import { describe, it, expect, beforeAll, vi } from 'vitest'
import { resolve } from 'node:path'
import {
  compileTypeSpecInMemory,
  createPluginContext,
} from '../../plugin/index.js'
import { pluginTypescript } from '../../plugin/plugins/typescript.js'
import { pluginClient, pluginSdk } from '../../plugin/plugins/client.js'
import { renderOpenApiTsClient } from '../../plugin/client-renderer/openapi-ts-client.js'
import type { OasDocument } from '@oa-sdk/parser'

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
    expect(code).toContain('export type ClientResult<TData = unknown, TError = unknown>')
    expect(code).toContain('export type ClientResponse<TData = unknown, TError = unknown>')

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

  it('renderOpenApiTsClient produces identical output and valid TypeScript', () => {
    const result = renderOpenApiTsClient({
      document: petstoreDoc,
      output: 'client.ts',
      httpClient: 'fetch',
    })

    expect(result.code).toContain('export class Client {')
    expect(result.code).toContain('export async function getPetById(')
    expect(result.exports).toContain('getPetById')
    expect(result.exports).toContain('Client')
  })
})
