import { describe, it, expect } from 'vitest'
import { collectTypeNames, getGeneratedErrorResponseKeys, hasGeneratedErrorType } from '../codegen-utils.js'

describe('collectTypeNames', () => {
  it('path params → PathParams', () => {
    const names = collectTypeNames([{
      operationId: 'getUser',
      parameters: [{ in: 'path' }],
      responses: {
        '200': {
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      },
    }])
    expect(names).toContain('GetUserPathParams')
    expect(names).toContain('GetUserResponse')
  })

  it('query params → QueryParams', () => {
    const names = collectTypeNames([{
      operationId: 'listUsers',
      parameters: [{ in: 'query' }],
      responses: { '200': {} },
    }])
    expect(names).toContain('ListUsersQueryParams')
  })

  it('header params → HeaderParams', () => {
    const names = collectTypeNames([{
      operationId: 'requestExport',
      parameters: [{ in: 'header' }],
      responses: { '202': {} },
    }])
    expect(names).toContain('RequestExportHeaderParams')
  })

  it('querystring param → QueryString', () => {
    const names = collectTypeNames([{
      operationId: 'requestExport',
      parameters: [{ in: 'querystring' }],
      responses: { '202': {} },
    }])
    expect(names).toContain('RequestExportQueryString')
  })

  it('requestBody → Body', () => {
    const names = collectTypeNames([{
      operationId: 'createUser',
      parameters: [],
      requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
      responses: {
        '201': {
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      },
    }])
    expect(names).toContain('CreateUserBody')
    expect(names).toContain('CreateUserResponse')
  })

  it('typed 4xx response → Error 타입을 수집', () => {
    const names = collectTypeNames([{
      operationId: 'checkAuthorization',
      parameters: [],
      responses: {
        '200': { content: { 'application/json': { schema: { type: 'object' } } } },
        '403': { content: { 'application/json': { schema: { type: 'object' } } } },
      },
    }])
    expect(names).toContain('CheckAuthorizationError')
    expect(names).toContain('CheckAuthorizationErrorByStatus')
  })

  it('hasGeneratedErrorType는 4xx/5xx JSON 응답만 감지', () => {
    expect(hasGeneratedErrorType({
      '403': { content: { 'application/json': { schema: { type: 'object' } } } },
    })).toBe(true)
    expect(hasGeneratedErrorType({ '204': {} })).toBe(false)
  })

  it('getGeneratedErrorResponseKeys는 typed error status 순서를 보존', () => {
    expect(getGeneratedErrorResponseKeys({
      '503': { content: { 'application/json': { schema: { type: 'object' } } } },
      '403': { content: { 'application/json': { schema: { type: 'object' } } } },
      '400': { content: { 'application/json': { schema: { type: 'object' } } } },
      '401': {},
    })).toEqual(['400', '403', '503'])
  })

  it('204 without JSON schema → Response 제외', () => {
    const names = collectTypeNames([{
      operationId: 'deleteUser',
      parameters: [{ in: 'path' }],
      responses: { '204': {} },
    }])
    expect(names).toContain('DeleteUserPathParams')
    expect(names).not.toContain('DeleteUserResponse')
  })

  it('operationId 없으면 스킵', () => {
    const names = collectTypeNames([{
      parameters: [{ in: 'query' }],
      responses: { '200': {} },
    }])
    expect(names).toHaveLength(0)
  })

  it('복수 오퍼레이션', () => {
    const names = collectTypeNames([
      {
        operationId: 'listUsers',
        parameters: [],
        responses: {
          '200': {
            content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } },
          },
        },
      },
      {
        operationId: 'createUser',
        parameters: [],
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
        responses: {
          '201': {
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    ])
    expect(names).toContain('ListUsersResponse')
    expect(names).toContain('CreateUserBody')
    expect(names).toContain('CreateUserResponse')
  })

  it('2xx가 없으면 default response headers 타입을 포함', () => {
    const names = collectTypeNames([{
      operationId: 'fallbackResponse',
      parameters: [],
      responses: {
        default: {
          headers: {
            'X-Request-Id': { schema: { type: 'string' } },
          },
        },
      },
    }])
    expect(names).toContain('FallbackResponseResponseHeaders')
  })

  it('response headers는 첫 번째 2xx response 기준으로만 수집', () => {
    const names = collectTypeNames([{
      operationId: 'listUsers',
      parameters: [],
      responses: {
        '200': {},
        '201': {
          headers: {
            'X-Request-Id': { schema: { type: 'string' } },
          },
        },
      },
    }])
    expect(names).not.toContain('ListUsersResponseHeaders')
  })

  it('첫 번째 2xx response headers 타입은 수집', () => {
    const names = collectTypeNames([{
      operationId: 'listUsers',
      parameters: [],
      responses: {
        '200': {
          headers: {
            'X-Request-Id': { schema: { type: 'string' } },
          },
        },
        '201': {},
      },
    }])
    expect(names).toContain('ListUsersResponseHeaders')
  })

  it('$ref response header만 있으면 headers 타입을 수집하지 않음', () => {
    const names = collectTypeNames([{
      operationId: 'listUsers',
      parameters: [],
      responses: {
        '200': {
          headers: {
            'X-Request-Id': { $ref: '#/components/headers/RequestId' },
          },
        },
      },
    }])
    expect(names).not.toContain('ListUsersResponseHeaders')
  })
})
