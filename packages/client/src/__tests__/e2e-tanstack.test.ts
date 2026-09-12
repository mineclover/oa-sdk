import { describe, it, expect } from 'vitest'
import {
  generateTanstackQuery,
  generateKeyFactory,
  generateOptionsFactory,
  generateHookFactory,
  isQueryOperation,
} from '../tanstack/index.js'
import { parseDocument } from '@oa-sdk/parser'
import type { OasDocument } from '@oa-sdk/parser'

const sampleOas: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Sample API', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        tags: ['users'],
        responses: {
          '200': {
            description: 'Success',
            content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } },
          },
        },
      },
      post: {
        operationId: 'createUser',
        tags: ['users'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
  },
}

describe('E2E Client TanStack Query v5 Generator', () => {
  it('e2e-client-tanstack-1: generates query key trees with zero runtime leaks', () => {
    const parsed = parseDocument(sampleOas)
    const keysCode = generateKeyFactory(parsed)
    expect(keysCode).toContain("all: ['users'] as const")
    expect(keysCode).toContain("lists: () => [...usersKeys.all, 'list'] as const")
    expect(keysCode).not.toContain('@tanstack/react-query')
  })

  it('e2e-client-tanstack-2: generates pure options factory', () => {
    const parsed = parseDocument(sampleOas)
    const optionsCode = generateOptionsFactory(parsed)
    expect(optionsCode).toContain('listUsersQueryOptions')
    expect(optionsCode).toContain('createUserMutationOptions')
    expect(optionsCode).toContain('queryOptions(')
    expect(optionsCode).toContain('mutationOptions(')
  })

  it('e2e-client-tanstack-3: generates composition hook helpers', () => {
    const parsed = parseDocument(sampleOas)
    const hooksCode = generateHookFactory(parsed)
    expect(hooksCode).toContain('useListUsersQuery')
    expect(hooksCode).toContain('useCreateUserMutation')
    expect(hooksCode).toContain('createApiHooks')
  })

  it('e2e-client-tanstack-4: generates full 3-tier bundle with modular outputs', () => {
    const output = generateTanstackQuery(sampleOas)
    expect(output.keysCode).toContain('usersKeys')
    expect(output.queriesCode).toContain('listUsersQueryOptions')
    expect(output.hooksCode).toContain('useListUsersQuery')
    expect(output.combinedCode).toContain('usersKeys')
  })

  it('e2e-client-tanstack-5: correctly classifies query vs mutation operations', () => {
    const parsed = parseDocument(sampleOas)
    const listOp = parsed.operations.find(o => o.operationId === 'listUsers')!
    const createOp = parsed.operations.find(o => o.operationId === 'createUser')!

    expect(isQueryOperation(listOp)).toBe(true)
    expect(isQueryOperation(createOp)).toBe(false)
  })
})
