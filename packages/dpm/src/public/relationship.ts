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
} from '../discovery/types.js'
export type {
  RegistryApprovalMetadata,
  RegistryConditionMetadata,
  RegistryEvidence,
  RegistryOrphanPolicy,
  RegistryRelationship,
  RegistryRelationshipInput,
  RegistryRelationshipKind,
  RegistryRelationshipStatus,
  RegistrySnapshot,
  RegistrySnapshotInput,
  RegistryTransformStrategy,
} from '../registry/types.js'
export type {
  CanonicalKeyValue,
  CanonicalKeyValueMap,
  TenantNamespaceInput,
} from '../model/canonical-key.js'
export type {
  ModelEndpoint,
} from '../model/endpoint.js'
export type {
  EntityDeclaration,
  EntityDeclarationInput,
  EntityKeyStrategy,
  EntityKeyStrategyType,
  EntityTransform,
} from '../model/entity.js'
export type {
  LogicalRelationship,
  LogicalRelationshipCardinality,
  LogicalRelationshipCondition,
  LogicalRelationshipInput,
  LogicalRelationshipKind,
  LogicalRelationshipOrphanPolicy,
  RelationshipCanonicalKeyStrategy,
  TemporalRelationshipInput,
} from '../model/relationship-types.js'
export type {
  DpmCatalogCoordinate,
  DpmDiagnostic,
  DpmDiagnosticCode,
  DpmDiagnosticSeverity,
  DpmRegistryCoordinate,
  DpmValidationResult,
  DpmValidationSummary,
} from '../validator/diagnostics.js'
export type {
  DpmValidationInput,
  DpmValidationPhase,
} from '../validator/validation-types.js'
export type {
  DpmColumnStep,
  DpmCompiledPlan,
  DpmCompiledPlanVersion,
  DpmNamespaceBinding,
  DpmPlanFreshness,
  DpmPlanStaleReason,
  DpmRelationshipStep,
  DpmRelationshipStepCardinality,
} from '../compiler/plan.js'
export type {
  DpmCompileFailure,
  DpmCompileInput,
  DpmCompileResult,
  DpmCompileSuccess,
} from '../compiler/compile.js'
export type {
  DpmDryRunCategory,
  DpmDryRunImpact,
  DpmDryRunInput,
  DpmDryRunReport,
} from '../dry-run/report.js'
export {
  DISCOVERY_CANDIDATE_RECOMMENDATIONS,
  DISCOVERY_CONFIDENCE_LEVELS,
} from '../discovery/types.js'
export {
  DISCOVERY_REPORT_KIND,
  classifyRelationshipCandidate,
  createRelationshipDiscoveryReport,
} from '../discovery/report.js'
export {
  REGISTRY_ORPHAN_POLICIES,
  REGISTRY_RELATIONSHIP_KINDS,
  REGISTRY_RELATIONSHIP_STATUSES,
  REGISTRY_TRANSFORM_STRATEGIES,
} from '../registry/types.js'
export {
  REGISTRY_SNAPSHOT_KIND,
  createRegistrySnapshot,
  isExecutableRegistryRelationship,
  parseRegistrySnapshotYaml,
  selectApprovedRelationships,
} from '../registry/snapshot.js'
export {
  createEntityDeclaration,
  renderEntityCanonicalKey,
} from '../model/entity.js'
export {
  createLogicalRelationship,
} from '../model/relationship-normalize.js'
export {
  renderRelationshipCanonicalKey,
} from '../model/relationship-canonical-key.js'
export {
  DPM_COMPILED_PLAN_KIND,
  DPM_COMPILED_PLAN_VERSIONS,
  DPM_PLAN_STALE_REASONS,
  DPM_RELATIONSHIP_STEP_CARDINALITIES,
  createPlanFreshness,
} from '../compiler/plan.js'
export { compileDpmPlan } from '../compiler/compile.js'
export {
  DPM_DRY_RUN_REPORT_KIND,
  createDpmDryRunReport,
} from '../dry-run/report.js'
export { validateDpmManifest } from '../validator/manifest.js'
export {
  DPM_DIAGNOSTIC_CODES,
} from '../validator/diagnostics.js'
