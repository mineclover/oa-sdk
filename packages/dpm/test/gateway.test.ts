import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'

import { parseDocument } from '../../parser/src/index.js'
import {
  DPM_GATEWAY_OPERATION_IDS,
  DPM_MANIFEST_SCHEMA_ID,
  getDpmGatewayOpenApiDocument,
} from '../src/index.js'

function compileGatewayComponentSchema(name: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  ajv.addSchema(getDpmGatewayOpenApiDocument(), 'dpm-gateway')
  return ajv.compile({ $ref: `dpm-gateway#/components/schemas/${name}` })
}

describe('DPM gateway OpenAPI contract', () => {
  it('parses as an OpenAPI 3.2 gateway artifact through the OA SDK parser path', () => {
    const document = getDpmGatewayOpenApiDocument()
    const parsed = parseDocument(document)

    expect(parsed.openapi).toBe('3.2.0')
    expect(parsed.operations.map(operation => operation.operationId).sort()).toEqual([
      ...DPM_GATEWAY_OPERATION_IDS,
    ].sort())
    expect(parsed.operations).toHaveLength(10)
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

  it('rejects empty objects for every non-opaque gateway component schema', () => {
    const document = getDpmGatewayOpenApiDocument()
    const schemaNames = Object.keys(document.components?.schemas ?? {})
      .filter(schemaName => schemaName !== 'DpmManifestPolicy')

    for (const schemaName of schemaNames) {
      const schema = compileGatewayComponentSchema(schemaName)
      expect(schema({}), `${schemaName} unexpectedly accepted an empty object`).toBe(false)
    }
  })

  it('rejects incomplete request payloads for gateway write operations', () => {
    for (const schemaName of [
      'DpmCatalogProfileRequest',
      'DpmRelationshipDiscoveryRequest',
      'DpmCandidateImportRequest',
      'DpmRelationshipApprovalRequest',
      'DpmManifestValidationRequest',
      'DpmManifestCompileRequest',
      'DpmManifestDryRunRequest',
      'DpmExecuteJobRequest',
    ]) {
      const schema = compileGatewayComponentSchema(schemaName)
      expect(schema({}), `${schemaName} unexpectedly accepted an empty object`).toBe(false)
    }
  })

  it('accepts minimal request payloads for gateway write operations', () => {
    const snapshotRef = { ref: 'catalog://commerce/v1', versionHash: 'sha256:test' }
    const manifest = { dpm_version: '1.0' }
    const cases: Array<[string, Record<string, unknown>]> = [
      ['DpmCatalogProfileRequest', { datasetId: 'commerce_ai', catalogSourceRef: 'source://catalog', manifest }],
      ['DpmRelationshipDiscoveryRequest', { manifest, catalogSnapshot: snapshotRef }],
      ['DpmCandidateImportRequest', { datasetId: 'commerce_ai', candidates: [{ name: 'rel_orders_customer', evidenceRef: 'evidence://rel' }] }],
      ['DpmRelationshipApprovalRequest', { owner: 'privacy', approvedBy: 'reviewer', reason: 'reviewed' }],
      ['DpmManifestValidationRequest', { manifest, catalogSnapshot: snapshotRef, registrySnapshot: snapshotRef }],
      ['DpmManifestCompileRequest', { manifest, catalogSnapshot: snapshotRef, registrySnapshot: snapshotRef }],
      ['DpmManifestDryRunRequest', { manifest, catalogSnapshot: snapshotRef, registrySnapshot: snapshotRef }],
      ['DpmExecuteJobRequest', { planRef: 'compiled-plan://commerce', targetDatasetRef: 'target://ai' }],
    ]

    for (const [schemaName, payload] of cases) {
      const schema = compileGatewayComponentSchema(schemaName)
      expect(schema(payload), JSON.stringify(schema.errors, null, 2)).toBe(true)
    }
  })

  it('rejects incomplete response payloads for gateway workflow schemas', () => {
    for (const schemaName of [
      'DpmCatalogProfileResponse',
      'DpmRelationshipDiscoveryReport',
      'DpmCandidateImportResponse',
      'DpmRelationshipApprovalResponse',
      'DpmRegistrySnapshotResponse',
      'DpmExecuteJobResponse',
      'DpmJobReport',
    ]) {
      const schema = compileGatewayComponentSchema(schemaName)
      expect(schema({}), `${schemaName} unexpectedly accepted an empty object`).toBe(false)
    }
  })

  it('accepts minimal response payloads for gateway workflow schemas', () => {
    const diagnostic = {
      severity: 'info',
      code: 'SAF007',
      message: 'ok',
      sourcePointer: '/quality_gates',
    }
    const cases: Array<[string, Record<string, unknown>]> = [
      ['DpmCatalogProfileResponse', {
        catalogSnapshotRef: 'catalog://commerce/v1',
        catalogVersionHash: 'sha256:test',
        diagnostics: [diagnostic],
      }],
      ['DpmRelationshipDiscoveryReport', {
        reportRef: 'report://discovery',
        candidates: [{ name: 'rel_orders_customer', recommendation: 'review' }],
      }],
      ['DpmCandidateImportResponse', { imported: 1, rejected: 0 }],
      ['DpmRelationshipApprovalResponse', { relationshipName: 'rel_orders_customer', status: 'approved' }],
      ['DpmRegistrySnapshotResponse', {
        datasetId: 'commerce_ai',
        registryVersion: 'reg-2026-07-01',
        relationships: [{ name: 'rel_orders_customer', status: 'approved' }],
      }],
      ['DpmExecuteJobResponse', { jobId: 'job_001', status: 'accepted' }],
      ['DpmJobReport', {
        jobId: 'job_001',
        status: 'completed',
        validationReportRef: 'dpm-report:job_001',
        diagnostics: [],
      }],
    ]

    for (const [schemaName, payload] of cases) {
      const schema = compileGatewayComponentSchema(schemaName)
      expect(schema(payload), JSON.stringify(schema.errors, null, 2)).toBe(true)
    }
  })

  it('rejects job report statuses outside the persisted validation report lifecycle', () => {
    const schema = compileGatewayComponentSchema('DpmJobReport')

    expect(schema({
      jobId: 'job_001',
      status: 'accepted',
      validationReportRef: 'dpm-report:job_001',
      diagnostics: [],
    }), 'DpmJobReport unexpectedly accepted a pre-report job status').toBe(false)
    expect(schema({
      jobId: 'job_001',
      status: 'failed',
      validationReportRef: 'dpm-report:job_001',
      diagnostics: [],
    }), JSON.stringify(schema.errors, null, 2)).toBe(true)
  })
})
