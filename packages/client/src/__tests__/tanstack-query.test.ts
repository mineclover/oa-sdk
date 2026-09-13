/**
 * Comprehensive Test Suite for TanStack Query v5 3-Tier Code Generator
 *
 * Tests:
 * 1. Tier 1: Hierarchical Query Key Factory (all, lists, list, details, detail, subresources, mutations)
 * 2. Tier 2: Pure Options Factory (queryOptions, mutationOptions, wire typing, variables)
 * 3. Tier 3: Client Composition Hook Helpers (useQuery, useMutation, createApiHooks)
 * 4. Master Orchestrator: generateTanstackQuery with ParsedDocument and OasDocument, split and combined
 * 5. Runtime execution of emitted keys via transpileModule
 * 6. TypeScript compiler verification of emitted artifacts
 * 7. Zero Runtime Dependency Leaks Invariant in @oa-sdk/client
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ModuleKind,
  ScriptTarget,
  createCompilerHost,
  createProgram,
  createSourceFile,
  getPreEmitDiagnostics,
  transpileModule,
} from 'typescript'
import { parseDocument, type OasDocument } from '@oa-sdk/parser'
import {
  generateTanstackQuery,
  generateKeyFactory,
  generateOptionsFactory,
  generateHookFactory,
  isQueryOperation,
  getOperationTag,
  toKeyFactoryName,
} from '../index.js'

function sampleSpec(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Test Petstore & User API', version: '1.0.0' },
    paths: {
      '/users': {
        get: {
          tags: ['users'],
          operationId: 'listUsers',
          summary: 'List users',
          parameters: [
            { name: 'role', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            '200': {
              description: 'Users list',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
                  },
                },
              },
            },
            '400': {
              description: 'Bad request',
              content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } },
            },
          },
        },
        post: {
          tags: ['users'],
          operationId: 'createUser',
          summary: 'Create a new user',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: { name: { type: 'string' }, email: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
      '/users/{id}': {
        get: {
          tags: ['users'],
          operationId: 'getUser',
          summary: 'Get user by id',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'includeDetails', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: {
            '200': {
              description: 'User details',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
                },
              },
            },
            '404': {
              description: 'Not found',
              content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } },
            },
          },
        },
        put: {
          tags: ['users'],
          operationId: 'updateUser',
          summary: 'Update user',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object', properties: { name: { type: 'string' } } },
              },
            },
          },
          responses: {
            '200': {
              description: 'Updated user',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
                },
              },
            },
          },
        },
        delete: {
          tags: ['users'],
          operationId: 'deleteUser',
          summary: 'Delete user',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '204': { description: 'Deleted' },
          },
        },
      },
      '/users/{id}/posts': {
        get: {
          tags: ['users'],
          operationId: 'getUserPosts',
          summary: 'Get posts for user',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'tag', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'User posts',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' } } } },
                },
              },
            },
          },
        },
      },
      '/pets': {
        get: {
          tags: ['pets'],
          operationId: 'listPets',
          summary: 'List pets',
          responses: {
            '200': {
              description: 'Pets list',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' } } } },
                },
              },
            },
          },
        },
      },
      '/system/status': {
        get: {
          operationId: 'getSystemStatus',
          summary: 'System health check',
          responses: {
            '200': {
              description: 'System status',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
                },
              },
            },
          },
        },
      },
      '/system/reset': {
        post: {
          operationId: 'resetSystem',
          summary: 'Reset system state',
          responses: {
            '204': { description: 'Reset completed' },
          },
        },
      },
    },
  }
}

/**
 * Transpiles generated TypeScript code in memory to an executable JavaScript object.
 */
function transpileAndEval<T>(tsCode: string): T {
  const js = transpileModule(tsCode, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
      removeComments: false,
    },
  }).outputText

  const exportsObj: Record<string, unknown> = {}
  const moduleObj = { exports: exportsObj }
  const fn = new Function('exports', 'module', 'require', js)
  fn(exportsObj, moduleObj, (id: string) => {
    throw new Error(`Unexpected require in pure test: ${id}`)
  })
  return (moduleObj.exports || exportsObj) as T
}

describe('TanStack Query v5 3-Tier Code Generator', () => {
  // ─── Zero Runtime Dependency Leaks Invariant ──────────────────────────────
  describe('Zero Runtime Dependency Leaks Invariant', () => {
    it('@oa-sdk/client/package.json must NOT list @tanstack/react-query in runtime dependencies', () => {
      const pkgPath = resolve(__dirname, '../../package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

      expect(pkg.dependencies).toBeDefined()
      expect(pkg.dependencies['@tanstack/react-query']).toBeUndefined()
      expect(pkg.dependencies['@tanstack/query-core']).toBeUndefined()
      expect(pkg.dependencies['@tanstack/vue-query']).toBeUndefined()
      expect(pkg.dependencies['react']).toBeUndefined()
    })
  })

  // ─── Utilities ────────────────────────────────────────────────────────────
  describe('Generator Helpers', () => {
    it('accurately classifies HTTP methods into query vs mutation', () => {
      const getOp = { method: 'get', openApiPath: '/a', tags: [], deprecated: false, parameters: [], responses: {}, security: [], servers: [], callbacks: {} } as any
      const headOp = { method: 'head', openApiPath: '/a', tags: [], deprecated: false, parameters: [], responses: {}, security: [], servers: [], callbacks: {} } as any
      const queryOp = { method: 'query', openApiPath: '/a', tags: [], deprecated: false, parameters: [], responses: {}, security: [], servers: [], callbacks: {} } as any
      const postOp = { method: 'post', openApiPath: '/a', tags: [], deprecated: false, parameters: [], responses: {}, security: [], servers: [], callbacks: {} } as any
      const putOp = { method: 'put', openApiPath: '/a', tags: [], deprecated: false, parameters: [], responses: {}, security: [], servers: [], callbacks: {} } as any
      const deleteOp = { method: 'delete', openApiPath: '/a', tags: [], deprecated: false, parameters: [], responses: {}, security: [], servers: [], callbacks: {} } as any

      expect(isQueryOperation(getOp)).toBe(true)
      expect(isQueryOperation(headOp)).toBe(true)
      expect(isQueryOperation(queryOp)).toBe(true)
      expect(isQueryOperation(postOp)).toBe(false)
      expect(isQueryOperation(putOp)).toBe(false)
      expect(isQueryOperation(deleteOp)).toBe(false)

      // Extension overrides
      const queryOverride = { ...postOp, 'x-oa-sdk-query': true }
      const mutationOverride = { ...getOp, 'x-oa-sdk-mutation': true }
      expect(isQueryOperation(queryOverride)).toBe(true)
      expect(isQueryOperation(mutationOverride)).toBe(false)
    })

    it('extracts primary tag with path fallback', () => {
      const taggedOp = { method: 'get', openApiPath: '/users', tags: ['auth', 'users'], deprecated: false, parameters: [], responses: {}, security: [], servers: [], callbacks: {} } as any
      const untaggedOp = { method: 'get', openApiPath: '/orders/{id}', tags: [], deprecated: false, parameters: [], responses: {}, security: [], servers: [], callbacks: {} } as any
      const rootOp = { method: 'get', openApiPath: '/{id}', tags: [], deprecated: false, parameters: [], responses: {}, security: [], servers: [], callbacks: {} } as any

      expect(getOperationTag(taggedOp)).toBe('auth')
      expect(getOperationTag(untaggedOp)).toBe('orders')
      expect(getOperationTag(rootOp)).toBe('api')
    })

    it('normalizes key factory names', () => {
      expect(toKeyFactoryName('users')).toBe('usersKeys')
      expect(toKeyFactoryName('user')).toBe('userKeys')
      expect(toKeyFactoryName('user-profile')).toBe('userProfileKeys')
      expect(toKeyFactoryName('API')).toBe('apiKeys')
    })
  })

  // ─── Tier 1: Hierarchical Query Key Factory ──────────────────────────────
  describe('Tier 1: Query Key Factory (generateKeyFactory)', () => {
    it('generates hierarchical query key tree with 0 external dependencies', () => {
      const spec = sampleSpec()
      const doc = parseDocument(spec)
      const code = generateKeyFactory(doc, { banner: true })

      // Banner check
      expect(code).toContain('Tier 1: Query Key Factory')

      // Zero framework imports
      expect(code).not.toContain('@tanstack/react-query')
      expect(code).not.toContain('react')

      // Core tree elements
      expect(code).toContain("all: ['users'] as const")
      expect(code).toContain("lists: () => [...usersKeys.all, 'list'] as const")
      expect(code).toContain("details: () => [...usersKeys.all, 'detail'] as const")
      expect(code).toContain('detail: (id: string | number) => [...usersKeys.details(), String(id)] as const')
      expect(code).toContain('subresource: <TQuery extends Record<string, unknown>')
      expect(code).toContain('mutation: (operationId: string) => [...usersKeys.all, \'mutation\', operationId] as const')

      // Operation-specific query & mutation keys
      expect(code).toContain('listUsers: (query?:')
      expect(code).toContain('getUser: (params:')
      expect(code).toContain('getUserPosts: (params:')
      expect(code).toContain('createUser: () => usersKeys.mutation(\'createUser\')')
      expect(code).toContain('updateUser: (id?: string | number) =>')
      expect(code).toContain('deleteUser: (id?: string | number) =>')

      // Aliases (singular userKeys and plural usersKeys)
      expect(code).toContain('export const userKeys = usersKeys')

      // Aggregate queryKeys export
      expect(code).toContain('export const queryKeys = {')
      expect(code).toContain('users: usersKeys,')
      expect(code).toContain('pets: petsKeys,')
      expect(code).toContain('export type QueryKeys = typeof queryKeys')
    })

    it('executes emitted keys at runtime and produces exact tuple values', () => {
      const spec = sampleSpec()
      const doc = parseDocument(spec)
      // Generate without external type imports so it evaluates standalone
      const code = generateKeyFactory(doc, { banner: false })

      type EmittedModule = {
        usersKeys: {
          all: readonly [string]
          lists: () => readonly [string, string]
          list: (filter?: any) => readonly unknown[]
          details: () => readonly [string, string]
          detail: (id: string | number) => readonly [string, string, string]
          subresource: (id: string | number, sub: string, q?: any) => readonly unknown[]
          mutation: (opId: string) => readonly [string, string, string]
          listUsers: (query?: any) => readonly unknown[]
          getUser: (params: { id: string }, query?: any) => readonly unknown[]
          getUserPosts: (params: { id: string }, query?: any) => readonly unknown[]
          createUser: () => readonly [string, string, string]
          updateUser: (id?: string | number) => readonly unknown[]
          deleteUser: (id?: string | number) => readonly unknown[]
        }
        userKeys: any
        queryKeys: {
          users: any
          pets: any
          system: any
        }
      }

      const mod = transpileAndEval<EmittedModule>(code)
      const { usersKeys, userKeys, queryKeys } = mod

      // Alias equality
      expect(userKeys).toBe(usersKeys)
      expect(queryKeys.users).toBe(usersKeys)

      // 1. All key
      expect(usersKeys.all).toEqual(['users'])

      // 2. Lists key
      expect(usersKeys.lists()).toEqual(['users', 'list'])

      // 3. List with filter
      expect(usersKeys.list()).toEqual(['users', 'list'])
      expect(usersKeys.list({ role: 'admin' })).toEqual(['users', 'list', { role: 'admin' }])

      // 4. Details key
      expect(usersKeys.details()).toEqual(['users', 'detail'])

      // 5. Detail by ID
      expect(usersKeys.detail('42')).toEqual(['users', 'detail', '42'])
      expect(usersKeys.detail(100)).toEqual(['users', 'detail', '100'])

      // 6. Subresource
      expect(usersKeys.subresource('42', 'posts')).toEqual(['users', 'detail', '42', 'posts'])
      expect(usersKeys.subresource('42', 'posts', { page: 1 })).toEqual(['users', 'detail', '42', 'posts', { page: 1 }])

      // 7. Generic Mutation Key
      expect(usersKeys.mutation('createUser')).toEqual(['users', 'mutation', 'createUser'])

      // 8. Operation-specific query keys
      expect(usersKeys.listUsers()).toEqual(['users', 'list'])
      expect(usersKeys.listUsers({ role: 'editor' })).toEqual(['users', 'list', { role: 'editor' }])
      expect(usersKeys.getUser({ id: 'u123' })).toEqual(['users', 'detail', 'u123'])
      expect(usersKeys.getUser({ id: 'u123' }, { includeDetails: true })).toEqual(['users', 'detail', 'u123', { includeDetails: true }])
      expect(usersKeys.getUserPosts({ id: 'u123' })).toEqual(['users', 'detail', 'u123', 'posts'])
      expect(usersKeys.getUserPosts({ id: 'u123' }, { tag: 'news' })).toEqual(['users', 'detail', 'u123', 'posts', { tag: 'news' }])

      // 9. Operation-specific mutation keys
      expect(usersKeys.createUser()).toEqual(['users', 'mutation', 'createUser'])
      expect(usersKeys.updateUser()).toEqual(['users', 'mutation', 'updateUser'])
      expect(usersKeys.updateUser('u123')).toEqual(['users', 'detail', 'u123', 'mutation', 'updateUser'])
      expect(usersKeys.deleteUser()).toEqual(['users', 'mutation', 'deleteUser'])
      expect(usersKeys.deleteUser('u123')).toEqual(['users', 'detail', 'u123', 'mutation', 'deleteUser'])
    })
  })

  // ─── Tier 2: Pure Query & Mutation Options Factory ────────────────────────
  describe('Tier 2: Options Factory (generateOptionsFactory)', () => {
    it('generates queryOptions and mutationOptions without UI framework coupling', () => {
      const spec = sampleSpec()
      const doc = parseDocument(spec)
      const code = generateOptionsFactory(doc, {
        typesImport: './types.js',
        clientImport: './client.js',
        keysImport: './keys.js',
      })

      // Framework imports
      expect(code).toContain("import { queryOptions, mutationOptions } from '@tanstack/react-query'")
      expect(code).toContain("import type { UndefinedInitialDataOptions, UseMutationOptions } from '@tanstack/react-query'")
      expect(code).toContain("import type { JsonPrimitive, Resolved } from '@oa-sdk/client'")

      // Wire-safe mutation variables
      expect(code).toContain('export type CreateUserVariables = {')
      expect(code).toContain('body: Resolved<CreateUserBody>')
      expect(code).toContain('export type UpdateUserVariables = {')
      expect(code).toContain('params: UpdateUserPathParams')
      expect(code).toContain('body: Resolved<UpdateUserBody>')
      expect(code).toContain('export type DeleteUserVariables = {')
      expect(code).toContain('params: DeleteUserPathParams')
      expect(code).toContain('export type ResetSystemVariables = void')

      // Query options functions
      expect(code).toContain('export function listUsersQueryOptions<TData = JsonPrimitive<ListUsersResponse>>(')
      expect(code).toContain('client: ApiClient,')
      expect(code).toContain('query?: ListUsersQueryParams,')
      expect(code).toContain('queryKey: usersKeys.listUsers(query),')
      expect(code).toContain('return client.listUsers(query, { signal })')

      expect(code).toContain('export function getUserQueryOptions<TData = JsonPrimitive<GetUserResponse>>(')
      expect(code).toContain('params: GetUserPathParams,')
      expect(code).toContain('query?: GetUserQueryParams,')
      expect(code).toContain('queryKey: usersKeys.getUser(params, query),')
      expect(code).toContain('return client.getUser(params, query, { signal })')

      // Mutation options functions
      expect(code).toContain('export function createUserMutationOptions<TContext = unknown>(')
      expect(code).toContain('mutationKey: usersKeys.createUser(),')
      expect(code).toContain('return client.createUser(variables.body)')

      expect(code).toContain('export function updateUserMutationOptions<TContext = unknown>(')
      expect(code).toContain('mutationKey: usersKeys.updateUser(),')
      expect(code).toContain('return client.updateUser(variables.params, variables.body)')

      expect(code).toContain('export function deleteUserMutationOptions<TContext = unknown>(')
      expect(code).toContain('mutationKey: usersKeys.deleteUser(),')
      expect(code).toContain('return client.deleteUser(variables.params)')

      expect(code).toContain('export function resetSystemMutationOptions<TContext = unknown>(')
      expect(code).toContain('mutationKey: systemKeys.resetSystem(),')
      expect(code).toContain('return client.resetSystem()')
    })

    it('supports custom query packages (@tanstack/vue-query or @tanstack/query-core)', () => {
      const spec = sampleSpec()
      const doc = parseDocument(spec)
      const code = generateOptionsFactory(doc, {
        queryPackage: '@tanstack/vue-query',
        clientImport: './my-client.js',
        clientName: 'MyClient',
      })

      expect(code).toContain("from '@tanstack/vue-query'")
      expect(code).toContain('client: MyClient,')
    })
  })

  // ─── Tier 3: Client Composition Hook Helpers ──────────────────────────────
  describe('Tier 3: Hook Factory (generateHookFactory)', () => {
    it('generates React hook wrappers with open generics and createApiHooks', () => {
      const spec = sampleSpec()
      const doc = parseDocument(spec)
      const code = generateHookFactory(doc, {
        typesImport: './types.js',
        clientImport: './client.js',
        keysImport: './keys.js',
        queriesImport: './queries.js',
      })

      // Directive
      expect(code).toContain("'use client'")

      // Hooks imports
      expect(code).toContain("import { useQuery, useMutation } from '@tanstack/react-query'")
      expect(code).toContain("import type { UseQueryOptions, UseQueryResult, UseMutationOptions, UseMutationResult, QueryClient } from '@tanstack/react-query'")

      // Individual hooks
      expect(code).toContain('export function useListUsersQuery<TData = JsonPrimitive<ListUsersResponse>>(')
      expect(code).toContain('return useQuery(listUsersQueryOptions(client, query, options), queryClient)')

      expect(code).toContain('export function useGetUserQuery<TData = JsonPrimitive<GetUserResponse>>(')
      expect(code).toContain('return useQuery(getUserQueryOptions(client, params, query, options), queryClient)')

      expect(code).toContain('export function useCreateUserMutation<TContext = unknown>(')
      expect(code).toContain('return useMutation(createUserMutationOptions(client, options), queryClient)')

      // Context binding helper
      expect(code).toContain('export function createApiHooks(useClient: () => ApiClient) {')
      expect(code).toContain('useListUsers:')
      expect(code).toContain('useGetUser:')
      expect(code).toContain('useCreateUser:')
      expect(code).toContain('useUpdateUser:')
      expect(code).toContain('useDeleteUser:')
    })
  })

  // ─── Master Orchestrator: generateTanstackQuery ────────────────────────────
  describe('Master Orchestrator (generateTanstackQuery)', () => {
    it('accepts raw OasDocument and produces all 4 code outputs', () => {
      const spec = sampleSpec()
      const output = generateTanstackQuery(spec, {
        typesImport: './types.js',
        clientImport: './client.js',
      })

      expect(output.keysCode).toBeDefined()
      expect(output.queriesCode).toBeDefined()
      expect(output.hooksCode).toBeDefined()
      expect(output.combinedCode).toBeDefined()

      expect(output.keysCode).toContain('Tier 1: Query Key Factory')
      expect(output.queriesCode).toContain('Tier 2: Pure Options Factory')
      expect(output.hooksCode).toContain('Tier 3: Client Composition Hook Helpers')

      // Combined code contains all 3 tiers
      expect(output.combinedCode).toContain('Tier 1: Query Key Factories')
      expect(output.combinedCode).toContain('Tier 2: Pure Query & Mutation Options')
      expect(output.combinedCode).toContain('Tier 3: Client Composition Hooks')
      expect(output.combinedCode).toContain('createApiHooks')
    })

    it('accepts ParsedDocument IR', () => {
      const spec = sampleSpec()
      const parsed = parseDocument(spec)
      const output = generateTanstackQuery(parsed)

      expect(output.keysCode).toContain('export const usersKeys')
      expect(output.queriesCode).toContain('export function listUsersQueryOptions')
    })

    it('respects tier filter', () => {
      const spec = sampleSpec()
      const keysOnly = generateTanstackQuery(spec, { tier: 'keys' })
      expect(keysOnly.combinedCode).toContain('Tier 1: Query Key Factories')
      expect(keysOnly.combinedCode).not.toContain('Tier 2: Pure Query & Mutation Options')
      expect(keysOnly.combinedCode).not.toContain('Tier 3: Client Composition Hooks')

      const optionsOnly = generateTanstackQuery(spec, { tier: 'options' })
      expect(optionsOnly.combinedCode).toContain('Tier 2: Pure Query & Mutation Options')
      expect(optionsOnly.combinedCode).not.toContain('Tier 3: Client Composition Hooks')
    })

    it('respects includeHooks: false option', () => {
      const spec = sampleSpec()
      const output = generateTanstackQuery(spec, { includeHooks: false })
      expect(output.hooksCode).toBe('')
      expect(output.combinedCode).not.toContain('Tier 3: Client Composition Hooks')
    })
  })

  // ─── TypeScript Transpilation & Syntax Validation ─────────────────────────
  describe('Emitted Code TypeScript Validity', () => {
    it('transpiles Tier 1 code without syntax errors', () => {
      const spec = sampleSpec()
      const output = generateTanstackQuery(spec)
      const transpileResult = transpileModule(output.keysCode, {
        compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
      })
      expect(transpileResult.outputText).toContain('exports.usersKeys')
    })

    it('transpiles combined code without syntax errors in CommonJS and ES2022', () => {
      const spec = sampleSpec()
      const output = generateTanstackQuery(spec, {
        typesImport: './types.js',
        clientImport: './client.js',
      })
      const cjsResult = transpileModule(output.combinedCode, {
        compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
      })
      expect(cjsResult.outputText).toContain('exports.queryKeys')
      expect(cjsResult.outputText).toContain('exports.listUsersQueryOptions')
      expect(cjsResult.outputText).toContain('exports.useListUsersQuery')
      expect(cjsResult.outputText).toContain('exports.createApiHooks')

      const esmResult = transpileModule(output.combinedCode, {
        compilerOptions: { module: ModuleKind.ES2022, target: ScriptTarget.ES2022 },
      })
      expect(esmResult.outputText).toContain('export const queryKeys')
      expect(esmResult.outputText).toContain('export function listUsersQueryOptions')
      expect(esmResult.outputText).toContain('export function useListUsersQuery')
      expect(esmResult.outputText).toContain('export function createApiHooks')
    })

  })

  // ─── Full-Stack Wire Typing & Router Contract Parity ──────────────────────
  describe('Full-Stack Contract Parity with @oa-sdk/router', () => {
    it('matches operation type naming and wire types identically', () => {
      const spec = sampleSpec()
      const doc = parseDocument(spec)
      const optionsCode = generateOptionsFactory(doc, { typesImport: './types.js' })

      // Confirms standard type names shared with router handler contracts:
      // ${BaseName}PathParams, ${BaseName}QueryParams, ${BaseName}Body, ${BaseName}Response
      expect(optionsCode).toContain('GetUserPathParams')
      expect(optionsCode).toContain('GetUserQueryParams')
      expect(optionsCode).toContain('Resolved<CreateUserBody>')
      expect(optionsCode).toContain('JsonPrimitive<ListUsersResponse>')
      expect(optionsCode).toContain('JsonPrimitive<GetUserResponse>')
      expect(optionsCode).toContain('JsonPrimitive<CreateUserResponse>')
    })
  })

  // ─── Adversarial Remediation Verification (Defect 1 & Defect 2) ───────────
  describe('Adversarial Remediation Verification (Defect 1 & Defect 2)', () => {
    it('remediates Defect 1: handles singular and plural tags without duplicate identifier collisions (TS2451)', () => {
      const spec: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Tag Collision Test', version: '1.0.0' },
        paths: {
          '/user': {
            get: {
              tags: ['user'],
              operationId: 'getCurrentUser',
              responses: { '200': { description: 'ok' } },
            },
          },
          '/users': {
            get: {
              tags: ['users'],
              operationId: 'listUsers',
              responses: { '200': { description: 'ok' } },
            },
          },
        },
      }

      const doc = parseDocument(spec)
      const keysCode = generateKeyFactory(doc, { banner: false })

      const userMatches = keysCode.match(/export const userKeys\b/g) || []
      const usersMatches = keysCode.match(/export const usersKeys\b/g) || []

      // Each primary factory must be declared exactly once
      expect(userMatches.length).toBe(1)
      expect(usersMatches.length).toBe(1)

      // No mutual alias clobbering
      expect(keysCode).not.toContain('export const userKeys = usersKeys')
      expect(keysCode).not.toContain('export const usersKeys = userKeys')

      // Runtime execution: both factories retain their respective operations
      const mod = transpileAndEval<{ userKeys: any; usersKeys: any }>(keysCode)
      expect(mod.userKeys.getCurrentUser).toBeDefined()
      expect(mod.usersKeys.listUsers).toBeDefined()
      expect(mod.userKeys.all).toEqual(['user'])
      expect(mod.usersKeys.all).toEqual(['users'])
    })

    it('remediates Defect 1: passes TypeScript compiler diagnostics with 0 TS2451 duplicate declaration errors', () => {
      const spec: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Tag Collision Test', version: '1.0.0' },
        paths: {
          '/user': {
            get: {
              tags: ['user'],
              operationId: 'getCurrentUser',
              responses: { '200': { description: 'ok' } },
            },
          },
          '/users': {
            get: {
              tags: ['users'],
              operationId: 'listUsers',
              responses: { '200': { description: 'ok' } },
            },
          },
        },
      }

      const doc = parseDocument(spec)
      const keysCode = generateKeyFactory(doc, { banner: false })

      const fileName = 'test-tag-collision.ts'
      const sourceFile = createSourceFile(fileName, keysCode, ScriptTarget.ES2022, true)
      const defaultHost = createCompilerHost({})
      const customHost = {
        ...defaultHost,
        getSourceFile: (name: string, lang: any) => (name === fileName ? sourceFile : defaultHost.getSourceFile(name, lang)),
        writeFile: () => {},
        fileExists: (name: string) => name === fileName || defaultHost.fileExists(name),
        readFile: (name: string) => (name === fileName ? keysCode : defaultHost.readFile(name)),
      }
      const program = createProgram([fileName], { noEmit: true, target: ScriptTarget.ES2022, module: ModuleKind.ESNext }, customHost)
      const diagnostics = getPreEmitDiagnostics(program, sourceFile)

      const ts2451Errors = diagnostics.filter(d => d.code === 2451)
      expect(ts2451Errors).toHaveLength(0)
    })

    it('remediates Defect 2: emits typesImport and clientImport in combinedCode', () => {
      const spec = sampleSpec()
      const doc = parseDocument(spec)
      const output = generateTanstackQuery(doc, {
        typesImport: './types.js',
        clientImport: './client.js',
        clientName: 'ApiClient',
      })

      const combined = output.combinedCode

      // Must emit clientImport
      expect(combined).toContain("import type { ApiClient } from './client.js'")

      // Must emit typesImport with all collected types sorted
      expect(combined).toContain("from './types.js'")
      expect(combined).toContain('GetUserPathParams')
      expect(combined).toContain('GetUserQueryParams')
      expect(combined).toContain('CreateUserBody')
      expect(combined).toContain('ListUsersResponse')

      // Key factory in combined code must use typed params (GetUserPathParams) instead of Record<string, string | number>
      expect(combined).toContain('getUser: (params: GetUserPathParams, query?: GetUserQueryParams)')
    })

    it('remediates Defect 2: suppresses redundant key factory imports inside combinedCode', () => {
      const spec = sampleSpec()
      const doc = parseDocument(spec)
      const output = generateTanstackQuery(doc, {
        typesImport: './types.js',
        clientImport: './client.js',
      })

      const combined = output.combinedCode

      // typesImport must only be imported once at top of file, not re-imported in Tier 1 section
      const typesImportMatches = combined.match(/from '\.\/types\.js'/g) || []
      expect(typesImportMatches).toHaveLength(1)
    })
  })
})
