// Public surface for @oa-sdk/spec-lens — do not import from cli/lib directly
export {
  adaptDefinitionBuilderFragmentFileFromContent,
  loadDefinitionFragments,
  loadDefinitionFragmentsFromEntries,
  loadDefinitionTargetConfig,
  lookupDefinitionSourceLocation,
  type LoadedDefinitionFragments,
  type SpecFileEntryInput,
} from '../cli/lib/definition-fragments.js'


export {
  createBuildSpecCompositionReport,
  type BuildSpecCompositionReport,
  type BuildSpecCompositionOutputComponent,
  type BuildSpecCompositionOutputPath,
  type BuildSpecCompositionSourceRef,
} from '../cli/lib/composition-report.js'

export {
  createBuildSpecProvenanceMap,
  diffBuildSpecProvenanceMaps,
  type BuildSpecProvenanceDiffEntry,
  type BuildSpecProvenanceDiffKind,
  type BuildSpecProvenanceEntry,
  type BuildSpecProvenanceMap,
} from '../cli/lib/provenance-report.js'

export {
  diffOpenApiDocuments,
  type OpenApiDiffCategory,
  type OpenApiDiffKind,
  type OpenApiNormalizedDiffEntry,
} from '../cli/lib/openapi-normalized-diff.js'

export {
  classifyBreakingChanges,
  classifyNonBreakingChanges,
  diffEndpoints,
  extractEndpoints,
  hasBreakingChanges,
  type ContractDiffChange,
  type DiffResult,
  type Endpoint,
  type HttpMethod,
} from '../cli/lib/openapi-breaking-diff.js'

export {
  compileTypeSpecBundleForSpecLens,
  resolveSpecLensTypeSpecSourceReadBudget,
  resolveSpecLensTypeSpecToolchain,
  type CompileTypeSpecBundleForSpecLensOptions,
  type CompileTypeSpecBundleForSpecLensResult,
  type SpecLensTypeSpecCompileEvidence,
  type SpecLensTypeSpecSourceEntry,
  type SpecLensTypeSpecSourceReadBudget,
  type SpecLensTypeSpecToolchainEvidence,
} from '../cli/lib/typespec-spec-lens.js'
