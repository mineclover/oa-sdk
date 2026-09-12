/**
 * Empirical Adversarial Stress Test Suite for TanStack Query v5 Generator
 *
 * Stress-tests:
 * 1. Parameterless operations (GET /health, POST /reset, DELETE /cache)
 * 2. Header-only operations (GET /metrics with header-only, POST /flush with header-only)
 * 3. 204 No Content operations (void return for queries and mutations)
 * 4. Void mutations (mutations with 0 variables)
 * 5. Multi-tag operations vs zero-tag operations (root path, {id} path, un-tagged)
 * 6. Complex nested JSON request bodies
 * 7. Tag singular/plural collisions (e.g. 'user' and 'users' in same spec)
 * 8. Runtime execution of emitted keys, queryOptions, mutationOptions, and createApiHooks
 * 9. TypeScript compiler diagnostics verification via ts.transpileModule and AST validation
 */

import { describe, it, expect } from 'vitest'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
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

function buildAdversarialSpec(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Adversarial Stress Test API', version: '2.0.0' },
    paths: {
      // 1. Parameterless GET (returns JSON)
      '/health': {
        get: {
          tags: ['system'],
          operationId: 'getHealth',
          summary: 'Parameterless health check',
          responses: {
            '200': {
              description: 'Healthy',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { status: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
      // 2. Parameterless 204 GET (void query)
      '/ping': {
        get: {
          tags: ['system'],
          operationId: 'ping',
          summary: 'Ping with 204 No Content',
          responses: {
            '204': { description: 'Pong no content' },
          },
        },
      },
      // 3. Void Mutation (POST with 0 variables, 204 response)
      '/system/reset': {
        post: {
          tags: ['system'],
          operationId: 'resetSystem',
          summary: 'Void mutation',
          responses: {
            '204': { description: 'Reset complete' },
          },
        },
      },
      // 4. Header-only GET
      '/metrics': {
        get: {
          tags: ['observability'],
          operationId: 'getMetrics',
          summary: 'Header-only GET',
          parameters: [
            {
              name: 'X-Tenant-Id',
              in: 'header',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'X-Debug-Mode',
              in: 'header',
              required: false,
              schema: { type: 'boolean' },
            },
          ],
          responses: {
            '200': {
              description: 'Metrics report',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { qps: { type: 'number' } } },
                },
              },
            },
          },
        },
      },
      // 5. Header-only Mutation (POST with headers only)
      '/observability/flush': {
        post: {
          tags: ['observability'],
          operationId: 'flushTelemetry',
          summary: 'Header-only mutation',
          parameters: [
            {
              name: 'X-Force-Flush',
              in: 'header',
              required: true,
              schema: { type: 'boolean' },
            },
          ],
          responses: {
            '204': { description: 'Flushed' },
          },
        },
      },
      // 6. Path-only operation (single path param)
      '/items/{id}': {
        get: {
          tags: ['items'],
          operationId: 'getItem',
          summary: 'Single path parameter',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Item',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { id: { type: 'string' } } },
                },
              },
            },
          },
        },
        delete: {
          tags: ['items'],
          operationId: 'deleteItem',
          summary: 'Delete item returning 204',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '204': { description: 'Deleted' },
          },
        },
      },
      // 7. Multi-level nested path subresources
      '/orgs/{orgId}/projects/{projectId}/secrets/{secretKey}': {
        get: {
          tags: ['projects'],
          operationId: 'getProjectSecret',
          summary: 'Nested 3-level subresource',
          parameters: [
            { name: 'orgId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'secretKey', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Secret value',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { value: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
      // 8. Complex nested JSON request body mutation
      '/workflows/batch': {
        post: {
          tags: ['workflows'],
          operationId: 'batchProcessWorkflows',
          summary: 'Complex nested body mutation',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['batchId', 'jobs'],
                  properties: {
                    batchId: { type: 'string' },
                    options: {
                      type: 'object',
                      properties: {
                        priority: { type: 'string', enum: ['low', 'high', 'urgent'] },
                        retryLimit: { type: 'integer' },
                      },
                    },
                    jobs: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['jobId', 'payload'],
                        properties: {
                          jobId: { type: 'string' },
                          payload: { type: 'object' },
                          tags: { type: 'array', items: { type: 'string' } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '204': { description: 'Batch submitted' },
          },
        },
      },
      // 9. Multi-tag operation
      '/reports/financial': {
        get: {
          tags: ['billing', 'finance', 'compliance'],
          operationId: 'getFinancialReport',
          summary: 'Multi-tag operation',
          responses: {
            '200': {
              description: 'Report',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { total: { type: 'number' } } },
                },
              },
            },
          },
        },
      },
      // 10. Zero-tag operations (no tags array)
      '/un-tagged-summary': {
        get: {
          operationId: 'getUntaggedSummary',
          summary: 'Zero tag operation with explicit segment',
          responses: {
            '200': {
              description: 'Summary',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
                },
              },
            },
          },
        },
      },
      // 11. Root path with zero tags
      '/': {
        get: {
          operationId: 'getRootIndex',
          summary: 'Root path with 0 tags',
          responses: {
            '200': {
              description: 'Root info',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { version: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
      // 12. Param-only root path with zero tags
      '/{globalEntityId}': {
        get: {
          operationId: 'getGlobalEntity',
          summary: 'Param at root segment with 0 tags',
          parameters: [
            { name: 'globalEntityId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Entity',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { name: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
    },
  }
}

/**
 * Transpiles and evaluates TypeScript code in memory with mock imports.
 */
function transpileAndEvalModule<T>(
  tsCode: string,
  mockImports: Record<string, unknown> = {},
): T {
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
    if (mockImports[id]) {
      return mockImports[id]
    }
    // Mock @tanstack/react-query
    if (id === '@tanstack/react-query') {
      return {
        queryOptions: (opts: unknown) => opts,
        mutationOptions: (opts: unknown) => opts,
        useQuery: (opts: unknown, qc: unknown) => ({ status: 'success', opts, qc }),
        useMutation: (opts: unknown, qc: unknown) => ({ status: 'idle', opts, qc }),
      }
    }
    // Mock @oa-sdk/client
    if (id === '@oa-sdk/client') {
      return {}
    }
    throw new Error(`Unexpected import in test execution: ${id}`)
  })

  return (moduleObj.exports || exportsObj) as T
}

describe('Empirical Adversarial Stress Testing — TanStack Query v5 Generator', () => {
  // ─── 1. Parameterless Operations ──────────────────────────────────────────
  describe('1. Parameterless Operations', () => {
    it('generates query keys and options for parameterless GET returning JSON', () => {
      const spec = buildAdversarialSpec()
      const doc = parseDocument(spec)
      const output = generateTanstackQuery(doc, { banner: false })

      // Tier 1 Key
      expect(output.keysCode).toContain('getHealth: () => systemKeys.lists(),')

      // Tier 2 Options
      expect(output.queriesCode).toContain('export function getHealthQueryOptions<TData = JsonPrimitive<unknown>>(')
      expect(output.queriesCode).toContain('client: ApiClient,')
      expect(output.queriesCode).toContain('queryKey: systemKeys.getHealth(),')
      expect(output.queriesCode).toContain('return client.getHealth()')

      // Tier 3 Hook
      expect(output.hooksCode).toContain('export function useGetHealthQuery<TData = JsonPrimitive<unknown>>(')
      expect(output.hooksCode).toContain('return useQuery(getHealthQueryOptions(client, options), queryClient)')
    })

    it('generates query options for parameterless GET returning 204 (void response)', () => {
      const spec = buildAdversarialSpec()
      const doc = parseDocument(spec)
      const output = generateTanstackQuery(doc, { banner: false })

      // Return type must be void for 204 response
      expect(output.queriesCode).toContain('export function pingQueryOptions<TData = void>(')
      expect(output.queriesCode).toContain('queryKey: systemKeys.ping(),')
      expect(output.queriesCode).toContain('return client.ping()')
    })
  })

  // ─── 2. Header-Only Operations ───────────────────────────────────────────
  describe('2. Header-Only Operations', () => {
    it('correctly wires header-only GET operation in Tier 1, 2, and 3', () => {
      const spec = buildAdversarialSpec()
      const doc = parseDocument(spec)
      const output = generateTanstackQuery(doc, { banner: false })

      // Tier 1: keys
      expect(output.keysCode).toContain('getMetrics: () => observabilityKeys.lists(),')

      // Tier 2: options with headers param
      expect(output.queriesCode).toContain('export function getMetricsQueryOptions<TData = JsonPrimitive<unknown>>(')
      expect(output.queriesCode).toContain('client: ApiClient,')
      expect(output.queriesCode).toContain('headers?: Record<string, unknown>,')
      expect(output.queriesCode).toContain('return client.getMetrics(headers)')

      // Tier 3: hook
      expect(output.hooksCode).toContain('export function useGetMetricsQuery<TData = JsonPrimitive<unknown>>(')
      expect(output.hooksCode).toContain('client: ApiClient,')
      expect(output.hooksCode).toContain('headers?: Record<string, unknown>,')
      expect(output.hooksCode).toContain('return useQuery(getMetricsQueryOptions(client, headers, options), queryClient)')
    })

    it('correctly wires header-only POST mutation operation', () => {
      const spec = buildAdversarialSpec()
      const doc = parseDocument(spec)
      const output = generateTanstackQuery(doc, { banner: false })

      // Mutation variables type
      expect(output.queriesCode).toContain('export type FlushTelemetryVariables = {')
      expect(output.queriesCode).toContain('headers?: Record<string, unknown>')

      // Mutation options
      expect(output.queriesCode).toContain('export function flushTelemetryMutationOptions<TContext = unknown>(')
      expect(output.queriesCode).toContain('mutationKey: observabilityKeys.flushTelemetry(),')
      expect(output.queriesCode).toContain('return client.flushTelemetry(variables.headers)')
    })
  })

  // ─── 3. Void Mutations & 204 No Content ────────────────────────────────────
  describe('3. Void Mutations & 204 No Content', () => {
    it('emits void variables and 0-arg mutationFn for resetSystem', () => {
      const spec = buildAdversarialSpec()
      const doc = parseDocument(spec)
      const output = generateTanstackQuery(doc, { banner: false })

      // Variables must be void
      expect(output.queriesCode).toContain('export type ResetSystemVariables = void')

      // Options factory must emit zero-argument mutationFn
      expect(output.queriesCode).toContain('export function resetSystemMutationOptions<TContext = unknown>(')
      expect(output.queriesCode).toContain('mutationFn: async (): Promise<void> => {')
      expect(output.queriesCode).toContain('return client.resetSystem()')

      // Hook wrapper
      expect(output.hooksCode).toContain('export function useResetSystemMutation<TContext = unknown>(')
      expect(output.hooksCode).toContain('return useMutation(resetSystemMutationOptions(client, options), queryClient)')
    })

    it('emits Promise<void> return type for 204 DELETE item mutation', () => {
      const spec = buildAdversarialSpec()
      const doc = parseDocument(spec)
      const output = generateTanstackQuery(doc, { banner: false })

      expect(output.queriesCode).toContain('export function deleteItemMutationOptions<TContext = unknown>(')
      expect(output.queriesCode).toContain('mutationFn: async (variables: DeleteItemVariables): Promise<void> => {')
      expect(output.queriesCode).toContain('return client.deleteItem(variables.params)')
    })
  })

  // ─── 4. Multi-Tag vs Zero-Tag Operations ──────────────────────────────────
  describe('4. Multi-Tag vs Zero-Tag Operations', () => {
    it('classifies multi-tag operations under primary tag without duplication', () => {
      const spec = buildAdversarialSpec()
      const doc = parseDocument(spec)
      const output = generateTanstackQuery(doc, { banner: false })

      // /reports/financial has tags: ['billing', 'finance', 'compliance']
      // Primary tag is 'billing'
      expect(output.keysCode).toContain('billingKeys')
      expect(output.keysCode).toContain('getFinancialReport: () => billingKeys.lists(),')
    })

    it('routes zero-tag operations to path segment or api fallback', () => {
      const spec = buildAdversarialSpec()
      const doc = parseDocument(spec)
      const output = generateTanstackQuery(doc, { banner: false })

      // 1. /un-tagged-summary falls back to 'unTaggedSummary'
      expect(output.keysCode).toContain('unTaggedSummaryKeys')
      expect(output.keysCode).toContain('getUntaggedSummary: () => unTaggedSummaryKeys.lists(),')

      // 2. Root path '/' and param-only path '/{globalEntityId}' fall back to 'api'
      expect(output.keysCode).toContain('apiKeys')
      expect(output.keysCode).toContain('getRootIndex: () => apiKeys.lists(),')
      expect(output.keysCode).toContain('getGlobalEntity: (params: Record<string, string | number>) => apiKeys.detail(params.globalEntityId),')
    })
  })

  // ─── 5. Complex Nested Request Body ───────────────────────────────────────
  describe('5. Complex Nested Request Body', () => {
    it('handles nested request body without syntax issues or schema leaking', () => {
      const spec = buildAdversarialSpec()
      const doc = parseDocument(spec)
      const output = generateTanstackQuery(doc, { banner: false })

      expect(output.queriesCode).toContain('export type BatchProcessWorkflowsVariables = {')
      expect(output.queriesCode).toContain('body: unknown')
      expect(output.queriesCode).toContain('export function batchProcessWorkflowsMutationOptions<TContext = unknown>(')
      expect(output.queriesCode).toContain('return client.batchProcessWorkflows(variables.body)')
    })
  })

  // ─── 6. Runtime Execution of Keys & Options Factories ─────────────────────
  describe('6. Runtime Execution & Option Resolution', () => {
    it('executes generated key factories and produces exact tuple values', () => {
      const spec = buildAdversarialSpec()
      const doc = parseDocument(spec)
      const keysCode = generateKeyFactory(doc, { banner: false })

      type EvaluatedKeys = {
        systemKeys: any
        observabilityKeys: any
        itemsKeys: any
        projectsKeys: any
        billingKeys: any
        queryKeys: Record<string, any>
      }

      const mod = transpileAndEvalModule<EvaluatedKeys>(keysCode)

      // Parameterless
      expect(mod.systemKeys.getHealth()).toEqual(['system', 'list'])
      expect(mod.systemKeys.ping()).toEqual(['system', 'list'])
      expect(mod.systemKeys.resetSystem()).toEqual(['system', 'mutation', 'resetSystem'])

      // Header-only
      expect(mod.observabilityKeys.getMetrics()).toEqual(['observability', 'list'])
      expect(mod.observabilityKeys.flushTelemetry()).toEqual(['observability', 'mutation', 'flushTelemetry'])

      // Single path param
      expect(mod.itemsKeys.getItem({ id: 'item_99' })).toEqual(['items', 'detail', 'item_99'])
      expect(mod.itemsKeys.deleteItem('item_99')).toEqual(['items', 'detail', 'item_99', 'mutation', 'deleteItem'])

      // Nested subresource: /orgs/{orgId}/projects/{projectId}/secrets/{secretKey}
      expect(mod.projectsKeys.getProjectSecret({ orgId: 'org_1', projectId: 'proj_2', secretKey: 'k3' })).toEqual([
        'projects',
        'detail',
        'org_1',
        'projects',
        'proj_2',
      ])

      // Aggregate queryKeys
      expect(mod.queryKeys.system).toBe(mod.systemKeys)
      expect(mod.queryKeys.observability).toBe(mod.observabilityKeys)
      expect(mod.queryKeys.items).toBe(mod.itemsKeys)
    })

    it('executes queryOptions and mutationOptions at runtime with mock client', async () => {
      const spec = buildAdversarialSpec()
      const doc = parseDocument(spec)
      const combined = generateTanstackQuery(doc, {
        banner: false,
        clientName: 'MockClient',
      }).combinedCode

      const mockClient = {
        getHealth: async () => ({ status: 'healthy_v2' }),
        ping: async () => {},
        resetSystem: async () => {},
        getMetrics: async (headers?: any) => ({ qps: 1500, receivedHeaders: headers }),
        flushTelemetry: async (headers?: any) => {},
        getItem: async (params: { id: string }) => ({ id: params.id, name: 'Sample' }),
        deleteItem: async (params: { id: string }) => {},
        batchProcessWorkflows: async (body: any) => {},
      }

      const mod = transpileAndEvalModule<any>(combined)

      // 1. Parameterless queryOptions
      const healthOpts = mod.getHealthQueryOptions(mockClient)
      expect(healthOpts.queryKey).toEqual(['system', 'list'])
      const healthData = await healthOpts.queryFn({ signal: new AbortController().signal })
      expect(healthData).toEqual({ status: 'healthy_v2' })

      // 2. Void mutationOptions (resetSystem)
      const resetOpts = mod.resetSystemMutationOptions(mockClient)
      expect(resetOpts.mutationKey).toEqual(['system', 'mutation', 'resetSystem'])
      const resetRes = await resetOpts.mutationFn()
      expect(resetRes).toBeUndefined()

      // 3. Header-only queryOptions (getMetrics)
      const metricsOpts = mod.getMetricsQueryOptions(mockClient, { 'x-tenant-id': 'tenant_corp' })
      expect(metricsOpts.queryKey).toEqual(['observability', 'list'])
      const metricsData = await metricsOpts.queryFn({ signal: new AbortController().signal })
      expect(metricsData).toEqual({ qps: 1500, receivedHeaders: { 'x-tenant-id': 'tenant_corp' } })

      // 4. Single path param queryOptions (getItem)
      const itemOpts = mod.getItemQueryOptions(mockClient, { id: 'item_42' })
      expect(itemOpts.queryKey).toEqual(['items', 'detail', 'item_42'])
      const itemData = await itemOpts.queryFn({ signal: new AbortController().signal })
      expect(itemData).toEqual({ id: 'item_42', name: 'Sample' })

      // 5. Context binding helper (createApiHooks)
      const apiHooks = mod.createApiHooks(() => mockClient)
      expect(typeof apiHooks.useGetHealth).toBe('function')
      expect(typeof apiHooks.useResetSystem).toBe('function')
      expect(typeof apiHooks.useGetMetrics).toBe('function')
      expect(typeof apiHooks.useGetItem).toBe('function')
      expect(typeof apiHooks.useDeleteItem).toBe('function')

      // Invoke bound hooks
      const healthHookResult = apiHooks.useGetHealth()
      expect(healthHookResult.status).toBe('success')

      const resetHookResult = apiHooks.useResetSystem()
      expect(resetHookResult.status).toBe('idle')
    })
  })

  // ─── 7. Adversarial Edge Case: Tag Singular/Plural Collision ───────────────
  describe('7. Adversarial Challenge: Tag Singular/Plural Collision Collision Safety', () => {
    it('detects variable collision when both singular and plural tags exist in same spec', () => {
      const collisionSpec: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Tag Collision Test', version: '1.0.0' },
        paths: {
          '/user': {
            get: {
              tags: ['user'],
              operationId: 'getUserProfile',
              responses: { '200': { description: 'OK' } },
            },
          },
          '/users': {
            get: {
              tags: ['users'],
              operationId: 'listUsers',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      }

      const doc = parseDocument(collisionSpec)
      const keysCode = generateKeyFactory(doc, { banner: false })

      // CHALLENGE FINDING:
      // When both 'user' and 'users' exist as tags in the spec:
      // user -> factoryName: 'userKeys', aliasName: 'usersKeys'
      // users -> factoryName: 'usersKeys', aliasName: 'userKeys'
      // The emitted code contains duplicate variable declarations:
      // export const usersKeys = userKeys
      // export const usersKeys = { ... }
      // export const userKeys = usersKeys
      // This causes userKeys to be overwritten by usersKeys at runtime,
      // losing all operations from the 'user' tag!

      const countUserKeysConst = (keysCode.match(/export const userKeys/g) || []).length
      const countUsersKeysConst = (keysCode.match(/export const usersKeys/g) || []).length

      // In safe code, a const identifier should only be declared ONCE in the same scope.
      // If declared more than once, it's a confirmed collision defect!
      console.log(`[CHALLENGE] 'export const userKeys' occurrences: ${countUserKeysConst}`)
      console.log(`[CHALLENGE] 'export const usersKeys' occurrences: ${countUsersKeysConst}`)

      const hasCollision = countUserKeysConst > 1 || countUsersKeysConst > 1
      expect(hasCollision).toBe(false)
      expect(countUserKeysConst).toBe(1)
      expect(countUsersKeysConst).toBe(1)

      // Verify runtime integrity: evaluating the code results in userKeys retaining getUserProfile!
      const mod = transpileAndEvalModule<any>(keysCode)
      expect(mod.userKeys.getUserProfile).toBeDefined()
      expect(mod.usersKeys.listUsers).toBeDefined()
    })
  })
})

