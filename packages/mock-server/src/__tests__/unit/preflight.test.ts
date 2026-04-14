import { describe, expect, it } from 'vitest'
import { parseDocument, type OasDocument } from '@oa-sdk/parser'
import { createMswHandlers } from '../../adapters/msw.js'
import { createNodeMockServer } from '../../adapters/node-http.js'
import { validateRequestSchemas } from '../../core/request-validator.js'

const invalidSpec = {
  openapi: '3.2.0',
  info: { title: 'Broken API', version: '1.0.0' },
  paths: {
    '/broken': {
      post: {
        operationId: 'createBroken',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'strng' },
            },
          },
        },
        responses: { '200': { description: 'OK' } },
      },
    },
  },
} as unknown as OasDocument

describe('request schema preflight', () => {
  it('RouteIndex 요청 스키마 compile 실패를 보고한다', () => {
    const parsed = parseDocument(invalidSpec)
    const result = validateRequestSchemas(parsed.routes)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors[0]?.code).toBe('SCHEMA_COMPILE_ERROR')
      expect(result.errors[0]?.path).toBe('/routes/~1broken/post/requestBody/content/application~1json/schema')
    }
  })

  it('Node mock server는 기본적으로 깨진 요청 스키마를 생성 시점에 거부한다', () => {
    expect(() => createNodeMockServer(invalidSpec, { port: 0 })).toThrow(/Mock request schema preflight failed/)
  })

  it('Node mock server preflight는 opt-out 가능하다', () => {
    expect(() => createNodeMockServer(invalidSpec, { port: 0, validateRequestSchemas: false })).not.toThrow()
  })

  it('MSW handlers는 기본적으로 깨진 요청 스키마를 생성 시점에 거부한다', () => {
    expect(() => createMswHandlers(invalidSpec)).toThrow(/Mock request schema preflight failed/)
  })

  it('MSW handlers preflight는 opt-out 가능하다', () => {
    expect(() => createMswHandlers(invalidSpec, { validateRequestSchemas: false })).not.toThrow()
  })
})
