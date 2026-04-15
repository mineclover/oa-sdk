import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const __dir = dirname(fileURLToPath(import.meta.url))

const FIXTURES = [
  ['schema:admin/a/Name', 'schema/admin/a/Name.yaml'],
  ['schema:admin/book/Note', 'schema/admin/book/Note.yaml'],
  ['schema:admin/notebook/Note', 'schema/admin/notebook/Note.yaml'],
  ['schema:internal/health/HealthStatus', 'schema/internal/health/HealthStatus.yaml'],
  ['schema:public/a/Name', 'schema/public/a/Name.yaml'],
  ['schema:public/aname/Name', 'schema/public/aname/Name.yaml'],
  ['schema:public/a-name/Name', 'schema/public/a-name/Name.yaml'],
  ['schema:public/book/Note', 'schema/public/book/Note.yaml'],
  ['schema:public/notebook/Note', 'schema/public/notebook/Note.yaml'],
  ['schema:shared/common/Error', 'schema/shared/common/Error.yaml'],
] as const

const PATH_FIXTURES = [
  ['path:public/book/BookNotesPath', 'path/public/book/BookNotesPath.yaml', '/books/{bookId}/notes'],
  ['path:admin/book/BookNotesPath', 'path/admin/book/BookNotesPath.yaml', '/admin/books/{bookId}/notes'],
  ['path:internal/health/HealthPath', 'path/internal/health/HealthPath.yaml', '/internal/health'],
] as const

const TARGET_FIXTURES = [
  {
    name: 'public-api',
    path: 'public-api.yaml',
    scopes: ['shared', 'public'],
    domains: ['common', 'book', 'notebook', 'a', 'aname', 'a-name'],
    includePaths: ['/books/{bookId}/notes'],
  },
  {
    name: 'admin-api',
    path: 'admin-api.yaml',
    scopes: ['shared', 'admin'],
    domains: ['common', 'book', 'notebook', 'a'],
    includePaths: ['/admin/books/{bookId}/notes'],
  },
  {
    name: 'internal-api',
    path: 'internal-api.yaml',
    scopes: ['shared', 'internal'],
    domains: ['common', 'health'],
    includePaths: ['/internal/health'],
  },
] as const

describe('definition builder fixtures', () => {
  it('declares the canonical schema identity fixtures', () => {
    const fixtureIds = FIXTURES.map(([id]) => id)
    expect(new Set(fixtureIds).size).toBe(FIXTURES.length)

    for (const [expectedId, relativePath] of FIXTURES) {
      const fixture = readFixture(relativePath)
      expect(fixture.id).toBe(expectedId)
      expect(fixture.content).toMatchObject({ type: 'object' })
    }
  })

  it('declares canonical path fixtures for target selection', () => {
    const fixtureIds = PATH_FIXTURES.map(([id]) => id)
    expect(new Set(fixtureIds).size).toBe(PATH_FIXTURES.length)

    for (const [expectedId, relativePath, expectedPath] of PATH_FIXTURES) {
      const fixture = readFixture(relativePath)
      expect(fixture.id).toBe(expectedId)
      expect(fixture.metadata).toMatchObject({ path: expectedPath })
      expect(fixture.content).toEqual(expect.any(Object))
    }
  })

  it('declares target fixtures for target bundle selection', () => {
    const fixturePaths = new Set(PATH_FIXTURES.map(([, , path]) => path))

    for (const expected of TARGET_FIXTURES) {
      const target = readTargetFixture(expected.path)
      expect(target.name).toBe(expected.name)
      expect(target.scopes).toEqual(expected.scopes)
      expect(target.domains).toEqual(expected.domains)
      expect(target.servers).toEqual([expect.objectContaining({ url: expect.any(String) })])
      expect(target.includePaths).toEqual(expected.includePaths)
      expect(target.namingPolicy).toEqual({ aliases: {} })
      for (const path of expected.includePaths) {
        expect(fixturePaths.has(path)).toBe(true)
      }
    }
  })
})

function readFixture(relativePath: string): { id?: unknown; metadata?: unknown; content?: unknown } {
  const fixturePath = join(__dir, '../../src/fragments', relativePath)
  const raw = readFileSync(fixturePath, 'utf8')
  return parseYaml(raw) as { id?: unknown; metadata?: unknown; content?: unknown }
}

function readTargetFixture(relativePath: string): {
  name?: unknown
  scopes?: unknown
  domains?: unknown
  servers?: unknown
  includePaths?: unknown
  namingPolicy?: unknown
} {
  const fixturePath = join(__dir, '../../src/targets', relativePath)
  const raw = readFileSync(fixturePath, 'utf8')
  return parseYaml(raw) as {
    name?: unknown
    scopes?: unknown
    domains?: unknown
    servers?: unknown
    includePaths?: unknown
    namingPolicy?: unknown
  }
}
