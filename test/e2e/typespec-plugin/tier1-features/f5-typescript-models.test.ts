import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { compileTypeSpecInMemory } from '../../../../packages/codegen/src/plugin/index.js'
import { generateTypesFromSpec } from '../../../../packages/codegen/src/typegen/generate-types.js'

describe('Tier 1: F5 - TypeScript Models Plugin', () => {
  const petstoreFile = resolve('test/e2e/typespec-plugin/fixtures/petstore/main.tsp')
  let doc: any

  beforeAll(async () => {
    const result = await compileTypeSpecInMemory(petstoreFile)
    doc = result.document
  })

  it('F5.1: generates TypeScript interfaces for TypeSpec models (Pet, Category, Tag)', () => {
    const code = generateTypesFromSpec(doc, { style: 'interface' })

    expect(code).toMatch(/interface Pet\s*\{/)
    expect(code).toMatch(/interface Category\s*\{/)
    expect(code).toMatch(/interface Tag\s*\{/)
    expect(code).toContain('id: string')
    expect(code).toContain('name: string')
  })

  it('F5.2: generates type aliases and enums according to specified style', () => {
    const code = generateTypesFromSpec(doc, { style: 'type' })

    expect(code).toContain('PetStatus')
    expect(code).toContain("'available'")
    expect(code).toContain("'pending'")
    expect(code).toContain("'sold'")
  })

  it('F5.3: emits operation parameter DTO types (PathParams, QueryParams, Body, Response)', () => {
    const code = generateTypesFromSpec(doc)

    expect(code).toContain('ListPets')
    expect(code).toContain('GetPetById')
    expect(code).toContain('CreatePet')
  })

  it('F5.4: preserves JSDoc descriptions from TypeSpec source comments and @doc', () => {
    const code = generateTypesFromSpec(doc, { includeAnnotations: true })

    expect(code).toContain('Standard error structure')
  })

  it('F5.5: generates discriminated error shape types with mutually exclusive properties', () => {
    const code = generateTypesFromSpec(doc)

    expect(code).toContain('PetError')
    expect(code).toContain('code: string')
    expect(code).toContain('message: string')
  })
})
