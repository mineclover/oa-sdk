import { describe, it, expect, beforeAll } from 'vitest'
import {
  pluginClient,
  pluginTanstackQuery,
  pluginTypescript,
  type TspPipelineResult,
} from '../../../../packages/codegen/src/plugin/index.js'
import {
  emittedFiles,
  importGeneratedModules,
  isModuleWith,
  runFixturePipeline,
  type GeneratedApiClientResponseError,
  type GeneratedClient,
  type GeneratedClientConfig,
} from '../fixtures/generated-sdk.js'

/** The parts of the generated edge-cases client.ts and api-client.ts the F6.7 test calls. */
interface EdgeCasesClientModule {
  createClient(config?: GeneratedClientConfig): GeneratedClient
}
interface EdgeCasesAdapterModule {
  ApiClientResponseError: new (response: Response, body: unknown) => GeneratedApiClientResponseError
  createApiClient(client?: GeneratedClient): {
    getItem(params: { id: string }): Promise<unknown>
    getThing(params: { id: string }): Promise<unknown>
  }
}

describe('Tier 1: F6 - TanStack Query v5 Plugin (pluginTanstackQuery on the petstore fixture)', () => {
  let combined: Record<string, string>
  let split: Record<string, string>

  beforeAll(async () => {
    const run = async (splitFiles: boolean): Promise<TspPipelineResult> => {
      const result = await runFixturePipeline('petstore', [
        pluginTypescript(),
        pluginClient(),
        pluginTanstackQuery({ split: splitFiles }),
      ])
      expect(result.success).toBe(true)
      return result
    }
    combined = emittedFiles(await run(false))
    split = emittedFiles(await run(true))
  })

  it('F6.1: generates Tier 1 hierarchical query key factories (*Keys)', () => {
    const keys = split['keys.ts']!
    expect(keys).toContain('export const petsKeys = {')
    expect(keys).toContain("all: ['pets'] as const")
    expect(keys).toContain('petsGetPetById: (params: PetsGetPetByIdPathParams) => petsKeys.detail(params.petId)')
  })

  it('F6.2: generates Tier 2 pure queryOptions and mutationOptions factories', () => {
    const queries = split['queries.ts']!
    expect(queries).toContain('export function petsGetPetByIdQueryOptions<')
    expect(queries).toContain('export function petsCreatePetMutationOptions<')
    expect(queries).toContain("import type { ApiClient } from './api-client.js'")
  })

  it('F6.3: generates Tier 3 React hooks with "use client" directive banner', () => {
    const hooks = split['hooks.ts']!
    expect(hooks).toContain("'use client'")
    expect(hooks).toContain('export function usePetsGetPetByIdQuery<')
    expect(hooks).toContain('export function createApiHooks(useClient: () => ApiClient)')
  })

  it('F6.4: generates infinite query options for the offset-paginated listPets endpoint', () => {
    const queries = combined['queries.ts']!
    expect(queries).toMatch(/import \{[^}]*\binfiniteQueryOptions\b[^}]*\} from '@tanstack\/react-query'/)
    expect(queries).toContain('export function petsListPetsInfiniteQueryOptions<')
    expect(queries).toContain('"offset": pageParam')
    expect(queries).toContain('initialPageParam: 0 as unknown as TPageParam')
  })

  it('F6.5: supports split emission mode across keys, queries, and hooks files', () => {
    expect(Object.keys(split).sort()).toEqual(['api-client.ts', 'client.ts', 'hooks.ts', 'keys.ts', 'queries.ts', 'types.ts'])
    expect(Object.keys(combined).sort()).toEqual(['api-client.ts', 'client.ts', 'queries.ts', 'types.ts'])
    expect(split['hooks.ts']).toContain("from './queries.js'")
    expect(split['hooks.ts']).toContain("from './keys.js'")
  })

  it('F6.6: emits the operation-method adapter over the pluginClient SDK', () => {
    const adapter = combined['api-client.ts']!
    expect(adapter).toContain('export interface ApiClient {')
    expect(adapter).toContain('export function createApiClient(client?: Client): ApiClient')
    expect(adapter).toContain('export class ApiClientResponseError extends Error {')
    expect(adapter).toContain('petsGetPetById({ client, path: params, headers, signal: options?.signal, throwOnError: false })')
    expect(adapter).toContain('return settleSdkResult(result) as JsonPrimitive<PetsGetPetByIdResponse>')
  })

  it('F6.7: query/mutation errors reject with the declared error body the TanStack code types them as', async () => {
    const result = await runFixturePipeline('edge-cases', [pluginTypescript(), pluginClient(), pluginTanstackQuery()])
    expect(result.success).toBe(true)
    const files = emittedFiles(result)
    // getItem declares NotFound (404) and Conflict (409); getThing declares NotFound (404) and GenericError (default).
    expect(files['queries.ts']).toContain('UndefinedInitialDataOptions<JsonPrimitive<GetItemResponse>, GetItemError,')
    expect(files['types.ts']).toContain('export type GetItemError = NotFound | Conflict')

    const { 'client.ts': sdk, 'api-client.ts': adapter } = await importGeneratedModules(files, ['client.ts', 'api-client.ts'])
    if (!isModuleWith<EdgeCasesClientModule>(sdk, ['createClient'])) throw new Error('client.ts does not export createClient')
    if (!isModuleWith<EdgeCasesAdapterModule>(adapter, ['createApiClient', 'ApiClientResponseError'])) {
      throw new Error('api-client.ts does not export createApiClient and ApiClientResponseError')
    }
    const responses: Response[] = []
    const api = adapter.createApiClient(sdk.createClient({
      baseUrl: 'https://edge.test',
      fetch: async () => responses.shift() ?? new Response(null, { status: 599 }),
    }))
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

    responses.push(json(409, { conflictKey: 'k1' }))
    await expect(api.getItem({ id: 'a' })).rejects.toEqual({ conflictKey: 'k1' })
    responses.push(json(404, { message: 'gone' }))
    await expect(api.getItem({ id: 'a' })).rejects.toEqual({ message: 'gone' })
    responses.push(json(500, { reason: 'boom' }))
    await expect(api.getThing({ id: 'b' })).rejects.toEqual({ reason: 'boom' })

    // getItem declares no error model for 500 (and no default), so its body is not a GetItemError.
    responses.push(json(500, { reason: 'boom' }))
    const undeclared = await api.getItem({ id: 'a' }).catch((error: unknown) => error)
    expect(undeclared).toBeInstanceOf(adapter.ApiClientResponseError)
    expect(undeclared).toMatchObject({ status: 500, body: { reason: 'boom' } })
  })

  it('F6.8: the adapter over the axios transport settles results like the fetch transport (empty bodies included)', async () => {
    const result = await runFixturePipeline('edge-cases', [pluginTypescript(), pluginClient({ httpClient: 'axios' }), pluginTanstackQuery()])
    expect(result.success).toBe(true)
    const files = emittedFiles(result)
    expect(files['client.ts']).toContain("responseType: 'text'")

    const { 'client.ts': sdk, 'api-client.ts': adapter } = await importGeneratedModules(files, ['client.ts', 'api-client.ts'])
    if (!isModuleWith<EdgeCasesClientModule>(sdk, ['createClient'])) throw new Error('client.ts does not export createClient')
    if (!isModuleWith<EdgeCasesAdapterModule>(adapter, ['createApiClient', 'ApiClientResponseError'])) {
      throw new Error('api-client.ts does not export createApiClient and ApiClientResponseError')
    }
    // Stands in for axios.request: the raw text for responseType 'text'; otherwise axios's default JSON
    // parsing, which keeps text that is not JSON, so an empty body arrives as ''.
    const responses: Array<{ status: number; body: string }> = []
    const axios = {
      async request(config: { responseType?: string }) {
        const { status, body } = responses.shift() ?? { status: 599, body: '' }
        let data: unknown = body
        if (config.responseType !== 'text' && body) {
          try {
            data = JSON.parse(body)
          } catch {
            data = body
          }
        }
        return { status, statusText: '', headers: {}, data }
      },
    }
    const api = adapter.createApiClient(sdk.createClient({ baseUrl: 'https://edge.test', axios }))
    const settle = (run: Promise<unknown>) => run.then(value => ({ resolved: value }), (error: unknown) => ({ rejected: error }))

    responses.push({ status: 409, body: JSON.stringify({ conflictKey: 'k1' }) })
    await expect(api.getItem({ id: 'a' })).rejects.toEqual({ conflictKey: 'k1' })
    responses.push({ status: 500, body: JSON.stringify({ reason: 'boom' }) })
    await expect(api.getThing({ id: 'b' })).rejects.toEqual({ reason: 'boom' })

    // Empty bodies of a declared status (getItem 404) and of `default`-covered ones (getThing 500/502)
    // have no error model value to reject with.
    for (const [status, run] of [[404, () => api.getItem({ id: 'a' })], [500, () => api.getThing({ id: 'b' })], [502, () => api.getThing({ id: 'b' })]] as const) {
      responses.push({ status, body: '' })
      const outcome = await settle(run())
      expect('rejected' in outcome && outcome.rejected, `${status}`).toBeInstanceOf(adapter.ApiClientResponseError)
      expect(outcome, `${status}`).toMatchObject({ rejected: { status, body: undefined } })
    }

    responses.push({ status: 200, body: '' })
    await expect(api.getItem({ id: 'a' })).resolves.toBeUndefined()
  })
})
