/**
 * Stable source facade for repository-level schema and TypeSpec governance.
 *
 * Root orchestration scripts import this module instead of reaching through
 * `src/cli/lib`. This is intentionally not a public package export: it keeps
 * monorepo governance coupled to one reviewed boundary while the public
 * `@oa-sdk/codegen` API remains independent of maintainer-only tooling.
 */

export {
  checkTypeSpecBundle,
  formatTypeSpecBundleCheckFailure,
  parseTypeSpecBundleCheckArgs,
  printTypeSpecBundleCheckSummary,
  shouldFailTypeSpecBundleCheck,
} from './cli/lib/typespec-bundle-check.js'
export type {
  TypeSpecBundleCheckArgs,
  TypeSpecBundleCheckOptions,
  TypeSpecBundleCheckReport,
  TypeSpecBundleCheckResult,
} from './cli/lib/typespec-bundle-check.js'

export { loadSpecWithPath } from './cli/lib/load-spec.js'
export type { LoadedSpec } from './cli/lib/load-spec.js'

export {
  diffOpenApiDocuments,
  formatOpenApiDiff,
  stableOpenApiStringify,
} from './cli/lib/openapi-normalized-diff.js'
export type {
  OpenApiDiffCategory,
  OpenApiDiffKind,
  OpenApiNormalizedDiffEntry,
} from './cli/lib/openapi-normalized-diff.js'

export { stringifyOpenApiYaml } from './cli/lib/openapi-collect.js'
export { exportOpenApiToTypeSpec } from './cli/lib/tsp-export.js'
export type {
  TspExportDiagnostic,
  TspExportOptions,
  TspExportReport,
  TspExportResult,
} from './cli/lib/tsp-export.js'

export { createTypeSpecBundleManifest } from './cli/lib/typespec-bundle-manifest.js'
export type { TypeSpecBundleManifest } from './cli/lib/typespec-bundle-manifest.js'

export {
  applyTypeSpecCompatibilitySidecar,
  compareTypeSpecCompatibilitySidecars,
  createTypeSpecCompatibilitySidecar,
  createTypeSpecCompatibilitySidecarFromEntries,
  parseTypeSpecCompatibilitySidecar,
} from './cli/lib/typespec-sidecar.js'
export type {
  TypeSpecCompatibilityRestoreReport,
  TypeSpecCompatibilitySidecar,
  TypeSpecCompatibilitySidecarCompareReport,
  TypeSpecCompatibilitySidecarEntry,
  TypeSpecParameterExamplesSidecarEntry,
} from './cli/lib/typespec-sidecar.js'

export {
  convertTypeSpecSidecarToExtensions,
} from './cli/lib/typespec-sidecar-to-extensions.js'
export type {
  TypeSpecSidecarToExtensionsOptions,
  TypeSpecSidecarToExtensionsReport,
  TypeSpecSidecarToExtensionsResult,
} from './cli/lib/typespec-sidecar-to-extensions.js'

export {
  formatTypeSpecOpenApiExtensionSchemaVersions,
  isTypeSpecOpenApiExtensionSchemaVersion,
} from './cli/lib/typespec-extension-schema-version.js'
export type { TypeSpecOpenApiExtensionSchemaVersion } from './cli/lib/typespec-extension-schema-version.js'

export { createTypeSpecRoundtripReport } from './cli/lib/typespec-roundtrip-report.js'
export type {
  CreateTypeSpecRoundtripReportInput,
  TypeSpecRoundtripReport,
} from './cli/lib/typespec-roundtrip-report.js'

export {
  classifyBreakingChanges,
  classifyNonBreakingChanges,
  diffEndpoints,
  formatMarkdown,
  hasBreakingChanges,
} from './cli/lib/openapi-breaking-diff.js'
export type {
  ChangeSeverity,
  ContractDiffChange,
  DiffResult,
  Endpoint,
  EndpointParameter,
  HttpMethod,
} from './cli/lib/openapi-breaking-diff.js'

export { evaluateContractVersionPolicy } from './cli/lib/contract-version-policy.js'
export type {
  ContractVersionPolicyResult,
  SemanticVersion,
} from './cli/lib/contract-version-policy.js'
