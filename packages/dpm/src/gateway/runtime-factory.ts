import type { DpmGatewayRuntime } from './runtime-types.js'
import {
  compileDpmManifestRuntime,
  dryRunDpmManifestRuntime,
  validateDpmManifestRuntime,
} from './runtime-manifest.js'
import {
  analyzeDpmProfileRuntime,
  inspectDpmProfileRuntime,
  reviewDpmProfileProposalRuntime,
} from './runtime-profile.js'

export function createDpmGatewayRuntime(): DpmGatewayRuntime {
  return {
    inspectDpmProfile: inspectDpmProfileRuntime,
    analyzeDpmProfile: analyzeDpmProfileRuntime,
    reviewDpmProfileProposal: reviewDpmProfileProposalRuntime,
    validateDpmManifest: validateDpmManifestRuntime,
    compileDpmManifest: compileDpmManifestRuntime,
    dryRunDpmManifest: dryRunDpmManifestRuntime,
  }
}
