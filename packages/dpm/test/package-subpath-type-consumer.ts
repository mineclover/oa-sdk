import {
  DPM_PACKAGE_NAME,
  type DpmVersion,
} from '@oa-sdk/dpm/package'
import {
  computeCatalogFreshnessHash,
  type CatalogSnapshot,
} from '@oa-sdk/dpm/catalog'
import {
  createDpmRelationshipCandidateInputFromProfileHint,
  computeDpmProfileAnalysisPolicyHash,
  DEFAULT_DPM_PROFILE_ANALYSIS_POLICY,
  DPM_PROFILE_ARTIFACT_KIND,
  resolveDpmProfileAnalysisPolicy,
  type DpmProfileArtifact,
  type DpmProfileAnalysisPolicy,
  type DpmProfileRelationshipCandidateBridgeInput,
} from '@oa-sdk/dpm/profile'
import {
  REGISTRY_RELATIONSHIP_STATUSES,
  type ApprovedRegistryApprovalMetadata,
  type ApprovedRegistryRelationshipInput,
  type RegistryRelationshipStatus,
} from '@oa-sdk/dpm/relationship'
import {
  DPM_GATEWAY_RUNTIME_OPERATION_IDS,
  createDpmGatewayRuntime,
  getDpmGatewayOpenApiDocument,
  type DpmGatewayRuntime,
} from '@oa-sdk/dpm/gateway'
import {
  createDpmRegistryRelationshipRow,
  DPM_PROFILE_BASELINE_SELECTION_STRATEGIES,
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
  profileRelationshipCandidateBridge?: DpmProfileRelationshipCandidateBridgeInput
  baseline?: DpmProfileBaselineSummary
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
  createDpmRelationshipCandidateInputFromProfileHint,
  computeDpmProfileAnalysisPolicyHash,
  resolveDpmProfileAnalysisPolicy,
  createDpmRegistryRelationshipRow,
  typeSmoke,
]
