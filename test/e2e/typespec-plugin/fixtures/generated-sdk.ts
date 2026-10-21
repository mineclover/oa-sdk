/**
 * Shipped-plugin fixtures for the typespec-plugin e2e suite.
 *
 * Runs the real plugin pipeline (runTspPluginPipeline + the shipped plugins) on a TypeSpec fixture,
 * and loads the generated SDK modules at runtime from a temporary directory, so the suite exercises
 * the code users actually get instead of a hand-written reference client.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  pluginClient,
  pluginTanstackQuery,
  pluginTypescript,
  runTspPluginPipeline,
  type PluginClientOptions,
  type TspPipelineResult,
  type TspPluginEntry,
} from '../../../../packages/codegen/src/plugin/index.js'

export const fixturesDir = dirname(fileURLToPath(import.meta.url))

/** TypeSpec fixtures under `fixtures/<name>/main.tsp`. */
export type FixtureName = 'petstore' | 'storefront' | 'protobuf' | 'edge-cases' | 'wire-namespaces' | 'reserved-names'

export function fixtureEntrypoint(name: FixtureName): string {
  return resolve(fixturesDir, name, 'main.tsp')
}

/** Runs the plugin pipeline in memory (dryRun) on a TypeSpec fixture. */
export function runFixturePipeline(
  name: FixtureName,
  plugins: readonly TspPluginEntry[],
): Promise<TspPipelineResult> {
  return runTspPluginPipeline({ input: fixtureEntrypoint(name), dryRun: true, plugins })
}

/** Emitted (non-virtual) files of a pipeline run keyed by path. */
export function emittedFiles(result: TspPipelineResult): Record<string, string> {
  const files: Record<string, string> = {}
  for (const file of result.files) {
    if (!file.isVirtual) files[file.path] = file.content
  }
  return files
}

/** Result shape of the generated openapi-ts style functions and Client verbs. */
export interface GeneratedClientResult<TData = unknown, TError = unknown> {
  data: TData | undefined
  error: TError | undefined
  response: Response
}

export interface GeneratedClientConfig {
  baseUrl?: string
  headers?: Record<string, string>
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  /** Axios instance of a `pluginClient({ httpClient: 'axios' })` client */
  axios?: { request(config: { responseType?: string }): Promise<unknown> }
  throwOnError?: boolean
}

export interface GeneratedRequestOptions {
  url: string
  path?: Record<string, unknown>
  query?: Record<string, unknown>
  body?: unknown
  headers?: Record<string, unknown>
  signal?: AbortSignal | null
  throwOnError?: boolean
}

/** The generated transport class (pluginClient's `Client`). */
export interface GeneratedClient {
  readonly config: GeneratedClientConfig
  request<TData = unknown, TError = unknown>(options: GeneratedRequestOptions & { method: string }): Promise<GeneratedClientResult<TData, TError>>
  get<TData = unknown, TError = unknown>(options: GeneratedRequestOptions): Promise<GeneratedClientResult<TData, TError>>
  post<TData = unknown, TError = unknown>(options: GeneratedRequestOptions): Promise<GeneratedClientResult<TData, TError>>
  put<TData = unknown, TError = unknown>(options: GeneratedRequestOptions): Promise<GeneratedClientResult<TData, TError>>
  delete<TData = unknown, TError = unknown>(options: GeneratedRequestOptions): Promise<GeneratedClientResult<TData, TError>>
}

interface PetstoreCallOptions {
  client?: GeneratedClient
  signal?: AbortSignal | null
  throwOnError?: boolean
}

interface Pet {
  id: string
  name: string
}

/** The part of the generated petstore client.ts the e2e tests call. */
export interface GeneratedPetstoreClientModule {
  Client: new (config?: GeneratedClientConfig) => GeneratedClient
  createClient(config?: GeneratedClientConfig): GeneratedClient
  getDefaultClient(): GeneratedClient
  setDefaultClient(client: GeneratedClient): void
  listPets(options?: PetstoreCallOptions & { query?: Record<string, unknown> }): Promise<GeneratedClientResult<Pet[]>>
  getPetById(options: PetstoreCallOptions & { path: { petId: string } }): Promise<GeneratedClientResult<Pet, { code: string; message: string }>>
  createPet(options: PetstoreCallOptions & { body: { name: string } }): Promise<GeneratedClientResult<Pet>>
  deletePet(options: PetstoreCallOptions & { path: { petId: string } }): Promise<GeneratedClientResult<void>>
}

/** The generated `ApiClientResponseError`: the rejection value of failed responses without a declared error body. */
export interface GeneratedApiClientResponseError extends Error {
  readonly status: number
  readonly body: unknown
  readonly response: Response
}

/** The generated api-client.ts (pluginTanstackQuery's adapter over the pluginClient SDK). */
export interface GeneratedPetstoreAdapterModule {
  ApiClientResponseError: new (response: Response, body: unknown) => GeneratedApiClientResponseError
  createApiClient(client?: GeneratedClient): {
    petsGetPetById(params: { petId: string }, headers?: Record<string, unknown>, options?: { signal?: AbortSignal | null }): Promise<Pet>
    petsListPets(query?: Record<string, unknown>, headers?: Record<string, unknown>, options?: { signal?: AbortSignal | null }): Promise<Pet[]>
  }
}

export interface GeneratedPetstoreSdk {
  files: Record<string, string>
  client: GeneratedPetstoreClientModule
  adapter: GeneratedPetstoreAdapterModule
}

/** True when `value` is a module namespace exporting a function (or class) under each of `members`. */
export function isModuleWith<T>(value: unknown, members: readonly string[]): value is T {
  return typeof value === 'object' && value !== null
    && members.every(member => typeof (value as Record<string, unknown>)[member] === 'function')
}

/**
 * Writes the named generated modules to a temporary directory and imports them. The modules may only
 * import each other (and type-only packages); the directory is removed once they are loaded.
 */
export async function importGeneratedModules(
  files: Record<string, string>,
  names: readonly string[],
): Promise<Record<string, unknown>> {
  const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-e2e-generated-sdk-'))
  try {
    for (const name of new Set(['types.ts', ...names])) {
      const content = files[name]
      if (content === undefined) throw new Error(`pipeline did not emit ${name}`)
      writeFileSync(join(directory, name), content)
    }
    const modules: Record<string, unknown> = {}
    for (const name of names) modules[name] = await import(join(directory, name))
    return modules
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/**
 * Generates the petstore SDK with pluginTypescript + pluginClient + pluginTanstackQuery and imports
 * the generated client.ts and api-client.ts (both runtime-dependency free) from a temporary directory.
 */
export async function loadGeneratedPetstoreSdk(clientOptions: PluginClientOptions = {}): Promise<GeneratedPetstoreSdk> {
  const result = await runFixturePipeline('petstore', [pluginTypescript(), pluginClient(clientOptions), pluginTanstackQuery()])
  if (!result.success) {
    throw new Error(`petstore pipeline failed: ${JSON.stringify(result.diagnostics)}`)
  }
  const files = emittedFiles(result)
  const { 'client.ts': client, 'api-client.ts': adapter } = await importGeneratedModules(files, ['client.ts', 'api-client.ts'])
  if (!isModuleWith<GeneratedPetstoreClientModule>(client, ['Client', 'createClient', 'getPetById', 'deletePet'])) {
    throw new Error('generated client.ts does not export the expected petstore SDK')
  }
  if (!isModuleWith<GeneratedPetstoreAdapterModule>(adapter, ['createApiClient', 'ApiClientResponseError'])) {
    throw new Error('generated api-client.ts does not export createApiClient and ApiClientResponseError')
  }
  return { files, client, adapter }
}
