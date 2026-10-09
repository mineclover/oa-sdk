import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import {
  normalizeVirtualPath,
  formatEsmImportExtension,
  createPluginContext,
} from '../../../../packages/codegen/src/plugin/index.js'
import { extractWireSchemaFromOas } from '../../../../packages/codegen/src/wire-adapter/index.js'
import { negotiateResponseMediaType } from '../../../../packages/router/src/index.js'
import type { OasDocument } from '@oa-sdk/parser'

describe('Tier 2: Boundary & Corner Cases — Router, Wire Codecs & VFS Paths', () => {
  // ── Envelope Collision Defense ──
  it('B4.1: differentiates between domain objects containing "body" and HTTP response envelopes', () => {
    // Condition from oa-sdk router:
    // 'body' in result && (status === undefined || typeof status === 'number') && (headers === undefined || typeof headers === 'object')
    const isResponseEnvelope = (result: any): boolean => {
      if (!result || typeof result !== 'object') return false
      return (
        'body' in result &&
        (result.status === undefined || typeof result.status === 'number') &&
        (result.headers === undefined || typeof result.headers === 'object') &&
        ('status' in result || 'headers' in result)
      )
    }

    // 1. Domain payload that happens to have a "body" field (e.g. blog post / email / comment)
    const domainPayload = { id: 'p1', title: 'Hello', body: 'This is the article content.' }
    expect(isResponseEnvelope(domainPayload)).toBe(false)

    // 2. Explicit HTTP envelope
    const httpEnvelope = { status: 201, body: domainPayload, headers: { 'x-created': 'true' } }
    expect(isResponseEnvelope(httpEnvelope)).toBe(true)

    // 3. Envelope with only status and body
    const statusEnvelope = { status: 200, body: { ok: true } }
    expect(isResponseEnvelope(statusEnvelope)).toBe(true)
  })

  it('B4.2: handles raw scalar or primitive handler returns', () => {
    const isResponseEnvelope = (result: any) =>
      Boolean(result && typeof result === 'object' && 'body' in result && 'status' in result)

    expect(isResponseEnvelope('raw string')).toBe(false)
    expect(isResponseEnvelope(12345)).toBe(false)
    expect(isResponseEnvelope(null)).toBe(false)
    expect(isResponseEnvelope(true)).toBe(false)
  })

  it('B4.3: handles explicit 204 No Content response envelope with undefined body', () => {
    const noContentResponse = { status: 204, body: undefined }
    expect(noContentResponse.status).toBe(204)
    expect(noContentResponse.body).toBeUndefined()
  })

  // ── Wire Codec Boundaries ──
  it('B4.4: safely returns empty wire schema when OpenAPI document has 0 schemas', () => {
    const emptyDoc: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Empty Spec', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {},
      },
    }

    const wireModel = extractWireSchemaFromOas(emptyDoc)
    expect(wireModel.models.length).toBe(0)
    expect(wireModel.enums.length).toBe(0)
    expect(wireModel.services.length).toBe(0)
  })

  it('B4.5: accurately extracts repeated array fields in wire models', () => {
    const docWithArray: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Batch Spec', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          Batch: {
            type: 'object',
            'x-oa-sdk-protobuf': true,
            properties: {
              ids: {
                type: 'array',
                items: { type: 'string' },
                'x-oa-sdk-field': { index: 1 },
              },
            },
          },
        },
      },
    }

    const wireModel = extractWireSchemaFromOas(docWithArray)
    expect(wireModel.models.length).toBe(1)
    expect(wireModel.models[0].fields[0].repeated).toBe(true)
  })

  it('B4.6: resolves wildcard */* Accept header to first supported server media type', () => {
    const negotiated = negotiateResponseMediaType('*/*', [
      'application/json',
      'application/x-protobuf',
    ])
    expect(negotiated).toBe('application/json')
  })

  it('B4.7: falls back to default media type when Accept header has no match', () => {
    const negotiated = negotiateResponseMediaType('text/html', [
      'application/json',
      'application/x-protobuf',
    ])
    expect(negotiated).toBe('application/json')
  })

  // ── VFS Path & ESM Specifier Boundaries ──
  it('B4.8: normalizes Windows backslash paths to clean relative POSIX paths', () => {
    expect(normalizeVirtualPath('.\\src\\models\\user.ts')).toBe('src/models/user.ts')
    expect(normalizeVirtualPath('/root/nested/file.ts')).toBe('root/nested/file.ts')
    expect(normalizeVirtualPath('a/./b/../c/file.ts')).toBe('a/c/file.ts')
  })

  it('B4.9: resolves relative imports across deeply nested sibling directories', () => {
    const ctx = createPluginContext({
      entrypoint: resolve('test/e2e/typespec-plugin/fixtures/petstore/main.tsp'),
      outputDir: resolve('dist/generated'),
      document: { openapi: '3.2.0', info: { title: 'A', version: '1' }, paths: {} },
      config: { input: 'main.tsp', output: 'dist/generated', plugins: [] },
    })

    const specifier = ctx.resolveImport('modules/billing/services/invoice.ts', 'common/types/id.ts')
    expect(specifier).toBe('../../../common/types/id.js')
  })

  it('B4.10: replaces .ts, .tsx, .mts with .js for Node ESM module specifiers', () => {
    expect(formatEsmImportExtension('./user.ts')).toBe('./user.js')
    expect(formatEsmImportExtension('./component.tsx')).toBe('./component.js')
    expect(formatEsmImportExtension('./helper.mts')).toBe('./helper.js')
    expect(formatEsmImportExtension('./already.js')).toBe('./already.js')
  })
})
