import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import {
  TARGET_COVERAGE_SCHEMA_VERSION,
  checkTargetCoverage,
} from '../cli/lib/target-coverage.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'oa-sdk-target-coverage-'))
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
})

describe('target coverage checker', () => {
  it('checks required and forbidden paths in generated YAML artifacts', () => {
    const artifactPath = writeYaml('artifacts/public-api.yaml', openApiDocument({
      '/admin/books': {},
      '/books': {},
    }))

    const result = checkTargetCoverage({
      artifactPath,
      mustIncludePaths: ['/books', '/health'],
      mustExcludePaths: ['/admin/books', '/internal/health'],
    })

    expect(result.schemaVersion).toBe(TARGET_COVERAGE_SCHEMA_VERSION)
    expect(result.valid).toBe(false)
    expect(result.source).toEqual({
      kind: 'openapi-artifact',
      path: artifactPath,
    })
    expect(result.emittedPaths).toEqual(['/admin/books', '/books'])
    expect(result.assertions).toEqual([
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
        message: 'Required path "/health" is missing from OpenAPI artifact.',
      },
      {
        kind: 'mustExcludePath',
        path: '/admin/books',
        passed: false,
        code: 'target-coverage/forbidden-path-emitted',
        message: 'Forbidden path "/admin/books" is emitted by OpenAPI artifact.',
      },
      {
        kind: 'mustExcludePath',
        path: '/internal/health',
        passed: true,
      },
    ])
    expect(result.failures).toEqual([
      {
        code: 'target-coverage/missing-required-path',
        severity: 'error',
        message: 'Required path "/health" is missing from OpenAPI artifact.',
        assertion: 'mustIncludePath',
        path: '/health',
        source: result.source,
      },
      {
        code: 'target-coverage/forbidden-path-emitted',
        severity: 'error',
        message: 'Forbidden path "/admin/books" is emitted by OpenAPI artifact.',
        assertion: 'mustExcludePath',
        path: '/admin/books',
        source: result.source,
      },
    ])
    expect(result.summary).toEqual({
      pathCount: 2,
      assertionCount: 4,
      failureCount: 2,
      missingRequiredPathCount: 1,
      forbiddenEmittedPathCount: 1,
      errors: 2,
    })
  })

  it('checks generated JSON artifacts', () => {
    const artifactPath = writeJson('artifacts/public-api.json', openApiDocument({
      '/books': {},
    }))

    const result = checkTargetCoverage({
      artifactPath,
      mustIncludePath: '/books',
      mustExcludePath: '/admin/books',
    })

    expect(result.valid).toBe(true)
    expect(result.emittedPaths).toEqual(['/books'])
    expect(result.failures).toEqual([])
  })

  it('checks Definition Builder target configs through target build output', () => {
    const targetPath = writeTarget('public-api.yaml', {
      name: 'public-api',
      scopes: ['public', 'admin'],
      domains: ['book'],
      servers: [],
      includePaths: ['/books'],
    })
    writeFragment('path/public/book/BooksPath.yaml', pathFragment('/books'))
    writeFragment('path/admin/book/AdminBooksPath.yaml', pathFragment('/admin/books'))

    const result = checkTargetCoverage({
      targetPath,
      fragmentsDir: join(tmpDir, 'fragments'),
      mustIncludePath: ['/books'],
      mustExcludePath: ['/admin/books'],
    })

    expect(result.valid).toBe(true)
    expect(result.source).toEqual({
      kind: 'definition-target',
      targetName: 'public-api',
      targetPath,
      fragmentsDir: join(tmpDir, 'fragments'),
    })
    expect(result.emittedPaths).toEqual(['/books'])
    expect(result.assertions).toEqual([
      {
        kind: 'mustIncludePath',
        path: '/books',
        passed: true,
      },
      {
        kind: 'mustExcludePath',
        path: '/admin/books',
        passed: true,
      },
    ])
  })

  it('requires exactly one source mode', () => {
    expect(() => checkTargetCoverage({
      mustIncludePath: '/books',
    })).toThrow('Target coverage requires exactly one of artifactPath, targetPath, or document.')
    expect(() => checkTargetCoverage({
      artifactPath: join(tmpDir, 'artifact.yaml'),
      document: openApiDocument({}),
    })).toThrow('Target coverage requires exactly one of artifactPath, targetPath, or document.')
  })
})

function openApiDocument(paths: NonNullable<OasDocument['paths']>): OasDocument {
  return {
    openapi: '3.2.0',
    info: {
      title: 'Test API',
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

function writeFragment(relativePath: string, value: unknown): string {
  return writeYamlFile(join(tmpDir, 'fragments', relativePath), value)
}

function writeTarget(relativePath: string, value: unknown): string {
  return writeYamlFile(join(tmpDir, 'targets', relativePath), value)
}

function writeYaml(relativePath: string, value: unknown): string {
  return writeYamlFile(join(tmpDir, relativePath), value)
}

function writeYamlFile(filePath: string, value: unknown): string {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, stringifyYaml(value), 'utf8')
  return filePath
}

function writeJson(relativePath: string, value: unknown): string {
  const filePath = join(tmpDir, relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return filePath
}
