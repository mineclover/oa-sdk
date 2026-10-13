import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { parseDocument, type OasDocument } from '@oa-sdk/parser'
import { buildRpcContract, buildSurfaceIr, RPC_CONTRACT_VERSION, toRpcContract } from '../src/index.js'

const json = (schema: object) => ({ content: { 'application/json': { schema } } })

function petstore(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Pets', version: '1.0.0' },
    paths: {
      '/pets': {
        get: {
          operationId: 'listPets',
          tags: ['Pet Store'],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'tags', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
          ],
          responses: { '200': { description: 'ok', ...json({ type: 'array', items: { $ref: '#/components/schemas/Pet' } }) } },
        },
        post: {
          operationId: 'createPet',
          tags: ['Pet Store'],
          requestBody: { required: true, ...json({ $ref: '#/components/schemas/NewPet' }) },
          responses: {
            '201': { description: 'created', ...json({ $ref: '#/components/schemas/Pet' }) },
            '409': { description: 'conflict', ...json({ $ref: '#/components/schemas/Problem' }) },
          },
        },
      },
      '/pets/{petId}': {
        get: {
          operationId: 'getPet',
          tags: ['Pet Store'],
          parameters: [
            { name: 'petId', in: 'path', required: true, schema: { type: 'integer' }, description: 'Pet id' },
            { name: 'X-Trace', in: 'header', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'ok', ...json({ $ref: '#/components/schemas/Pet' }) },
            '404': { description: 'missing', ...json({ $ref: '#/components/schemas/Problem' }) },
          },
        },
        delete: {
          operationId: 'deletePet',
          tags: ['Pet Store'],
          deprecated: true,
          parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '204': { description: 'deleted' } },
        },
      },
      '/pets/{petId}/photos': {
        put: {
          operationId: 'replacePhotos',
          tags: ['Pet Store'],
          parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: { required: true, ...json({ type: 'array', items: { type: 'string' } }) },
          responses: { '204': { description: 'replaced' } },
        },
      },
      '/pets/{petId}/rename': {
        post: {
          operationId: 'renamePet',
          tags: ['Pet Store'],
          'x-oa-sdk-rpc': { serviceName: 'PetService', methodName: 'Rename' },
          parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: { required: false, ...json({ type: 'object', required: ['name'], properties: { name: { type: 'string' } } }) },
          responses: { '200': { description: 'ok', ...json({ $ref: '#/components/schemas/Pet' }) } },
        },
      },
      '/pets/events': {
        get: {
          operationId: 'streamPetEvents',
          tags: ['Pet Store'],
          responses: { '200': { description: 'events', content: { 'text/event-stream': { itemSchema: { type: 'object' } } } } },
        },
      },
      '/health': {
        get: { operationId: 'health', responses: { '200': { description: 'ok', content: { 'text/plain': { schema: { type: 'string' } } } } } },
      },
    },
    components: {
      schemas: {
        Base: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
        NewPet: { allOf: [{ $ref: '#/components/schemas/Base' }, { type: 'object', properties: { tag: { type: 'string' } } }] },
        Pet: { allOf: [{ $ref: '#/components/schemas/NewPet' }, { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } }] },
        Problem: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } },
      },
    },
  } as unknown as OasDocument
}

describe('buildRpcContract', () => {
  it('names procedures after the camel-cased first tag and the operationId', () => {
    const contract = buildRpcContract(parseDocument(petstore()))

    expect(contract.schemaVersion).toBe(RPC_CONTRACT_VERSION)
    expect(Object.keys(contract.procedures).sort()).toEqual([
      'PetService.Rename',
      'health',
      'petStore.createPet',
      'petStore.deletePet',
      'petStore.getPet',
      'petStore.listPets',
      'petStore.replacePhotos',
    ])
    expect(contract.procedures.health?.path).toEqual(['health'])
    expect(contract.procedures['petStore.getPet']?.path).toEqual(['petStore', 'getPet'])
    expect(contract.procedures['petStore.listPets']?.kind).toBe('query')
    expect(contract.procedures['petStore.createPet']?.kind).toBe('mutation')
    expect(contract.procedures['petStore.deletePet']?.deprecated).toBe(true)
    expect(contract.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
  })

  it('merges parameters into a closed object input and records their HTTP binding', () => {
    const procedure = buildRpcContract(parseDocument(petstore())).procedures['petStore.getPet']!

    expect(procedure.input).toEqual({
      type: 'object',
      properties: {
        petId: { type: 'integer', description: 'Pet id' },
        'X-Trace': { type: 'string' },
      },
      required: ['petId'],
      additionalProperties: false,
    })
    expect(procedure.http).toEqual({
      method: 'get',
      path: '/pets/{petId}',
      parameters: [
        { field: 'petId', in: 'path', required: true },
        { field: 'X-Trace', in: 'header', required: false },
      ],
      success: { status: 200, mediaType: 'application/json' },
    })
    expect(procedure.errors['404']).toMatchObject({ description: 'missing', mediaType: 'application/json' })
  })

  it('spreads a plain object body, flattening allOf members reached through $ref', () => {
    const procedure = buildRpcContract(parseDocument(petstore())).procedures['petStore.createPet']!

    expect(procedure.http.body).toEqual({ mode: 'spread', mediaType: 'application/json', required: true })
    expect(procedure.input.properties).toEqual({ name: { type: 'string' }, tag: { type: 'string' } })
    expect(procedure.input.required).toEqual(['name'])
    expect(procedure.input.additionalProperties).toBeUndefined()
    expect(procedure.http.success).toEqual({ status: 201, mediaType: 'application/json' })
  })

  it('keeps a body under the body field when spreading would change its meaning', () => {
    const contract = buildRpcContract(parseDocument(petstore()))

    // An array body cannot be spread.
    expect(contract.procedures['petStore.replacePhotos']?.http.body).toEqual({
      mode: 'field', field: 'body', mediaType: 'application/json', required: true,
    })
    expect(contract.procedures['petStore.replacePhotos']?.input.required).toEqual(['petId', 'body'])
    // An optional body with required properties would lose "body absent" as a valid input.
    expect(contract.procedures['PetService.Rename']?.http.body).toMatchObject({ mode: 'field', required: false })
    expect(contract.procedures['PetService.Rename']?.input.required).toEqual(['petId'])

    const fieldMode = buildRpcContract(parseDocument(petstore()), { bodyMode: 'field', bodyField: 'payload' })
    expect(fieldMode.procedures['petStore.createPet']?.http.body).toMatchObject({ mode: 'field', field: 'payload' })
  })

  it('maps a success response without content to a null output', () => {
    const contract = buildRpcContract(parseDocument(petstore()))

    expect(contract.procedures['petStore.deletePet']?.output).toBeNull()
    expect(contract.procedures['petStore.deletePet']?.http.success).toEqual({ status: 204 })
    expect(contract.procedures.health?.http.success).toEqual({ status: 200, mediaType: 'text/plain' })
  })

  it('skips streaming operations with a warning', () => {
    const contract = buildRpcContract(parseDocument(petstore()))

    expect(contract.procedures['petStore.streamPetEvents']).toBeUndefined()
    expect(contract.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'rpc-contract/streaming-not-supported',
      operationId: 'streamPetEvents',
    }))
  })

  it('reports parameters that map to the same input field', () => {
    const document = petstore()
    const getPet = (document.paths!['/pets/{petId}'] as Record<string, any>).get
    getPet.parameters.push({ name: 'petId', in: 'query', schema: { type: 'string' } })
    const contract = buildRpcContract(parseDocument(document))

    expect(contract.procedures['petStore.getPet']).toBeUndefined()
    expect(contract.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'rpc-contract/field-collision',
      operationId: 'getPet',
    }))
  })

  it('reports a procedure that is also the group of other procedures', () => {
    const contract = buildRpcContract(parseDocument(petstore()), {
      operationOverrides: {
        health: { groupPath: [], methodName: 'petStore' },
      },
    })

    expect(contract.diagnostics).toContainEqual(expect.objectContaining({
      code: 'rpc-contract/namespace-conflict',
      operationId: 'health',
    }))
    expect(contract.procedures.petStore).toBeUndefined()
    expect(contract.procedures['petStore.getPet']).toBeDefined()
  })

  it('ignores Accept, Content-Type and Authorization header parameters', () => {
    const document = petstore()
    const getPet = (document.paths!['/pets/{petId}'] as Record<string, any>).get
    getPet.parameters.push(
      { name: 'Authorization', in: 'header', required: true, schema: { type: 'string' } },
      { name: 'accept', in: 'header', schema: { type: 'string' } },
    )
    const procedure = buildRpcContract(parseDocument(document)).procedures['petStore.getPet']!

    expect(Object.keys(procedure.input.properties ?? {})).toEqual(['petId', 'X-Trace'])
    expect(procedure.http.parameters.map(binding => binding.field)).toEqual(['petId', 'X-Trace'])
  })

  it('applies include filters and surface overrides', () => {
    const contract = buildRpcContract(parseDocument(petstore()), {
      include: operation => operation.method === 'get',
      operationOverrides: { getPet: { groupPath: ['pets'], methodName: 'get' } },
    })

    expect(Object.keys(contract.procedures).sort()).toEqual(['health', 'petStore.listPets', 'pets.get'])
  })

  it('projects an existing surface IR and hashes deterministically', () => {
    const document = parseDocument(petstore())
    const first = toRpcContract(buildSurfaceIr(document), document)
    const second = toRpcContract(buildSurfaceIr(document), document)

    expect(first.versionHash).toMatch(/^[0-9a-f]{64}$/)
    expect(first.versionHash).toBe(second.versionHash)
    expect(first.procedures['pet-store.getPet']).toBeDefined()
  })

  it('projects the current TypeSpec-derived OpenAPI artifact', () => {
    const specPath = new URL('../../schemas/src/.merged.yaml', import.meta.url)
    const document = parseDocument(parse(readFileSync(specPath, 'utf8')) as OasDocument)
    const contract = buildRpcContract(document)

    expect(Object.keys(contract.procedures)).toHaveLength(33)
    expect(contract.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
    expect(contract.procedures['users.getUserById']?.input.required).toEqual(['id'])
    expect(contract.procedures['worldModel.getWorldHead']).toBeDefined()
    expect(JSON.parse(JSON.stringify(contract))).toEqual(contract)
  })
})
