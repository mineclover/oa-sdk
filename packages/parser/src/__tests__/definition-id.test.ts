import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  CANONICAL_DEFINITION_KINDS,
  parseDefinitionId,
  validateDefinitionId,
  validateDefinitionIds,
} from '../definition-id.js'

const __dir = dirname(fileURLToPath(import.meta.url))

describe('canonical definition ids', () => {
  it('parses kind:scope/domain/name into stable identity parts', () => {
    expect(parseDefinitionId('schema:public/book/Note')).toEqual({
      id: 'schema:public/book/Note',
      kind: 'schema',
      scope: 'public',
      domain: 'book',
      name: 'Note',
    })
  })

  it('accepts every supported definition kind', () => {
    for (const kind of CANONICAL_DEFINITION_KINDS) {
      expect(validateDefinitionId(`${kind}:public/book/Note`).valid).toBe(true)
    }
  })

  it('rejects malformed and nested ids', () => {
    const malformed = [
      'schema:book/Note',
      'schema:Note',
      'schema:public/book/chapter/Note',
    ]

    for (const id of malformed) {
      const result = validateDefinitionId(id)
      expect(result.valid).toBe(false)
      expect(result.diagnostics[0]?.code).toBe('definition-id/malformed')
    }
  })

  it('rejects unsupported kinds', () => {
    const result = validateDefinitionId('model:public/book/Note')

    expect(result.valid).toBe(false)
    expect(result.diagnostics.some(d => d.code === 'definition-id/unsupported-kind')).toBe(true)
  })

  it('requires lower-case scope and domain segments', () => {
    const result = validateDefinitionId('schema:Public/Book/Note')

    expect(result.valid).toBe(false)
    expect(result.diagnostics.map(d => d.code)).toEqual([
      'definition-id/invalid-scope',
      'definition-id/invalid-domain',
    ])
  })

  it('requires PascalCase names for component-like definitions', () => {
    const componentResult = validateDefinitionId('schema:public/book/note')
    const operationResult = validateDefinitionId('operation:public/book/listNotes')

    expect(componentResult.valid).toBe(false)
    expect(componentResult.diagnostics.some(d => d.code === 'definition-id/component-name-pascal-case')).toBe(true)
    expect(operationResult.valid).toBe(true)
  })

  it('rejects duplicate ids in a definition id list', () => {
    const result = validateDefinitionIds([
      'schema:public/book/Note',
      'schema:public/notebook/Note',
      'schema:public/book/Note',
    ])

    expect(result.valid).toBe(false)
    expect(result.diagnostics).toContainEqual({
      id: 'schema:public/book/Note',
      code: 'definition-id/duplicate',
      message: 'Duplicate definition id "schema:public/book/Note" first appeared at index 0.',
      index: 2,
      firstIndex: 0,
    })
  })

  it('parses the schema fragment fixtures without duplicate ids', () => {
    const fixtureIds = [
      readFixtureId('public/book/Note.yaml'),
      readFixtureId('public/notebook/Note.yaml'),
      readFixtureId('shared/common/Error.yaml'),
    ]

    expect(fixtureIds).toEqual([
      'schema:public/book/Note',
      'schema:public/notebook/Note',
      'schema:shared/common/Error',
    ])
    const result = validateDefinitionIds(fixtureIds)
    expect(result.valid).toBe(true)
    expect(result.ids.map(id => id.domain)).toEqual(['book', 'notebook', 'common'])
  })
})

function readFixtureId(path: string): string {
  const fixturePath = join(__dir, '../../../schemas/src/fragments/schema', path)
  const raw = readFileSync(fixturePath, 'utf8')
  const parsed = parseYaml(raw) as { id?: unknown }
  if (typeof parsed.id !== 'string') throw new Error(`Fixture ${path} is missing id`)
  return parsed.id
}
