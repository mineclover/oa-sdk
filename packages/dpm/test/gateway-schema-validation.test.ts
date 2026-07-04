import { describe, expect, it } from 'vitest'

import { getDpmGatewayOpenApiDocument } from '../src/index.js'
import { profileAnalysisReport, profileArtifact, profileCoordinate, relationshipHint } from './support/gateway-fixtures.js'
import { compileGatewayComponentSchema } from './support/gateway-schema.js'

describe('DPM gateway component schema validation', () => {
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
      'DpmProfileInspectionRequest',
      'DpmProfileAnalysisRequest',
      'DpmProfileProposalReviewRequest',
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
      ['DpmProfileInspectionRequest', { profileArtifact }],
      ['DpmProfileAnalysisRequest', { profileArtifact }],
      ['DpmProfileProposalReviewRequest', {
        status: 'accepted',
        reviewedBy: 'privacy-reviewer',
        reason: 'reviewed against catalog evidence',
        coordinate: profileCoordinate,
        relationshipHint,
      }],
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

  it('rejects incomplete profile analysis payloads and editor evidence mutation patches', () => {
    const analysisRequestSchema = compileGatewayComponentSchema('DpmProfileAnalysisRequest')
    const analysisResponseSchema = compileGatewayComponentSchema('DpmProfileAnalysisResponse')
    const reviewRequestSchema = compileGatewayComponentSchema('DpmProfileProposalReviewRequest')

    expect(analysisRequestSchema({
      profileArtifact: {},
    }), 'DpmProfileAnalysisRequest unexpectedly accepted an incomplete profile artifact').toBe(false)
    expect(analysisResponseSchema({
      analysisReport: {
        kind: 'dpm.profile.analysis-report.v1',
        reportId: 'profile-analysis:orders.created',
      },
    }), 'DpmProfileAnalysisResponse unexpectedly accepted an incomplete analysis report').toBe(false)
    expect(reviewRequestSchema({
      proposalId: relationshipHint.id,
      status: 'accepted',
      reviewedBy: 'privacy-reviewer',
      reason: 'reviewed against catalog evidence',
      rawPatch: { evidenceSources: {} },
    }), 'DpmProfileProposalReviewRequest unexpectedly accepted a raw evidence patch').toBe(false)
    expect(reviewRequestSchema({
      proposalId: relationshipHint.id,
      status: 'accepted',
      reviewedBy: 'privacy-reviewer',
      reason: 'reviewed against catalog evidence',
      profileArtifact,
    }), 'DpmProfileProposalReviewRequest unexpectedly accepted a profile artifact overwrite').toBe(false)
    expect(reviewRequestSchema({
      proposalId: relationshipHint.id,
      status: 'review',
      reviewedBy: 'privacy-reviewer',
      reason: 'reviewed against catalog evidence',
    }), 'DpmProfileProposalReviewRequest unexpectedly accepted the pre-decision relationship hint status').toBe(false)
    expect(reviewRequestSchema({
      proposalId: relationshipHint.id,
      status: 'accepted',
      reviewedBy: 'privacy-reviewer',
      reason: 'reviewed against catalog evidence',
      coordinate: profileCoordinate,
      relationshipHint,
    }), 'DpmProfileProposalReviewRequest unexpectedly accepted a duplicate body proposal id').toBe(false)
  })
})
