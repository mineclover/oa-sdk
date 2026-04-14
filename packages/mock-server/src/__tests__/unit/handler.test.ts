import { describe, expect, it } from 'vitest'
import { handleRequest } from '../../core/handler.js'

const baseEntry = {
  operationId: 'createUser',
  method: 'post',
  openApiPath: '/users',
  parameters: [],
  responses: { '200': { description: 'OK' } },
  security: [],
}

describe('handleRequest', () => {
  it('요청 값 검증 실패는 422 validation-error', () => {
    const result = handleRequest(
      {
        pathParams: {},
        queryParams: {},
        headers: {},
        body: {},
        contentType: 'application/json',
      },
      {
        ...baseEntry,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string' } },
              },
            },
          },
        },
      },
      {},
    )

    expect(result.type).toBe('validation-error')
    if (result.type === 'validation-error') {
      expect(result.status).toBe(422)
      expect(result.body.error.code).toBe('CONSTRAINT_VIOLATION')
    }
  })

  it('검증 스키마 컴파일 실패는 500 schema-error', () => {
    const result = handleRequest(
      {
        pathParams: {},
        queryParams: {},
        headers: {},
        body: 'anything',
        contentType: 'application/json',
      },
      {
        ...baseEntry,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'strng' as never },
            },
          },
        },
      },
      {},
    )

    expect(result.type).toBe('schema-error')
    if (result.type === 'schema-error') {
      expect(result.status).toBe(500)
      expect(result.body.error.code).toBe('SCHEMA_COMPILE_ERROR')
      expect(result.body.error.details[0]?.code).toBe('SCHEMA_COMPILE_ERROR')
    }
  })
})
