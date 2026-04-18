import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { stringify as stringifyYaml } from 'yaml'
import type { BuildSpecCompositionReport } from '../cli/lib/composition-report.js'
import type { DefinitionDuplicateReviewResult } from '../cli/lib/duplicate-review.js'
import type {
  ReviewBundle,
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
    const duplicateReview = duplicateReviewReport()
    const runtimeDriftPath = writeJson('runtime-drift.json', runtimeDrift)
    const compositionPath = writeJson('composition.json', composition)
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
      '--composition-report',
      compositionPath,
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
      'inventory',
      'composition',
      'duplicateReview',
      'nonBreakingChanges',
    ])
    expect(bundle.sections.runtimeDrift?.report).toEqual(runtimeDrift)
    expect(bundle.sections.inventory?.report.schemaVersion).toBe('oa-gen.inventory.v1')
    expect(bundle.sections.composition?.report).toEqual(composition)
    expect(bundle.sections.duplicateReview?.report).toEqual(duplicateReview)
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
