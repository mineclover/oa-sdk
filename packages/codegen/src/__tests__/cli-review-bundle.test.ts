import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { stringify as stringifyYaml } from 'yaml'
import type { BuildSpecCompositionReport } from '../cli/lib/composition-report.js'
import type { DefinitionDuplicateReviewResult } from '../cli/lib/duplicate-review.js'
import type { BuildSpecMetadataRegistry } from '../cli/lib/metadata-registry.js'
import type { BuildSpecProvenanceEntry } from '../cli/lib/provenance-report.js'
import { loadSqliteDriver } from '../sqlite-workspace-index.js'
import type {
  ReviewBundle,
  ReviewBundleProvenanceDiff,
  ReviewBundleRuntimeDriftReport,
} from '../cli/lib/review-bundle.js'

const pkgDir = resolve(__dirname, '../..')
const cliPath = resolve(pkgDir, 'dist/cli/index.js')
const tmpBase = resolve(pkgDir, '.tmp-cli-review-bundle-test')

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpBase, `run-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
})

describe('oa-gen review-bundle', () => {
  it('approves a clean bundle and starts markdown with recommendation then summary', () => {
    const spec = reviewSpec('string')
    const basePath = writeYaml('base.yaml', spec)
    const headPath = writeYaml('head.yaml', spec)
    const artifactPath = writeYaml('artifact.yaml', spec)

    const result = runCli([
      'review-bundle',
      '--base',
      basePath,
      '--head',
      headPath,
      '--artifact',
      artifactPath,
    ])

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.startsWith('Recommendation: **APPROVE**\n\n## Summary')).toBe(true)
    expect(result.stdout).toContain('## Artifact Freshness')
    expect(result.stdout).not.toContain('## Runtime Drift')
    expect(result.stdout).not.toContain('## Inventory')
  })

  it('requests changes for breaking changes and keeps breaking before non-breaking changes', () => {
    const basePath = writeYaml('base.yaml', reviewSpec('string'))
    const head = reviewSpec('integer', {
      '/status': {
        get: {
          operationId: 'getStatus',
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const headPath = writeYaml('head.yaml', head)
    const artifactPath = writeYaml('artifact.yaml', head)

    const result = runCli([
      'review-bundle',
      '--base',
      basePath,
      '--head',
      headPath,
      '--artifact',
      artifactPath,
    ])

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Recommendation: **REQUEST_CHANGES**')
    expect(result.stdout).toContain('response-schema-changed')
    expect(result.stdout.indexOf('## Breaking Changes')).toBeLessThan(
      result.stdout.indexOf('## Non-breaking Changes'),
    )
  })

  it('renders an incomplete optional section set without requiring every sidecar', () => {
    const spec = reviewSpec('string')
    const basePath = writeYaml('base.yaml', spec)
    const headPath = writeYaml('head.yaml', spec)
    const artifactPath = writeYaml('artifact.yaml', spec)
    const runtimeDrift = runtimeDriftReport(false)
    const runtimeDriftPath = writeJson('runtime-drift.json', runtimeDrift)

    const result = runCli([
      'review-bundle',
      '--base',
      basePath,
      '--head',
      headPath,
      '--artifact',
      artifactPath,
      '--runtime-drift',
      runtimeDriftPath,
    ])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('## Runtime Drift')
    expect(result.stdout).not.toContain('## Inventory')
    expect(result.stdout).not.toContain('## Composition')
    expect(result.stdout).not.toContain('## Duplicate Review')
  })

  it('preserves optional reports under stable JSON section names', () => {
    const spec = reviewSpec('string')
    const basePath = writeYaml('base.yaml', spec)
    const headPath = writeYaml('head.yaml', spec)
    const artifactPath = writeYaml('artifact.yaml', spec)
    const runtimeDrift = runtimeDriftReport(false)
    const composition = compositionReport()
    const metadataRegistry = metadataRegistryReport()
    const duplicateReview = duplicateReviewReport()
    const runtimeDriftPath = writeJson('runtime-drift.json', runtimeDrift)
    const baseProvenancePath = writeJson('base.provenance.json', provenanceDiffBase())
    const headProvenancePath = writeJson('head.provenance.json', provenanceDiffHead())
    const provenanceDiff = provenanceDiffReport(baseProvenancePath, headProvenancePath)
    const compositionPath = writeJson('composition.json', composition)
    const metadataRegistryPath = writeJson('metadata-registry.json', metadataRegistry)
    const duplicateReviewPath = writeJson('duplicate-review.json', duplicateReview)

    const result = runCli([
      'review-bundle',
      '--base',
      basePath,
      '--head',
      headPath,
      '--artifact',
      artifactPath,
      '--inventory',
      '--runtime-drift',
      runtimeDriftPath,
      '--base-provenance',
      baseProvenancePath,
      '--head-provenance',
      headProvenancePath,
      '--composition-report',
      compositionPath,
      '--metadata-registry',
      metadataRegistryPath,
      '--duplicate-review',
      duplicateReviewPath,
      '--format',
      'json',
    ])

    expect(result.status).toBe(0)
    const bundle = JSON.parse(result.stdout) as ReviewBundle
    expect(bundle.schemaVersion).toBe('oa-gen.review-bundle.v1')
    expect(Object.keys(bundle.sections)).toEqual([
      'breakingDiff',
      'artifactFreshness',
      'runtimeDrift',
      'provenanceDiff',
      'inventory',
      'composition',
      'metadataRegistry',
      'duplicateReview',
      'nonBreakingChanges',
    ])
    expect(bundle.sections.runtimeDrift?.report).toEqual(runtimeDrift)
    expect(bundle.sections.provenanceDiff?.report).toEqual(provenanceDiff)
    expect(bundle.sections.inventory?.report.schemaVersion).toBe('oa-gen.inventory.v1')
    expect(bundle.sections.composition?.report).toEqual(composition)
    expect(bundle.sections.metadataRegistry?.report).toEqual(metadataRegistry)
    expect(bundle.sections.duplicateReview?.report).toEqual(duplicateReview)
  })

  it('joins TypeSpec and ttsc provenance as review-only parallel evidence', () => {
    const spec = reviewSpec('string')
    const basePath = writeYaml('base.yaml', spec)
    const headPath = writeYaml('head.yaml', spec)
    const artifactPath = writeYaml('artifact.yaml', spec)
    const typeSpecProvenancePath = writeJson('typespec-provenance.json', typeSpecProvenanceArtifact())
    const ttscProvenancePath = writeJson('ttsc-provenance.json', ttscProvenanceArtifact())
    const behaviorLogPath = writeJsonlPath('parallel-evidence.behavior.jsonl')

    const result = runCli([
      'review-bundle',
      '--base', basePath,
      '--head', headPath,
      '--artifact', artifactPath,
      '--typespec-provenance', typeSpecProvenancePath,
      '--ttsc-provenance', ttscProvenancePath,
      '--behavior-log', behaviorLogPath,
      '--format', 'json',
    ])

    expect(result.status).toBe(0)
    const bundle = JSON.parse(result.stdout) as ReviewBundle
    expect(bundle.summary.parallelEvidenceIncluded).toBe(true)
    expect(bundle.summary.recommendation).toBe('APPROVE')
    expect(bundle.sections.parallelEvidence?.report).toMatchObject({
      contractAuthority: 'typespec',
      purpose: 'review-evidence-only',
      summary: { matchedPointers: 1 },
    })
    const record = readJsonl(behaviorLogPath)[0] as {
      components?: { metrics?: Record<string, number> }
    }
    expect(record.components?.metrics).toEqual(expect.objectContaining({
      parallelEvidenceMatchedPointers: 1,
      parallelEvidenceContractCoverageRatio: 1,
      parallelEvidenceImplementationCoverageRatio: 1,
      parallelEvidenceDirectShapes: 1,
    }))
  })

  it('rejects an unpaired parallel provenance input', () => {
    const spec = reviewSpec('string')
    const basePath = writeYaml('base.yaml', spec)
    const headPath = writeYaml('head.yaml', spec)
    const artifactPath = writeYaml('artifact.yaml', spec)
    const typeSpecProvenancePath = writeJson('typespec-provenance.json', typeSpecProvenanceArtifact())

    const result = runCli([
      'review-bundle',
      '--base', basePath,
      '--head', headPath,
      '--artifact', artifactPath,
      '--typespec-provenance', typeSpecProvenancePath,
    ])

    expect(result.status).toBe(1)
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      '--typespec-provenance and --ttsc-provenance must be provided together',
    )
  })

  it('includes metadata registry diff when base and head sidecars are provided', () => {
    const spec = reviewSpec('string')
    const basePath = writeYaml('base.yaml', spec)
    const headPath = writeYaml('head.yaml', spec)
    const artifactPath = writeYaml('artifact.yaml', spec)
    const baseMetadataRegistryPath = writeJson('base.metadata.json', metadataRegistryReport('trk_meta_v1', 'oa-meta:v1:meta1'))
    const headMetadataRegistryPath = writeJson('head.metadata.json', metadataRegistryReport('trk_meta_v2', 'oa-meta:v1:meta2'))

    const result = runCli([
      'review-bundle',
      '--base',
      basePath,
      '--head',
      headPath,
      '--artifact',
      artifactPath,
      '--base-metadata-registry',
      baseMetadataRegistryPath,
      '--head-metadata-registry',
      headMetadataRegistryPath,
      '--format',
      'json',
    ])

    expect(result.status).toBe(0)
    const bundle = JSON.parse(result.stdout) as ReviewBundle & {
      summary?: { recommendation?: string; metadataRegistryChanges?: number | null }
    }
    expect(bundle.summary?.recommendation).toBe('COMMENT')
    expect(bundle.summary?.metadataRegistryChanges).toBe(1)
    expect(bundle.sections.metadataRegistryDiff?.report).toEqual(expect.objectContaining({
      checked: true,
      changed: true,
      base: baseMetadataRegistryPath,
      head: headMetadataRegistryPath,
    }))
    expect(bundle.sections.metadataRegistryDiff?.report.differences).toEqual([
      expect.objectContaining({ kind: 'changed', pointer: '#/paths/~1pets' }),
    ])
  })

  it('writes a succeeded review-bundle behavior record when behavior logging is enabled', () => {
    const spec = reviewSpec('string')
    const basePath = writeYaml('base.yaml', spec)
    const headPath = writeYaml('head.yaml', spec)
    const artifactPath = writeYaml('artifact.yaml', spec)
    const behaviorLogPath = writeJsonlPath('review-bundle.behavior.jsonl')

    const result = runCli([
      'review-bundle',
      '--base',
      basePath,
      '--head',
      headPath,
      '--artifact',
      artifactPath,
      '--behavior-log',
      behaviorLogPath,
      '--format',
      'json',
    ])

    expect(result.status).toBe(0)
    const records = readJsonl(behaviorLogPath) as Array<{
      behaviorType?: string
      status?: string
      components?: {
        decision?: { primarySignal?: string }
        result?: {
          recommendation?: string
          reasonCount?: number
          reasons?: string[]
          artifactChecked?: boolean
          artifactFresh?: boolean | null
          runtimeDriftIncluded?: boolean
          provenanceChecked?: boolean
          inventoryIncluded?: boolean
          compositionIncluded?: boolean
          metadataRegistryIncluded?: boolean
          metadataRegistryChecked?: boolean
          metadataRegistryValid?: boolean | null
          duplicateReviewIncluded?: boolean
        }
      }
    }>

    expect(records).toHaveLength(1)
    expect(records[0]).toEqual(expect.objectContaining({
      behaviorType: 'publish_review_bundle',
      status: 'succeeded',
      components: expect.objectContaining({
        decision: expect.objectContaining({
          primarySignal: 'approve',
        }),
        result: expect.objectContaining({
          recommendation: 'APPROVE',
          reasonCount: 0,
          reasons: [],
          artifactChecked: true,
          artifactFresh: true,
          runtimeDriftIncluded: false,
          provenanceChecked: false,
          inventoryIncluded: false,
          compositionIncluded: false,
          metadataRegistryIncluded: false,
          metadataRegistryChecked: false,
          metadataRegistryValid: null,
          duplicateReviewIncluded: false,
        }),
      }),
    }))
  })

  it('writes a failed review-bundle behavior record when recommendation is request_changes', () => {
    const basePath = writeYaml('base.yaml', reviewSpec('string'))
    const headPath = writeYaml('head.yaml', reviewSpec('integer'))
    const artifactPath = writeYaml('artifact.yaml', reviewSpec('string'))
    const behaviorLogPath = writeJsonlPath('review-bundle-failed.behavior.jsonl')

    const result = runCli([
      'review-bundle',
      '--base',
      basePath,
      '--head',
      headPath,
      '--artifact',
      artifactPath,
      '--behavior-log',
      behaviorLogPath,
      '--format',
      'json',
    ])

    expect(result.status).toBe(1)
    const records = readJsonl(behaviorLogPath) as Array<{
      behaviorType?: string
      status?: string
      components?: {
        decision?: { primarySignal?: string }
        result?: {
          recommendation?: string
          reasonCount?: number
          reasons?: string[]
          artifactChecked?: boolean
          artifactFresh?: boolean | null
          runtimeDriftIncluded?: boolean
          breakingChanges?: number
          provenanceChecked?: boolean
          inventoryIncluded?: boolean
          compositionIncluded?: boolean
          metadataRegistryIncluded?: boolean
          metadataRegistryChecked?: boolean
          metadataRegistryValid?: boolean | null
          duplicateReviewIncluded?: boolean
        }
      }
    }>

    expect(records).toHaveLength(1)
    expect(records[0]).toEqual(expect.objectContaining({
      behaviorType: 'publish_review_bundle',
      status: 'failed',
      components: expect.objectContaining({
        decision: expect.objectContaining({
          primarySignal: 'request-changes',
        }),
        result: expect.objectContaining({
          recommendation: 'REQUEST_CHANGES',
          reasonCount: expect.any(Number),
          reasons: expect.arrayContaining([
            expect.stringContaining('breaking change'),
          ]),
          artifactChecked: true,
          artifactFresh: false,
          runtimeDriftIncluded: false,
          breakingChanges: 1,
          provenanceChecked: false,
          inventoryIncluded: false,
          compositionIncluded: false,
          metadataRegistryIncluded: false,
          metadataRegistryChecked: false,
          metadataRegistryValid: null,
          duplicateReviewIncluded: false,
        }),
      }),
    }))
  })

  it('writes a succeeded review-bundle behavior record to SQLite when behavior-db is enabled', () => {
    const spec = reviewSpec('string')
    const basePath = writeYaml('base.yaml', spec)
    const headPath = writeYaml('head.yaml', spec)
    const artifactPath = writeYaml('artifact.yaml', spec)
    const behaviorDbPath = join(tmpDir, 'review-bundle.behavior.sqlite')

    const result = runCli([
      'review-bundle',
      '--base',
      basePath,
      '--head',
      headPath,
      '--artifact',
      artifactPath,
      '--behavior-db',
      behaviorDbPath,
      '--format',
      'json',
    ])

    expect(result.status).toBe(0)
    const sqlite = loadSqliteDriver().open(behaviorDbPath)
    try {
      const rows = sqlite.prepare(`
        SELECT behavior_type, status
        FROM behavior_records
        ORDER BY occurred_at
      `).all()

      expect(rows).toEqual([
        expect.objectContaining({
          behavior_type: 'publish_review_bundle',
          status: 'succeeded',
        }),
      ])
    } finally {
      sqlite.close()
    }
  })
})

function reviewSpec(
  valueType: 'string' | 'integer',
  extraPaths: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    openapi: '3.2.0',
    info: { title: 'Review bundle fixture', version: '1.0.0' },
    paths: {
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['value'],
                    properties: {
                      value: { type: valueType },
                    },
                  },
                },
              },
            },
          },
        },
      },
      ...extraPaths,
    },
    components: {
      schemas: {
        Pet: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      },
    },
  }
}

function runtimeDriftReport(drift: boolean): ReviewBundleRuntimeDriftReport {
  return {
    schemaVersion: 'oa-gen.drift.v1',
    drift,
    status: 'ok',
    runtime: 'runtime.yaml',
    managed: 'head.yaml',
    issues: [],
  }
}

function compositionReport(): BuildSpecCompositionReport {
  return {
    schemaVersion: 'oa-gen.composition-report.v1',
    target: {
      name: 'public-api',
      targetPath: 'targets/public.yaml',
      fragmentsDir: 'fragments',
      scopes: ['public'],
      domains: ['pet'],
      includePaths: ['/pets'],
      includeDefinitions: [],
    },
    summary: {
      registryNodeCount: 2,
      selectedNodeCount: 2,
      directPathCount: 1,
      directDefinitionCount: 0,
      transitiveComponentCount: 1,
      omittedNodeCount: 0,
      sourceRefCount: 1,
      outputAliasCount: 0,
      renamedOutputAliasCount: 0,
      collisionReportCount: 0,
    },
    selected: {
      directPathIds: ['path:public/pet/PetsPath'],
      directDefinitionIds: [],
      transitiveComponentIds: ['schema:public/pet/Pet'],
      selectedNodeIds: ['path:public/pet/PetsPath', 'schema:public/pet/Pet'],
    },
    output: {
      paths: [],
      components: [],
      aliases: [],
      renamedAliases: [],
      collisionReport: [],
    },
    omitted: {
      total: 0,
      byScope: {},
      byDomain: {},
      byKind: {},
    },
    sourceRefs: [],
  }
}

function duplicateReviewReport(): DefinitionDuplicateReviewResult {
  return {
    schemaVersion: 'oa-gen.duplicate-review.v1',
    valid: true,
    decision: 'APPROVE',
    policy: {
      name: 'review',
      checks: ['canonical-id', 'content-hash', 'local-name', 'output-name', 'semantic-alias'],
      failOn: 'error',
      targetRequired: false,
      enforceable: true,
    },
    fragmentsDir: 'fragments',
    targets: [{ name: 'public-api', targetPath: 'targets/public.yaml' }],
    diagnostics: [],
    findings: [],
    summary: {
      fragmentCount: 2,
      targetCount: 1,
      findingCount: 0,
      diagnosticCount: 0,
      errors: 0,
      warnings: 0,
      infos: 0,
      findingsByCode: {
        'definition-duplicate-review/duplicate-canonical-id': 0,
        'definition-duplicate-review/same-content-hash': 0,
        'definition-duplicate-review/same-local-name-different-shape': 0,
        'definition-duplicate-review/output-name-collision': 0,
        'definition-duplicate-review/semantic-alias': 0,
      },
    },
  }
}

function metadataRegistryReport(
  trackingId = 'trk_meta_v1',
  stableKey = 'oa-meta:v1:meta1',
): BuildSpecMetadataRegistry {
  return {
    schemaVersion: 'oa-gen.metadata-registry.v1',
    targetName: 'public-api',
    summary: {
      entryCount: 1,
      explicitTrackingIdCount: 0,
      generatedTrackingIdCount: 1,
      invalidTrackingIdCount: 0,
      duplicateTrackingIdCount: 0,
      duplicateStableKeyCount: 0,
      duplicateOutputPointerCount: 0,
    },
    duplicates: {
      trackingIds: [],
      stableKeys: [],
      outputPointers: [],
    },
    entries: {
      '#/paths/~1pets': {
        pointer: '#/paths/~1pets',
        canonicalId: 'path:public/pet/PetsPath',
        kind: 'path',
        sourcePath: 'fragments/path/public/pet/PetsPath.yaml',
        sourcePointer: '#/content',
        contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        trackingId,
        trackingIdSource: 'generated',
        identityKey: 'definition:path:public/pet/PetsPath',
        identitySource: 'canonical',
        stableKey,
        metadata: { path: '/pets' },
        openApiPath: '/pets',
      },
    },
  }
}

function provenanceDiffBase(): Record<string, BuildSpecProvenanceEntry> {
  return {
    '#/paths/~1pets': {
      canonicalId: 'path:public/pet/PetsPath',
      kind: 'path',
      sourcePath: 'fragments/path/public/pet/PetsPath.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
  }
}

function provenanceDiffHead(): Record<string, BuildSpecProvenanceEntry> {
  return {
    '#/paths/~1pets': {
      canonicalId: 'path:public/pet/PetsPath',
      kind: 'path',
      sourcePath: 'fragments/path/public/pet/PetsPath.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
  }
}

function provenanceDiffReport(base = 'base.provenance.json', head = 'head.provenance.json'): ReviewBundleProvenanceDiff {
  const baseEntry = provenanceDiffBase()['#/paths/~1pets']!
  const headEntry = provenanceDiffHead()['#/paths/~1pets']!
  return {
    checked: true,
    base,
    head,
    changed: true,
    summary: '1 provenance entry changed',
    differences: [
      {
        kind: 'changed',
        pointer: '#/paths/~1pets',
        base: baseEntry,
        head: headEntry,
        message: 'Provenance changed for #/paths/~1pets.',
      },
    ],
  }
}

function typeSpecProvenanceArtifact(): Record<string, unknown> {
  return {
    schemaVersion: 'oa-sdk.typespec-ref-provenance.v1',
    provenanceKind: 'typespec-source-ast',
    inputs: {},
    declarations: [{
      id: 'model:models.tsp:Pet',
      kind: 'model',
      symbol: 'Pet',
      source: sourceRange('models.tsp', 1),
    }],
    edges: [{
      kind: 'emits',
      declarationId: 'model:models.tsp:Pet',
      outputPointer: '#/components/schemas/Pet',
    }],
    exclusions: [],
  }
}

function ttscProvenanceArtifact(): Record<string, unknown> {
  return {
    schemaVersion: 'ttsc-contract-provenance.v2',
    inputs: { toolchain: { typescript: '7.0.2' } },
    declarations: [{
      id: 'schema:contracts.ts:Pet',
      kind: 'schema',
      astKind: 'InterfaceDeclaration',
      symbol: 'Pet',
      source: sourceRange('contracts.ts', 1),
      shape: { features: ['object'], typeSpecProjection: 'direct' },
    }],
    edges: [{
      kind: 'emits',
      declarationId: 'schema:contracts.ts:Pet',
      outputPointer: '#/components/schemas/Pet',
    }],
    diagnostics: [],
  }
}

function sourceRange(file: string, line: number): Record<string, unknown> {
  return {
    file,
    start: { line, column: 1 },
    end: { line, column: 2 },
  }
}

function writeYaml(relativePath: string, value: unknown): string {
  const filePath = join(tmpDir, relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, stringifyYaml(value), 'utf8')
  return filePath
}

function writeJson(relativePath: string, value: unknown): string {
  const filePath = join(tmpDir, relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
  return filePath
}

function writeJsonlPath(relativePath: string): string {
  return join(tmpDir, relativePath)
}

function readJsonl(filePath: string): unknown[] {
  return readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter((line: string) => line.length > 0)
    .map((line: string) => JSON.parse(line))
}

function runCli(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: pkgDir,
    encoding: 'utf8',
    timeout: 15_000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  }
}
