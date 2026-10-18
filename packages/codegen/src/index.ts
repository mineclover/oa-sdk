/**
 * @oa-sdk/codegen
 *
 * Zod 스키마 → OpenAPI 3.2 component YAML 생성 라이브러리.
 *
 * 변환 파이프라인:
 *   Zod Schema → OasSchema → components.yaml
 *
 * Drizzle과 함께 사용 시:
 *   Drizzle Table → drizzle-orm/zod → Zod Schema → OpenAPI Component
 */

export { zodToSchema } from './zod-to-schema.js'
export { generateComponents } from './generator.js'
export {
  defineConfig,
  validateOaConfig,
  assertOaConfig,
  isOaConfig,
  OaConfigError,
  getArchetypeDefaults,
  resolveConfigWithDefaults,
  ARTIFACT_KINDS,
  artifactKindSchema,
  outputRoutingRuleSchema,
  byKindRoutingConfigSchema,
  outputRoutingConfigSchema,
} from './config.js'
export {
  toKebabCase,
  toCamelCase,
  toPascalCase,
  splitWords,
  sanitizePathPreserve,
  casingTransformers,
  extractGroupFromPath,
  resolvePathPattern,
  loadTsconfig,
  stripJsonComments,
  toPosixPath,
  formatExtension,
  matchTsconfigPathAlias,
  resolveImportSpecifier,
  DEFAULT_BANNER_MARKERS,
  OaManifestManager,
  matchesRoutingRule,
  dispatchArtifactPath,
  PathDispatcher,
  createPathDispatcher,
} from './routing/index.js'
export {
  loadOaConfig,
  resolveProfileTarget,
  resolveGuardTarget,
  CANDIDATE_CONFIG_FILES,
} from './cli/lib/config-loader.js'
export { findProjectRoot } from '@oa-sdk/core'
export type { FindProjectRootOptions } from '@oa-sdk/core'
export {
  stableStringify,
  computeSha256,
  computeVersionHash,
  stripSchemaEngineExtensions,
  projectTargetSpec,
  projectTargetGuards,
} from './spec-projector.js'
export {
  executeSchemaPipeline,
  formatTransparencyTable,
} from './schema-pipeline/index.js'
export type {
  SchemaPipelineRunOptions,
  SchemaPipelineTransparencyManifest,
  SchemaStage1ZodInfo,
  SchemaStage2JsonSchemaInfo,
  SchemaStage3OpenApiInfo,
  SchemaStage4GuardInfo,
} from './schema-pipeline/index.js'

export { analyzeExternalSchemaRefs, generateTypes, generateTypesFromSpec } from './typegen/generate-types.js'
export { createTypescriptAlgebra, schemaToTs } from './typegen/schema-to-ts.js'
export { analyzeSchemaFidelity, projectSchemaToTs } from './typegen/schema-fidelity.js'
export {
  createDynamicZodValidator,
  createRuntimeZodValidators,
  createZod4Algebra,
  generateZodFromSpec,
  normalizeOasForZodRuntime,
  prepareSchemaForZod,
  schemaToZod,
  ZodGenerationPreflightError,
} from './zodgen/index.js'
export { createMemoryWorkspaceIndex, createNoopWorkspaceIndex, createWorkspaceIndex } from './workspace-index.js'
export { createSQLiteWorkspaceIndex, SQLITE_WORKSPACE_INDEX_SCHEMA_VERSION } from './sqlite-workspace-index.js'
export { createMemoryTypeRegistry, createNoopTypeRegistry } from './type-registry.js'
export {
  createOpenApiCollectReport,
  normalizeOpenApiDocument,
  parseOpenApiCollectProfile,
  stringifyOpenApiYaml,
  upgradeOpenApiDocumentTo32,
} from './cli/lib/openapi-collect.js'
export { exportOpenApiToTypeSpec } from './cli/lib/tsp-export.js'
export {
  ARTIFACT_COMPATIBILITY_POLICY_SCHEMA_VERSION,
  OA_SDK_ARTIFACT_COMPATIBILITY_POLICY_V1,
  findArtifactCompatibility,
  supportsArtifactSchemaVersion,
} from './cli/lib/artifact-compatibility-policy.js'
export {
  REF_PROJECTION_SCHEMA_VERSION,
  createRefProjectionArtifact,
  serializeRefProjectionArtifact,
} from './cli/lib/ref-projection-artifact.js'
export {
  REF_PROJECTION_ARTIFACT_SCHEMA_V1,
  validateRefProjectionArtifact,
} from './cli/lib/ref-projection-artifact-schema.js'
export {
  CodegenSourceAdapterRegistry,
  adaptDrizzleTables,
  adaptOpenApiProjectionEnvelope,
  adaptPythonContractSpecSnapshot,
  adaptZodSchemas,
  createBuiltInCodegenSourceAdapterRegistry,
  drizzleTableSourceAdapter,
  openApiProjectionEnvelopeSourceAdapter,
  pythonContractSpecSnapshotSourceAdapter,
  zodSchemaSourceAdapter,
} from './cli/lib/source-adapters.js'
export {
  buildParallelEvidence,
  buildParallelEvidenceFromArtifacts,
  createParallelEvidenceMetricDelta,
  createParallelEvidenceMetrics,
  createParallelEvidenceReport,
  PARALLEL_EVIDENCE_METRICS_SCHEMA_VERSION,
  PARALLEL_EVIDENCE_REPORT_SCHEMA_VERSION,
  PARALLEL_EVIDENCE_SCHEMA_VERSION,
  parseParallelEvidenceMetrics,
  parseTtscContractProvenance,
  parseTypeSpecRefProvenance,
  ttscContractProvenanceAdapter,
} from './cli/lib/parallel-evidence.js'
export {
  createOpenApiGovernanceInterface,
  fingerprintGovernanceConfig,
  formatScaffoldResult,
  scaffoldOpenApiGovernance,
} from './cli/lib/openapi-governance-scaffold.js'
export {
  APITOMY_DATA_MODELS_PACKAGE,
  APITOMY_REFERENCE_ADAPTER_VERSION,
  ApitomyReferenceError,
  createApitomyReferenceAdapter,
  createApitomyReferenceAdapterFromModule,
  loadApitomyDataModels,
} from './apitomy/index.js'
export {
  applyTextEdits,
  computeEntitySpecDiff,
  createDeleteEdit,
  createInsertEdit,
  createReplaceEdit,
  syncEntitySpecWithCode,
  TsAstTypeAdapter,
  TypiaTypeAdapter,
  ZodTypeAdapter,
} from './ast-sync/index.js'
export { generateStandaloneGuards } from './standalone-guards/index.js'
export { auditShapeCommand } from './cli/commands/audit-shape.js'
export { auditShapeFiles } from './cli/lib/audit-shape-files.js'
export { traceCommand } from './cli/commands/trace.js'
export {
  SPEC_TRACEABILITY_SCHEMA_VERSION,
  DEFAULT_TRACE_SIDECAR_FILENAME,
  buildSpecTraceabilityGraph,
  toTypegenProvenanceMap,
  querySpecTrace,
  analyzeSpecImpact,
  serializeSpecTraceabilityGraph,
  saveSpecTraceabilitySidecar,
  loadSpecTraceabilitySidecar,
  formatSpecTraceabilityHumanReport,
} from './traceability/index.js'

export type { OasSchema } from './zod-to-schema.js'
export type {
  ArtifactCompatibilityEntry,
  ArtifactCompatibilityPolicyV1,
} from './cli/lib/artifact-compatibility-policy.js'
export type {
  CreateRefProjectionArtifactOptions,
  RefProjectionArtifact,
  RefProjectionArtifactDiagnostic,
  RefProjectionArtifactEdge,
  RefProjectionArtifactGenerator,
  RefProjectionArtifactNode,
  RefProjectionArtifactRecursion,
  RefProjectionArtifactSourceFile,
  RefProjectionNodeIdentity,
  RefProjectionUnmappedReason,
} from './cli/lib/ref-projection-artifact.js'
export type { RefProjectionArtifactSchemaIssue } from './cli/lib/ref-projection-artifact-schema.js'
export type {
  CodegenSourceAdapter,
  CodegenSourceAdapterOptions,
  CodegenSourceAdapterResult,
  DrizzleTableSourceAdapterInput,
  DrizzleTableSourceAdapterOptions,
  OpenApiProjectionEnvelopeAdapterOptions,
  PythonContractSpecSnapshotAdapterOptions,
  ZodSchemaSourceAdapterOptions,
} from './cli/lib/source-adapters.js'
export type {
  CodegenConfig,
  OaConfig,
  ResolvedOaConfig,
  ProfileTargetConfig,
  GuardTargetConfig,
  ConfigValidationError,
  ConfigValidationResult,
  ArtifactKind,
  OutputRoutingRule,
  ByKindRoutingConfig,
  OutputRoutingConfig,
} from './config.js'
export type {
  CasingStyle,
  TokenContext,
  ResolveTokenOptions,
  ParsedTsconfig,
  ResolveImportOptions,
  ManifestArtifact,
  OaManifest,
  WriteArtifactInput,
  WriteArtifactResult,
  PruneOrphansOptions,
  PruneSkippedEntry,
  PruneResult,
  DispatchPathOptions,
  DispatchedArtifactPath,
} from './routing/index.js'
export type {
  LoadedOaConfig,
  LoadOaConfigOptions,
  ResolvedProfileTarget,
  ResolvedGuardTarget,
} from './cli/lib/config-loader.js'
export type {
  ExternalSchemaRefAnalysis,
  ExternalSchemaRefDiagnostic,
  ExternalSchemaRefDiagnosticCode,
  ExternalSchemaTypeAlias,
  TypegenOptions,
  TypegenProvenanceEntry,
} from './typegen/generate-types.js'
export type {
  SpecDefinitionKind,
  SpecTraceSourceOrigin,
  SpecTraceSourceCoordinates,
  SpecTraceGovernanceCapabilities,
  SpecTraceArtifactKind,
  SpecTraceGeneratedArtifactMapping,
  SpecTraceabilityNode,
  SpecTraceabilityEdgeKind,
  SpecTraceabilityEdge,
  SpecTraceabilityDiagnosticCode,
  SpecTraceabilityDiagnostic,
  SpecTraceabilitySummary,
  SpecTraceabilityGraph,
  BuildSpecTraceabilityOptions,
  SpecTraceQuery,
  SpecImpactAnalysis,
} from './traceability/index.js'
export type { SchemaToTsOptions } from './typegen/schema-to-ts.js'
export type { GenerateZodOptions, Zod4AlgebraOptions } from './zodgen/index.js'
export type {
  SchemaToTsProjection,
  TypegenFidelity,
  TypegenFidelityAnalysis,
  TypegenFidelityDiagnostic,
  TypegenFidelityDiagnosticCode,
} from './typegen/schema-fidelity.js'
export type {
  TypeArtifactFilter,
  TypeArtifactRecord,
  TypeBoundaryFilter,
  TypeBoundaryRecord,
  TypeDeclarationFilter,
  TypeDeclarationRecord,
  TypeExposureFilter,
  TypeExposureRecord,
  TypeRegistry,
  TypeRegistrySnapshot,
  TypeRelationFilter,
  TypeRelationRecord,
} from './type-registry.js'
export type { OutputOptions, NamedSchema, CodegenResult } from './types.js'
export type { DrizzleCodegenOptions } from './drizzle/index.js'
export type {
  OpenApiCollectProfile,
  OpenApiCollectReport,
  OpenApiTransformWarning,
  OpenApiUpgradeReport,
} from './cli/lib/openapi-collect.js'
export type {
  TspExportDiagnostic,
  TspExportDiagnosticSeverity,
  TspExportOptions,
  TspExportReport,
  TspExportResult,
} from './cli/lib/tsp-export.js'
export type {
  OpenApiGovernanceInterface,
  OpenApiGovernanceScaffoldOptions,
  OpenApiGovernanceScaffoldResult,
  OpenApiGovernanceTypegenPolicy,
} from './cli/lib/openapi-governance-scaffold.js'
export type {
  ParallelEvidenceArtifactInput,
  ParallelEvidenceDeclaration,
  ParallelEvidenceMetricDeltaV1,
  ParallelEvidenceMetricsV1,
  ParallelEvidenceRelation,
  ParallelEvidenceReportV1,
  ParallelEvidenceRole,
  ParallelEvidenceSourceRange,
  ParallelEvidenceSubject,
  ParallelEvidenceSubjectStatus,
  ParallelEvidenceV1,
  ImplementationProvenanceAdapter,
  ImplementationProvenanceArtifact,
  ImplementationProvenanceDeclaration,
  ImplementationProvenanceEdge,
  TtscContractProvenanceV2,
} from './cli/lib/parallel-evidence.js'
export type {
  ApitomyReferenceAdapter,
  ApitomyReferenceAdapterOptions,
  ApitomyReferenceCompareOptions,
  ApitomyReferenceComparison,
  ApitomyReferenceDiagnosticDifference,
  ApitomyReferenceDifferenceKind,
  ApitomyReferenceDocument,
  ApitomyReferenceErrorCode,
  ApitomyReferenceLibrary,
  ApitomyReferenceMetadata,
  ApitomyReferenceModule,
  ApitomyReferenceSerialization,
  ApitomyReferenceValidationProblem,
} from './apitomy/index.js'
export type {
  WorkspaceComponentFilter,
  WorkspaceComponentRecord,
  WorkspaceDiagnosticFilter,
  WorkspaceDiagnosticRecord,
  WorkspaceDiagnosticSeverity,
  WorkspaceFileIndexData,
  WorkspaceFileRecord,
  WorkspaceIndex,
  WorkspaceIndexCompatibilityMetadata,
  WorkspaceIndexDiff,
  WorkspaceIndexMode,
  WorkspaceIndexOptions,
  WorkspaceIndexSnapshot,
  WorkspaceRefFilter,
  WorkspaceRefKind,
  WorkspaceRefRecord,
  WorkspaceSourceLocationRecord,
  WorkspaceTypeAliasFilter,
  WorkspaceTypeAliasRecord,
} from './workspace-index.js'
export type { SQLiteWorkspaceIndex, SQLiteWorkspaceIndexOptions, SqliteDriverName } from './sqlite-workspace-index.js'
export type {
  ASTDiff,
  ASTDiffKind,
  EntityDiscriminator,
  EntityKind,
  EntityPropertySpec,
  EntitySpec,
  PropertyConstraint,
  SyncOptions,
  SyncResult,
  TextEdit,
  TypeAdapter,
} from './ast-sync/index.js'
export type {
  GeneratedGuardArtifact,
  StandaloneGuardGeneratorOptions,
  StandaloneGuardTarget,
} from './standalone-guards/index.js'

export { generateRpcModule } from './rpc/generate-rpc-module.js'
export type { RpcModuleOptions } from './rpc/generate-rpc-module.js'

export {
  extractWireSchemaFromOas,
  Proto3TargetAdapter,
  ProtobufCodecTargetAdapter,
  RpcContractTargetAdapter,
  MessagePackTargetAdapter,
  TypeSpecWirePipeline,
  typeSpecWirePipeline,
} from './wire-adapter/index.js'
export type {
  WireSchemaModel,
  WireModel,
  WireField,
  WireEnum,
  WireEnumMember,
  WireService,
  WireMethod,
  WireFieldKind,
  WireMapValue,
  WireParameter,
  WireParameterLocation,
  WirePayload,
  TypeSpecWireTargetAdapter,
  WireTransformationResult,
  ExtractorOptions,
  Proto3AdapterOptions,
  ProtobufCodecAdapterOptions,
  RpcContractAdapterOptions,
  MessagePackAdapterOptions,
  TransformationBundle,
} from './wire-adapter/index.js'

export {
  defineTspConfig,
  validateTspConfig,
  sortPlugins,
  sortPluginEntries,
  compileTypeSpecInMemory,
  resolveTypeSpecEntrypoint,
  createPluginContext,
  normalizeVirtualPath,
  formatEsmImportExtension,
  TspPluginContextImpl,
  runTspPluginPipeline,
  pluginTypescript,
  pluginClient,
  pluginSdk,
  pluginTanstackQuery,
  pluginRouter,
  pluginWire,
  pluginRpc,
  TspPluginError,
  TspPluginCycleError,
  TspPluginMissingDependencyError,
  TspPluginDuplicateError,
  TspFileConflictError,
  TspConfigValidationError,
  TspProjectBuilder,
  createTspBuilder,
  vitePluginTsp,
} from './plugin/index.js'
export type {
  TspPlugin,
  TspPluginContext,
  TspGeneratedFile,
  TspPluginDiagnostic,
  TspConfig,
  TspConfigInput,
  TspConfigInputObject,
  TspPluginEntry,
  NormalizedPluginRegistration,
  TypeSpecCompilerOptions,
  TypeSpecCompilerResult,
  CreatePluginContextOptions,
  RunTspPluginPipelineOptions,
  TspPipelineResult,
  PluginTypescriptOptions,
  PluginClientOptions,
  PluginTanstackQueryOptions,
  PluginRouterOptions,
  PluginWireOptions,
  PluginRpcOptions,
  TspIntrospectedParameter,
  TspIntrospectedResponse,
  TspIntrospectedOperation,
  TspIntrospectedModelProperty,
  TspIntrospectedModel,
  TspIntrospectionReport,
  CreateTspBuilderOptions,
  TspWatchEvent,
  TspWatchOptions,
  TspWatcherHandle,
  VitePluginTspOptions,
  VitePluginTspResult,
} from './plugin/index.js'

export {
  buildJsonSchemaFromSketchIr,
  buildMermaidFromSketchIr,
  buildOpenApiFromSketchIr,
  buildPythonStubFromSketchIr,
  buildTypeScriptStubFromSketchIr,
  emitSketchArtifacts,
} from './sketch-emitter/index.js'
export type { SketchEmittedArtifacts } from './sketch-emitter/index.js'

