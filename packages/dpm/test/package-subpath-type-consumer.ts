import {
  DPM_PACKAGE_NAME,
  type DpmVersion,
} from '@oa-sdk/dpm/package'
import {
  computeCatalogFreshnessHash,
  type CatalogSnapshot,
} from '@oa-sdk/dpm/catalog'
import {
  createDpmRelationshipCandidateInputFromResolvedProfileHint,
  createDpmRelationshipCandidateInputFromProfileHint,
  computeDpmProfileAnalysisPolicyHash,
  DEFAULT_DPM_PROFILE_ANALYSIS_POLICY,
  DPM_PROFILE_ARTIFACT_KIND,
  resolveDpmRelationshipCandidateEndpointsFromProfileHint,
  resolveDpmProfileAnalysisPolicy,
  type DpmProfileArtifact,
  type DpmProfileAnalysisPolicy,
  type DpmProfileRelationshipEndpointResolution,
  type DpmProfileRelationshipEndpointResolverInput,
  type DpmProfileRelationshipCandidateBridgeInput,
  type DpmProfileResolvedRelationshipCandidateBridgeInput,
} from '@oa-sdk/dpm/profile'
import {
  REGISTRY_RELATIONSHIP_STATUSES,
  type ApprovedRegistryApprovalMetadata,
  type ApprovedRegistryRelationshipInput,
  type RegistryRelationshipStatus,
} from '@oa-sdk/dpm/relationship'
import {
  DPM_GATEWAY_RUNTIME_OPERATION_IDS,
  approveDpmProfileRelationshipHintRuntime,
  createDpmGatewayRuntime,
  getDpmGatewayOpenApiDocument,
  listDpmRegistryRelationshipAuditEventsRuntime,
  type DpmGatewayProfileRelationshipHintApprovalRequest,
  type DpmGatewayProfileRelationshipHintApprovalBlockingResult,
  type DpmGatewayRegistryAuditEventListInput,
  type DpmGatewayRegistryAuditEventListResult,
  type DpmGatewayProfileRelationshipHintApprovalInput,
  type DpmGatewayProfileRelationshipHintApprovalSuccessResult,
  type DpmGatewayRuntime,
} from '@oa-sdk/dpm/gateway'
import {
  createDpmRegistryRelationshipRow,
  DPM_REGISTRY_RELATIONSHIP_AUDIT_EVENT_TYPES,
  DPM_PROFILE_BASELINE_SELECTION_STRATEGIES,
  type DpmRegistryAuditEventReader,
  type DpmRegistryRelationshipAuditEventRow,
  type DpmRegistryRelationshipSaveInput,
  type DpmRegistryWritableRepository,
  type DpmProfileBaselineSummary,
} from '@oa-sdk/dpm/storage'
import {
  DPM_PUBLISHING_CONTEXT_KIND,
  type DpmPublishingContext,
} from '@oa-sdk/dpm/publishing'

type DpmSubpathTypeSmoke = {
  catalog?: CatalogSnapshot
  profile?: DpmProfileArtifact
  profileAnalysisPolicy?: DpmProfileAnalysisPolicy
  profileRelationshipEndpointResolution?: DpmProfileRelationshipEndpointResolution
  profileRelationshipEndpointResolver?: DpmProfileRelationshipEndpointResolverInput
  profileRelationshipCandidateBridge?: DpmProfileRelationshipCandidateBridgeInput
  resolvedProfileRelationshipCandidateBridge?: DpmProfileResolvedRelationshipCandidateBridgeInput
  profileRelationshipHintApproval?: DpmGatewayProfileRelationshipHintApprovalInput
  profileRelationshipHintApprovalRequest?: DpmGatewayProfileRelationshipHintApprovalRequest
  profileRelationshipHintApprovalSuccess?: DpmGatewayProfileRelationshipHintApprovalSuccessResult
  profileRelationshipHintApprovalBlocking?: DpmGatewayProfileRelationshipHintApprovalBlockingResult
  registryAuditEventList?: DpmGatewayRegistryAuditEventListInput
  registryAuditEventListResult?: DpmGatewayRegistryAuditEventListResult
  baseline?: DpmProfileBaselineSummary
  registryAuditEvent?: DpmRegistryRelationshipAuditEventRow
  registryAuditEventReader?: DpmRegistryAuditEventReader
  registryRelationshipSave?: DpmRegistryRelationshipSaveInput
  approvedRegistryApproval?: ApprovedRegistryApprovalMetadata
  approvedRegistryRelationship?: ApprovedRegistryRelationshipInput
  registryRepository?: DpmRegistryWritableRepository
  publishing?: DpmPublishingContext
}

const packageName: '@oa-sdk/dpm' = DPM_PACKAGE_NAME
const manifestVersion: DpmVersion = '1.0'
const gatewayRuntime: DpmGatewayRuntime = createDpmGatewayRuntime()
const registryStatus: RegistryRelationshipStatus = REGISTRY_RELATIONSHIP_STATUSES[0]
const typeSmoke: DpmSubpathTypeSmoke = {}

void [
  packageName,
  manifestVersion,
  gatewayRuntime,
  registryStatus,
  getDpmGatewayOpenApiDocument().paths,
  DPM_GATEWAY_RUNTIME_OPERATION_IDS,
  DPM_PROFILE_ARTIFACT_KIND,
  DEFAULT_DPM_PROFILE_ANALYSIS_POLICY,
  DPM_PROFILE_BASELINE_SELECTION_STRATEGIES,
  DPM_PUBLISHING_CONTEXT_KIND,
  computeCatalogFreshnessHash,
  createDpmRelationshipCandidateInputFromResolvedProfileHint,
  createDpmRelationshipCandidateInputFromProfileHint,
  computeDpmProfileAnalysisPolicyHash,
  resolveDpmRelationshipCandidateEndpointsFromProfileHint,
  resolveDpmProfileAnalysisPolicy,
  approveDpmProfileRelationshipHintRuntime,
  listDpmRegistryRelationshipAuditEventsRuntime,
  DPM_REGISTRY_RELATIONSHIP_AUDIT_EVENT_TYPES,
  createDpmRegistryRelationshipRow,
  typeSmoke,
]
