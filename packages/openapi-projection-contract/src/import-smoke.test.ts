import { describe, expect, it } from 'vitest'
import type {
  OpenApiProjectionProfile,
  OpenApiProjectionResult,
  SchemaDiagnostic,
  SchemaRefEdge,
  SchemaSourceCoordinate,
  SchemaTypeTarget,
  SchemaValidateResult,
} from '@oa-sdk/openapi-projection-contract'

describe('@oa-sdk/openapi-projection-contract import smoke', () => {
  it('imports the built ESM package through its workspace package name', async () => {
    const imported = await import('@oa-sdk/openapi-projection-contract')

    expect(Object.keys(imported)).toEqual([])
    expect(Object.prototype.toString.call(imported)).toBe('[object Module]')
  })

  it('accepts the exported projection contract types from the package entrypoint', () => {
    const profile: OpenApiProjectionProfile = 'component-bundle'
    const source: SchemaSourceCoordinate = {
      kind: 'file',
      filePath: '/workspace/openapi.yaml',
      pointer: '#/components/schemas/Book',
    }
    const ref: SchemaRefEdge = {
      from: 'schema:public/book/BookList',
      to: 'schema:public/book/Book',
      ref: '#/components/schemas/Book',
      kind: 'schema-ref',
      source,
    }
    const diagnostic: SchemaDiagnostic = {
      severity: 'info',
      code: 'contract/import-smoke',
      message: 'Contract package types are importable.',
      source,
    }
    const typeTarget: SchemaTypeTarget = {
      id: 'schema:public/book/Book',
      name: 'Book',
      kind: 'schema',
      source,
    }
    const validation: SchemaValidateResult = {
      valid: true,
      diagnostics: [],
    }
    const result: OpenApiProjectionResult = {
      profile,
      projection: { openapi: '3.2.0' },
      refs: [ref],
      diagnostics: [diagnostic],
      sources: {
        [typeTarget.id]: source,
      },
      versionHash: 'sha256:import-smoke',
      typeTargets: [typeTarget],
    }

    expect(validation.valid).toBe(true)
    expect(result.profile).toBe('component-bundle')
    expect(result.refs).toHaveLength(1)
    expect(result.typeTargets?.[0]?.name).toBe('Book')
  })
})
