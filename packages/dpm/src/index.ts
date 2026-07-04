export type { DpmBaseline, DpmPackageMetadata, DpmVersion } from './types.js'
export type {
  DpmManifestSchemaIssue,
  DpmManifestSchemaValidationResult,
} from './schema/index.js'
export type {
  CatalogColumn,
  CatalogDiagnostic,
  CatalogForeignKey,
  CatalogFreshness,
  CatalogIndex,
  CatalogPrimaryKey,
  CatalogSchema,
  CatalogSnapshot,
  CatalogSnapshotInput,
  CatalogSnapshotSource,
  CatalogTable,
  CatalogUniqueCandidate,
  PostgresCatalogSnapshotInput,
} from './catalog/types.js'
export type {
  PostgresCatalogProfileRecordKind,
  PostgresCatalogProfileRow,
  PostgresCatalogProfilerClient,
  PostgresCatalogProfilerInput,
  PostgresCatalogRowsToSnapshotInput,
} from './catalog/profiler-postgres.js'
export type {
  DiscoveryCandidateRecommendation,
  DiscoveryConfidenceLevel,
  DiscoveryEvidence,
  DiscoveryEvidenceKind,
  DiscoveryThresholds,
  ExcludedRelationshipCandidate,
  RelationshipCandidate,
  RelationshipCandidateInput,
  RelationshipDiscoveryReport,
  RelationshipDiscoveryReportInput,
} from './discovery/types.js'
export type {
  RegistryApprovalMetadata,
  RegistryConditionMetadata,
  RegistryEvidence,
  RegistryRelationship,
  RegistryRelationshipInput,
  RegistryRelationshipKind,
  RegistryRelationshipStatus,
  RegistrySnapshot,
  RegistrySnapshotInput,
  RegistryTransformStrategy,
} from './registry/types.js'
export type {
  CanonicalKeyValue,
  CanonicalKeyValueMap,
  EntityDeclaration,
  EntityDeclarationInput,
  EntityKeyStrategy,
  EntityKeyStrategyType,
  EntityTransform,
  ModelEndpoint,
  TenantNamespaceInput,
} from './model/entity.js'
export type {
  LogicalRelationship,
  LogicalRelationshipCardinality,
  LogicalRelationshipCondition,
  LogicalRelationshipInput,
  LogicalRelationshipKind,
  LogicalRelationshipOrphanPolicy,
  RelationshipCanonicalKeyStrategy,
  TemporalRelationshipInput,
} from './model/relationship.js'
export type {
  DpmCatalogCoordinate,
  DpmDiagnostic,
  DpmDiagnosticCode,
  DpmDiagnosticSeverity,
  DpmRegistryCoordinate,
  DpmValidationResult,
  DpmValidationSummary,
} from './validator/diagnostics.js'
export type {
  DpmValidationInput,
  DpmValidationPhase,
} from './validator/manifest.js'
export type {
  DpmColumnStep,
  DpmCompiledPlan,
  DpmCompiledPlanVersion,
  DpmNamespaceBinding,
  DpmPlanFreshness,
  DpmPlanStaleReason,
  DpmRelationshipStep,
} from './compiler/plan.js'
export type {
  DpmCompileFailure,
  DpmCompileInput,
  DpmCompileResult,
  DpmCompileSuccess,
} from './compiler/compile.js'
export type {
  DpmDryRunCategory,
  DpmDryRunImpact,
  DpmDryRunInput,
  DpmDryRunReport,
} from './dry-run/report.js'
export type {
  DpmGatewayOpenApiDocument,
  DpmGatewayOperationId,
} from './gateway/openapi.js'
export type {
  DpmGatewayRuntime,
  DpmGatewayRuntimeBody,
  DpmGatewayRuntimeCommand,
  DpmGatewayRuntimeManifestInput,
  DpmGatewayRuntimeOperationId,
  DpmGatewayRuntimeResponse,
  DpmGatewayRuntimeStatusCode,
} from './gateway/runtime.js'
export type {
  DpmJobOperation,
  DpmJobRepository,
  DpmJobRequest,
  DpmJobRow,
  DpmJobSaveInput,
  DpmJobStatus,
  DpmJobStorage,
} from './storage/job-repository.js'
export type {
  DpmGatewayJobReport,
  DpmReportRepository,
  DpmStoredValidationReport,
  DpmValidationReportRequest,
  DpmValidationReportSaveInput,
  DpmValidationReportStatus,
  DpmValidationReportStorage,
} from './storage/report-repository.js'
export type {
  DpmRegistryRelationshipRow,
  DpmRegistryRelationshipRowRequest,
  DpmRegistryRepository,
  DpmRegistryRowsToSnapshotInput,
  DpmRegistrySnapshotExportRequest,
  DpmRegistryStorageReader,
} from './storage/registry-repository.js'
export type {
  DpmAiRelationshipContext,
  DpmAiSchemaContext,
  DpmPhysicalForeignKeyRecommendation,
  DpmPublishingContext,
  DpmPublishingContextInput,
  DpmRelationshipMetadata,
} from './publishing/context.js'
export {
  computeCatalogFreshnessHash,
  normalizeCatalogSnapshot,
} from './catalog/types.js'
export { createPostgresCatalogSnapshot } from './catalog/postgres.js'
export { catalogSnapshotFromOpenApiProjection } from './catalog/projection.js'
export {
  POSTGRES_CATALOG_PROFILE_SQL,
  postgresCatalogRowsToSnapshot,
  profilePostgresCatalog,
} from './catalog/profiler-postgres.js'
export {
  DISCOVERY_REPORT_KIND,
  classifyRelationshipCandidate,
  createRelationshipDiscoveryReport,
} from './discovery/report.js'
export {
  REGISTRY_SNAPSHOT_KIND,
  createRegistrySnapshot,
  isExecutableRegistryRelationship,
  parseRegistrySnapshotYaml,
  selectApprovedRelationships,
} from './registry/snapshot.js'
export {
  createEntityDeclaration,
  renderEntityCanonicalKey,
} from './model/entity.js'
export {
  createLogicalRelationship,
  renderRelationshipCanonicalKey,
} from './model/relationship.js'
export {
  DPM_COMPILED_PLAN_KIND,
  DPM_COMPILED_PLAN_VERSIONS,
  DPM_PLAN_STALE_REASONS,
  createPlanFreshness,
} from './compiler/plan.js'
export { compileDpmPlan } from './compiler/compile.js'
export {
  DPM_DRY_RUN_REPORT_KIND,
  createDpmDryRunReport,
} from './dry-run/report.js'
export {
  DPM_GATEWAY_OPERATION_IDS,
  getDpmGatewayOpenApiDocument,
} from './gateway/openapi.js'
export {
  DPM_GATEWAY_RUNTIME_OPERATION_IDS,
  createDpmGatewayRuntime,
} from './gateway/runtime.js'
export {
  DPM_REGISTRY_STORAGE_SCHEMA_SQL,
  DPM_REGISTRY_STORAGE_SCHEMA_VERSION,
} from './storage/registry-schema.js'
export {
  DPM_JOB_KIND,
  createDpmJobRepository,
  createDpmJobRow,
} from './storage/job-repository.js'
export {
  DPM_VALIDATION_REPORT_KIND,
  createDpmReportRepository,
  createDpmValidationReport,
  validationReportToGatewayJobReport,
} from './storage/report-repository.js'
export {
  createDpmRegistryRepository,
  registryRowsToSnapshot,
} from './storage/registry-repository.js'
export {
  DPM_PUBLISHING_CONTEXT_KIND,
  createDpmPublishingContext,
} from './publishing/context.js'
export { validateDpmManifest } from './validator/manifest.js'
export {
  DPM_DIAGNOSTIC_CODES,
} from './validator/diagnostics.js'
export {
  DPM_MANIFEST_SCHEMA_ID,
  validateDpmManifestSchema,
} from './schema/index.js'

export const DPM_PACKAGE_NAME = '@oa-sdk/dpm' as const
export const DPM_BASELINE = 'relationship-first' as const
export const DPM_VERSION = '1.0' as const
