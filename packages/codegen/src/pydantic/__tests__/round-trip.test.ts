import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildPydanticModels } from '../build.js'
import { deriveParitySourceSchemas } from './parity-source.js'
import { PYDANTIC_FIXTURE_NAMES, loadPydanticFixture, withReversedOperations, withReversedSchemas } from './fixtures.js'

const allowList = JSON.parse(readFileSync(new URL('./python-lane/parity-allowlist.json', import.meta.url), 'utf8')) as Array<{ fixture: string; pointer: string; reason: string }>

const fidelityDocument = {
  openapi: '3.2.0', info: { title: 'parity', version: '1' }, components: { schemas: {
    Profile: { type: 'object', title: 'Profile title', properties: {
      code: { type: 'string', title: 'Code', pattern: '\\d+' },
      homepage: { type: 'string', format: 'uri' },
    } },
  } }, paths: { '/items': { post: {
    operationId: 'createItem', requestBody: { content: {
      'application/json': { schema: { $ref: '#/components/schemas/Profile' } },
    } }, responses: { '200': { description: 'ok', content: {
      'application/json': { schema: { $ref: '#/components/schemas/Profile' } },
    } } },
  } } },
}

const parityDocuments: Record<string, ReturnType<typeof loadPydanticFixture>> = {
  ...Object.fromEntries(PYDANTIC_FIXTURE_NAMES.map(name => [name, loadPydanticFixture(name)])),
  'type-fidelity': fidelityDocument as ReturnType<typeof loadPydanticFixture>,
}

function pointerExists(source: Record<string, unknown>, pointer: string): boolean {
  const [model, ...tokens] = pointer.split('/').slice(1)
  let value: unknown = source[model ?? '']
  for (const token of tokens) {
    if (value === null || typeof value !== 'object') return false
    value = (value as Record<string, unknown>)[token.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return value !== undefined
}

describe('Pydantic type schema parity contract', () => {
  it('derives every model source schema and validates the exact allow-list', () => {
    const seenPointers = new Set<string>()
    for (const entry of allowList) {
      expect(Object.keys(parityDocuments)).toContain(entry.fixture)
      expect(entry.fixture.length).toBeGreaterThan(0)
      expect(entry.pointer.startsWith('/')).toBe(true)
      expect(entry.pointer.includes('*')).toBe(false)
      expect(entry.pointer.split('/').slice(1).every(token => token.length > 0)).toBe(true)
      expect(entry.reason.length).toBeGreaterThan(20)
      expect(entry.reason).toContain('because')
      expect(seenPointers.has(`${entry.fixture}:${entry.pointer}`)).toBe(false)
      seenPointers.add(`${entry.fixture}:${entry.pointer}`)
    }
    for (const [fixture, document] of Object.entries(parityDocuments)) {
      const result = buildPydanticModels(document, { layout: 'single', regex: 'ecma' })
      const source = deriveParitySourceSchemas(document, result.ir)
      const modelNames = result.ir.decls.filter(decl => decl.kind === 'model' && decl.pyName !== null).map(decl => decl.pyName!).sort()
      expect(Object.keys(source.models).sort(), fixture).toEqual(modelNames)
      for (const entry of allowList.filter(item => item.fixture === fixture)) {
        expect(entry.pointer.startsWith('/'), entry.pointer).toBe(true)
        expect(entry.pointer.split('/').slice(1).every(token => token.length > 0), entry.pointer).toBe(true)
        expect(entry.reason.length, entry.pointer).toBeGreaterThan(20)
        expect(pointerExists(source.models, entry.pointer), `${fixture}${entry.pointer}`).toBe(true)
      }
    }
  })

  it('derivation is independent of component and path order', () => {
    for (const [fixture, document] of Object.entries(parityDocuments)) {
      const first = buildPydanticModels(document, { layout: 'single', regex: 'ecma' })
      const reversedDocument = withReversedOperations(withReversedSchemas(document))
      const reversed = buildPydanticModels(reversedDocument, { layout: 'single', regex: 'ecma' })
      expect(deriveParitySourceSchemas(document, first.ir), fixture).toEqual(deriveParitySourceSchemas(reversedDocument, reversed.ir))
    }
  })
})
