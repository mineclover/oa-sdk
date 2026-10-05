import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectRefs } from '@oa-sdk/parser'
import { afterEach, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import type { BuildSpecProvenanceMap } from '../cli/lib/provenance-report.js'
import {
  REF_PROJECTION_SCHEMA_VERSION,
  createRefProjectionArtifact,
  serializeRefProjectionArtifact,
  summarizeRefProjectionArtifact,
  type RefProjectionArtifact,
  type RefProjectionArtifactSourceFile,
} from '../cli/lib/ref-projection-artifact.js'
import { validateRefProjectionArtifact } from '../cli/lib/ref-projection-artifact-schema.js'
import { createRefProjectionArtifactFromFiles } from '../cli/lib/ref-projection-files.js'

const fixtureDir = fileURLToPath(new URL('../../test/fixtures/ref-projection/', import.meta.url))
const generator = { name: '@oa-sdk/codegen', version: '0.0.0-fixture' }
const spec: RefProjectionArtifactSourceFile = {
  path: 'api.yaml',
  contentHash: `sha256:${'0'.repeat(64)}`,
}

const tempDirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'oa-sdk-ref-projection-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fixtureArtifact(root = fixtureDir): RefProjectionArtifact {
  return createRefProjectionArtifactFromFiles({
    specPath: 'api.yaml',
    provenancePath: 'provenance.json',
    root,
    generator,
  })
}

function readFixtureDocument(): Record<string, unknown> {
  return parseYaml(readFileSync(join(fixtureDir, 'api.yaml'), 'utf8')) as Record<string, unknown>
}

function readFixtureProvenance(): BuildSpecProvenanceMap {
  return JSON.parse(readFileSync(join(fixtureDir, 'provenance.json'), 'utf8')) as BuildSpecProvenanceMap
}

/** The same JSON value with every object's keys in reverse order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]))
}

describe('oa-sdk.ref-projection.v1 artifact', () => {
  it('matches the reviewed golden artifact of the fixture', () => {
    // The fixture covers guarded recursion (a self-reference and a cycle through
    // shared.yaml), unguarded recursion, external and whole-file external targets,
    // a dangling ref, references whose occurrence or target lies outside every
    // node, a webhook, and a provenance map that covers part of the nodes.
    const expected = readFileSync(join(fixtureDir, 'expected.ref-projection.json'), 'utf8')
    expect(serializeRefProjectionArtifact(fixtureArtifact())).toBe(expected)
  })

  it('conforms to the published JSON Schema', () => {
    const artifact = fixtureArtifact()
    expect(validateRefProjectionArtifact(artifact)).toEqual([])
    expect(artifact.schemaVersion).toBe(REF_PROJECTION_SCHEMA_VERSION)
  })

  it('rejects artifacts that leave the schema', () => {
    const artifact = fixtureArtifact()
    const node = artifact.nodes[0]!
    const broken = [
      { ...artifact, schemaVersion: 'oa-sdk.ref-projection.v2' },
      { ...artifact, nodes: [{ ...node, identity: { status: 'unmapped' } }] },
      { ...artifact, nodes: [{ ...node, identity: { status: 'unmapped', reason: 'unknown' } }] },
      { ...artifact, nodes: [{ ...node, identity: { status: 'mapped', reason: 'external-document' } }] },
      { ...artifact, nodes: [{ ...node, pointer: '#components' }] },
      { ...artifact, edges: [{ ...artifact.edges[0]!, recursion: undefined }] },
      { ...artifact, source: { spec: { path: 'api.yaml', contentHash: 'md5:abc' } } },
      { ...artifact, generatedAt: '2026-10-05T00:00:00Z' },
    ]
    for (const value of broken) {
      expect(validateRefProjectionArtifact(JSON.parse(JSON.stringify(value)))).not.toEqual([])
    }
  })

  it('gives every node a unique id and a canonicalId or a reason, and every edge known ends', () => {
    const artifact = fixtureArtifact()
    const nodeIds = artifact.nodes.map(node => node.id)
    expect(new Set(nodeIds).size).toBe(nodeIds.length)
    const edgeIds = artifact.edges.map(edge => edge.id)
    expect(new Set(edgeIds).size).toBe(edgeIds.length)
    for (const edge of artifact.edges) {
      expect(nodeIds).toContain(edge.source)
      expect(nodeIds).toContain(edge.target)
    }
    for (const node of artifact.nodes) {
      const identity = node.identity
      expect(identity.status === 'mapped' ? identity.canonicalId : identity.reason).toBeTruthy()
    }
    expect(summarizeRefProjectionArtifact(artifact)).toEqual({
      nodes: 13,
      edges: 12,
      diagnostics: 5,
      recursion: { none: 7, guarded: 3, unguarded: 2 },
      mappedNodes: 6,
      unmappedNodes: { 'external-document': 3, 'no-enclosing-provenance-entry': 4 },
    })
  })

  it('names every $ref occurrence the graph reaches in an edge or a diagnostic', () => {
    const artifact = fixtureArtifact()
    const occurrences: string[] = []
    for (const file of ['api.yaml', './shared.yaml']) {
      const document = parseYaml(readFileSync(join(fixtureDir, file), 'utf8')) as unknown
      const prefix = file === 'api.yaml' ? '' : file
      collectRefs(document, '#', (_ref, sourcePointer) => occurrences.push(`${prefix}${sourcePointer}`))
    }
    const named = new Set([
      ...artifact.edges.map(edge => edge.id),
      ...artifact.diagnostics.map(diagnostic => `${diagnostic.sourceFilePath ?? ''}${diagnostic.sourcePointer ?? ''}`),
    ])
    expect([...named].sort()).toEqual([...occurrences].sort())
  })

  it('reports a $ref whose occurrence or target lies outside every node instead of dropping it', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'api.yaml'), [
      'openapi: 3.2.0',
      'info: { title: Outside, version: 1.0.0 }',
      'paths: {}',
      'components:',
      '  schemas:',
      '    A:',
      '      type: object',
      '      properties:',
      "        t: { $ref: '#/x-shared/Thing' }",
      'x-shared:',
      "  Thing: { $ref: '#/components/schemas/A' }",
    ].join('\n'))

    const artifact = createRefProjectionArtifactFromFiles({ specPath: 'api.yaml', root: dir, generator })
    expect(artifact.edges).toEqual([])
    expect(artifact.diagnostics).toEqual([
      {
        code: 'ref-target-outside-nodes',
        ref: '#/x-shared/Thing',
        message: expect.stringContaining('#/x-shared/Thing'),
        sourcePointer: '#/components/schemas/A/properties/t/$ref',
        pointer: '#/x-shared/Thing',
      },
      {
        code: 'ref-source-outside-nodes',
        ref: '#/components/schemas/A',
        message: expect.stringContaining('#/x-shared/Thing/$ref'),
        sourcePointer: '#/x-shared/Thing/$ref',
        pointer: '#/components/schemas/A',
      },
    ])
    expect(serializeRefProjectionArtifact(artifact)).not.toContain(dir)
    expect(validateRefProjectionArtifact(artifact)).toEqual([])
  })

  it('is byte-identical for the same files at the same root-relative paths in different checkouts', () => {
    const first = tempDir()
    const second = join(tempDir(), 'nested', 'copy')
    cpSync(fixtureDir, first, { recursive: true })
    cpSync(fixtureDir, second, { recursive: true })

    const firstText = serializeRefProjectionArtifact(fixtureArtifact(first))
    const secondText = serializeRefProjectionArtifact(fixtureArtifact(second))
    expect(secondText).toBe(firstText)
    expect(firstText).not.toContain(first)
    expect(secondText).not.toContain(second)
  })

  it('changes only the root-relative paths when the same files run under another project root', () => {
    const base = tempDir()
    const project = join(base, 'project')
    cpSync(fixtureDir, project, { recursive: true })
    // Absolute fragment paths, as build-spec writes them, are rewritten against the root.
    const provenance = Object.fromEntries(
      Object.entries(readFixtureProvenance())
        .map(([pointer, entry]) => [pointer, { ...entry, sourcePath: join(project, entry.sourcePath) }]),
    )
    writeFileSync(join(project, 'provenance.json'), JSON.stringify(provenance, null, 2))
    const create = (root: string, prefix: string) => createRefProjectionArtifactFromFiles({
      specPath: `${prefix}api.yaml`,
      provenancePath: `${prefix}provenance.json`,
      root,
      generator,
    })

    const atProject = create(project, '')
    const atBase = create(base, 'project/')
    expect(atBase.source.spec).toEqual({ ...atProject.source.spec, path: 'project/api.yaml' })
    expect(atBase.source.provenance).toEqual({ ...atProject.source.provenance!, path: 'project/provenance.json' })
    expect(atBase.nodes).toEqual(atProject.nodes.map(node => node.identity.status === 'mapped'
      ? { ...node, identity: { ...node.identity, sourcePath: `project/${node.identity.sourcePath}` } }
      : node))
    expect(atBase.nodes.some(node => node.identity.status === 'mapped')).toBe(true)
    expect({ ...atBase, source: atProject.source, nodes: atProject.nodes }).toEqual(atProject)
  })

  it('writes the absolute fragment paths of build-spec provenance relative to the project root', () => {
    // `oa-gen build-spec --provenance` records each sourcePath as an absolute
    // path of the checkout it ran in; the artifact must not carry it.
    const golden = JSON.parse(
      readFileSync(join(fixtureDir, 'expected.ref-projection.json'), 'utf8'),
    ) as RefProjectionArtifact
    for (const root of [tempDir(), join(tempDir(), 'nested', 'copy')]) {
      cpSync(fixtureDir, root, { recursive: true })
      const provenance = Object.fromEntries(
        Object.entries(readFixtureProvenance())
          .map(([pointer, entry]) => [pointer, { ...entry, sourcePath: join(root, entry.sourcePath) }]),
      )
      writeFileSync(join(root, 'provenance.json'), JSON.stringify(provenance, null, 2))

      const artifact = fixtureArtifact(root)
      expect(artifact.nodes).toEqual(golden.nodes)
      expect(serializeRefProjectionArtifact(artifact)).not.toContain(root)
    }
  })

  it('reads an entry document named by a relative or unnormalized entryPath as the entry document', () => {
    // shared.yaml refers back into api.yaml, so the projection meets the entry
    // file again through an external document and must recognize it.
    const entryPath = join(fixtureDir, 'api.yaml')
    const create = (path: string) => serializeRefProjectionArtifact(createRefProjectionArtifact({
      document: readFixtureDocument(),
      entryPath: path,
      spec,
      generator,
    }))
    const expected = create(entryPath)

    for (const variant of [relative(process.cwd(), entryPath), `${fixtureDir}../ref-projection/api.yaml`]) {
      const text = create(variant)
      const edgeIds = (JSON.parse(text) as RefProjectionArtifact).edges.map(edge => edge.id)
      expect(new Set(edgeIds).size, variant).toBe(edgeIds.length)
      expect(text, variant).not.toContain(fixtureDir)
      expect(text, variant).toBe(expected)
    }
  })

  it('orders its content independently of the key order of the document', () => {
    const entryPath = join(fixtureDir, 'api.yaml')
    const create = (document: Record<string, unknown>, provenance: BuildSpecProvenanceMap) =>
      serializeRefProjectionArtifact(createRefProjectionArtifact({
        document,
        entryPath,
        spec,
        provenance: { map: provenance, source: { path: 'provenance.json', contentHash: spec.contentHash }, root: fixtureDir },
        generator,
      }))

    const reordered = create(
      reverseKeys(readFixtureDocument()) as Record<string, unknown>,
      reverseKeys(readFixtureProvenance()) as BuildSpecProvenanceMap,
    )
    expect(reordered).toBe(create(readFixtureDocument(), readFixtureProvenance()))
  })

  it('reads its inputs without modifying them', () => {
    const document = readFixtureDocument()
    const provenance = readFixtureProvenance()
    const documentBefore = structuredClone(document)
    const provenanceBefore = structuredClone(provenance)

    createRefProjectionArtifact({
      document,
      entryPath: join(fixtureDir, 'api.yaml'),
      spec,
      provenance: { map: provenance, source: spec, root: fixtureDir },
      generator,
    })
    expect(document).toEqual(documentBefore)
    expect(provenance).toEqual(provenanceBefore)
  })

  it('states why nodes have no canonicalId when no provenance is supplied', () => {
    const artifact = createRefProjectionArtifactFromFiles({ specPath: 'api.yaml', root: fixtureDir, generator })
    expect(artifact.source).not.toHaveProperty('provenance')
    for (const node of artifact.nodes) {
      expect(node.identity).toEqual({
        status: 'unmapped',
        reason: node.filePath === undefined ? 'provenance-not-supplied' : 'external-document',
      })
    }
    expect(validateRefProjectionArtifact(artifact)).toEqual([])
  })

  it('maps a node through its nearest enclosing provenance entry only', () => {
    const entry = (canonicalId: string) => ({
      canonicalId,
      kind: 'schema',
      sourcePath: 'fragments/all.yaml',
      sourcePointer: '#',
      contentHash: 'h',
    }) as BuildSpecProvenanceMap[string]
    const artifact = createRefProjectionArtifact({
      document: readFixtureDocument(),
      entryPath: join(fixtureDir, 'api.yaml'),
      spec,
      provenance: {
        map: {
          // An ancestor of every schema declaration.
          '#/components/schemas': entry('schema:public/all/Schemas'),
          // A child of a path declaration does not identify the path.
          '#/paths/~1pets~1{id}/get': entry('path:public/pets/pet-by-id'),
        },
        source: spec,
        root: fixtureDir,
      },
      generator,
    })
    const identities = Object.fromEntries(artifact.nodes.map(node => [node.id, node.identity]))

    expect(identities['#/components/schemas/Pet']).toMatchObject({
      status: 'mapped',
      canonicalId: 'schema:public/all/Schemas',
      provenancePointer: '#/components/schemas',
    })
    expect(identities['#/paths/~1pets~1{id}']).toEqual({ status: 'unmapped', reason: 'no-enclosing-provenance-entry' })
    expect(identities['#/components/responses/OwnerList']).toEqual({ status: 'unmapped', reason: 'no-enclosing-provenance-entry' })
  })

  it('writes the files of external diagnostics relative to the entry document', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'api.yaml'), [
      'openapi: 3.2.0',
      'info: { title: Missing, version: 1.0.0 }',
      'paths: {}',
      'components:',
      '  schemas:',
      '    Pet:',
      "      $ref: './missing.yaml#/components/schemas/Pet'",
    ].join('\n'))

    const artifact = createRefProjectionArtifactFromFiles({ specPath: 'api.yaml', root: dir, generator })
    expect(artifact.diagnostics).toEqual([
      expect.objectContaining({
        code: 'external-ref-read-failed',
        sourcePointer: '#/components/schemas/Pet/$ref',
        filePath: './missing.yaml',
        pointer: '#/components/schemas/Pet',
      }),
    ])
    expect(artifact.diagnostics[0]!.message).toContain('./missing.yaml')
    expect(serializeRefProjectionArtifact(artifact)).not.toContain(dir)
    expect(validateRefProjectionArtifact(artifact)).toEqual([])
  })

  it('rejects unreadable and malformed input files', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'broken.yaml'), 'openapi: [3.2.0\n')
    writeFileSync(join(dir, 'list.yaml'), '- openapi\n')
    writeFileSync(join(dir, 'api.json'), '{"openapi": "3.2.0", "paths": {}}')
    writeFileSync(join(dir, 'not-json.json'), '{')
    writeFileSync(join(dir, 'bad-entry.json'), JSON.stringify({ '#/paths/~1x': { canonicalId: 'path:public/x/x' } }))
    writeFileSync(join(dir, 'empty-id.json'), JSON.stringify({
      '#/paths/~1x': { canonicalId: '', kind: 'path', sourcePath: 'x.yaml', sourcePointer: '#', contentHash: 'h' },
    }))
    const create = (specPath: string, provenancePath?: string) => () => createRefProjectionArtifactFromFiles({
      specPath,
      ...(provenancePath !== undefined ? { provenancePath } : {}),
      root: dir,
      generator,
    })

    expect(create('absent.yaml')).toThrow(/spec 파일을 읽을 수 없습니다/)
    expect(create('broken.yaml')).toThrow(/spec 파일을 파싱할 수 없습니다/)
    expect(create('list.yaml')).toThrow(/OpenAPI 문서 객체여야 합니다/)
    expect(create('main.tsp')).toThrow(/TypeSpec/)
    expect(create('api.json', 'absent.json')).toThrow(/provenance 파일을 읽을 수 없습니다/)
    expect(create('api.json', 'not-json.json')).toThrow(/provenance 파일을 파싱할 수 없습니다/)
    expect(create('api.json', 'bad-entry.json')).toThrow(/Invalid provenance entry at #\/paths\/~1x/)
    expect(create('api.json', 'empty-id.json')).toThrow('Invalid provenance entry at #/paths/~1x: canonicalId must not be empty')
    expect(create('api.json')()).toMatchObject({ source: { spec: { path: 'api.json' } }, nodes: [] })
  })
})
