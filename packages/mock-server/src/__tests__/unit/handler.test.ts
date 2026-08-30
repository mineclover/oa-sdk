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
  it('요청 값 검증 실패는 문서화된 422 response와 contract-safe diagnostics를 선택한다', () => {
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
        responses: {
          '200': { description: 'OK' },
          '422': {
            description: 'Unprocessable Content',
            content: {
              'application/problem+json': {
                schema: {
                  type: 'object',
                  required: ['code', 'message'],
                  properties: {
                    code: { const: 'SCHEMA_VALIDATION_FAILED' },
                    message: { type: 'string' },
                    details: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['path', 'message'],
                        properties: {
                          path: { type: 'string' },
                          message: { type: 'string' },
                          expected: { type: 'string' },
                        },
                        additionalProperties: false,
                      },
                    },
                  },
                  additionalProperties: false,
                },
                example: { code: 'SCHEMA_VALIDATION_FAILED', message: 'Invalid request' },
              },
            },
          },
        },
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

    expect(result.type).toBe('success')
    if (result.type === 'success') {
      expect(result.picked.status).toBe(422)
      expect(result.picked.contentType).toBe('application/problem+json')
      expect(result.picked.body).toEqual({
        code: 'SCHEMA_VALIDATION_FAILED',
        message: 'Invalid request',
        details: [{ path: '/body/name', message: "필수 필드 누락: 'name'" }],
      })
    }
  })

  it('422 schema가 diagnostics를 허용하지 않으면 문서화된 body를 그대로 유지한다', () => {
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
        responses: {
          '200': { description: 'OK' },
          '422': {
            description: 'Unprocessable Content',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['code', 'message'],
                  properties: {
                    code: { const: 'SCHEMA_VALIDATION_FAILED' },
                    message: { type: 'string' },
                  },
                  additionalProperties: false,
                },
                example: { code: 'SCHEMA_VALIDATION_FAILED', message: 'Invalid request' },
              },
            },
          },
        },
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

    expect(result.type).toBe('success')
    if (result.type === 'success') {
      expect(result.picked.status).toBe(422)
      expect(result.picked.body).toEqual({ code: 'SCHEMA_VALIDATION_FAILED', message: 'Invalid request' })
    }
  })

  it('인증 자격 증명 누락은 문서화된 401 Error 응답을 선택한다', () => {
    const result = handleRequest(
      {
        pathParams: {},
        queryParams: {},
        headers: {},
        body: undefined,
        contentType: undefined,
      },
      {
        ...baseEntry,
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'OK' },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['code', 'message'],
                  properties: {
                    code: { const: 'UNAUTHORIZED' },
                    message: { type: 'string' },
                  },
                  unevaluatedProperties: false,
                },
                example: { code: 'UNAUTHORIZED', message: 'Authentication required' },
              },
            },
          },
        },
      },
      { bearerAuth: { type: 'http', scheme: 'bearer' } },
    )

    expect(result.type).toBe('success')
    if (result.type === 'success') {
      expect(result.picked.status).toBe(401)
      expect(result.picked.body).toEqual({ code: 'UNAUTHORIZED', message: 'Authentication required' })
      expect(result.callbacks).toEqual([])
    }
  })

  it('422 error envelope serializes only summaries for sensitive request values', () => {
    const password = 'PASSWORD_SENTINEL_97af'
    const refreshToken = 'REFRESH_TOKEN_SENTINEL_20de'
    const secret = 'SECRET_SENTINEL_d41c'
    const wholeObjectValue = 'WHOLE_OBJECT_SENTINEL_6f88'
    const result = handleRequest(
      {
        pathParams: {},
        queryParams: {},
        headers: {},
        body: {
          password,
          refreshToken,
          secret,
          profile: { token: wholeObjectValue },
          entries: [wholeObjectValue],
        },
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
                required: ['password', 'refreshToken', 'secret', 'profile', 'entries'],
                properties: {
                  password: { type: 'string', minLength: 128 },
                  refreshToken: { type: 'string', enum: ['accepted-token'] },
                  secret: { type: 'string', pattern: '^[0-9]+$' },
                  profile: { type: 'object', maxProperties: 0 },
                  entries: { type: 'array', maxItems: 0 },
                },
              },
            },
          },
        },
      },
      {},
    )

    expect(result.type).toBe('validation-error')
    if (result.type === 'validation-error') {
      const serialized = JSON.stringify(result.body.error.details)
      for (const sensitiveValue of [password, refreshToken, secret, wholeObjectValue]) {
        expect(serialized).not.toContain(sensitiveValue)
      }
      expect(result.body.error.details).toContainEqual(expect.objectContaining({
        path: '/body/profile',
        received: { type: 'object', count: 1 },
        stage: 'validate',
      }))
      expect(result.body.error.details.every(detail => detail.value === undefined)).toBe(true)
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

  it('선택된 응답 example이 schema를 위반하면 500 schema-error', () => {
    const result = handleRequest(
      {
        pathParams: {},
        queryParams: {},
        headers: {},
        body: undefined,
        contentType: undefined,
      },
      {
        ...baseEntry,
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  unevaluatedProperties: { type: 'string' },
                },
                example: { actor: 42 },
              },
            },
          },
        },
      },
      {},
    )

    expect(result.type).toBe('schema-error')
    if (result.type === 'schema-error') {
      expect(result.status).toBe(500)
      expect(result.body.error.code).toBe('CONSTRAINT_VIOLATION')
      expect(result.body.error.message).toContain('응답이 응답 스키마를 만족하지 않습니다')
      expect(result.body.error.details[0]?.path).toBe('/response/body/actor')
    }
  })

  it('schema에서 생성한 응답은 post-validation을 통과한다', () => {
    const result = handleRequest(
      {
        pathParams: {},
        queryParams: {},
        headers: {},
        body: undefined,
        contentType: undefined,
      },
      {
        ...baseEntry,
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id'],
                  properties: { id: { type: 'string', minLength: 1 } },
                  unevaluatedProperties: false,
                },
              },
            },
          },
        },
      },
      {},
    )

    expect(result.type).toBe('success')
    if (result.type === 'success') {
      expect(result.picked.body).toEqual({ id: 'x' })
    }
  })

  it('응답 스키마 컴파일 실패는 500 SCHEMA_COMPILE_ERROR', () => {
    const result = handleRequest(
      {
        pathParams: {},
        queryParams: {},
        headers: {},
        body: undefined,
        contentType: undefined,
      },
      {
        ...baseEntry,
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'strng' as never },
              },
            },
          },
        },
      },
      {},
    )

    expect(result.type).toBe('schema-error')
    if (result.type === 'schema-error') {
      expect(result.body.error.code).toBe('SCHEMA_COMPILE_ERROR')
      expect(result.body.error.details[0]?.message).toContain('응답 검증 스키마')
    }
  })
})
