import { describe, expect, it } from 'vitest'

import { profileAnalysisReport, profileArtifact, profileCoordinate, relationshipHint } from './support/gateway-fixtures.js'
import { compileGatewayComponentSchema } from './support/gateway-schema.js'

describe('DPM gateway minimal response schemas', () => {
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
})
