import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { compileTypeSpecInMemory } from '../../plugin/compiler.js'
import { renderOpenApiTsClient } from '../../plugin/client-renderer/openapi-ts-client.js'
import type { OasDocument } from '@oa-sdk/parser'

describe('TypeSpec Builder Platform: Multi-Status Error Union & TSDoc Provenance', () => {
  const monorepoRoot = resolve(__dirname, '../../../../..')
  const petstoreFile = resolve(monorepoRoot, 'test/e2e/typespec-plugin/fixtures/petstore/main.tsp')
  let petstoreDoc: OasDocument

  beforeAll(async () => {
    const res = await compileTypeSpecInMemory(petstoreFile)
    petstoreDoc = res.document
  })

  it('generates ErrorUnion helper type and isErrorStatus type guard function', () => {
    const { code, exports } = renderOpenApiTsClient({
      document: petstoreDoc,
      output: 'client.ts',
    })

    expect(exports).toContain('ErrorUnion')
    expect(exports).toContain('isErrorStatus')

    expect(code).toContain('export type ErrorUnion<TStatusMap> = {')
    expect(code).toContain('export function isErrorStatus<TStatus extends number>(')
    expect(code).toContain('result.error !== undefined && result.response.status === status')
  })

  it('generates {Operation}Errors and {Operation}ErrorUnion for operations', () => {
    const { code, exports } = renderOpenApiTsClient({
      document: petstoreDoc,
      output: 'client.ts',
    })

    // Check exported symbols
    expect(exports).toContain('GetPetByIdErrors')
    expect(exports).toContain('GetPetByIdErrorUnion')
    expect(exports).toContain('ListPetsErrors')
    expect(exports).toContain('ListPetsErrorUnion')
    expect(exports).toContain('CreatePetErrors')
    expect(exports).toContain('CreatePetErrorUnion')

    // Check code structure
    expect(code).toMatch(/export type GetPetByIdErrors\s*=/)
    expect(code).toMatch(/export type GetPetByIdErrorUnion\s*=/)
  })

  it('generates rich TSDoc comments with @param and @see provenance', () => {
    const { code } = renderOpenApiTsClient({
      document: petstoreDoc,
      output: 'client.ts',
    })

    // Contains method and path
    expect(code).toContain('GET /pets/{petId} - Get pet by ID')
    // Contains parameter documentation
    expect(code).toContain('@param options.path Path parameters for /pets/{petId}')
    // Contains cross-reference provenance link
    expect(code).toContain('@see {@link ./types.js} Operation getPetById')
  })

  it('generates multi-status error map when operation has explicit error status codes', () => {
    // Synthetic OAS document with multiple error responses
    const syntheticDoc: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Multi-Error API', version: '1.0.0' },
      paths: {
        '/items/{id}': {
          get: {
            operationId: 'getItem',
            summary: 'Get item with typed errors',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Item' },
                  },
                },
              },
              '400': {
                description: 'Bad Request',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/ValidationError' },
                  },
                },
              },
              '404': {
                description: 'Not Found',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/NotFoundError' },
                  },
                },
              },
              default: {
                description: 'Unexpected Error',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/GeneralError' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Item: { type: 'object', properties: { id: { type: 'string' } } },
          ValidationError: { type: 'object', properties: { field: { type: 'string' } } },
          NotFoundError: { type: 'object', properties: { message: { type: 'string' } } },
          GeneralError: { type: 'object', properties: { code: { type: 'number' } } },
        },
      },
    }

    const { code, exports } = renderOpenApiTsClient({
      document: syntheticDoc,
      output: 'client.ts',
    })

    expect(exports).toContain('GetItemErrors')
    expect(exports).toContain('GetItemErrorUnion')

    // Interface with explicit status codes
    expect(code).toContain('export interface GetItemErrors {')
    expect(code).toContain('400: ValidationError')
    expect(code).toContain('404: NotFoundError')
    expect(code).toContain('[status: number]: GeneralError')

    // Discriminated union by status
    expect(code).toContain(
      'export type GetItemErrorUnion = { status: 400; error: ValidationError } | { status: 404; error: NotFoundError } | { status: number; error: GeneralError }',
    )
  })
})
