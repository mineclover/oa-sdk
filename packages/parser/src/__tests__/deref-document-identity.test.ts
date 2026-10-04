/**
 * Cycle identity across documents.
 *
 * Node deref tracks `$ref` cycles by (document, pointer): `#/components/schemas/Node`
 * inside an external file is a different target from the entry document's
 * `#/components/schemas/Node`, and the entry file reached through an external ref
 * is the entry document itself.
 *
 * Oracle: splitting a contract into files must not move a cycle cut or change
 * whether a cycle is valid recursion. Every scenario is also bundled into one
 * document (external targets renamed). The Node parse of the split files must
 * cut where the bundled parse cuts, and the browser parse of the bundled
 * document must equal the Node parse of it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { derefSpecWithDiagnostics, type DerefCycleStrategy } from '../deref.js'
import { parseDocument as parseBrowserDocument } from '../parse-browser.js'
import { parseDocument } from '../parse.js'
import { resolveRefGraph } from '../ref-graph.js'
import type { OasDocument } from '../oas32-types.js'
import type { ParsedDocument, ParsedDocumentRefDiagnostic } from '../types.js'

type Schemas = Record<string, unknown>
type Cut = (ref: string) => unknown

type Scenario = {
  name: string
  /** Entry `components.schemas`. `Node` is the subject served by `GET /subject`. */
  entry: Schemas
  /** External documents next to the entry (`api.json`): file name → `components.schemas`. */
  files: Record<string, Schemas>
  /** The same contract as a single document. */
  bundled: Schemas
  /** Subject schema from the split files, given how the strategy represents a cut. */
  expected: (cut: Cut) => unknown
  /** `code ref` of every ref diagnostic of the split-file parse. */
  diagnostics: string[]
  /** Refs cut as valid recursion in the split-file parse. */
  recursiveRefs: string[]
}

const ENTRY_FILE = 'api.json'
const SUBJECT = '#/components/schemas/Node'
const leaf = { type: 'object', properties: { id: { type: 'string' } } }

const scenarios: Scenario[] = [
  {
    name: 'same pointer in two documents, reached under properties',
    entry: {
      Node: { type: 'object', properties: { shared: { $ref: './shared.json#/components/schemas/Wrapper' } } },
    },
    files: {
      'shared.json': {
        Node: leaf,
        Wrapper: { type: 'object', properties: { node: { $ref: '#/components/schemas/Node' } } },
      },
    },
    bundled: {
      Node: { type: 'object', properties: { shared: { $ref: '#/components/schemas/SharedWrapper' } } },
      SharedWrapper: { type: 'object', properties: { node: { $ref: '#/components/schemas/SharedNode' } } },
      SharedNode: leaf,
    },
    expected: () => ({
      type: 'object',
      properties: { shared: { type: 'object', properties: { node: leaf } } },
    }),
    diagnostics: [],
    recursiveRefs: [],
  },
  {
    name: 'same pointer in two documents, reached through allOf only',
    entry: {
      Node: { allOf: [{ $ref: './shared.json#/components/schemas/Alias' }] },
    },
    files: {
      'shared.json': {
        Node: leaf,
        Alias: { allOf: [{ $ref: '#/components/schemas/Node' }] },
      },
    },
    bundled: {
      Node: { allOf: [{ $ref: '#/components/schemas/SharedAlias' }] },
      SharedAlias: { allOf: [{ $ref: '#/components/schemas/SharedNode' }] },
      SharedNode: leaf,
    },
    expected: () => ({ allOf: [{ allOf: [leaf] }] }),
    diagnostics: [],
    recursiveRefs: [],
  },
  {
    name: 'unguarded cycle in a nested external document behind a same-named pointer',
    entry: {
      Node: { $ref: './outer.json#/components/schemas/Holder' },
    },
    files: {
      'outer.json': {
        Holder: { type: 'object', properties: { node: { $ref: '#/components/schemas/Node' } } },
        Node: { type: 'object', properties: { inner: { $ref: './inner.json#/components/schemas/Loop' } } },
      },
      'inner.json': {
        Loop: { allOf: [{ $ref: '#/components/schemas/Node' }] },
        Node: { allOf: [{ $ref: '#/components/schemas/Loop' }] },
      },
    },
    bundled: {
      Node: { $ref: '#/components/schemas/OuterHolder' },
      OuterHolder: { type: 'object', properties: { node: { $ref: '#/components/schemas/OuterNode' } } },
      OuterNode: { type: 'object', properties: { inner: { $ref: '#/components/schemas/InnerLoop' } } },
      InnerLoop: { allOf: [{ $ref: '#/components/schemas/InnerNode' }] },
      InnerNode: { allOf: [{ $ref: '#/components/schemas/InnerLoop' }] },
    },
    // preserve-ref keeps the `$ref` spelling of the document the cut is in (inner.json).
    expected: cut => ({
      type: 'object',
      properties: {
        node: {
          type: 'object',
          properties: { inner: { allOf: [{ allOf: [cut('#/components/schemas/Loop')] }] } },
        },
      },
    }),
    diagnostics: ['ref-cycle #/components/schemas/Loop'],
    recursiveRefs: [],
  },
  {
    name: 'unguarded cycle across the entry and an external document',
    entry: {
      Node: { allOf: [{ $ref: './back.json#/components/schemas/Back' }] },
    },
    files: {
      'back.json': {
        Back: { allOf: [{ $ref: `./${ENTRY_FILE}#/components/schemas/Node` }] },
      },
    },
    bundled: {
      Node: { allOf: [{ $ref: '#/components/schemas/Back' }] },
      Back: { allOf: [{ $ref: '#/components/schemas/Node' }] },
    },
    expected: cut => ({ allOf: [{ allOf: [cut(`./${ENTRY_FILE}#/components/schemas/Node`)] }] }),
    diagnostics: [
      `ref-cycle ./${ENTRY_FILE}#/components/schemas/Node`,
      'ref-cycle ./back.json#/components/schemas/Back',
    ],
    recursiveRefs: [],
  },
  {
    name: 'valid recursion across the entry and an external document',
    entry: {
      Node: { type: 'object', properties: { next: { $ref: './link.json#/components/schemas/Link' } } },
    },
    files: {
      'link.json': {
        Link: { type: 'object', properties: { node: { $ref: `./${ENTRY_FILE}#/components/schemas/Node` } } },
      },
    },
    bundled: {
      Node: { type: 'object', properties: { next: { $ref: '#/components/schemas/Link' } } },
      Link: { type: 'object', properties: { node: { $ref: '#/components/schemas/Node' } } },
    },
    expected: cut => ({
      type: 'object',
      properties: {
        next: { type: 'object', properties: { node: cut(`./${ENTRY_FILE}#/components/schemas/Node`) } },
      },
    }),
    diagnostics: [],
    recursiveRefs: [
      `./${ENTRY_FILE}#/components/schemas/Node`,
      './link.json#/components/schemas/Link',
    ],
  },
]

const strategies: ReadonlyArray<readonly [string, DerefCycleStrategy | undefined]> = [
  ['default', undefined],
  ['empty-schema', 'empty-schema'],
  ['preserve-ref', 'preserve-ref'],
]

const cases = scenarios.flatMap(scenario =>
  strategies.map(([label, strategy]) => [scenario.name, label, scenario, strategy] as const))

let root: string
const entryPaths = new Map<Scenario, string>()

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'oa-sdk-deref-identity-'))
  scenarios.forEach((scenario, index) => {
    const dir = join(root, String(index))
    mkdirSync(dir)
    const entryPath = join(dir, ENTRY_FILE)
    writeFileSync(entryPath, JSON.stringify(document(scenario.entry)))
    for (const [file, schemas] of Object.entries(scenario.files)) {
      writeFileSync(join(dir, file), JSON.stringify({ components: { schemas } }))
    }
    entryPaths.set(scenario, entryPath)
  })
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('Node deref keys cycles by (document, pointer)', () => {
  it.each(cases)('%s (%s)', (_name, _label, scenario, cycleStrategy) => {
    const options = nodeOptions(scenario, cycleStrategy)
    const parsed = parseDocument(document(scenario.entry), options)

    expect(subject(parsed)).toEqual(scenario.expected(cutFor(cycleStrategy)))
    expect(diagnosticKeys(parsed).sort()).toEqual([...scenario.diagnostics].sort())
    expect(parsed.resolution?.status).toBe(scenario.diagnostics.length === 0 ? 'complete' : 'partial')

    const { recursiveRefs } = derefSpecWithDiagnostics(document(scenario.entry), options)
    expect([...recursiveRefs].sort()).toEqual([...scenario.recursiveRefs].sort())
  })

  it.each(cases)('splitting into files keeps the cuts of the bundled document: %s (%s)', (
    _name,
    _label,
    scenario,
    cycleStrategy,
  ) => {
    const split = parseDocument(document(scenario.entry), nodeOptions(scenario, cycleStrategy))
    const bundled = parseDocument(document(scenario.bundled), cycleStrategy ? { cycleStrategy } : {})

    expect(normalizeCuts(subject(split))).toEqual(normalizeCuts(subject(bundled)))
    expect(normalizeCuts(split.schemas.Node)).toEqual(normalizeCuts(bundled.schemas.Node))
    expect(split.resolution?.status).toBe(bundled.resolution?.status)
  })

  it.each(scenarios.map(scenario => [scenario.name, scenario] as const))(
    'lint and parse agree on unguarded cycles: %s',
    (_name, scenario) => {
      const spec = document(scenario.entry)
      const parsed = parseDocument(spec, { basePath: entryPaths.get(scenario)! })
      const graph = resolveRefGraph(spec, { basePath: entryPaths.get(scenario)! })

      const parseCycle = diagnostics(parsed).some(diagnostic => diagnostic.code === 'ref-cycle')
      const lintCycle = graph.diagnostics.some(diagnostic => diagnostic.code === 'ref-cycle')
      expect(parseCycle).toBe(scenario.diagnostics.some(key => key.startsWith('ref-cycle ')))
      expect(lintCycle).toBe(parseCycle)
    },
  )
})

describe('browser deref has one document per key space', () => {
  it.each(cases)('agrees with Node deref on the bundled document: %s (%s)', (
    _name,
    _label,
    scenario,
    cycleStrategy,
  ) => {
    const options = cycleStrategy ? { cycleStrategy } : {}
    const browser = parseBrowserDocument(document(scenario.bundled), options)
    const node = parseDocument(document(scenario.bundled), options)

    expect(subject(browser)).toEqual(subject(node))
    expect(browser.schemas).toEqual(node.schemas)
    // Node diagnostics carry no use-site pointer, so compare the distinct `code ref` pairs.
    expect(new Set(diagnosticKeys(browser))).toEqual(new Set(diagnosticKeys(node)))
    expect(browser.resolution?.status).toBe(node.resolution?.status)
  })

  it.each(cases)('leaves external refs of the split files unresolved: %s (%s)', (
    _name,
    _label,
    scenario,
    cycleStrategy,
  ) => {
    // Without a loader the browser parser never enters another document, so a
    // pointer can only name a target in the document being parsed.
    const parsed = parseBrowserDocument(document(scenario.entry), cycleStrategy ? { cycleStrategy } : {})

    expect(subject(parsed)).toEqual(scenario.entry.Node)
    expect(parsed.resolution?.status).toBe('partial')
    expect(new Set(diagnostics(parsed).map(diagnostic => diagnostic.code)))
      .toEqual(new Set(['external-ref-unresolved']))
  })
})

describe('external targets are read from their file', () => {
  it('does not serve an external ref to the entry file from the in-memory expansion memo', () => {
    const dir = join(root, 'entry-file-ref')
    mkdirSync(dir)
    const entryPath = join(dir, ENTRY_FILE)
    // The file on disk and the in-memory document disagree, as with a projected spec.
    writeFileSync(entryPath, JSON.stringify(document({ Pet: { type: 'string', description: 'file' } })))
    const spec = {
      ...document({ Pet: { type: 'string', description: 'memory' } }),
      paths: {
        '/internal': { get: response('#/components/schemas/Pet') },
        '/external': { get: response(`./${ENTRY_FILE}#/components/schemas/Pet`) },
      },
    } as OasDocument

    const parsed = parseDocument(spec, { basePath: entryPath })
    const schemaOf = (path: string) => responseSchema(parsed.operations.find(op => op.openApiPath === path))

    expect(schemaOf('/internal')).toEqual({ type: 'string', description: 'memory' })
    expect(schemaOf('/external')).toEqual({ type: 'string', description: 'file' })
    expect(parsed.resolution?.status).toBe('complete')
  })
})

function document(schemas: Schemas): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Cycle identity', version: '1.0.0' },
    paths: { '/subject': { get: response(SUBJECT) } },
    components: { schemas },
  } as OasDocument
}

function response(ref: string) {
  return {
    responses: {
      '200': { description: 'OK', content: { 'application/json': { schema: { $ref: ref } } } },
    },
  }
}

function nodeOptions(scenario: Scenario, cycleStrategy: DerefCycleStrategy | undefined) {
  return { basePath: entryPaths.get(scenario)!, ...(cycleStrategy ? { cycleStrategy } : {}) }
}

function subject(parsed: ParsedDocument): unknown {
  return responseSchema(parsed.operations.find(op => op.openApiPath === '/subject'))
}

function responseSchema(operation: ParsedDocument['operations'][number] | undefined): unknown {
  const media = operation?.responses['200']?.content?.['application/json'] as { schema?: unknown } | undefined
  return media?.schema
}

function diagnostics(parsed: ParsedDocument): readonly ParsedDocumentRefDiagnostic[] {
  return parsed.resolution?.diagnostics ?? []
}

function diagnosticKeys(parsed: ParsedDocument): string[] {
  return diagnostics(parsed).map(diagnostic => `${diagnostic.code} ${diagnostic.ref}`)
}

function cutFor(cycleStrategy: DerefCycleStrategy | undefined): Cut {
  return ref => cycleStrategy === 'preserve-ref' ? { $ref: ref } : {}
}

/** Cut refs are spelled per document; compare only where cuts are. */
function normalizeCuts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeCuts)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) =>
    [key, key === '$ref' ? '<cut>' : normalizeCuts(child)]))
}
