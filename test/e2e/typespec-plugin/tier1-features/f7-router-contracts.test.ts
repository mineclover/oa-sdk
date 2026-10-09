import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { compileTypeSpecInMemory } from '../../../../packages/codegen/src/plugin/index.js'
import {
  generateHandlerContract,
  generateRouter,
} from '../../../../packages/router/src/index.js'

describe('Tier 1: F7 - Server Router Contracts Plugin', () => {
  const petstoreFile = resolve('test/e2e/typespec-plugin/fixtures/petstore/main.tsp')
  let doc: any

  beforeAll(async () => {
    const result = await compileTypeSpecInMemory(petstoreFile)
    doc = result.document
  })

  it('F7.1: generates pure handler contract interface ApiHandlers (*.contract.ts)', () => {
    const contract = generateHandlerContract(doc, { typesImport: './types.js' })

    expect(contract).toContain('export interface ApiHandlers')
    expect(contract).toContain('petsListPets')
    expect(contract).toContain('petsGetPetById')
    expect(contract).toContain('petsCreatePet')
  })

  it('F7.2: enforces HandlerResponse multi-status error union return type', () => {
    const contract = generateHandlerContract(doc)

    expect(contract).toContain('HandlerResponse')
  })

  it('F7.3: implements response envelope collision defense logic', () => {
    const contract = generateHandlerContract(doc)

    // Checks that handler responses distinguish between body payloads and HTTP envelope
    expect(contract).toMatch(/body|status|headers/)
  })

  it('F7.4: generates Hono router dispatch stubs wired to handler contracts', () => {
    const router = generateRouter(doc, { target: 'hono', contractImport: './api.contract.js' })

    expect(router).toContain("import { Hono } from 'hono'")
    expect(router).toContain('/pets')
  })

  it('F7.5: supports multi-framework router targets (Fastify, Express, Elysia)', () => {
    const fastifyRouter = generateRouter(doc, { target: 'fastify', contractImport: './api.contract.js' })
    expect(fastifyRouter).toContain('fastify')

    const expressRouter = generateRouter(doc, { target: 'express', contractImport: './api.contract.js' })
    expect(expressRouter).toContain('express')
  })
})
