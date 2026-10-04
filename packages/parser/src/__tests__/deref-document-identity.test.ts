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
 *
 * A recursion cut kept by `preserve-ref` is a `$ref` of the output document, so
 * it must name its target from the entry file's location even when it was
 * written in a file in another directory.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { derefSpecWithDiagnostics, type DerefCycleStrategy } from '../deref.js'
import { resolveJsonPointer } from '../json-pointer.js'
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
  /** External documents: path relative to the entry (`api.json`) → `components.schemas`. */
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
    // A diagnosed cut keeps the `$ref` as written in its document (inner.json), like
    // every other diagnosed ref; the diagnostic names that document as `sourceFilePath`.
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
    // The cut is written in link.json; it targets the entry document, so the output names it `#...`.
    expected: cut => ({
      type: 'object',
      properties: {
        next: { type: 'object', properties: { node: cut('#/components/schemas/Node') } },
      },
    }),
    diagnostics: [],
    recursiveRefs: [
      '#/components/schemas/Node',
      './link.json#/components/schemas/Link',
    ],
  },
  {
    name: 'valid recursion back into the entry from a subdirectory',
    entry: {
      Node: { type: 'object', properties: { next: { $ref: './sub/link.json#/components/schemas/Link' } } },
    },
    files: {
      'sub/link.json': {
        Link: { type: 'object', properties: { node: { $ref: `../${ENTRY_FILE}#/components/schemas/Node` } } },
      },
    },
    bundled: {
      Node: { type: 'object', properties: { next: { $ref: '#/components/schemas/Link' } } },
      Link: { type: 'object', properties: { node: { $ref: '#/components/schemas/Node' } } },
    },
    expected: cut => ({
      type: 'object',
      properties: {
        next: { type: 'object', properties: { node: cut('#/components/schemas/Node') } },
      },
    }),
    diagnostics: [],
    recursiveRefs: [
      '#/components/schemas/Node',
      './sub/link.json#/components/schemas/Link',
    ],
  },
  {
    name: 'valid recursion inside a subdirectory document',
    entry: {
      Node: { type: 'object', properties: { root: { $ref: './sub/tree.json#/components/schemas/Tree' } } },
    },
    files: {
      'sub/tree.json': {
        Tree: {
          type: 'object',
          properties: { children: { type: 'array', items: { $ref: '#/components/schemas/Tree' } } },
        },
      },
    },
    bundled: {
      Node: { type: 'object', properties: { root: { $ref: '#/components/schemas/SubTree' } } },
      SubTree: {
        type: 'object',
        properties: { children: { type: 'array', items: { $ref: '#/components/schemas/SubTree' } } },
      },
    },
    // `#/components/schemas/Tree` is written in sub/tree.json; from the entry it is that file's Tree.
    expected: cut => ({
      type: 'object',
      properties: {
        root: {
          type: 'object',
          properties: { children: { type: 'array', items: cut('./sub/tree.json#/components/schemas/Tree') } },
        },
      },
    }),
    diagnostics: [],
    recursiveRefs: ['./sub/tree.json#/components/schemas/Tree'],
  },
  {
    name: 'valid recursion between documents in sibling directories',
    entry: {
      Node: { type: 'object', properties: { left: { $ref: './a/left.json#/components/schemas/Left' } } },
    },
    files: {
      'a/left.json': {
        Left: { type: 'object', properties: { right: { $ref: '../b/right.json#/components/schemas/Right' } } },
      },
      'b/right.json': {
        Right: { type: 'object', properties: { left: { $ref: '../a/left.json#/components/schemas/Left' } } },
      },
    },
    bundled: {
      Node: { type: 'object', properties: { left: { $ref: '#/components/schemas/ALeft' } } },
      ALeft: { type: 'object', properties: { right: { $ref: '#/components/schemas/BRight' } } },
      BRight: { type: 'object', properties: { left: { $ref: '#/components/schemas/ALeft' } } },
    },
    expected: cut => ({
      type: 'object',
      properties: {
        left: {
          type: 'object',
          properties: {
            right: {
              type: 'object',
              properties: { left: cut('./a/left.json#/components/schemas/Left') },
            },
          },
        },
      },
    }),
    diagnostics: [],
    recursiveRefs: ['./a/left.json#/components/schemas/Left'],
  },
  {
    name: 'unguarded cycle in a subdirectory document',
    entry: {
      Node: { allOf: [{ $ref: './sub/loop.json#/components/schemas/A' }] },
    },
    files: {
      'sub/loop.json': {
        A: { allOf: [{ $ref: '#/components/schemas/B' }] },
        B: { allOf: [{ $ref: '#/components/schemas/A' }] },
      },
    },
    bundled: {
      Node: { allOf: [{ $ref: '#/components/schemas/LoopA' }] },
      LoopA: { allOf: [{ $ref: '#/components/schemas/LoopB' }] },
      LoopB: { allOf: [{ $ref: '#/components/schemas/LoopA' }] },
    },
    // Diagnosed: the cut keeps its sub/loop.json spelling and matches the diagnostic.
    expected: cut => ({ allOf: [{ allOf: [{ allOf: [cut('#/components/schemas/A')] }] }] }),
    diagnostics: ['ref-cycle #/components/schemas/A'],
    recursiveRefs: [],
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
      mkdirSync(dirname(join(dir, file)), { recursive: true })
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

describe('preserve-ref cuts in the output document', () => {
  it.each(scenarios.map(scenario => [scenario.name, scenario] as const))(
    'recursion cuts name their target from the entry file: %s',
    (_name, scenario) => {
      const entryPath = entryPaths.get(scenario)!
      const options = nodeOptions(scenario, 'preserve-ref')
      const parsed = parseDocument(document(scenario.entry), options)
      const { recursiveRefs } = derefSpecWithDiagnostics(document(scenario.entry), options)
      const cutRefs = collectRefs([subject(parsed), parsed.schemas])
      if (parsed.resolution?.status !== 'complete') return

      for (const ref of cutRefs) {
        expect(recursiveRefs, ref).toContain(ref)
        expect(resolveFromFile(entryPath, ref), `${ref} from ${ENTRY_FILE}`).toBeDefined()
      }
    },
  )

  it.each(scenarios.map(scenario => [scenario.name, scenario] as const))(
    'ref-cycle diagnostics name the cut as written in their source file: %s',
    (_name, scenario) => {
      const parsed = parseDocument(document(scenario.entry), nodeOptions(scenario, 'preserve-ref'))
      const cycles = diagnostics(parsed).filter(diagnostic => diagnostic.code === 'ref-cycle')

      for (const diagnostic of cycles) {
        expect(diagnostic.sourceFilePath, diagnostic.ref).toBeDefined()
        expect(resolveFromFile(diagnostic.sourceFilePath!, diagnostic.ref), diagnostic.ref).toBeDefined()
      }
      // Each kept cut is covered by its diagnostic, so no remaining-ref diagnostic is added.
      expect(new Set(diagnostics(parsed).map(diagnostic => diagnostic.code)))
        .toEqual(new Set(cycles.length > 0 ? ['ref-cycle'] : []))
    },
  )

  it('locates a diagnosed cut in a subdirectory by its source file', () => {
    const scenario = scenarios.find(candidate => candidate.name === 'unguarded cycle in a subdirectory document')!
    const parsed = parseDocument(document(scenario.entry), nodeOptions(scenario, 'preserve-ref'))

    expect(diagnostics(parsed)).toEqual([expect.objectContaining({
      code: 'ref-cycle',
      ref: '#/components/schemas/A',
      pointer: '#/components/schemas/A',
      sourceFilePath: join(dirname(entryPaths.get(scenario)!), 'sub', 'loop.json'),
    })])
  })
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

/** Every `$ref` string under `value`. */
function collectRefs(value: unknown, refs = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') refs.add(child)
      else collectRefs(child, refs)
    }
  }
  return refs
}

/** Plain file-relative `$ref` lookup, independent of the resolver under test. */
function resolveFromFile(documentPath: string, ref: string): unknown {
  const hashIndex = ref.indexOf('#')
  const file = hashIndex === -1 ? ref : ref.slice(0, hashIndex)
  const fragment = hashIndex === -1 ? '#' : ref.slice(hashIndex)
  const targetPath = file ? join(dirname(documentPath), file) : documentPath
  let target: unknown
  try {
    target = JSON.parse(readFileSync(targetPath, 'utf8'))
  } catch {
    return undefined
  }
  return resolveJsonPointer(target, fragment)
}

/** Cut refs to other documents are spelled with their file; compare only where cuts are. */
function normalizeCuts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeCuts)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) =>
    [key, key === '$ref' ? '<cut>' : normalizeCuts(child)]))
}
