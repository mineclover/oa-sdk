import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { SUBPROCESS_TEST_BUDGET_MS } from './helpers/subprocess-budget.js'
import { stringify as stringifyYaml } from 'yaml'
import type { TargetCoverageResult } from '../cli/lib/target-coverage.js'

const pkgDir = resolve(__dirname, '../..')
const cliPath = resolve(pkgDir, 'dist/cli/index.js')
const tmpBase = resolve(pkgDir, '.tmp-cli-target-check-test')

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpBase, `run-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
})

describe('oa-gen target-check', () => {
  it('passes public target checks and renders every markdown assertion', () => {
    const targetPath = writePublicTarget(['/books'])
    writePathFragments()

    const result = runCli([
      'target-check',
      '--target',
      targetPath,
      '--fragments',
      join(tmpDir, 'fragments'),
      '--must-include-path',
      '/books',
      '--must-exclude-path',
      '/admin/books',
    ])

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('## Target Check')
    expect(result.stdout).toContain('Summary: 2 assertions, 1 emitted paths, 0 failures.')
    expect(result.stdout).toContain('| PASS | mustIncludePath | `/books` | - |')
    expect(result.stdout).toContain('| PASS | mustExcludePath | `/admin/books` | - |')
  })

  it('fails with JSON when a required path is missing', () => {
    const targetPath = writePublicTarget(['/books'])
    writePathFragments()

    const result = runCli([
      'target-check',
      '--target',
      targetPath,
      '--fragments',
      join(tmpDir, 'fragments'),
      '--must-include-path',
      '/health',
      '--must-include-path',
      '/books',
      '--format',
      'json',
    ])

    expect(result.status).toBe(1)
    const report = JSON.parse(result.stdout) as TargetCoverageResult
    expect(report.valid).toBe(false)
    expect(report.assertions).toEqual([
      {
        kind: 'mustIncludePath',
        path: '/books',
        passed: true,
      },
      {
        kind: 'mustIncludePath',
        path: '/health',
        passed: false,
        code: 'target-coverage/missing-required-path',
        message: 'Required path "/health" is missing from Definition Builder target "public-api".',
      },
    ])
    expect(report.failures).toEqual([
      expect.objectContaining({
        code: 'target-coverage/missing-required-path',
        assertion: 'mustIncludePath',
        path: '/health',
      }),
    ])
  })

  it('fails with JSON when a forbidden path is emitted', () => {
    const targetPath = writePublicTarget(['/books', '/admin/books'])
    writePathFragments()

    const result = runCli([
      'target-check',
      '--target',
      targetPath,
      '--fragments',
      join(tmpDir, 'fragments'),
      '--must-include-path',
      '/books',
      '--must-exclude-path',
      '/admin/books',
      '--format',
      'json',
    ])

    expect(result.status).toBe(1)
    const report = JSON.parse(result.stdout) as TargetCoverageResult
    expect(report.valid).toBe(false)
    expect(report.emittedPaths).toEqual(['/admin/books', '/books'])
    expect(report.failures).toEqual([
      expect.objectContaining({
        code: 'target-coverage/forbidden-path-emitted',
        assertion: 'mustExcludePath',
        path: '/admin/books',
      }),
    ])
  })

  it('checks generated OpenAPI artifact mode deterministically', () => {
    const artifactPath = writeYaml('artifacts/public-api.yaml', openApiDocument({
      '/health': {},
      '/books': {},
    }))

    const result = runCli([
      'target-check',
      '--artifact',
      artifactPath,
      '--must-include-path',
      '/health',
      '--must-include-path',
      '/books',
      '--must-exclude-path',
      '/admin/books',
      '--format',
      'json',
    ])

    expect(result.status).toBe(0)
    const report = JSON.parse(result.stdout) as TargetCoverageResult
    expect(report.source).toEqual({
      kind: 'openapi-artifact',
      path: artifactPath,
    })
    expect(report.emittedPaths).toEqual(['/books', '/health'])
    expect(report.assertions).toEqual([
      {
        kind: 'mustIncludePath',
        path: '/books',
        passed: true,
      },
      {
        kind: 'mustIncludePath',
        path: '/health',
        passed: true,
      },
      {
        kind: 'mustExcludePath',
        path: '/admin/books',
        passed: true,
      },
    ])
  })
})

function writePublicTarget(includePaths: string[]): string {
  return writeYaml('targets/public-api.yaml', {
    name: 'public-api',
    scopes: ['public', 'admin'],
    domains: ['book'],
    servers: [],
    includePaths,
  })
}

function writePathFragments(): void {
  writeYaml('fragments/path/public/book/BooksPath.yaml', pathFragment('/books'))
  writeYaml('fragments/path/admin/book/AdminBooksPath.yaml', pathFragment('/admin/books'))
}

function openApiDocument(paths: Record<string, unknown>) {
  return {
    openapi: '3.2.0',
    info: {
      title: 'Public API',
      version: '1.0.0',
    },
    paths,
  }
}

function pathFragment(path: string) {
  return {
    id: path.startsWith('/admin/')
      ? 'path:admin/book/AdminBooksPath'
      : 'path:public/book/BooksPath',
    metadata: { path },
    content: {
      get: {
        responses: {
          '200': {
            description: 'OK',
          },
        },
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
