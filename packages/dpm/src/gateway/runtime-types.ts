import type { DpmCompileResult } from '../compiler/compile.js'
import type { DpmDryRunReport } from '../dry-run/report.js'
import type { DpmValidationResult } from '../validator/diagnostic-types.js'
import type { DpmGatewayRuntimeManifestInput } from './runtime-manifest-types.js'
import type {
  DpmGatewayProfileAnalysisInput,
  DpmGatewayProfileAnalysisResult,
  DpmGatewayProfileInspectionInput,
  DpmGatewayProfileInspectionResult,
  DpmGatewayProfileProposalReviewInput,
  DpmGatewayProfileProposalReviewResult,
} from './runtime-profile-types.js'
import type { DpmGatewayRuntimeResponse } from './runtime-response-types.js'

export type DpmGatewayRuntime = {
  inspectDpmProfile(
    input: DpmGatewayProfileInspectionInput,
  ): Promise<DpmGatewayRuntimeResponse<DpmGatewayProfileInspectionResult>>
  analyzeDpmProfile(
    input: DpmGatewayProfileAnalysisInput,
  ): Promise<DpmGatewayRuntimeResponse<DpmGatewayProfileAnalysisResult>>
  reviewDpmProfileProposal(
    input: DpmGatewayProfileProposalReviewInput,
  ): Promise<DpmGatewayRuntimeResponse<DpmGatewayProfileProposalReviewResult>>
  validateDpmManifest(input: DpmGatewayRuntimeManifestInput): Promise<DpmGatewayRuntimeResponse<DpmValidationResult>>
  compileDpmManifest(input: DpmGatewayRuntimeManifestInput): Promise<DpmGatewayRuntimeResponse<DpmCompileResult>>
  dryRunDpmManifest(input: DpmGatewayRuntimeManifestInput): Promise<DpmGatewayRuntimeResponse<DpmCompileResult | DpmDryRunReport>>
}
