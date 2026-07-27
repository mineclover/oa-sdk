import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const pkgDir = resolve(__dirname, '../..')
const cliPath = resolve(pkgDir, 'dist/cli/index.js')
const tmpBase = resolve(pkgDir, '.tmp-cli-parallel-evidence-test')

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpBase, `run-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
})

describe('oa-gen parallel-evidence', () => {
  it('reports pointer coverage, shape taxonomy, and a stable baseline delta', () => {
    const typeSpecPath = writeJson('typespec.json', typeSpecArtifact())
    const ttscPath = writeJson('ttsc.json', ttscArtifact())
    const baselinePath = writeJson('baseline.json', {
      schemaVersion: 'oa-sdk.parallel-evidence-metrics.v1',
      pointers: {
        contract: 1,
        implementation: 1,
        union: 1,
        matched: 0,
        contractCoverageRatio: 0,
        implementationCoverageRatio: 0,
        unionCoverageRatio: 0,
      },
      declarations: {
        contractTotal: 1,
        contractEmitting: 1,
        implementationTotal: 1,
        implementationEmitting: 1,
        implementationShapeAnnotated: 1,
      },
      relations: {
        contractTotal: 0,
        implementationTotal: 0,
        contractTargetResolved: 0,
        implementationTargetResolved: 0,
      },
      implementationShapes: {
        direct: 1,
        policyRequired: 0,
        unsupported: 0,
        unclassified: 0,
        features: { object: 1 },
      },
    })

    const result = runCli([
      'parallel-evidence',
      '--typespec-provenance', typeSpecPath,
      '--ttsc-provenance', ttscPath,
      '--baseline', baselinePath,
      '--format', 'json',
    ])

    expect(result.status).toBe(0)
    const report = JSON.parse(result.stdout) as {
      schemaVersion?: string
      metrics?: { pointers?: { matched?: number; contractCoverageRatio?: number }; implementationShapes?: { direct?: number; features?: Record<string, number> } }
      baseline?: { changed?: boolean; values?: Record<string, { delta?: number }> }
    }
    expect(report.schemaVersion).toBe('oa-sdk.parallel-evidence-report.v1')
    expect(report.metrics?.pointers).toEqual(expect.objectContaining({ matched: 1, contractCoverageRatio: 1 }))
    expect(report.metrics?.implementationShapes).toEqual(expect.objectContaining({ direct: 1, features: { object: 1 } }))
    expect(report.baseline?.changed).toBe(true)
    expect(report.baseline?.values?.['pointers.matched']).toEqual({ baseline: 0, current: 1, delta: 1 })
  })
})

function typeSpecArtifact(): Record<string, unknown> {
  return {
    schemaVersion: 'oa-sdk.typespec-ref-provenance.v1',
    provenanceKind: 'typespec-source-ast',
    inputs: {},
    declarations: [{ id: 'model:models.tsp:Widget', kind: 'model', symbol: 'Widget', source: range('models.tsp') }],
    edges: [{ kind: 'emits', declarationId: 'model:models.tsp:Widget', outputPointer: '#/components/schemas/Widget' }],
    exclusions: [],
  }
}

function ttscArtifact(): Record<string, unknown> {
  return {
    schemaVersion: 'ttsc-contract-provenance.v2',
    inputs: { toolchain: { typescript: '7.0.2' } },
    declarations: [{
      id: 'schema:contracts.ts:Widget',
      kind: 'schema',
      astKind: 'InterfaceDeclaration',
      symbol: 'Widget',
      source: range('contracts.ts'),
      shape: { features: ['object'], typeSpecProjection: 'direct' },
    }],
    edges: [{ kind: 'emits', declarationId: 'schema:contracts.ts:Widget', outputPointer: '#/components/schemas/Widget' }],
    diagnostics: [],
  }
}

function range(file: string): Record<string, unknown> {
  return { file, start: { line: 1, column: 1 }, end: { line: 1, column: 2 } }
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
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status }
}
