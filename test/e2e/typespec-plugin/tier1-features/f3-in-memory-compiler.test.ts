import { describe, it, expect } from 'vitest'
import { resolve, dirname } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import {
  compileTypeSpecInMemory,
  resolveTypeSpecEntrypoint,
} from '../../../../packages/codegen/src/plugin/index.js'

describe('Tier 1: F3 - In-Memory TypeSpec Compiler', () => {
  const petstoreFile = resolve('test/e2e/typespec-plugin/fixtures/petstore/main.tsp')
  const petstoreDir = resolve('test/e2e/typespec-plugin/fixtures/petstore')
  const invalidFile = resolve('test/e2e/typespec-plugin/fixtures/syntax-error/invalid.tsp')

  it('F3.1: compiles in-memory with zero disk write artifacts', async () => {
    const dirBefore = readdirSync(petstoreDir)
    const result = await compileTypeSpecInMemory(petstoreFile)

    expect(result.program).toBeDefined()
    expect(result.document).toBeDefined()

    const dirAfter = readdirSync(petstoreDir)
    expect(dirAfter).toEqual(dirBefore)
    expect(existsSync(resolve(petstoreDir, 'openapi.json'))).toBe(false)
    expect(existsSync(resolve(petstoreDir, 'openapi.yaml'))).toBe(false)
  })

  it('F3.2: compiles single .tsp file entrypoint cleanly', async () => {
    const result = await compileTypeSpecInMemory(petstoreFile)
    expect(result.entrypoint).toBe(petstoreFile)
    expect(result.routesCount).toBeGreaterThan(0)
    expect(result.sourceFiles.length).toBeGreaterThan(0)
    expect(result.document.openapi).toBe('3.2.0')
  })

  it('F3.3: automatically resolves main.tsp when given a directory entrypoint', async () => {
    const resolvedPath = resolveTypeSpecEntrypoint(petstoreDir)
    expect(resolvedPath).toBe(petstoreFile)

    const result = await compileTypeSpecInMemory(petstoreDir)
    expect(result.entrypoint).toBe(petstoreFile)
    expect(result.document.info.title).toBe('Petstore Service')
  })

  it('F3.4: generates complete OpenAPI 3.2.0 structure with components.schemas and paths', async () => {
    const result = await compileTypeSpecInMemory(petstoreFile, { openApiVersion: '3.2.0' })
    const doc = result.document

    expect(doc.openapi).toBe('3.2.0')
    expect(doc.paths).toBeDefined()
    expect(doc.paths['/pets']).toBeDefined()
    expect(doc.paths['/pets/{petId}']).toBeDefined()

    expect(doc.components?.schemas).toBeDefined()
    const schemaNames = Object.keys(doc.components!.schemas!)
    expect(schemaNames).toContain('Pet')
    expect(schemaNames).toContain('PetStatus')
    expect(schemaNames).toContain('CreatePetRequest')
  })

  it('F3.5: throws descriptive error with formatted diagnostics on invalid TypeSpec source', async () => {
    await expect(compileTypeSpecInMemory(invalidFile)).rejects.toThrow(/TypeSpec compilation failed/)
  })
})
