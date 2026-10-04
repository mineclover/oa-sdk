import { describe, expect, it } from 'vitest'

import { derefSpecWithDiagnostics } from '../deref.js'
import { derefInternalSpecWithDiagnostics } from '../deref-internal.js'
import { parseDocument as parseBrowserDocument } from '../parse-browser.js'
import { parseDocument } from '../parse.js'
import type { OasDocument } from '../oas32-types.js'

type CycleStrategy = 'empty-schema' | 'preserve-ref'
type DiagnosticTrace = Array<[code: string, ref: string]>

const runtimes = [
  ['Node', (spec: unknown, cycleStrategy: CycleStrategy) => {
    const { document, diagnostics } = derefSpecWithDiagnostics(spec, { cycleStrategy })
    return { document, trace: diagnostics.map(d => [d.code, d.ref]) as DiagnosticTrace }
  }],
  ['browser', (spec: unknown, cycleStrategy: CycleStrategy) => {
    const { document, diagnostics } = derefInternalSpecWithDiagnostics(spec, { cycleStrategy })
    return { document, trace: diagnostics.map(d => [d.code, d.ref]) as DiagnosticTrace }
  }],
] as const

type OracleFrame = { ref: string; descents: number }

/**
 * Un-memoized reference expansion: every use site re-expands its target under
 * its own cycle stack. A cycle is valid recursion (no diagnostic) when the path
 * from the target crossed `properties` or `items`. Fixtures avoid $ref siblings,
 * missing targets, and property names that collide with keywords so the oracle
 * stays minimal.
 */
function naiveExpand(
  node: unknown,
  root: Record<string, any>,
  stack: readonly OracleFrame[],
  descents: number,
  keysAreNames: boolean,
  strategy: CycleStrategy,
  trace: DiagnosticTrace,
): unknown {
  if (Array.isArray(node)) {
    return node.map(item => naiveExpand(item, root, stack, descents, false, strategy, trace))
  }
  if (!node || typeof node !== 'object') return node
  const record = node as Record<string, unknown>
  if (typeof record.$ref === 'string') {
    const ref = record.$ref
    const frame = stack.find(entry => entry.ref === ref)
    if (frame) {
      if (descents === frame.descents) trace.push(['ref-cycle', ref])
      return strategy === 'preserve-ref' ? { $ref: ref } : {}
    }
    const name = ref.slice('#/components/schemas/'.length)
    return naiveExpand(
      root.components.schemas[name], root, [...stack, { ref, descents }], descents, false, strategy, trace,
    )
  }
  return Object.fromEntries(Object.entries(record).map(([key, value]) => {
    const descends = !keysAreNames && (key === 'properties' || key === 'items')
    return [key, naiveExpand(
      value,
      root,
      stack,
      descents + (descends ? 1 : 0),
      !keysAreNames && key === 'properties',
      strategy,
      trace,
    )]
  }))
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

function randomGraphSpec(seed: number, schemaCount: number): Record<string, any> {
  const random = seededRandom(seed)
  const schemas: Record<string, unknown> = {}
  for (let index = 0; index < schemaCount; index++) {
    const properties: Record<string, unknown> = { id: { type: 'string' } }
    const refCount = Math.floor(random() * 3)
    for (let edge = 0; edge < refCount; edge++) {
      const target = Math.floor(random() * schemaCount)
      properties[`to${edge}`] = random() < 0.25
        ? { type: 'array', items: { $ref: `#/components/schemas/S${target}` } }
        : { $ref: `#/components/schemas/S${target}` }
    }
    // allOf edges re-evaluate the same instance, so cycles made only of them
    // are diagnostics while cycles through properties/items are recursion.
    const allOf = random() < 0.4
      ? [{ $ref: `#/components/schemas/S${Math.floor(random() * schemaCount)}` }]
      : undefined
    schemas[`S${index}`] = { type: 'object', properties, ...(allOf ? { allOf } : {}) }
  }
  const paths: Record<string, unknown> = {}
  for (let index = 0; index < 3; index++) {
    const target = Math.floor(random() * schemaCount)
    paths[`/p${index}`] = {
      get: {
        responses: {
          200: {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: `#/components/schemas/S${target}` } } },
          },
        },
      },
    }
  }
  return { openapi: '3.2.0', info: { title: 'graph', version: '1' }, paths, components: { schemas } }
}

function diamondSpec(depth: number): OasDocument {
  const schemas: Record<string, unknown> = {
    [`D${depth}`]: { type: 'object', properties: { value: { type: 'string' } } },
  }
  for (let level = depth - 1; level >= 0; level--) {
    const next = `#/components/schemas/D${level + 1}`
    schemas[`D${level}`] = {
      type: 'object',
      properties: { left: { $ref: next }, right: { $ref: next } },
    }
  }
  return {
    openapi: '3.2.0',
    info: { title: 'diamond', version: '1' },
    paths: {},
    components: { schemas },
  } as OasDocument
}

describe('ref expansion memo', () => {
  describe.each(runtimes)('%s deref', (_runtime, deref) => {
    it.each(['empty-schema', 'preserve-ref'] as const)(
      'matches un-memoized expansion on random ref graphs (%s)',
      (strategy) => {
        let cyclicSeeds = 0
        for (let seed = 1; seed <= 60; seed++) {
          const spec = randomGraphSpec(seed, 2 + (seed % 7))
          const expectedTrace: DiagnosticTrace = []
          const expected = naiveExpand(spec, spec, [], 0, false, strategy, expectedTrace)

          const actual = deref(spec, strategy)

          expect(JSON.parse(JSON.stringify(actual.document)), `seed ${seed}`).toEqual(expected)
          expect(actual.trace, `seed ${seed}`).toEqual(expectedTrace)
          if (expectedTrace.length > 0) cyclicSeeds += 1
        }
        // Guard against a generator that never produces unguarded cycles.
        expect(cyclicSeeds).toBeGreaterThan(5)
      },
    )

    it('does not reuse an expansion that would observe a different cycle stack', () => {
      // B expanded on its own is B -> A -> (cycle B); inside A it is B -> (cycle A).
      const spec = {
        components: {
          schemas: {
            A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
            B: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
            X: {
              type: 'object',
              properties: {
                viaB: { $ref: '#/components/schemas/B' },
                viaA: { $ref: '#/components/schemas/A' },
              },
            },
          },
        },
      }

      const { document } = deref(spec, 'empty-schema') as { document: any }
      const x = document.components.schemas.X.properties
      expect(x.viaB.properties.a.properties.b).toEqual({})
      expect(x.viaA.properties.b.properties.a).toEqual({})
      expect(x.viaA.properties.b.properties.a.properties).toBeUndefined()
    })

    it('replays diagnostics from a shared target at every use site', () => {
      const spec = diamondSpec(3) as any
      spec.components.schemas.D3.properties.missing = { $ref: '#/components/schemas/Missing' }

      const { trace } = deref(spec, 'empty-schema')

      // D0..D2 are walked once as components, then each expands the chain below it:
      // D2 reaches D3 twice, D1 four times, D0 eight times, plus D3 itself once.
      expect(trace.filter(([code]) => code === 'ref-not-found')).toHaveLength(1 + 2 + 4 + 8)
    })
  })

  it.each([
    ['Node', parseDocument],
    ['browser', parseBrowserDocument],
  ] as const)('%s parser expands a 40-level diamond by sharing subtrees', (_runtime, parse) => {
    const parsed = parse(diamondSpec(40))

    expect(parsed.resolution?.status).toBe('complete')
    const root = parsed.schemas['D0'] as any
    expect(root.properties.left).toBe(root.properties.right)
    let node = root
    for (let level = 0; level < 40; level++) node = node.properties.right
    expect(node.properties.value).toEqual({ type: 'string' })
  })
})
