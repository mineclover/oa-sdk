export type {
  Persona,
  PersonaIdentity,
  PersonaReference,
  PersonaOutcome,
  PersonaStatus,
  DomainMatrix,
  Registry,
  TraitVocabulary,
  TraitValue,
  ValidationIssue,
  ValidationReport,
} from './types.js'

export {
  loadRegistry,
  loadTrait,
  loadAllTraits,
  loadDomain,
  listDomains,
  loadAllDomains,
  loadDataModel,
  listDataModels,
  loadAllDataModels,
  loadProfile,
  listProfiles,
  loadAllProfiles,
  loadOperationIdsFromMergedSpec,
  loadOperationsFromMergedSpec,
  defaultPackageRoot,
} from './load.js'
export type { OperationInfo } from './load.js'

export { expandProfile, matchesSelector, renderProfileMarkdown } from './profile.js'
export type { ExpandOptions } from './profile.js'

export { validate } from './validate.js'
export type { ValidateOptions } from './validate.js'

export { analyzeCoverage, renderMarkdown } from './coverage.js'
export type {
  CoverageInput,
  CoverageReport,
  OperationCoverageRow,
  CrossSection,
  GapEntry,
} from './coverage.js'

export { applyBindings, computeExpectedBindings, detectDrift } from './bind.js'
export type { MinimalOpenApiDoc, BindingMeta, BindOptions, BindingDrift } from './bind.js'

export { findPersona, findOperation, listPersonasForOperation, resolvePersonaResponse } from './resolver.js'
export type { ResolvedPersonaResponse, ResolveOptions } from './resolver.js'

export { createPersonaMockClient } from './mock.js'
export type { PersonaMockClient, MockServerLike, CreatePersonaMockClientOptions } from './mock.js'

export { generateVitestSuite } from './generate-tests.js'
export type { GenerateTestsOptions } from './generate-tests.js'

export { proposeStubsFromOrphans, renderStubsAsYaml } from './propose.js'
export type { ProposeOptions, ProposedStub } from './propose.js'

export { collectEdges, groupEdgesByLinkType, topologicalLayers, renderFlowMarkdown } from './flow.js'
export type { FlowEdge } from './flow.js'
