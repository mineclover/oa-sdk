import { describe, expect, it } from 'vitest'
import { extractTypeRegistryFile } from '../type-registry-extractor.js'

describe('Type Registry TypeScript extractor', () => {
  it('extracts stable declarations, local relations, artifacts, and exposures', () => {
    const sourceText = `
      interface Internal { id: string }
      export type User = Internal & { name: string }
      export { Internal as PublicInternal }
    `
    const options = {
      filePath: '/workspace/packages/core/src/models.ts',
      sourceText,
      packageName: '@oa-sdk/core',
      logicalModule: './models',
      exportKey: './models',
      runtime: 'node' as const,
    }
    const extracted = extractTypeRegistryFile(options)
    const movedByTrivia = extractTypeRegistryFile({
      ...options,
      sourceText: `// an inserted header does not change identity\n\n${sourceText}`,
    })

    expect(extracted.artifacts).toEqual([
      expect.objectContaining({
        filePath: options.filePath,
        packageName: '@oa-sdk/core',
        logicalModule: './models',
        runtime: 'node',
        origin: 'handwritten',
        role: 'observation',
      }),
    ])
    expect(extracted.declarations).toHaveLength(2)
    expect(extracted.declarations?.map(record => record.declarationId))
      .toEqual(movedByTrivia.declarations?.map(record => record.declarationId))
    expect(extracted.declarations?.map(record => record.qualifiedName).sort()).toEqual([
      '@oa-sdk/core:models#Internal',
      '@oa-sdk/core:models#User',
    ])

    const internal = extracted.declarations?.find(record => record.symbolName === 'Internal')
    const user = extracted.declarations?.find(record => record.symbolName === 'User')
    expect(internal?.exported).toBe(true)
    expect(user?.exported).toBe(true)
    expect(extracted.relations).toContainEqual(expect.objectContaining({
      fromDeclarationId: user?.declarationId,
      kind: 'type-ref',
      toDeclarationId: internal?.declarationId,
      resolved: true,
    }))
    expect(extracted.exposures?.map(exposure => exposure.exportName).sort()).toEqual(['PublicInternal', 'User'])
  })

  it('records unsafe boundaries without using line numbers in their identities', () => {
    const sourceText = `
      type Loose = any
      type User = { id: string }
      declare const schema: { parse(value: unknown): User }
      export function decode(raw: string): unknown {
        const asserted = JSON.parse(raw) as unknown as User
        const validated = schema.parse(JSON.parse(raw))
        return (asserted || validated)!
      }
    `
    const extracted = extractTypeRegistryFile({ filePath: 'decode.ts', sourceText })
    const kinds = extracted.boundaries?.map(boundary => boundary.kind) ?? []

    expect(kinds.filter(kind => kind === 'any')).toHaveLength(1)
    expect(kinds.filter(kind => kind === 'assertion')).toHaveLength(2)
    expect(kinds.filter(kind => kind === 'double-assertion')).toHaveLength(1)
    expect(kinds.filter(kind => kind === 'non-null')).toHaveLength(1)
    expect(kinds.filter(kind => kind === 'deserialize')).toHaveLength(2)
    expect(extracted.boundaries).toContainEqual(expect.objectContaining({
      kind: 'deserialize',
      validatorSymbol: 'schema.parse',
    }))

    const withHeader = extractTypeRegistryFile({
      filePath: 'decode.ts',
      sourceText: `// header\n${sourceText}`,
    })
    expect(extracted.boundaries?.map(boundary => boundary.boundaryId))
      .toEqual(withHeader.boundaries?.map(boundary => boundary.boundaryId))
  })

  it('treats `.json()` that reads a body as a deserialize boundary but not response builders', () => {
    const sourceText = `
      declare const c: { json(value: unknown, status?: number): Response }
      declare const upstream: Response
      declare const request: Request
      export async function handler() {
        const fromResponse = await upstream.json()
        const fromRequest = await request.json()
        c.json({ ok: true })
        c.json({ ok: false }, 500)
        Response.json({ ok: true })
        return [fromResponse, fromRequest]
      }
    `
    const extracted = extractTypeRegistryFile({ filePath: 'handler.ts', sourceText })
    const deserialize = extracted.boundaries?.filter(boundary => boundary.kind === 'deserialize') ?? []

    expect(deserialize.map(boundary => boundary.sourceType).sort()).toEqual(['request.json', 'upstream.json'])
  })

  it('keeps overload IDs unique and treats syntactic imports and reexports as unresolved', () => {
    const sourceText = `
      import type { External as Remote } from '@pkg/types'
      export function load(value: string): Remote
      export function load(value: number): Remote
      export function load(value: string | number): Remote { throw new Error(String(value)) }
      export type { External as PublicExternal } from '@pkg/types'
      export * from './more.js'
    `
    const extracted = extractTypeRegistryFile({
      filePath: 'entry.ts',
      sourceText,
      packageName: '@example/pkg',
      logicalModule: '.',
      exportKey: '.',
    })
    const overloads = extracted.declarations?.filter(record => record.symbolName === 'load') ?? []

    expect(overloads).toHaveLength(3)
    expect(new Set(overloads.map(record => record.declarationId))).toHaveProperty('size', 3)
    expect(extracted.relations).toContainEqual(expect.objectContaining({
      kind: 'import',
      targetSpecifier: '@pkg/types',
      targetSymbol: 'External',
      resolved: false,
    }))
    expect(extracted.relations).toContainEqual(expect.objectContaining({
      kind: 'reexport',
      targetSpecifier: './more.js',
      targetSymbol: '*',
      resolved: false,
    }))
    expect(extracted.exposures).toContainEqual(expect.objectContaining({
      exportName: 'PublicExternal',
      targetSpecifier: '@pkg/types',
      reexport: true,
    }))
  })
})
