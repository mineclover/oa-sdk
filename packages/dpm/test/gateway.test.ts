import { describe, expect, it } from 'vitest'

import { parseDocument } from '../../parser/src/index.js'
import {
  DPM_GATEWAY_OPERATION_IDS,
  DPM_MANIFEST_SCHEMA_ID,
  getDpmGatewayOpenApiDocument,
} from '../src/index.js'
import { compileGatewayComponentSchema } from './support/gateway-schema.js'

describe('DPM gateway OpenAPI contract', () => {
  it('parses as an OpenAPI 3.2 gateway artifact through the OA SDK parser path', () => {
    const document = getDpmGatewayOpenApiDocument()
    const parsed = parseDocument(document)

    expect(parsed.openapi).toBe('3.2.0')
    expect(parsed.operations.map(operation => operation.operationId).sort()).toEqual([
      ...DPM_GATEWAY_OPERATION_IDS,
    ].sort())
    expect(parsed.operations).toHaveLength(13)
  })

  it('models the full DPM gateway workflow without exposing secret-bearing operations', () => {
    const document = getDpmGatewayOpenApiDocument()

    expect(Object.keys(document.paths).sort()).toEqual([
      '/dpm/catalog/profile',
      '/dpm/jobs/execute',
      '/dpm/jobs/{jobId}/report',
      '/dpm/manifests/compile',
      '/dpm/manifests/dry-run',
      '/dpm/manifests/validate',
      '/dpm/profiles/analyze',
      '/dpm/profiles/inspect',
      '/dpm/profiles/proposals/{proposalId}/review',
      '/dpm/registry/snapshots/{datasetId}/{registryVersion}',
      '/dpm/relationships/candidates/import',
      '/dpm/relationships/discover',
      '/dpm/relationships/{relationshipName}/approve',
    ])
    const serialized = JSON.stringify(document).toLowerCase()

    expect(serialized).not.toContain('sourcedbcredential')
    expect(serialized).not.toContain('source_db_credential')
    expect(serialized).not.toContain('vaultkey')
    expect(serialized).not.toContain('reverse token')
    expect(serialized).not.toContain('/tokens/resolve')
  })

  it('references the DPM manifest JSON Schema without taking ownership of policy semantics', () => {
    const document = getDpmGatewayOpenApiDocument()
    const manifestSchema = document.components?.schemas?.DpmManifestPolicy as Record<string, any>
    const compiledManifestPolicy = compileGatewayComponentSchema('DpmManifestPolicy')

    expect(manifestSchema['x-dpm-manifest-schema-id']).toBe(DPM_MANIFEST_SCHEMA_ID)
    expect(manifestSchema.additionalProperties).toBe(true)
    expect(manifestSchema.properties).toBeUndefined()
    expect(compiledManifestPolicy({})).toBe(true)
  })
})
