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
import type {
  TypeSpecCompatibilityRestoreReport,
  TypeSpecCompatibilitySidecar,
} from '../cli/lib/typespec-sidecar.js'

const pkgDir = resolve(__dirname, '../..')
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
    const restoredPath = join(tmpDir, 'restored.yaml')
    const restoreReportPath = join(tmpDir, 'restore-report.json')

    const exportResult = runCli([
      'tsp-export',
      '--spec', sourcePath,
      '--output', tspPath,
      '--sidecar', sidecarPath,
    ])
    expect(exportResult.status).toBe(0)
    expect(exportResult.stderr).toBe('')
    expect(existsSync(tspPath)).toBe(true)

    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as TypeSpecCompatibilitySidecar
    expect(sidecar.schemaVersion).toBe('oa-sdk.typespec-compat-sidecar.v1')
    expect(sidecar.counts).toEqual({
      entries: 2,
      parameterExamples: 0,
      responseMediaExamples: 1,
      securitySchemes: 1,
    })

    const restoreResult = runCli([
      'tsp-restore',
      '--spec', emittedPath,
      '--sidecar', sidecarPath,
      '--output', restoredPath,
      '--report', restoreReportPath,
    ])
    expect(restoreResult.status).toBe(0)
    expect(restoreResult.stderr).toBe('')

    const report = JSON.parse(readFileSync(restoreReportPath, 'utf8')) as TypeSpecCompatibilityRestoreReport
    expect(report.counts).toEqual({
      entries: 2,
      applied: 2,
      missingTargets: 0,
    })
    const restored = parseYaml(readFileSync(restoredPath, 'utf8')) as Record<string, any>
    expect(restored.components.securitySchemes.oauth2).toEqual(sidecar.entries.find(entry => entry.kind === 'security-scheme')?.value)
    expect(restored.paths['/users'].get.responses['200'].content['application/json'].examples).toEqual({
      default: {
        dataValue: { items: [] },
      },
    })
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
