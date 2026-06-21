import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { TypeSpecBundleManifest } from '../cli/lib/typespec-bundle-manifest.js'
import type {
  TypeSpecCompatibilityRestoreReport,
  TypeSpecCompatibilitySidecarCompareReport,
  TypeSpecCompatibilitySidecar,
} from '../cli/lib/typespec-sidecar.js'

const pkgDir = resolve(__dirname, '../..')
const rootDir = resolve(pkgDir, '../..')
const cliPath = resolve(pkgDir, 'dist/cli/index.js')
const tmpBase = resolve(pkgDir, '.tmp-cli-tsp-sidecar-test')

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpBase, `run-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
})

describe('oa-gen TypeSpec sidecar CLI', () => {
  it('exports a compatibility sidecar and restores emitted OpenAPI metadata', () => {
    const sourcePath = writeYaml('source.yaml', {
      openapi: '3.2.0',
      info: { title: 'Sidecar API', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': {
                description: 'Users',
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                    examples: {
                      default: {
                        dataValue: { items: [] },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
          oauth2: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: 'https://auth.example.com/authorize',
                tokenUrl: 'https://auth.example.com/token',
                scopes: { read: 'Read' },
              },
            },
          },
        },
      },
    })
    const emittedPath = writeYaml('emitted.yaml', {
      openapi: '3.2.0',
      info: { title: 'Sidecar API', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': {
                description: 'Users',
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
    })
    const tspPath = join(tmpDir, 'main.tsp')
    const sidecarPath = join(tmpDir, 'sidecar.json')
    const bundleManifestPath = join(tmpDir, 'oa-sdk.typespec-bundle.json')
    const restoredPath = join(tmpDir, 'restored.yaml')
    const restoreReportPath = join(tmpDir, 'restore-report.json')
    const stabilityReportPath = join(tmpDir, 'stability-report.json')

    const exportResult = runCli([
      'tsp-export',
      '--spec', sourcePath,
      '--output', tspPath,
      '--sidecar', sidecarPath,
      '--bundle-manifest', bundleManifestPath,
    ])
    expect(exportResult.status).toBe(0)
    expect(exportResult.stderr).toBe('')
    expect(existsSync(tspPath)).toBe(true)

    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as TypeSpecCompatibilitySidecar
    const bundleManifest = JSON.parse(readFileSync(bundleManifestPath, 'utf8')) as TypeSpecBundleManifest
    expect(bundleManifest).toEqual({
      schemaVersion: 'oa-sdk.typespec-bundle.v1',
      entrypoint: 'main.tsp',
      sidecar: 'sidecar.json',
      compatibility: {
        openapiVersion: '3.2.0',
        sidecarSchemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
      },
    })
    expect(sidecar.schemaVersion).toBe('oa-sdk.typespec-compat-sidecar.v1')
    expect(sidecar.counts).toEqual({
      entries: 2,
      parameterExamples: 0,
      responseMediaExamples: 1,
      securitySchemes: 1,
    })
    const bundleReportPath = join(tmpDir, 'bundle-check-report.json')
    const bundleCheck = spawnSync('pnpm', [
      'typespec:bundle-check',
      '--',
      '--manifest', bundleManifestPath,
      '--report', bundleReportPath,
    ], {
      cwd: rootDir,
      encoding: 'utf8',
    })
    expect(bundleCheck.status, `${bundleCheck.stdout}\n${bundleCheck.stderr}`).toBe(0)
    const bundleReport = JSON.parse(readFileSync(bundleReportPath, 'utf8')) as Record<string, any>
    expect(bundleReport.bundle).toEqual({
      source: 'manifest',
      schemaVersion: 'oa-sdk.typespec-bundle.v1',
      compatibility: {
        openapiVersion: '3.2.0',
        sidecarSchemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
      },
    })
    expect(bundleReport.gates.compatibilitySidecar).toBe('pass')
    expect(bundleReport.gates.restoredValidation).toBe('pass')
    expect(bundleReport.gates.expectedDiff).toBeUndefined()

    const restoreResult = runCli([
      'tsp-restore',
      '--spec', emittedPath,
      '--sidecar', sidecarPath,
      '--output', restoredPath,
      '--report', restoreReportPath,
      '--stability-report', stabilityReportPath,
    ])
    expect(restoreResult.status).toBe(0)
    expect(restoreResult.stderr).toBe('')

    const report = JSON.parse(readFileSync(restoreReportPath, 'utf8')) as TypeSpecCompatibilityRestoreReport
    expect(report.counts).toEqual({
      entries: 2,
      applied: 2,
      missingTargets: 0,
    })
    const stabilityReport = JSON.parse(readFileSync(stabilityReportPath, 'utf8')) as TypeSpecCompatibilitySidecarCompareReport
    expect(stabilityReport.counts).toEqual({
      expectedEntries: 2,
      actualEntries: 2,
      expectedSatisfied: 2,
      actualCovered: 2,
      missingExpected: 0,
      unexpectedActual: 0,
      valueMismatches: 0,
    })
    const restored = parseYaml(readFileSync(restoredPath, 'utf8')) as Record<string, any>
    expect(restored.components.securitySchemes.oauth2).toEqual(sidecar.entries.find(entry => entry.kind === 'security-scheme')?.value)
    expect(restored.paths['/users'].get.responses['200'].content['application/json'].examples).toEqual({
      default: {
        dataValue: { items: [] },
      },
    })
  })

  it('requires output and sidecar when exporting a TypeSpec bundle manifest', () => {
    const sourcePath = writeYaml('source.yaml', {
      openapi: '3.2.0',
      info: { title: 'Sidecar API', version: '1.0.0' },
      paths: {},
    })

    const exportResult = runCli([
      'tsp-export',
      '--spec', sourcePath,
      '--bundle-manifest', join(tmpDir, 'oa-sdk.typespec-bundle.json'),
    ])

    expect(exportResult.status).not.toBe(0)
    expect(exportResult.stderr).toContain('--bundle-manifest requires both --output and --sidecar')
  })

  it('fails restore when a sidecar target is missing and still writes the report', () => {
    const emittedPath = writeYaml('emitted.yaml', {
      openapi: '3.2.0',
      info: { title: 'Sidecar API', version: '1.0.0' },
      paths: {},
    })
    const sidecarPath = join(tmpDir, 'sidecar.json')
    const restoredPath = join(tmpDir, 'restored.yaml')
    const restoreReportPath = join(tmpDir, 'restore-report.json')
    const sidecar: TypeSpecCompatibilitySidecar = {
      schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
      counts: {
        entries: 1,
        parameterExamples: 0,
        responseMediaExamples: 1,
        securitySchemes: 0,
      },
      entries: [
        {
          kind: 'response-media-examples',
          pointer: '#/paths/~1users/get/responses/200/content/application~1json',
          target: {
            path: '/users',
            method: 'get',
            statusCode: '200',
            mediaType: 'application/json',
          },
          value: {
            examples: {
              default: { dataValue: { items: [] } },
            },
          },
        },
      ],
    }
    writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), 'utf8')

    const restoreResult = runCli([
      'tsp-restore',
      '--spec', emittedPath,
      '--sidecar', sidecarPath,
      '--output', restoredPath,
      '--report', restoreReportPath,
    ])

    expect(restoreResult.status).not.toBe(0)
    expect(restoreResult.stderr).toContain('sidecar restore missed 1 target(s)')
    expect(existsSync(restoredPath)).toBe(false)
    const report = JSON.parse(readFileSync(restoreReportPath, 'utf8')) as TypeSpecCompatibilityRestoreReport
    expect(report.counts).toEqual({
      entries: 1,
      applied: 0,
      missingTargets: 1,
    })
  })

  it('fails restore when sidecar re-extraction drifts and still writes the stability report', () => {
    const emittedPath = writeYaml('emitted.yaml', {
      openapi: '3.2.0',
      info: { title: 'Sidecar API', version: '1.0.0' },
      paths: {},
    })
    const sidecarPath = join(tmpDir, 'sidecar.json')
    const restoredPath = join(tmpDir, 'restored.yaml')
    const stabilityReportPath = join(tmpDir, 'stability-report.json')
    const sidecar: TypeSpecCompatibilitySidecar = {
      schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
      counts: {
        entries: 1,
        parameterExamples: 0,
        responseMediaExamples: 0,
        securitySchemes: 1,
      },
      entries: [
        {
          kind: 'security-scheme',
          pointer: '#/components/securitySchemes/bearerAuth',
          target: { name: 'bearerAuth' },
          value: { type: 'http', scheme: 'bearer' },
        },
      ],
    }
    writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), 'utf8')

    const restoreResult = runCli([
      'tsp-restore',
      '--spec', emittedPath,
      '--sidecar', sidecarPath,
      '--output', restoredPath,
      '--stability-report', stabilityReportPath,
    ])

    expect(restoreResult.status).not.toBe(0)
    expect(restoreResult.stderr).toContain('sidecar stability drift detected: 1 missing expected, 0 unexpected actual, 0 value mismatch(es)')
    expect(existsSync(restoredPath)).toBe(false)
    const stabilityReport = JSON.parse(readFileSync(stabilityReportPath, 'utf8')) as TypeSpecCompatibilitySidecarCompareReport
    expect(stabilityReport.counts).toEqual({
      expectedEntries: 1,
      actualEntries: 0,
      expectedSatisfied: 0,
      actualCovered: 0,
      missingExpected: 1,
      unexpectedActual: 0,
      valueMismatches: 0,
    })
  })
})

function writeYaml(name: string, value: unknown): string {
  const filePath = join(tmpDir, name)
  writeFileSync(filePath, stringifyYaml(value), 'utf8')
  return filePath
}

function runCli(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: pkgDir,
    encoding: 'utf8',
  })
}
