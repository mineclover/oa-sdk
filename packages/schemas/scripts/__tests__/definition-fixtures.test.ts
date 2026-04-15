import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const __dir = dirname(fileURLToPath(import.meta.url))

const FIXTURES = [
  ['schema:public/book/Note', 'schema/public/book/Note.yaml'],
  ['schema:public/notebook/Note', 'schema/public/notebook/Note.yaml'],
  ['schema:shared/common/Error', 'schema/shared/common/Error.yaml'],
] as const

describe('definition builder fixtures', () => {
  it('declares the canonical schema identity fixtures', () => {
    for (const [expectedId, relativePath] of FIXTURES) {
      const fixture = readFixture(relativePath)
      expect(fixture.id).toBe(expectedId)
      expect(fixture.content).toMatchObject({ type: 'object' })
    }
  })
})

function readFixture(relativePath: string): { id?: unknown; content?: unknown } {
  const fixturePath = join(__dir, '../../src/fragments', relativePath)
  const raw = readFileSync(fixturePath, 'utf8')
  return parseYaml(raw) as { id?: unknown; content?: unknown }
}
