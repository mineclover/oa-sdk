import {
  profileAnalysisReport,
  profileArtifact,
  profileCoordinate,
  relationshipHint,
} from './gateway-profile-fixtures.js'

export const GATEWAY_WORKFLOW_RESPONSE_SCHEMA_NAMES = [
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
] as const

export type GatewayWorkflowResponseSchemaName =
  typeof GATEWAY_WORKFLOW_RESPONSE_SCHEMA_NAMES[number]

const gatewayDiagnostic = {
  severity: 'info',
  code: 'SAF007',
  message: 'ok',
  sourcePointer: '/quality_gates',
}

export const gatewayMinimalResponseCases: ReadonlyArray<
  readonly [GatewayWorkflowResponseSchemaName, Record<string, unknown>]
> = [
  ['DpmCatalogProfileResponse', {
    catalogSnapshotRef: 'catalog://commerce/v1',
    catalogVersionHash: 'sha256:test',
    diagnostics: [gatewayDiagnostic],
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
  ['DpmRelationshipApprovalResponse', {
    relationshipName: 'rel_orders_customer',
    status: 'approved',
  }],
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

export const gatewayInvalidResponseTaxonomyCases: ReadonlyArray<
  readonly [GatewayWorkflowResponseSchemaName, Record<string, unknown>, string]
> = [
  ['DpmRelationshipDiscoveryReport', {
    reportRef: 'report://discovery',
    candidates: [{ name: 'rel_orders_customer', recommendation: 'auto_approve' }],
  }, 'unknown recommendation'],
  ['DpmRegistrySnapshotResponse', {
    datasetId: 'commerce_ai',
    registryVersion: 'reg-2026-07-01',
    relationships: [{ name: 'rel_orders_customer', status: 'unknown_status' }],
  }, 'unknown relationship status'],
]

export const gatewayJobReportLifecycleStatusCases = [
  ['pre-report job status', 'accepted', false],
  ['persisted failure status', 'failed', true],
] as const
