/**
 * Adversarial Stress Tests for TanStack Query v5 3-Tier Code Generator
 *
 * Authored by: challenger_m2_2 (Empirical Challenger)
 * Focus:
 * 1. Cache Invalidation Key Tree Cascades & Negative Controls (Non-clobbering)
 * 2. Next.js SSR Prefetching Emulation in Headless Environment
 * 3. Dehydration / Hydration Roundtrip Integrity
 * 4. Adversarial Edge Cases: Tag Collision and Combined Import Emission
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { ModuleKind, ScriptTarget, createCompilerHost, createProgram, createSourceFile, getPreEmitDiagnostics, transpileModule } from 'typescript'
import { parseDocument, type OasDocument } from '@oa-sdk/parser'
import {
  generateTanstackQuery,
  generateKeyFactory,
  generateOptionsFactory,
} from '../index.js'

// Dynamically load TanStack Query v5 QueryClient from spec-lens monorepo workspace
const req = createRequire('/Users/junwoobang/workflow/oa-sdk/apps/spec-lens/index.ts')
const { QueryClient, queryOptions, dehydrate, hydrate } = req('@tanstack/react-query')

function complexSpec(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Adversarial Challenge Spec', version: '1.0.0' },
    paths: {
      '/users': {
        get: {
          tags: ['users'],
          operationId: 'listUsers',
          parameters: [
            { name: 'role', in: 'query', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
        post: {
          tags: ['users'],
          operationId: 'createUser',
          requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { '201': { description: 'created' } },
        },
      },
      '/users/{id}': {
        get: {
          tags: ['users'],
          operationId: 'getUser',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'includeDetails', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
        put: {
          tags: ['users'],
          operationId: 'updateUser',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { '200': { description: 'ok' } },
        },
      },
      '/users/{id}/posts': {
        get: {
          tags: ['users'],
          operationId: 'getUserPosts',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'tag', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
      '/users/{id}/comments': {
        get: {
          tags: ['users'],
          operationId: 'getUserComments',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
      '/pets': {
        get: {
          tags: ['pets'],
          operationId: 'listPets',
          parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
      '/pets/{id}': {
        get: {
          tags: ['pets'],
          operationId: 'getPet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
      '/pets/{id}/posts': {
        get: {
          tags: ['pets'],
          operationId: 'getPetPosts',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
      '/system/status': {
        get: {
          tags: ['system'],
          operationId: 'getSystemStatus',
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  }
}

function transpileAndEvalKeys(tsCode: string): any {
  const js = transpileModule(tsCode, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText
  const exportsObj: Record<string, unknown> = {}
  const moduleObj = { exports: exportsObj }
  new Function('exports', 'module', js)(exportsObj, moduleObj)
  return moduleObj.exports || exportsObj
}

describe('Adversarial Stress Test: TanStack Query v5 3-Tier Generator', () => {
  let qc: any
  let keysMod: any
  let userKeys: any
  let petKeys: any
  let systemKeys: any

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 1000 * 60, // queries start fresh
        },
      },
    })
    const doc = parseDocument(complexSpec())
    const keysCode = generateKeyFactory(doc, { banner: false })
    keysMod = transpileAndEvalKeys(keysCode)
    userKeys = keysMod.usersKeys
    petKeys = keysMod.petsKeys
    systemKeys = keysMod.systemKeys
  })

  // ════════════════════════════════════════════════════════════════════════════
  // 1. Cache Invalidation Key Tree Stress Tests
  // ════════════════════════════════════════════════════════════════════════════
  describe('Cache Invalidation Key Tree & Cascades', () => {
    it('invalidating userKeys.all matches all user lists, details, and subresources, while preserving pets and system', async () => {
      // Populate cache with multiple user and non-user entries
      qc.setQueryData(userKeys.lists(), { type: 'unfiltered-users' })
      qc.setQueryData(userKeys.list({ role: 'admin' }), { type: 'admin-users' })
      qc.setQueryData(userKeys.list({ role: 'member' }), { type: 'member-users' })
      qc.setQueryData(userKeys.detail('123'), { id: '123', name: 'User 123' })
      qc.setQueryData(userKeys.detail('456'), { id: '456', name: 'User 456' })
      qc.setQueryData(userKeys.subresource('123', 'posts'), [{ id: 'p1', author: '123' }])
      qc.setQueryData(userKeys.subresource('123', 'comments'), [{ id: 'c1', author: '123' }])
      qc.setQueryData(userKeys.subresource('456', 'posts'), [{ id: 'p2', author: '456' }])

      // Unrelated entities (Negative controls)
      qc.setQueryData(petKeys.lists(), [{ id: 'pet-1' }])
      qc.setQueryData(petKeys.detail('123'), { id: '123', name: 'Pet with same ID 123' })
      qc.setQueryData(petKeys.subresource('123', 'posts'), [{ id: 'pet-post-1' }])
      qc.setQueryData(systemKeys.all, { status: 'healthy' })

      // Verify all queries initially fresh
      const allQueries = qc.getQueryCache().getAll()
      expect(allQueries.length).toBe(12)
      for (const q of allQueries) {
        expect(q.isStale()).toBe(false)
      }

      // Action: Invalidate userKeys.all
      await qc.invalidateQueries({ queryKey: userKeys.all })

      // Assert: ALL user queries are stale
      expect(qc.getQueryCache().find({ queryKey: userKeys.lists() })?.isStale()).toBe(true)
      expect(qc.getQueryCache().find({ queryKey: userKeys.list({ role: 'admin' }) })?.isStale()).toBe(true)
      expect(qc.getQueryCache().find({ queryKey: userKeys.list({ role: 'member' }) })?.isStale()).toBe(true)
      expect(qc.getQueryCache().find({ queryKey: userKeys.detail('123') })?.isStale()).toBe(true)
      expect(qc.getQueryCache().find({ queryKey: userKeys.detail('456') })?.isStale()).toBe(true)
      expect(qc.getQueryCache().find({ queryKey: userKeys.subresource('123', 'posts') })?.isStale()).toBe(true)
      expect(qc.getQueryCache().find({ queryKey: userKeys.subresource('123', 'comments') })?.isStale()).toBe(true)
      expect(qc.getQueryCache().find({ queryKey: userKeys.subresource('456', 'posts') })?.isStale()).toBe(true)

      // Assert: Zero cross-entity pollution (Negative controls remain fresh!)
      expect(qc.getQueryCache().find({ queryKey: petKeys.lists() })?.isStale()).toBe(false)
      expect(qc.getQueryCache().find({ queryKey: petKeys.detail('123') })?.isStale()).toBe(false)
      expect(qc.getQueryCache().find({ queryKey: petKeys.subresource('123', 'posts') })?.isStale()).toBe(false)
      expect(qc.getQueryCache().find({ queryKey: systemKeys.all })?.isStale()).toBe(false)
    })

    it('invalidating userKeys.lists() invalidates filtered lists but NOT userKeys.detail(id) or subresources', async () => {
      qc.setQueryData(userKeys.lists(), { type: 'unfiltered-users' })
      qc.setQueryData(userKeys.list({ role: 'admin' }), { type: 'admin-users' })
      qc.setQueryData(userKeys.list({ role: 'admin', page: 2 }), { type: 'admin-page-2' })
      qc.setQueryData(userKeys.detail('123'), { id: '123', name: 'Alice' })
      qc.setQueryData(userKeys.subresource('123', 'posts'), [{ id: 'p1' }])
      qc.setQueryData(petKeys.lists(), { type: 'pets' })

      await qc.invalidateQueries({ queryKey: userKeys.lists() })

      // User lists are stale
      expect(qc.getQueryCache().find({ queryKey: userKeys.lists() })?.isStale()).toBe(true)
      expect(qc.getQueryCache().find({ queryKey: userKeys.list({ role: 'admin' }) })?.isStale()).toBe(true)
      expect(qc.getQueryCache().find({ queryKey: userKeys.list({ role: 'admin', page: 2 }) })?.isStale()).toBe(true)

      // Detail and subresource remain FRESH
      expect(qc.getQueryCache().find({ queryKey: userKeys.detail('123') })?.isStale()).toBe(false)
      expect(qc.getQueryCache().find({ queryKey: userKeys.subresource('123', 'posts') })?.isStale()).toBe(false)

      // Negative control
      expect(qc.getQueryCache().find({ queryKey: petKeys.lists() })?.isStale()).toBe(false)
    })

    it('invalidating userKeys.detail(id) cascades to subresources for that ID without clobbering other IDs or lists', async () => {
      qc.setQueryData(userKeys.lists(), { type: 'lists' })
      qc.setQueryData(userKeys.detail('123'), { id: '123', name: 'Alice' })
      qc.setQueryData(userKeys.subresource('123', 'posts'), [{ id: 'post-1' }])
      qc.setQueryData(userKeys.subresource('123', 'posts', { tag: 'react' }), [{ id: 'post-2' }])
      qc.setQueryData(userKeys.subresource('123', 'comments'), [{ id: 'comment-1' }])

      // Other user (ID 456)
      qc.setQueryData(userKeys.detail('456'), { id: '456', name: 'Bob' })
      qc.setQueryData(userKeys.subresource('456', 'posts'), [{ id: 'post-3' }])

      // Pet with exact same ID '123'
      qc.setQueryData(petKeys.detail('123'), { id: '123', name: 'Fluffy the Dog' })

      await qc.invalidateQueries({ queryKey: userKeys.detail('123') })

      // User 123 and all its subresources are invalidated
      expect(qc.getQueryCache().find({ queryKey: userKeys.detail('123') })?.isStale()).toBe(true)
      expect(qc.getQueryCache().find({ queryKey: userKeys.subresource('123', 'posts') })?.isStale()).toBe(true)
      expect(qc.getQueryCache().find({ queryKey: userKeys.subresource('123', 'posts', { tag: 'react' }) })?.isStale()).toBe(true)
      expect(qc.getQueryCache().find({ queryKey: userKeys.subresource('123', 'comments') })?.isStale()).toBe(true)

      // Other user 456 MUST NOT be invalidated
      expect(qc.getQueryCache().find({ queryKey: userKeys.detail('456') })?.isStale()).toBe(false)
      expect(qc.getQueryCache().find({ queryKey: userKeys.subresource('456', 'posts') })?.isStale()).toBe(false)

      // User list MUST NOT be invalidated
      expect(qc.getQueryCache().find({ queryKey: userKeys.lists() })?.isStale()).toBe(false)

      // Pet with ID 123 MUST NOT be invalidated
      expect(qc.getQueryCache().find({ queryKey: petKeys.detail('123') })?.isStale()).toBe(false)
    })

    it('numeric and string ID normalization: userKeys.detail(123) and userKeys.detail("123") share exact queryKey', async () => {
      const numKey = userKeys.detail(123)
      const strKey = userKeys.detail('123')

      expect(numKey).toEqual(strKey)
      expect(numKey).toEqual(['users', 'detail', '123'])

      // Storing with string ID, invalidating with numeric ID
      qc.setQueryData(strKey, { id: '123', name: 'Normalizer' })
      expect(qc.getQueryCache().find({ queryKey: strKey })?.isStale()).toBe(false)

      await qc.invalidateQueries({ queryKey: numKey })
      expect(qc.getQueryCache().find({ queryKey: strKey })?.isStale()).toBe(true)
    })

    it('subresource invalidation does NOT cascade upwards to parent detail or sideways to sibling subresources', async () => {
      qc.setQueryData(userKeys.detail('123'), { id: '123', name: 'Alice' })
      qc.setQueryData(userKeys.subresource('123', 'posts'), [{ id: 'p1' }])
      qc.setQueryData(userKeys.subresource('123', 'posts', { tag: 'ai' }), [{ id: 'p2' }])
      qc.setQueryData(userKeys.subresource('123', 'comments'), [{ id: 'c1' }])

      // Action: Invalidate ONLY posts subresource
      await qc.invalidateQueries({ queryKey: userKeys.subresource('123', 'posts') })

      // Posts subresource and filtered posts are invalidated
      expect(qc.getQueryCache().find({ queryKey: userKeys.subresource('123', 'posts') })?.isStale()).toBe(true)
      expect(qc.getQueryCache().find({ queryKey: userKeys.subresource('123', 'posts', { tag: 'ai' }) })?.isStale()).toBe(true)

      // Parent detail is PRESERVED (Not clobbered!)
      expect(qc.getQueryCache().find({ queryKey: userKeys.detail('123') })?.isStale()).toBe(false)

      // Sibling subresource is PRESERVED (Not clobbered!)
      expect(qc.getQueryCache().find({ queryKey: userKeys.subresource('123', 'comments') })?.isStale()).toBe(false)
    })
  })

  // ════════════════════════════════════════════════════════════════════════════
  // 2. Next.js SSR Prefetching Emulation
  // ════════════════════════════════════════════════════════════════════════════
  describe('Next.js SSR Prefetching Emulation', () => {
    it('executes prefetchQuery headlessly in Node environment without DOM or React rendering', async () => {
      const serverQC = new QueryClient()
      const mockClient = {
        getUser: async (params: { id: string }) => ({
          id: params.id,
          name: 'Server Side User',
          email: 'ssr@example.com',
        }),
      }

      // Emulate options factory returned by getUserQueryOptions
      const options = queryOptions({
        queryKey: userKeys.getUser({ id: 'ssr-1' }),
        queryFn: async () => mockClient.getUser({ id: 'ssr-1' }),
      })

      // Prefetch headlessly
      await serverQC.prefetchQuery(options)

      // Assert data is populated in server cache
      const cached = serverQC.getQueryData(userKeys.getUser({ id: 'ssr-1' }))
      expect(cached).toEqual({
        id: 'ssr-1',
        name: 'Server Side User',
        email: 'ssr@example.com',
      })

      const state = serverQC.getQueryState(userKeys.getUser({ id: 'ssr-1' }))
      expect(state?.status).toBe('success')
      expect(state?.fetchStatus).toBe('idle')
      expect(state?.dataUpdatedAt).toBeGreaterThan(0)
    })

    it('handles multiple concurrent SSR prefetches via Promise.all with zero collisions', async () => {
      const serverQC = new QueryClient()
      const mockClient = {
        getUser: async (params: { id: string }) => ({ id: params.id, name: `User ${params.id}` }),
        getUserPosts: async (params: { id: string }) => [{ id: 'p1', author: params.id }],
        listUsers: async (query?: { role?: string }) => [{ id: 'u1', role: query?.role ?? 'all' }],
        getSystemStatus: async () => ({ status: 'operational', timestamp: 123456 }),
      }

      // Execute 4 prefetch operations concurrently
      await Promise.all([
        serverQC.prefetchQuery({
          queryKey: userKeys.getUser({ id: 'concurrent-1' }),
          queryFn: () => mockClient.getUser({ id: 'concurrent-1' }),
        }),
        serverQC.prefetchQuery({
          queryKey: userKeys.getUserPosts({ id: 'concurrent-1' }),
          queryFn: () => mockClient.getUserPosts({ id: 'concurrent-1' }),
        }),
        serverQC.prefetchQuery({
          queryKey: userKeys.listUsers({ role: 'admin' }),
          queryFn: () => mockClient.listUsers({ role: 'admin' }),
        }),
        serverQC.prefetchQuery({
          queryKey: systemKeys.getSystemStatus(),
          queryFn: () => mockClient.getSystemStatus(),
        }),
      ])

      expect(serverQC.getQueryData(userKeys.getUser({ id: 'concurrent-1' }))).toEqual({ id: 'concurrent-1', name: 'User concurrent-1' })
      expect(serverQC.getQueryData(userKeys.getUserPosts({ id: 'concurrent-1' }))).toEqual([{ id: 'p1', author: 'concurrent-1' }])
      expect(serverQC.getQueryData(userKeys.listUsers({ role: 'admin' }))).toEqual([{ id: 'u1', role: 'admin' }])
      expect(serverQC.getQueryData(systemKeys.getSystemStatus())).toEqual({ status: 'operational', timestamp: 123456 })
    })

    it('guarantees complete roundtrip integrity: prefetch -> dehydrate -> JSON.stringify -> hydrate -> client getQueryData', async () => {
      const serverQC = new QueryClient()
      const serverData = { id: 'u77', name: 'Hydration Hero', tags: ['typescript', 'react-query'] }

      await serverQC.prefetchQuery({
        queryKey: userKeys.getUser({ id: 'u77' }),
        queryFn: async () => serverData,
      })

      // 1. Dehydrate server cache
      const dehydrated = dehydrate(serverQC)
      expect(dehydrated.queries.length).toBe(1)
      expect(dehydrated.queries[0].queryKey).toEqual(['users', 'detail', 'u77'])

      // 2. Wire serialization (simulating Next.js HTML stream / page props transfer)
      const wireJson = JSON.stringify(dehydrated)
      expect(typeof wireJson).toBe('string')
      const parsedState = JSON.parse(wireJson)

      // 3. Client initialization and hydration
      const clientQC = new QueryClient()
      expect(clientQC.getQueryData(userKeys.getUser({ id: 'u77' }))).toBeUndefined()

      hydrate(clientQC, parsedState)

      // 4. Assert client has immediate synchronous access with zero network latency
      const clientData = clientQC.getQueryData(userKeys.getUser({ id: 'u77' }))
      expect(clientData).toEqual(serverData)
      expect(clientQC.getQueryState(userKeys.getUser({ id: 'u77' }))?.status).toBe('success')
    })

    it('handles SSR prefetch errors gracefully without crashing the server or polluting hydration', async () => {
      const serverQC = new QueryClient()
      const failingClient = {
        getUser: async () => {
          throw new Error('500 Internal Server Error')
        },
      }

      // prefetchQuery catches error and marks status as error
      await serverQC.prefetchQuery({
        queryKey: userKeys.getUser({ id: 'fail-1' }),
        queryFn: () => failingClient.getUser(),
      })

      const state = serverQC.getQueryState(userKeys.getUser({ id: 'fail-1' }))
      expect(state?.status).toBe('error')
      expect(state?.error?.message).toBe('500 Internal Server Error')

      // TanStack Query defaultShouldDehydrateQuery skips failed queries
      const dehydrated = dehydrate(serverQC)
      expect(dehydrated.queries.length).toBe(0)
    })
  })

  // ════════════════════════════════════════════════════════════════════════════
  // 3. Adversarial Edge Cases & Vulnerability Findings
  // ════════════════════════════════════════════════════════════════════════════
  describe('Adversarial Edge Cases & Bug Hunting (Remediation Verification)', () => {
    it('REMEDIATED: singular and plural tags ("user" and "users") emit exactly once without duplicate identifier collisions', () => {
      const collisionDoc = parseDocument({
        openapi: '3.2.0',
        info: { title: 'Collision Spec', version: '1.0.0' },
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
      })

      const out = generateTanstackQuery(collisionDoc)
      const keysCode = out.keysCode

      // Count occurrences of export const userKeys and usersKeys
      const userKeysMatches = keysCode.match(/export const userKeys\b/g) || []
      const usersKeysMatches = keysCode.match(/export const usersKeys\b/g) || []

      // REMEDIATED: Both userKeys and usersKeys are declared exactly once in the same file
      expect(userKeysMatches.length).toBe(1)
      expect(usersKeysMatches.length).toBe(1)

      // Test with TypeScript compiler host
      const fileName = 'test-collision.ts'
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

      const errorCodes = diagnostics.map(d => d.code)
      // TS2451: Cannot redeclare block-scoped variable — must NOT be present
      expect(errorCodes).not.toContain(2451)
    }, 25_000)

    it('REMEDIATED: generateCombinedFile emits clientImport and typesImport in emitted combinedCode', () => {
      const doc = parseDocument(complexSpec())
      const out = generateTanstackQuery(doc, {
        typesImport: './types.js',
        clientImport: './client.js',
        clientName: 'ApiClient',
      })

      const combined = out.combinedCode

      // Combined code references ApiClient as function parameters
      expect(combined).toContain('client: ApiClient')

      // clientImport is properly emitted in combined file
      expect(combined).toContain("from './client.js'")
      expect(combined).toContain("import type { ApiClient } from './client.js'")

      // typesImport is properly emitted in combined file
      expect(combined).toContain("from './types.js'")
    })
  })
})
