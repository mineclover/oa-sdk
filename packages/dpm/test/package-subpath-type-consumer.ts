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
  DPM_KAFKA_TOPIC_PROFILE_CAPTURE_MODES,
  DPM_KAFKA_TOPIC_PROFILE_CONNECTOR_ID,
  DPM_PROFILE_ARTIFACT_KIND,
  resolveDpmRelationshipCandidateEndpointsFromProfileHint,
  resolveDpmProfileAnalysisPolicy,
  profileKafkaTopic,
  type DpmProfileArtifact,
  type DpmProfileAnalysisPolicy,
  type DpmProfileRelationshipEndpointResolution,
  type DpmProfileRelationshipEndpointResolverInput,
  type DpmProfileRelationshipCandidateBridgeInput,
  type DpmProfileResolvedRelationshipCandidateBridgeInput,
  type DpmKafkaTopicProfileInput,
  type DpmKafkaTopicProfileCaptureMode,
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
  type DpmGatewayRegistryRelationshipWriteReceipt,
  type DpmGatewayRuntime,
} from '@oa-sdk/dpm/gateway'
import {
  appendDpmPostgresRegistryRelationshipAuditEvent,
  applyDpmRegistryStorageSchema,
  commitDpmPostgresRegistryRelationshipApproval,
  createDpmPostgresRegistryStorage,
  createDpmRegistryRelationshipRow,
  DPM_REGISTRY_STORAGE_SCHEMA_SQL_BLOCKS,
  DPM_REGISTRY_RELATIONSHIP_AUDIT_EVENT_TYPES,
  DPM_PROFILE_BASELINE_SELECTION_STRATEGIES,
  listDpmPostgresRegistryRelationshipAuditEvents,
  listDpmPostgresRegistryRelationshipRows,
  upsertDpmPostgresRegistryRelationshipRow,
  type DpmPostgresRegistryClient,
  type DpmPostgresRegistryQueryClient,
  type DpmRegistryAuditEventReader,
  type DpmRegistryStorageSchemaApplyResult,
  type DpmRegistryStorageSchemaQueryClient,
  type DpmRegistryRelationshipApprovalCommitInput,
  type DpmRegistryRelationshipApprovalCommitResult,
  type DpmRegistryRelationshipAuditEventRow,
  type DpmRegistryRelationshipSaveInput,
  type DpmRegistryRelationshipSaveResult,
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
  kafkaTopicProfile?: DpmKafkaTopicProfileInput
  kafkaTopicProfileCaptureMode?: DpmKafkaTopicProfileCaptureMode
  profileRelationshipHintApproval?: DpmGatewayProfileRelationshipHintApprovalInput
  profileRelationshipHintApprovalRequest?: DpmGatewayProfileRelationshipHintApprovalRequest
  profileRelationshipHintApprovalSuccess?: DpmGatewayProfileRelationshipHintApprovalSuccessResult
  profileRelationshipHintApprovalBlocking?: DpmGatewayProfileRelationshipHintApprovalBlockingResult
  registryRelationshipWriteReceipt?: DpmGatewayRegistryRelationshipWriteReceipt
  registryAuditEventList?: DpmGatewayRegistryAuditEventListInput
  registryAuditEventListResult?: DpmGatewayRegistryAuditEventListResult
  baseline?: DpmProfileBaselineSummary
  registryAuditEvent?: DpmRegistryRelationshipAuditEventRow
  registryAuditEventReader?: DpmRegistryAuditEventReader
  registryStorageSchemaClient?: DpmRegistryStorageSchemaQueryClient
  registryStorageSchemaApplyResult?: DpmRegistryStorageSchemaApplyResult
  postgresRegistryClient?: DpmPostgresRegistryClient
  postgresRegistryQueryClient?: DpmPostgresRegistryQueryClient
  registryRelationshipApprovalCommitInput?: DpmRegistryRelationshipApprovalCommitInput
  registryRelationshipApprovalCommitResult?: DpmRegistryRelationshipApprovalCommitResult
  registryRelationshipSave?: DpmRegistryRelationshipSaveInput
  registryRelationshipSaveResult?: DpmRegistryRelationshipSaveResult
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
  DPM_KAFKA_TOPIC_PROFILE_CAPTURE_MODES,
  DPM_KAFKA_TOPIC_PROFILE_CONNECTOR_ID,
  DEFAULT_DPM_PROFILE_ANALYSIS_POLICY,
  profileKafkaTopic,
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
  DPM_REGISTRY_STORAGE_SCHEMA_SQL_BLOCKS,
  applyDpmRegistryStorageSchema,
  DPM_REGISTRY_RELATIONSHIP_AUDIT_EVENT_TYPES,
  createDpmRegistryRelationshipRow,
  createDpmPostgresRegistryStorage,
  listDpmPostgresRegistryRelationshipRows,
  upsertDpmPostgresRegistryRelationshipRow,
  commitDpmPostgresRegistryRelationshipApproval,
  appendDpmPostgresRegistryRelationshipAuditEvent,
  listDpmPostgresRegistryRelationshipAuditEvents,
  typeSmoke,
]
