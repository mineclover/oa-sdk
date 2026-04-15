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
  ['schema:public/a/Name', 'schema/public/a/Name.yaml'],
  ['schema:public/aname/Name', 'schema/public/aname/Name.yaml'],
  ['schema:public/a-name/Name', 'schema/public/a-name/Name.yaml'],
  ['schema:public/book/Note', 'schema/public/book/Note.yaml'],
  ['schema:public/notebook/Note', 'schema/public/notebook/Note.yaml'],
  ['schema:shared/common/Error', 'schema/shared/common/Error.yaml'],
] as const

const TARGET_FIXTURES = [
  {
    name: 'public-api',
    path: 'public-api.yaml',
    includeDefinitions: [
      'schema:shared/common/Error',
      'schema:public/book/Note',
      'schema:public/notebook/Note',
      'schema:public/a/Name',
      'schema:public/aname/Name',
      'schema:public/a-name/Name',
    ],
  },
  {
    name: 'admin-api',
    path: 'admin-api.yaml',
    includeDefinitions: [
      'schema:shared/common/Error',
      'schema:admin/book/Note',
      'schema:admin/notebook/Note',
      'schema:admin/a/Name',
    ],
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

  it('declares target fixtures for collision simulations', () => {
    const fixtureIds = new Set(FIXTURES.map(([id]) => id))

    for (const expected of TARGET_FIXTURES) {
      const target = readTargetFixture(expected.path)
      expect(target.name).toBe(expected.name)
      expect(target.servers).toEqual([expect.objectContaining({ url: expect.any(String) })])
      expect(target.includeDefinitions).toEqual(expected.includeDefinitions)
      for (const id of expected.includeDefinitions) {
        expect(fixtureIds.has(id)).toBe(true)
      }
    }
  })
})

function readFixture(relativePath: string): { id?: unknown; content?: unknown } {
  const fixturePath = join(__dir, '../../src/fragments', relativePath)
  const raw = readFileSync(fixturePath, 'utf8')
  return parseYaml(raw) as { id?: unknown; content?: unknown }
}

function readTargetFixture(relativePath: string): {
  name?: unknown
  servers?: unknown
  includeDefinitions?: unknown
} {
  const fixturePath = join(__dir, '../../src/targets', relativePath)
  const raw = readFileSync(fixturePath, 'utf8')
  return parseYaml(raw) as {
    name?: unknown
    servers?: unknown
    includeDefinitions?: unknown
  }
}
