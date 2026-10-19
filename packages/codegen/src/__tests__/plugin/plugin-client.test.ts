import { describe, it, expect, beforeAll, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  compileTypeSpecInMemory,
  createPluginContext,
  runTspPluginPipeline,
} from '../../plugin/index.js'
import { pluginTypescript } from '../../plugin/plugins/typescript.js'
import { pluginClient, pluginSdk, readClientSdkManifest } from '../../plugin/plugins/client.js'
import { clientModuleScopeValueNames, renderOpenApiTsClient } from '../../plugin/client-renderer/openapi-ts-client.js'
import type { OasDocument } from '@oa-sdk/parser'
import { collectModuleScopeValueNames, toFileRecord, typecheckGeneratedFiles } from './helpers/typecheck-generated.js'

/** Runs pluginTypescript + pluginClient (through the real pipeline) and returns the emitted files. */
async function generateClient(
  document: OasDocument,
  clientOptions: Parameters<typeof pluginClient>[0] = {},
): Promise<Record<string, string>> {
  const result = await runTspPluginPipeline(
    { input: 'main.tsp', dryRun: true, plugins: [pluginTypescript(), pluginClient(clientOptions)] },
    { document },
  )
  expect(result.success).toBe(true)
  return toFileRecord(result.files)
}

/** Runs pluginTypescript + pluginClient on a plugin context and returns the emitted files and the published SDK manifest. */
async function generateClientWithManifest(
  document: OasDocument,
  clientOptions: Parameters<typeof pluginClient>[0] = {},
) {
  const pTs = pluginTypescript()
  const pCl = pluginClient(clientOptions)
  const context = createPluginContext({
    entrypoint: '/project/main.tsp',
    outputDir: '/project/dist',
    document,
    config: { input: 'main.tsp', plugins: [pTs, pCl] },
  })
  await pTs.generate?.(context)
  await pCl.generate?.(context)
  const manifest = readClientSdkManifest(context)
  if (!manifest) throw new Error('pluginClient published no SDK manifest')
  return { files: toFileRecord(context.getFiles()), manifest }
}

/** Declarations of `export type <Name> =` that occur more than once, plus self-referential aliases. */
function duplicateOrSelfAliases(code: string): string[] {
  const problems: string[] = []
  const counts = new Map<string, number>()
  for (const match of code.matchAll(/^export type ([A-Za-z0-9_$]+)\s*=\s*([^;\n]*)/gm)) {
    const name = match[1]!
    counts.set(name, (counts.get(name) ?? 0) + 1)
    if (match[2]?.trim() === name) problems.push(`self-alias ${name}`)
  }
  for (const [name, count] of counts) {
    if (count > 1) problems.push(`duplicate ${name} x${count}`)
  }
  return problems
}

const rootLevelDoc: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Root ops', version: '1.0.0' },
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Item' } } } } } },
      },
    },
    '/items/{id}': {
      get: {
        operationId: 'getItem',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } },
          '404': { description: 'missing', content: { 'application/json': { schema: { $ref: '#/components/schemas/NotFound' } } } },
        },
      },
      delete: {
        operationId: 'removeItem',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'gone' } },
      },
    },
  },
  components: {
    schemas: {
      Item: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      NotFound: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } },
    },
  },
}

const sharedShortNameDoc: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Shared short names', version: '1.0.0' },
  paths: {
    '/pets': { get: { operationId: 'Pets_list', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } } } },
    '/users': { get: { operationId: 'Users_list', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } } } },
  },
}

function typedHeaderDoc(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Typed headers', version: '1.0.0' },
    paths: {
      '/items/{id}': {
        get: {
          operationId: 'Items_getItem',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'x-count', in: 'header', required: false, schema: { type: 'integer', format: 'int32' } },
            { name: 'x-debug', in: 'header', required: false, schema: { type: 'boolean' } },
            { name: 'x-tags', in: 'header', required: false, schema: { type: 'array', items: { type: 'string' } } },
          ],
          responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } } } } },
        },
      },
    },
  }
}

describe('M2: pluginClient & pluginSdk', () => {
  const monorepoRoot = resolve(__dirname, '../../../../..')
  const petstoreFile = resolve(monorepoRoot, 'test/e2e/typespec-plugin/fixtures/petstore/main.tsp')
  let petstoreDoc: OasDocument

  beforeAll(async () => {
    const res = await compileTypeSpecInMemory(petstoreFile)
    petstoreDoc = res.document
  })

  it('declares correct plugin name and dependencies on typescript', () => {
    const plugin = pluginClient()
    expect(plugin.name).toBe('client')
    expect(plugin.dependencies).toEqual(['typescript'])

    const sdk = pluginSdk()
    expect(sdk.name).toBe('client')
    expect(sdk.dependencies).toEqual(['typescript'])
  })

  it('generates client.ts with single-object calling convention and discriminated union', async () => {
    const pTs = pluginTypescript()
    const pCl = pluginClient()

    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [pTs, pCl] },
    })

    await pTs.generate?.(context)
    await pCl.generate?.(context)

    expect(context.hasFile('client.ts')).toBe(true)
    const clientFile = context.getFile('client.ts')!
    expect(clientFile.sourcePlugin).toBe('client')
    expect(clientFile.kind).toBe('client')

    const code = clientFile.content

    // 1. Types import and re-export
    expect(code).toContain("import type {")
    expect(code).toContain("from './types.js';")
    expect(code).toContain("export type * from './types.js';")

    // 2. Calling convention interfaces
    expect(code).toContain('export interface RequestParameters<')
    expect(code).toContain('export type RequestOptions<TData = unknown>')
    expect(code).toContain('export type ClientResult<TData = unknown, TError = unknown, TErrors = Record<number, TError>>')
    expect(code).toContain('export type ClientResponse<TData = unknown, TError = unknown, TErrors = Record<number, TError>>')

    // 3. Central Client class and createClient
    expect(code).toContain('export class Client {')
    expect(code).toContain('export function createClient(')
    expect(code).toContain('export const client = defaultClient')

    // 4. Standalone functions matching operations
    expect(code).toContain('export async function listPets(')
    expect(code).toContain('export async function getPetById(')
    expect(code).toContain('export async function createPet(')
    expect(code).toContain('export async function updatePet(')
    expect(code).toContain('export async function deletePet(')

    // 5. Data interfaces for single-object parameters
    expect(code).toContain('export interface GetPetByIdData {')
    expect(code).toContain('export interface ListPetsData {')
    expect(code).toContain('export interface CreatePetData {')
    expect(code).toContain('export interface UpdatePetData {')
    expect(code).toContain('export interface DeletePetData {')

    // 6. Exported symbols
    expect(clientFile.exports).toContain('Client')
    expect(clientFile.exports).toContain('createClient')
    expect(clientFile.exports).toContain('client')
    expect(clientFile.exports).toContain('getPetById')
    expect(clientFile.exports).toContain('listPets')
    expect(clientFile.exports).toContain('createPet')
    expect(clientFile.exports).toContain('updatePet')
    expect(clientFile.exports).toContain('deletePet')
    expect(clientFile.exports).toContain('GetPetByIdData')
    expect(clientFile.exports).toContain('ListPetsData')
  })

  it('enforces required parameters on functions with path/required body and allows optional parameters on others', async () => {
    const pTs = pluginTypescript()
    const pCl = pluginClient()

    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [pTs, pCl] },
    })

    await pTs.generate?.(context)
    await pCl.generate?.(context)

    const code = context.getFile('client.ts')!.content

    // getPetById has required path param petId => options is NOT optional (options: RequestOptions<...>)
    expect(code).toMatch(/export async function getPetById\(\s*options:\s*RequestOptions<GetPetByIdData>/)

    // listPets has only optional query parameters => options IS optional (options?: RequestOptions<...>)
    expect(code).toMatch(/export async function listPets\(\s*options\?:\s*RequestOptions<ListPetsData>/)
  })

  it('supports dual emission toggles (standalone: false, clientClass: false)', async () => {
    // 1. standalone: false (only Client class)
    const pNoStandalone = pluginClient({ standalone: false })
    const ctx1 = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [pNoStandalone] },
    })
    await pNoStandalone.generate?.(ctx1)
    const code1 = ctx1.getFile('client.ts')!.content
    expect(code1).toContain('export class Client {')
    expect(code1).not.toContain('export async function getPetById(')

    // 2. clientClass: false (only standalone functions)
    const pNoClass = pluginClient({ clientClass: false })
    const ctx2 = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [pNoClass] },
    })
    await pNoClass.generate?.(ctx2)
    const code2 = ctx2.getFile('client.ts')!.content
    expect(code2).not.toContain('export class Client {')
    expect(code2).toContain('export async function getPetById(')
  })

  it('clientClass: false keeps a module-private transport the standalone functions use (compiles and runs)', async () => {
    const files = await generateClient(petstoreDoc, { clientClass: false, baseUrl: 'https://api.test' })
    const code = files['client.ts']!

    // The public client API is not exported ...
    expect(code).not.toMatch(/export (class Client|function createClient|let defaultClient|function setDefaultClient|const client\b)/)
    expect(readExports(code)).not.toContain('Client')
    // ... but the transport the functions call is defined.
    expect(code).toContain('class Client {')
    expect(code).toContain('const defaultClient: Client = new Client({ baseUrl: "https://api.test" })')
    expect(code).not.toContain('options?.client')

    expect(typecheckGeneratedFiles({ files })).toEqual([])

    // Runtime: the standalone function reaches the transport instead of throwing ReferenceError.
    const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-client-runtime-'))
    try {
      for (const [path, content] of Object.entries(files)) writeFileSync(join(directory, path), content)
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'p1', name: 'Rex', status: 'available' }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      try {
        const sdk = await import(join(directory, 'client.ts'))
        const res = await sdk.getPetById({ path: { petId: 'p1' } })
        expect(res.data).toEqual({ id: 'p1', name: 'Rex', status: 'available' })
        expect(fetchMock).toHaveBeenCalledWith('https://api.test/pets/p1', expect.objectContaining({ method: 'GET' }))
      } finally {
        vi.unstubAllGlobals()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('publishes an SDK manifest naming every emitted operation function', async () => {
    const pTs = pluginTypescript()
    const pCl = pluginClient()
    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [pTs, pCl] },
    })
    await pTs.generate?.(context)
    await pCl.generate?.(context)

    const manifest = readClientSdkManifest(context)
    expect(manifest).toMatchObject({ output: 'client.ts', clientName: 'Client', clientClass: true, standalone: true })
    const getPet = manifest?.operations.find(op => op.operationId === 'Pets_getPetById')
    expect(getPet).toMatchObject({ functionName: 'petsGetPetById', primaryFunctionName: 'getPetById', hasPathParams: true })
    const exports = context.getFile('client.ts')!.exports ?? []
    for (const op of manifest?.operations ?? []) expect(exports).toContain(op.functionName)
  })

  it('generates Axios transport client when httpClient: "axios" is specified', async () => {
    const pCl = pluginClient({ httpClient: 'axios' })
    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [pCl] },
    })

    await pCl.generate?.(context)

    const code = context.getFile('client.ts')!.content
    expect(code).toContain('axios?: any')
    expect(code).toContain('const axiosInstance = this.config.axios')
    expect(code).toContain('axiosInstance.request({')
  })

  it('calculates relative ESM types import when client is in a subfolder', async () => {
    const pTs = pluginTypescript({ output: 'models/types.ts' })
    const pCl = pluginClient({ output: 'sdk/client.ts' })

    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [pTs, pCl] },
    })

    await pTs.generate?.(context)
    await pCl.generate?.(context)

    const clientCode = context.getFile('sdk/client.ts')!.content
    expect(clientCode).toContain("from '../models/types.js';")
    expect(clientCode).toContain("export type * from '../models/types.js';")
  })

  it('embeds baseUrl when specified in plugin options', async () => {
    const pCl = pluginClient({ baseUrl: 'https://api.petstore.io/v1' })
    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [pCl] },
    })

    await pCl.generate?.(context)

    const code = context.getFile('client.ts')!.content
    expect(code).toContain('createClient({ baseUrl: "https://api.petstore.io/v1" })')
  })

  it('renderOpenApiTsClient output for the petstore type-checks with the pluginTypescript types', async () => {
    const result = renderOpenApiTsClient({
      document: petstoreDoc,
      output: 'client.ts',
      httpClient: 'fetch',
    })

    expect(result.code).toContain('export class Client {')
    expect(result.code).toContain('export async function getPetById(')
    expect(result.exports).toContain('getPetById')
    expect(result.exports).toContain('Client')

    for (const httpClient of ['fetch', 'axios'] as const) {
      const files = await generateClient(petstoreDoc, { httpClient })
      expect(typecheckGeneratedFiles({ files }), httpClient).toEqual([])
    }
  })

  it('does not emit self-referential or duplicate aliases for root-level operations', async () => {
    const files = await generateClient(rootLevelDoc)
    const code = files['client.ts']!

    expect(duplicateOrSelfAliases(code)).toEqual([])
    // The operation types still resolve: imported (and re-exported) or declared once as fallbacks.
    expect(code).toContain('export type RemoveItemResponse = void;')
    expect(code).toContain('export type ListItemsError = unknown;')
    expect(code).not.toContain('export type ListItemsResponse = ListItemsResponse')
    expect(typecheckGeneratedFiles({ files })).toEqual([])
  })

  it('does not emit self-referential or duplicate aliases when a short name is shared by namespaces', async () => {
    const files = await generateClient(sharedShortNameDoc)
    const code = files['client.ts']!

    expect(code).toContain('export async function petsList(')
    expect(code).toContain('export async function usersList(')
    expect(duplicateOrSelfAliases(code)).toEqual([])
    expect(typecheckGeneratedFiles({ files })).toEqual([])
  })

  it('accepts typed (integer, boolean, array) header parameters and serializes them', async () => {
    for (const httpClient of ['fetch', 'axios'] as const) {
      const files = await generateClient(typedHeaderDoc(), { httpClient })
      expect(files['types.ts']).toContain("'x-count'?: number")
      expect(typecheckGeneratedFiles({
        files: {
          ...files,
          'usage.ts': [
            "import { getItem } from './client.js'",
            "export const call = getItem({ path: { id: 'a' }, headers: { 'x-count': 3, 'x-debug': true, 'x-tags': ['a', 'b'] } })",
          ].join('\n'),
        },
      }), httpClient).toEqual([])
    }

    const files = await generateClient(typedHeaderDoc())
    const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-client-headers-'))
    try {
      for (const [path, content] of Object.entries(files)) writeFileSync(join(directory, path), content)
      const sdk = await import(join(directory, 'client.ts'))
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}', { status: 200 }))
      const client = sdk.createClient({ baseUrl: 'https://api.test', fetch: fetchMock })
      await sdk.getItem({ client, path: { id: 'a' }, headers: { 'x-count': 3, 'x-debug': false, 'x-tags': ['a', 'b'] } })
      await sdk.getItem({ client, path: { id: 'a' }, headers: { 'x-count': undefined } })

      const first = fetchMock.mock.calls[0]![1].headers as Record<string, string>
      expect(first).toMatchObject({ 'x-count': '3', 'x-debug': 'false', 'x-tags': 'a,b' })
      const second = fetchMock.mock.calls[1]![1].headers as Record<string, string>
      expect(second).not.toHaveProperty('x-count')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('pluginClient axios transport', () => {
  it('handles null-body responses (204, 304) for which axios reports an empty-string body', async () => {
    const files = await generateClient(typedHeaderDoc(), { httpClient: 'axios' })
    const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-client-axios-'))
    try {
      for (const [path, content] of Object.entries(files)) writeFileSync(join(directory, path), content)
      const sdk = await import(join(directory, 'client.ts'))
      const request = vi.fn()
      const client = sdk.createClient({ baseUrl: 'https://api.test', axios: { request } })

      // axios resolves an empty body as data: '' (not undefined); new Response('', { status: 204 }) throws.
      request.mockResolvedValueOnce({ status: 204, statusText: 'No Content', data: '', headers: {} })
      const noContent = await client.delete({ url: '/items/{id}', path: { id: 'a' } })
      expect(noContent).toMatchObject({ data: undefined, error: undefined })
      expect(noContent.response.status).toBe(204)

      request.mockResolvedValueOnce({ status: 304, statusText: 'Not Modified', data: '', headers: {} })
      const notModified = await client.get({ url: '/items/{id}', path: { id: 'a' } })
      expect(notModified.response.status).toBe(304)
      expect(notModified.error).toBeUndefined()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('reads response bodies exactly like the fetch transport (empty: undefined, JSON: parsed, other text: kept)', async () => {
    const axiosFiles = await generateClient(rootLevelDoc, { httpClient: 'axios' })
    const fetchFiles = await generateClient(rootLevelDoc)
    const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-client-axios-bodies-'))
    try {
      writeFileSync(join(directory, 'types.ts'), axiosFiles['types.ts']!)
      writeFileSync(join(directory, 'axios-client.ts'), axiosFiles['client.ts']!)
      writeFileSync(join(directory, 'fetch-client.ts'), fetchFiles['client.ts']!)
      const axiosSdk = await import(join(directory, 'axios-client.ts'))
      const fetchSdk = await import(join(directory, 'fetch-client.ts'))

      let next = { status: 200, body: '' }
      const axios = fakeAxios(() => next)
      const axiosClient = axiosSdk.createClient({ baseUrl: 'https://api.test', axios })
      const fetchClient = fetchSdk.createClient({ baseUrl: 'https://api.test', fetch: async () => new Response(next.body, { status: next.status }) })

      const cases: Array<{ status: number; body: string; data?: unknown; error?: unknown }> = [
        { status: 404, body: '' },
        { status: 404, body: '  \n' },
        { status: 404, body: '{"message":"gone"}', error: { message: 'gone' } },
        { status: 500, body: 'upstream failed', error: 'upstream failed' },
        { status: 200, body: '' },
        { status: 200, body: '{"id":"a"}', data: { id: 'a' } },
        { status: 200, body: '"a"', data: 'a' },
      ]
      for (const testCase of cases) {
        next = testCase
        const fromAxios = await axiosSdk.getItem({ client: axiosClient, path: { id: 'a' } })
        const fromFetch = await fetchSdk.getItem({ client: fetchClient, path: { id: 'a' } })
        const label = `${testCase.status} ${JSON.stringify(testCase.body)}`
        expect({ data: fromAxios.data, error: fromAxios.error }, label).toEqual({ data: testCase.data, error: testCase.error })
        expect({ data: fromFetch.data, error: fromFetch.error }, label).toEqual({ data: testCase.data, error: testCase.error })
        // isErrorStatus is true only for a failed response that carries a body.
        expect(axiosSdk.isErrorStatus(fromAxios, testCase.status), label).toBe(testCase.error !== undefined)
        expect(await fromAxios.response.text(), label).toBe(testCase.body)
      }
      expect(axios.request).toHaveBeenCalledWith(expect.objectContaining({ responseType: 'text', url: 'https://api.test/items/a' }))

      // An instance that still yields decoded data (a custom adapter or transform) has it used as is.
      axios.request.mockResolvedValueOnce({ status: 404, statusText: '', headers: {}, data: { message: 'decoded' } })
      const decoded = await axiosSdk.getItem({ client: axiosClient, path: { id: 'a' } })
      expect(decoded.error).toEqual({ message: 'decoded' })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('pluginClient function names', () => {
  /** Operation names that are not valid bindings, or that clash with a name client.ts declares. */
  const reservedNamesDoc: OasDocument = {
    openapi: '3.2.0',
    info: { title: 'Reserved names', version: '1.0.0' },
    paths: {
      '/things/{id}': {
        delete: {
          operationId: 'delete',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'gone' } },
        },
      },
      '/pets/{id}': {
        delete: {
          operationId: 'Pets_delete',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'gone' } },
        },
      },
      '/orders/export': {
        get: { operationId: 'Orders_export', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } } },
      },
      '/clients': {
        post: { operationId: 'createClient', responses: { '204': { description: 'created' } } },
      },
      '/checks': {
        get: { operationId: 'isErrorStatus', responses: { '204': { description: 'ok' } } },
      },
      '/pets': {
        get: { operationId: 'Pets_list', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } } },
      },
      '/pets-flat': {
        // Its short name is the prefixed function name of Pets_list.
        get: { operationId: 'petsList', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } } },
      },
    },
  }

  it('never declares a reserved word, a module name or another operation\'s name as a function', async () => {
    const files = await generateClient(reservedNamesDoc)
    const code = files['client.ts']!
    const functions = Array.from(code.matchAll(/^export (?:async function|const) ([A-Za-z0-9_$]+)(?:\(| =)/gm), match => match[1]!)

    expect(functions.sort()).toEqual([
      'client', // the default-client export
      'createClient_',
      'delete_',
      'isErrorStatus_',
      'list',
      'ordersExport',
      'petsDelete',
      'petsList',
      'petsList2',
    ])
    // The module's own bindings keep their meaning.
    expect(code).toContain('export function createClient(config?: ClientConfig): Client {')
    expect(code).toMatch(/export function isErrorStatus</)
    // Escaped names keep the operation's type base: no `Delete_Data` and no aliases of DeleteResponse.
    expect(code).toContain('export interface DeleteData {')
    expect(code).toContain('export const petsList = list;')
    expect(duplicateOrSelfAliases(code)).toEqual([])
    expect(typecheckGeneratedFiles({ files })).toEqual([])
  })

  it('publishes the escaped names in the SDK manifest and calls them at runtime', async () => {
    const pTs = pluginTypescript()
    const pCl = pluginClient()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: reservedNamesDoc,
      config: { input: 'main.tsp', plugins: [pTs, pCl] },
    })
    await pTs.generate?.(context)
    await pCl.generate?.(context)
    const operations = readClientSdkManifest(context)?.operations ?? []
    const exports = context.getFile('client.ts')?.exports ?? []
    for (const op of operations) {
      expect(exports).toContain(op.functionName)
      expect(exports).toContain(op.primaryFunctionName)
    }
    expect(operations.map(op => [op.operationId, op.functionName, op.primaryFunctionName])).toEqual([
      ['delete', 'delete_', 'delete_'],
      ['Pets_delete', 'petsDelete', 'petsDelete'],
      ['Orders_export', 'ordersExport', 'ordersExport'],
      ['createClient', 'createClient_', 'createClient_'],
      ['isErrorStatus', 'isErrorStatus_', 'isErrorStatus_'],
      ['Pets_list', 'petsList', 'list'],
      ['petsList', 'petsList2', 'petsList2'],
    ])

    const files = await generateClient(reservedNamesDoc)
    const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-client-reserved-'))
    try {
      for (const [path, content] of Object.entries(files)) writeFileSync(join(directory, path), content)
      const sdk = await import(join(directory, 'client.ts'))
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }))
      const client = sdk.createClient({ baseUrl: 'https://api.test', fetch: fetchMock })
      await sdk.delete_({ client, path: { id: 'a' } })
      expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/things/a', expect.objectContaining({ method: 'DELETE' }))
      await sdk.createClient_({ client })
      expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/clients', expect.objectContaining({ method: 'POST' }))
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  /** One operation per emitted code path: path/query/header parameters, a JSON body, JSON success and error bodies, no body, a method without a verb helper. */
  const transportPathsDoc: OasDocument = {
    openapi: '3.2.0',
    info: { title: 'Transport paths', version: '1.0.0' },
    paths: {
      '/items/{id}': {
        get: {
          operationId: 'Items_get',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'tags', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
            { name: 'x-trace', in: 'header', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } } } },
            '404': { description: 'missing', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } } },
          },
        },
        post: {
          operationId: 'createItem',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { '204': { description: 'created' } },
        },
        trace: { operationId: 'traceItem', responses: { '204': { description: 'traced' } } },
      },
    },
  }

  it('reserves every global and module binding the emitted client module refers to, for every transport and clientClass setting', async () => {
    const reserved = clientModuleScopeValueNames('Client')
    const referenced = new Set<string>()
    for (const httpClient of ['fetch', 'axios'] as const) {
      for (const clientClass of [true, false]) {
        const label = JSON.stringify({ httpClient, clientClass })
        const { files, manifest } = await generateClientWithManifest(transportPathsDoc, { httpClient, clientClass })
        // The TypeScript checker resolves the names: the globals the code refers to (`typeof fetch`
        // included) and the module's own bindings other than the operation functions.
        const names = collectModuleScopeValueNames({ files, file: 'client.ts' })
        const operationFunctions = new Set(manifest.operations.flatMap(op => [op.functionName, op.primaryFunctionName]))
        const moduleBindings = names.declarations.filter(name => !operationFunctions.has(name))
        expect(names.globals, label).toContain(httpClient === 'fetch' ? 'fetch' : 'Headers')

        expect(names.globals.filter(name => !reserved.has(name)), label).toEqual([])
        expect(moduleBindings.filter(name => !reserved.has(name)), label).toEqual([])
        for (const name of [...names.globals, ...moduleBindings]) referenced.add(name)
      }
    }
    // Nothing is reserved that no setting's module refers to or declares.
    expect([...reserved].sort()).toEqual([...referenced].sort())
  })

  it('never names an operation function after a global the module refers to: a root-level `fetch` keeps the network call on the global fetch', async () => {
    const pet = { id: 'p1', name: 'Rex' }
    const globalNamesDoc: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Global names', version: '1.0.0' },
      paths: {
        '/fetch/{id}': {
          get: {
            operationId: 'fetch',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string' }, name: { type: 'string' } } } } } } },
          },
        },
        // Its short name is `fetch` as well.
        '/resources/fetch': { get: { operationId: 'Resources_fetch', responses: { '204': { description: 'ok' } } } },
        '/encode': { get: { operationId: 'encodeURIComponent', responses: { '204': { description: 'ok' } } } },
        '/global': { get: { operationId: 'globalThis', responses: { '204': { description: 'ok' } } } },
      },
    }

    // The same names whatever the transport and clientClass setting, and every variant type-checks.
    const expectedNames = [
      ['fetch', 'fetch_', 'fetch_'],
      ['Resources_fetch', 'resourcesFetch', 'resourcesFetch'],
      ['encodeURIComponent', 'encodeURIComponent_', 'encodeURIComponent_'],
      ['globalThis', 'globalThis_', 'globalThis_'],
    ]
    for (const httpClient of ['fetch', 'axios'] as const) {
      for (const clientClass of [true, false]) {
        const label = JSON.stringify({ httpClient, clientClass })
        const { files, manifest } = await generateClientWithManifest(globalNamesDoc, { httpClient, clientClass })
        expect(manifest.operations.map(op => [op.operationId, op.functionName, op.primaryFunctionName]), label).toEqual(expectedNames)
        expect(files['client.ts'], label).not.toMatch(/\b(?:function|const) (?:fetch|encodeURIComponent|globalThis)\b/)
        expect(typecheckGeneratedFiles({ files }), label).toEqual([])
      }
    }

    // Runtime: the operation reaches a real HTTP server through the real global fetch, both through the
    // exported default client and through the module-private one (clientClass: false).
    const requests: string[] = []
    const server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`)
      if (request.url === '/fetch/p1') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(pet))
      } else {
        response.writeHead(204)
        response.end()
      }
    })
    await new Promise<void>(listening => server.listen(0, '127.0.0.1', listening))
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-client-global-names-'))
    try {
      for (const clientClass of [true, false]) {
        const { files } = await generateClientWithManifest(globalNamesDoc, { clientClass, baseUrl })
        const variantDir = mkdtempSync(join(directory, clientClass ? 'with-class-' : 'without-class-'))
        for (const [path, content] of Object.entries(files)) writeFileSync(join(variantDir, path), content)
        const sdk = await import(join(variantDir, 'client.ts'))

        requests.length = 0
        const result = await sdk.fetch_({ path: { id: 'p1' } })
        expect(result.error, `clientClass=${clientClass}`).toBeUndefined()
        expect(result.data, `clientClass=${clientClass}`).toEqual(pet)
        expect((await sdk.resourcesFetch()).response.status).toBe(204)
        expect(requests).toEqual(['GET /fetch/p1', 'GET /resources/fetch'])
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
      await new Promise<void>(closed => server.close(() => closed()))
    }
  })
})

/**
 * Minimal stand-in for an axios instance (`request` with `validateStatus: () => true`). Like axios, it
 * returns the raw text for `responseType: 'text'`; otherwise it applies axios's default JSON parsing,
 * which keeps text that is not JSON, so an empty body arrives as `''`.
 */
function fakeAxios(respond: () => { status: number; body: string }) {
  const request = vi.fn(async (config: { responseType?: string }) => {
    const { status, body } = respond()
    let data: unknown = body
    if (config.responseType !== 'text' && body) {
      try {
        data = JSON.parse(body)
      } catch {
        data = body
      }
    }
    return { status, statusText: '', headers: {}, data }
  })
  return { request }
}

function readExports(code: string): string[] {
  return Array.from(code.matchAll(/^export (?:async )?(?:class|function|const|let|type|interface) ([A-Za-z0-9_$]+)/gm), match => match[1]!)
}
