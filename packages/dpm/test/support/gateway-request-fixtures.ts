import {
  profileArtifact,
  profileCoordinate,
  relationshipHint,
} from './gateway-profile-fixtures.js'

export const GATEWAY_WRITE_REQUEST_SCHEMA_NAMES = [
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
] as const

export type GatewayWriteRequestSchemaName =
  typeof GATEWAY_WRITE_REQUEST_SCHEMA_NAMES[number]

const snapshotRef = { ref: 'catalog://commerce/v1', versionHash: 'sha256:test' }
const manifest = { dpm_version: '1.0' }

export const gatewayMinimalRequestCases: ReadonlyArray<
  readonly [GatewayWriteRequestSchemaName, Record<string, unknown>]
> = [
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
  ['DpmCandidateImportRequest', {
    datasetId: 'commerce_ai',
    candidates: [{ name: 'rel_orders_customer', evidenceRef: 'evidence://rel' }],
  }],
  ['DpmRelationshipApprovalRequest', { owner: 'privacy', approvedBy: 'reviewer', reason: 'reviewed' }],
  ['DpmManifestValidationRequest', { manifest, catalogSnapshot: snapshotRef, registrySnapshot: snapshotRef }],
  ['DpmManifestCompileRequest', { manifest, catalogSnapshot: snapshotRef, registrySnapshot: snapshotRef }],
  ['DpmManifestDryRunRequest', { manifest, catalogSnapshot: snapshotRef, registrySnapshot: snapshotRef }],
  ['DpmExecuteJobRequest', { planRef: 'compiled-plan://commerce', targetDatasetRef: 'target://ai' }],
]
