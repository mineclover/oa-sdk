import { describe, it, expect } from 'vitest'
import { collectTypeNames } from '../codegen-utils.js'

describe('collectTypeNames', () => {
  it('path params → PathParams', () => {
    const names = collectTypeNames([{
      operationId: 'getUser',
      parameters: [{ in: 'path' }],
      responses: { '200': {} },
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

  it('requestBody → Body', () => {
    const names = collectTypeNames([{
      operationId: 'createUser',
      parameters: [],
      requestBody: {},
      responses: { '201': {} },
    }])
    expect(names).toContain('CreateUserBody')
    expect(names).toContain('CreateUserResponse')
  })

  it('204 → Response 포함', () => {
    const names = collectTypeNames([{
      operationId: 'deleteUser',
      parameters: [{ in: 'path' }],
      responses: { '204': {} },
    }])
    expect(names).toContain('DeleteUserPathParams')
    expect(names).toContain('DeleteUserResponse')
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
      { operationId: 'listUsers', parameters: [], responses: { '200': {} } },
      { operationId: 'createUser', parameters: [], requestBody: {}, responses: { '201': {} } },
    ])
    expect(names).toContain('ListUsersResponse')
    expect(names).toContain('CreateUserBody')
    expect(names).toContain('CreateUserResponse')
  })
})
