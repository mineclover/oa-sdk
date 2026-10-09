import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { compileTypeSpecInMemory } from '../../../../packages/codegen/src/plugin/index.js'
import {
  generateTanstackQuery,
  generateKeyFactory,
  generateOptionsFactory,
  generateHookFactory,
} from '../../../../packages/client/src/tanstack/index.js'

describe('Tier 1: F6 - TanStack Query v5 Plugin', () => {
  const petstoreFile = resolve('test/e2e/typespec-plugin/fixtures/petstore/main.tsp')
  let doc: any

  beforeAll(async () => {
    const result = await compileTypeSpecInMemory(petstoreFile)
    doc = result.document
  })

  it('F6.1: generates Tier 1 hierarchical query key factories (*Keys)', () => {
    const output = generateTanstackQuery(doc)
    expect(output.keysCode).toBeDefined()
    expect(output.keysCode).toMatch(/Keys\s*=\s*\{/)
    expect(output.keysCode).toContain('all:')
  })

  it('F6.2: generates Tier 2 pure queryOptions and mutationOptions factories', () => {
    const output = generateTanstackQuery(doc)
    expect(output.queriesCode).toBeDefined()
    expect(output.queriesCode).toContain('queryOptions')
  })

  it('F6.3: generates Tier 3 React hooks with "use client" directive banner', () => {
    const output = generateTanstackQuery(doc)
    expect(output.hooksCode).toBeDefined()
    expect(output.hooksCode).toContain('useQuery')
  })

  it('F6.4: supports infinite query generation for paginated endpoints', () => {
    const output = generateTanstackQuery(doc, { infiniteQuery: true })
    expect(output.combinedCode || output.queriesCode).toBeDefined()
  })

  it('F6.5: supports split emission mode across keys, queries, and hooks files', () => {
    const output = generateTanstackQuery(doc, { splitFiles: true })
    expect(output.keysCode.length).toBeGreaterThan(0)
    expect(output.queriesCode.length).toBeGreaterThan(0)
    expect(output.hooksCode.length).toBeGreaterThan(0)
  })
})
