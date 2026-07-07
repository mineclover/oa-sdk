import type { DpmGatewayRuntime } from './runtime-types.js'
import {
  compileDpmManifestRuntime,
  dryRunDpmManifestRuntime,
  validateDpmManifestRuntime,
} from './runtime-manifest.js'
import {
  analyzeDpmProfileRuntime,
  inspectDpmProfileRuntime,
  listDpmProfileBaselineSummariesRuntime,
  reviewDpmProfileProposalRuntime,
} from './runtime-profile.js'
import { importDpmRelationshipCandidatesRuntime } from './runtime-relationship-candidate-import.js'
import { discoverDpmRelationshipsRuntime } from './runtime-relationship-discover.js'

export function createDpmGatewayRuntime(): DpmGatewayRuntime {
  return {
    inspectDpmProfile: inspectDpmProfileRuntime,
    analyzeDpmProfile: analyzeDpmProfileRuntime,
    listDpmProfileBaselineSummaries: listDpmProfileBaselineSummariesRuntime,
    reviewDpmProfileProposal: reviewDpmProfileProposalRuntime,
    discoverDpmRelationships: discoverDpmRelationshipsRuntime,
    importDpmRelationshipCandidates: importDpmRelationshipCandidatesRuntime,
    validateDpmManifest: validateDpmManifestRuntime,
    compileDpmManifest: compileDpmManifestRuntime,
    dryRunDpmManifest: dryRunDpmManifestRuntime,
  }
}
