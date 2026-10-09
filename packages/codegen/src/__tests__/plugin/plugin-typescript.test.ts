import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import {
  compileTypeSpecInMemory,
  createPluginContext,
} from '../../plugin/index.js'
import { pluginTypescript } from '../../plugin/plugins/typescript.js'
import type { OasDocument } from '@oa-sdk/parser'

describe('M2: pluginTypescript', () => {
const monorepoRoot = resolve(__dirname, '../../../../..')
const petstoreFile = resolve(monorepoRoot, 'test/e2e/typespec-plugin/fixtures/petstore/main.tsp')
  let petstoreDoc: OasDocument

  beforeAll(async () => {
    const res = await compileTypeSpecInMemory(petstoreFile)
    petstoreDoc = res.document
  })

  it('declares correct plugin name and empty dependencies array', () => {
    const plugin = pluginTypescript()
    expect(plugin.name).toBe('typescript')
    expect(plugin.dependencies).toEqual([])
  })

  it('generates types.ts with default options and registers in VFS', async () => {
    const plugin = pluginTypescript()
    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [plugin] },
    })

    await plugin.generate?.(context)

    expect(context.hasFile('types.ts')).toBe(true)
    const file = context.getFile('types.ts')!
    expect(file.sourcePlugin).toBe('typescript')
    expect(file.kind).toBe('models')
    expect(file.content).toContain('export type Pet')
    expect(file.content).toContain('export type PetStatus')
    expect(file.content).toContain('export type PetError')
    expect(file.exports).toContain('Pet')
    expect(file.exports).toContain('PetStatus')
    expect(file.exports).toContain('PetError')

    expect(context.getPluginData('typescript:output')).toBe('types.ts')
    expect(context.getPluginData('typescript:exports')).toBe(file.exports)
  })

  it('generates TypeScript interfaces when style: "interface" is specified', async () => {
    const plugin = pluginTypescript({ style: 'interface' })
    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [plugin] },
    })

    await plugin.generate?.(context)

    const file = context.getFile('types.ts')!
    expect(file.content).toMatch(/export interface Pet\s*\{/)
    expect(file.content).toMatch(/export interface Category\s*\{/)
    expect(file.content).toMatch(/export interface Tag\s*\{/)
  })

  it('generates TypeScript enum when enums: "typescript" is specified', async () => {
    const plugin = pluginTypescript({ enums: 'typescript' })
    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [plugin] },
    })

    await plugin.generate?.(context)

    const file = context.getFile('types.ts')!
    expect(file.content).toContain('export enum PetStatus {')
    expect(file.content).toMatch(/Available\s*=\s*['"]available['"]/)
    expect(file.content).toMatch(/Pending\s*=\s*['"]pending['"]/)
    expect(file.content).toMatch(/Sold\s*=\s*['"]sold['"]/)
  })

  it('generates JavaScript const object when enums: "javascript" is specified', async () => {
    const plugin = pluginTypescript({ enums: 'javascript' })
    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [plugin] },
    })

    await plugin.generate?.(context)

    const file = context.getFile('types.ts')!
    expect(file.content).toContain('export const PetStatus = {')
    expect(file.content).toMatch(/Available:\s*['"]available['"]/)
    expect(file.content).toContain('} as const;')
    expect(file.content).toContain('export type PetStatus = (typeof PetStatus)[keyof typeof PetStatus];')
  })

  it('generates string union when enums: "union" is specified', async () => {
    const plugin = pluginTypescript({ enums: 'union' })
    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [plugin] },
    })

    await plugin.generate?.(context)

    const file = context.getFile('types.ts')!
    expect(file.content).toContain("export type PetStatus = 'available' | 'pending' | 'sold'")
  })

  it('preserves JSDoc comments by default and strips them when comments: false', async () => {
    // 1. comments: true (default)
    const pWithComments = pluginTypescript()
    const ctx1 = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [pWithComments] },
    })
    await pWithComments.generate?.(ctx1)
    expect(ctx1.getFile('types.ts')?.content).toContain('Standard error structure')

    // 2. comments: false
    const pNoComments = pluginTypescript({ comments: false })
    const ctx2 = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [pNoComments] },
    })
    await pNoComments.generate?.(ctx2)
    expect(ctx2.getFile('types.ts')?.content).not.toContain('Standard error structure')
  })

  it('emits operation parameter DTO types and discriminated errors', async () => {
    const plugin = pluginTypescript()
    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [plugin] },
    })

    await plugin.generate?.(context)

    const content = context.getFile('types.ts')!.content
    expect(content).toContain('PetsListPets')
    expect(content).toContain('PetsGetPetById')
    expect(content).toContain('PetsCreatePet')
    expect(content).toContain('PetError')
    expect(content).toContain('code: string')
    expect(content).toContain('message: string')
  })

  it('generates standalone runtime type guards when typeGuards: true', async () => {
    const plugin = pluginTypescript({ typeGuards: true })
    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [plugin] },
    })

    await plugin.generate?.(context)

    expect(context.hasFile('guards.ts')).toBe(true)
    const guardsFile = context.getFile('guards.ts')!
    expect(guardsFile.sourcePlugin).toBe('typescript')
    expect(guardsFile.kind).toBe('guards')
    expect(guardsFile.content).toContain("import type { Category, CreatePetRequest, Pet, PetError, PetStatus, Tag, UpdatePetRequest } from './types.js';")
    expect(guardsFile.content).toContain('export function isPet(value: unknown): value is Pet')
    expect(guardsFile.content).toContain('export function isPetStatus(value: unknown): value is PetStatus')
    expect(guardsFile.content).toContain('export function isPetError(value: unknown): value is PetError')
    expect(guardsFile.exports).toContain('isPet')
    expect(guardsFile.exports).toContain('isPetStatus')
    expect(guardsFile.exports).toContain('isPetError')
  })

  it('respects custom output paths for both types and guards', async () => {
    const plugin = pluginTypescript({
      output: 'models/schema-types.ts',
      typeGuards: true,
      guardsOutput: 'validation/schema-guards.ts',
    })
    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [plugin] },
    })

    await plugin.generate?.(context)

    expect(context.hasFile('models/schema-types.ts')).toBe(true)
    expect(context.hasFile('validation/schema-guards.ts')).toBe(true)

    const guardsFile = context.getFile('validation/schema-guards.ts')!
    // Check that relative ESM import was computed correctly across subdirectories
    expect(guardsFile.content).toContain("from '../models/schema-types.js';")
  })
})
