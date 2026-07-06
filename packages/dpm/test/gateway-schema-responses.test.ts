import { describe, expect, it } from 'vitest'

import { profileAnalysisReport, profileArtifact, profileCoordinate, relationshipHint } from './support/gateway-fixtures.js'
import { compileGatewayComponentSchema } from './support/gateway-schema.js'

describe('DPM gateway response schemas', () => {
  it('rejects incomplete response payloads for gateway workflow schemas', () => {
    for (const schemaName of [
      'DpmCatalogProfileResponse',
      'DpmProfileInspectionResponse',
      'DpmProfileAnalysisResponse',
      'DpmProfileProposalReviewResponse',
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
      ['DpmProfileInspectionResponse', {
        profileArtifact,
        nodeCount: 1,
        edgeCount: 0,
        metricCount: 0,
        diagnostics: [],
      }],
      ['DpmProfileAnalysisResponse', {
        analysisReport: profileAnalysisReport,
      }],
      ['DpmProfileProposalReviewResponse', {
        proposalId: relationshipHint.id,
        status: 'accepted',
        reviewedBy: 'privacy-reviewer',
        reason: 'reviewed against catalog evidence',
        coordinate: profileCoordinate,
        relationshipHint,
        diagnostics: [],
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

  it('rejects workflow response taxonomy values outside DPM review and registry contracts', () => {
    const discoverySchema = compileGatewayComponentSchema('DpmRelationshipDiscoveryReport')
    const registrySchema = compileGatewayComponentSchema('DpmRegistrySnapshotResponse')

    expect(discoverySchema({
      reportRef: 'report://discovery',
      candidates: [{ name: 'rel_orders_customer', recommendation: 'auto_approve' }],
    }), 'DpmRelationshipDiscoveryReport unexpectedly accepted an unknown recommendation').toBe(false)
    expect(registrySchema({
      datasetId: 'commerce_ai',
      registryVersion: 'reg-2026-07-01',
      relationships: [{ name: 'rel_orders_customer', status: 'unknown_status' }],
    }), 'DpmRegistrySnapshotResponse unexpectedly accepted an unknown relationship status').toBe(false)
  })
})
