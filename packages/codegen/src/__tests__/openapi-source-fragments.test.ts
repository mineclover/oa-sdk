import { describe, expect, it } from 'vitest'
import {
  createOpenApiSourceAdapterDiagnostic,
  createOpenApiSourceContentHash,
  createOpenApiSourceFragment,
  createOpenApiSourceFragmentId,
} from '../cli/lib/openapi-source-fragments.js'

describe('OpenAPI source fragments', () => {
  it('creates deterministic ids from source coordinates and content hash', () => {
    const content = {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
      },
    }
    const contentHash = createOpenApiSourceContentHash(content)

    const first = createOpenApiSourceFragment({
      kind: 'json-schema',
      sourcePath: 'schemas/user.yaml',
      sourcePointer: '#/components/schemas/User',
      content,
    })
    const second = createOpenApiSourceFragment({
      kind: 'json-schema',
      sourcePath: 'schemas/user.yaml',
      sourcePointer: '#/components/schemas/User',
      contentHash,
      content: {
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
        type: 'object',
      },
    })

    expect(first.id).toBe(second.id)
    expect(first.id).toBe(createOpenApiSourceFragmentId({
      kind: 'json-schema',
      sourcePath: 'schemas/user.yaml',
      sourcePointer: '#/components/schemas/User',
      contentHash,
    }))
    expect(first.id).toMatch(/^openapi-source:json-schema:[a-f0-9]{64}$/)
    expect(createOpenApiSourceFragmentId({
      kind: 'json-schema',
      sourcePath: 'schemas/user.yaml',
      sourcePointer: '#/components/schemas/Admin',
      contentHash,
    })).not.toBe(first.id)
  })

  it('creates deterministic content hashes from JSON-compatible content', () => {
    const first = createOpenApiSourceContentHash({
      type: 'object',
      properties: {
        name: { type: 'string' },
        id: { type: 'string' },
      },
    })
    const second = createOpenApiSourceContentHash({
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
      type: 'object',
      description: undefined,
    })

    expect(first).toBe(second)
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(createOpenApiSourceContentHash({
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
      },
    })).not.toBe(first)
  })

  it('preserves source path and pointer on adapter diagnostics', () => {
    const diagnostic = createOpenApiSourceAdapterDiagnostic({
      code: 'openapi-source/invalid-json-schema',
      severity: 'error',
      message: 'JSON Schema fragment must be an object.',
      sourcePath: 'schemas/user.yaml',
      sourcePointer: '#/components/schemas/User',
      metadata: {
        adapter: 'fixture',
      },
    })

    expect(diagnostic).toEqual({
      code: 'openapi-source/invalid-json-schema',
      severity: 'error',
      message: 'JSON Schema fragment must be an object.',
      sourcePath: 'schemas/user.yaml',
      sourcePointer: '#/components/schemas/User',
      metadata: {
        adapter: 'fixture',
      },
    })
  })
})
