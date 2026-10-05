import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { SUBPROCESS_TEST_BUDGET_MS } from './helpers/subprocess-budget.js'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { OpenApiCollectReport, OpenApiUpgradeReport } from '../cli/lib/openapi-collect.js'

const pkgDir = resolve(__dirname, '../..')
const cliPath = resolve(pkgDir, 'dist/cli/index.js')
const tmpBase = resolve(pkgDir, '.tmp-cli-openapi-collect-test')

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpBase, `run-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
})

describe('oa-gen normalize/upgrade/collect CLI', () => {
  it('normalize prints stable YAML to stdout when --output is omitted', () => {
    const specPath = writeYaml('openapi.raw.yaml', {
      openapi: '3.0.0',
      paths: { '/users': {} },
      info: { version: '1.0', title: 'API' },
      tags: [],
      servers: [],
      components: {},
    })

    const result = runCli(['normalize', '--spec', specPath, '--profile', 'nestjs-swagger'])

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const parsed = parseYaml(result.stdout) as Record<string, unknown>
    expect(Object.keys(parsed)).toEqual(['openapi', 'info', 'paths', 'components'])
    expect(parsed.openapi).toBe('3.0.0')
    expect(result.stdout).not.toContain('&ref_')
  })

  it('upgrade writes 3.2 artifact and a transform report', () => {
    const specPath = writeYaml('openapi.normalized.yaml', {
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      paths: {},
      components: {
        schemas: {
          MaybeName: { type: 'string', nullable: true },
        },
      },
    })
    const outputPath = join(tmpDir, 'openapi.upgraded.yaml')
    const reportPath = join(tmpDir, 'openapi.upgrade-report.json')

    const result = runCli([
      'upgrade',
      '--spec', specPath,
      '--output', outputPath,
      '--report', reportPath,
    ])

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')

    const upgraded = parseYaml(readFileSync(outputPath, 'utf8')) as Record<string, unknown>
    expect(upgraded.openapi).toBe('3.2.0')
    const schemas = (upgraded.components as { schemas: Record<string, { type: string[] } | undefined> }).schemas
    expect(schemas.MaybeName?.type).toEqual(['string', 'null'])

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as OpenApiUpgradeReport
    expect(report.schemaVersion).toBe('oa-gen.openapi-upgrade-report.v1')
    expect(report.sourceOpenapi).toBe('3.0.0')
    expect(report.targetOpenapi).toBe('3.2.0')
    expect(report.conversions.map(c => c.code)).toContain('schema/nullable-upgraded')
  })

  it('collect produces normalized + upgraded artifacts and a collect report', () => {
    const specPath = writeYaml('openapi.raw.yaml', {
      openapi: '3.0.0',
      info: { title: 'API', version: '1.0' },
      paths: { '/health': { get: { responses: { '200': { description: 'ok' } } } } },
      components: {
        schemas: { Status: { type: 'string', nullable: true } },
      },
    })
    const normalizedPath = join(tmpDir, 'openapi.normalized.yaml')
    const upgradedPath = join(tmpDir, 'openapi.upgraded.yaml')
    const reportPath = join(tmpDir, 'openapi.collect-report.json')

    const result = runCli([
      'collect',
      '--spec', specPath,
      '--normalized', normalizedPath,
      '--upgraded', upgradedPath,
      '--report', reportPath,
      '--profile', 'nestjs-swagger',
    ])

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(existsSync(normalizedPath)).toBe(true)
    expect(existsSync(upgradedPath)).toBe(true)
    expect(existsSync(reportPath)).toBe(true)

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as OpenApiCollectReport
    expect(report.schemaVersion).toBe('oa-gen.openapi-collect-report.v1')
    expect(report.profile).toBe('nestjs-swagger')
    expect(report.normalized).toBe(normalizedPath)
    expect(report.upgraded).toBe(upgradedPath)
    expect(report.upgrade.conversions.map(c => c.code)).toContain('openapi/version-upgraded')

    const upgraded = parseYaml(readFileSync(upgradedPath, 'utf8')) as Record<string, unknown>
    expect(upgraded.openapi).toBe('3.2.0')
  })

  it('collect copies the source to --raw and writes report only when --report is given', () => {
    const specPath = writeYaml('source/openapi.yaml', {
      openapi: '3.0.0',
      info: { title: 'API', version: '1.0' },
      paths: {},
      components: {},
    })
    const rawCopyPath = join(tmpDir, 'snapshots/2026/openapi.raw.yaml')
    const normalizedPath = join(tmpDir, 'normalized.yaml')
    const upgradedPath = join(tmpDir, 'upgraded.yaml')
    const reportPath = join(tmpDir, 'collect-report.json')

    const withReport = runCli([
      'collect',
      '--spec', specPath,
      '--raw', rawCopyPath,
      '--normalized', normalizedPath,
      '--upgraded', upgradedPath,
      '--report', reportPath,
    ])

    expect(withReport.status).toBe(0)
    expect(existsSync(rawCopyPath)).toBe(true)
    expect(readFileSync(rawCopyPath, 'utf8')).toBe(readFileSync(specPath, 'utf8'))
    expect(existsSync(reportPath)).toBe(true)
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as OpenApiCollectReport
    expect(report.raw).toBe(rawCopyPath)

    rmSync(reportPath)
    rmSync(rawCopyPath)
    const noReport = runCli([
      'collect',
      '--spec', specPath,
      '--normalized', normalizedPath,
      '--upgraded', upgradedPath,
    ])
    expect(noReport.status).toBe(0)
    expect(existsSync(reportPath)).toBe(false)
    expect(existsSync(rawCopyPath)).toBe(false)
  })

  it('upgrade prints YAML to stdout when --output is omitted and skips --report', () => {
    const specPath = writeYaml('openapi.yaml', {
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      paths: {},
      components: {},
    })
    const reportPath = join(tmpDir, 'no-report-here.json')

    const result = runCli(['upgrade', '--spec', specPath])

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const upgraded = parseYaml(result.stdout) as Record<string, unknown>
    expect(upgraded.openapi).toBe('3.2.0')
    expect(existsSync(reportPath)).toBe(false)
  })

  it('collect rejects an unsupported --profile value', () => {
    const specPath = writeYaml('openapi.raw.yaml', {
      openapi: '3.0.0',
      info: { title: 'API', version: '1.0' },
      paths: {},
      components: {},
    })

    const result = runCli([
      'collect',
      '--spec', specPath,
      '--normalized', join(tmpDir, 'normalized.yaml'),
      '--upgraded', join(tmpDir, 'upgraded.yaml'),
      '--profile', 'django-ninja',
    ])

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('unsupported OpenAPI collect profile: django-ninja')
    expect(result.stderr).toContain('allowed: generic, nestjs-swagger, fastapi')
  })
})

function writeYaml(relativePath: string, value: unknown): string {
  const filePath = join(tmpDir, relativePath)
  mkdirSync(resolve(filePath, '..'), { recursive: true })
  writeFileSync(filePath, stringifyYaml(value), 'utf8')
  return filePath
}

function runCli(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: pkgDir,
    encoding: 'utf8',
    timeout: SUBPROCESS_TEST_BUDGET_MS,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  }
}
