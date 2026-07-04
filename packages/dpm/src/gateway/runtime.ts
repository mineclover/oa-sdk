import type { CatalogSnapshot, PostgresCatalogSnapshotInput } from '../catalog/types.js'
import type { DpmCompileResult } from '../compiler/compile.js'
import type { DpmDryRunReport } from '../dry-run/report.js'
import type {
  DpmProfileAnalysisInput,
  DpmProfileAnalysisReport,
  DpmProfileRelationshipHintProposal,
} from '../profile/analysis-types.js'
import type {
  DpmProfileArtifact,
  DpmProfileCoordinate,
  DpmProfileDiagnostic,
} from '../profile/types.js'
import type { RegistrySnapshot } from '../registry/types.js'
import type { DpmValidationResult } from '../validator/diagnostics.js'
import type { DpmProfileProposalReviewStatus } from './profile-proposal.js'
import {
  analyzeDpmProfileRuntime,
  inspectDpmProfileRuntime,
  reviewDpmProfileProposalRuntime,
} from './runtime-profile.js'
import {
  compileDpmManifestRuntime,
  dryRunDpmManifestRuntime,
  validateDpmManifestRuntime,
} from './runtime-manifest.js'

export const DPM_GATEWAY_RUNTIME_OPERATION_IDS = [
  'inspectDpmProfile',
  'analyzeDpmProfile',
  'reviewDpmProfileProposal',
  'validateDpmManifest',
  'compileDpmManifest',
  'dryRunDpmManifest',
] as const

export type DpmGatewayRuntimeOperationId = typeof DPM_GATEWAY_RUNTIME_OPERATION_IDS[number]
export type DpmGatewayRuntimeStatusCode = 200 | 400
export type DpmGatewayRuntimeCommand =
  | 'inspect-profile'
  | 'analyze-profile'
  | 'review-profile-proposal'
  | 'validate'
  | 'compile'
  | 'dry-run'

export type DpmGatewayRuntimeBody<TResult> = {
  command: DpmGatewayRuntimeCommand
  result: TResult
}

export type DpmGatewayRuntimeResponse<TResult> = {
  operationId: DpmGatewayRuntimeOperationId
  statusCode: DpmGatewayRuntimeStatusCode
  body: DpmGatewayRuntimeBody<TResult>
}

export type DpmGatewayRuntimeManifestInput = {
  manifest: unknown
  catalog: CatalogSnapshot | PostgresCatalogSnapshotInput
  registry: RegistrySnapshot
  estimatedRows?: Record<string, number>
}

export type DpmGatewayProfileInspectionInput = {
  profileArtifact: DpmProfileArtifact
}

export type DpmGatewayProfileInspectionResult = {
  profileArtifact: DpmProfileArtifact
  nodeCount: number
  edgeCount: number
  metricCount: number
  diagnostics: DpmProfileDiagnostic[]
}

export type DpmGatewayProfileAnalysisInput = DpmProfileAnalysisInput

export type DpmGatewayProfileAnalysisResult = {
  analysisReport: DpmProfileAnalysisReport
}

export type DpmGatewayProfileProposalReviewInput = {
  proposalId: string
  status: DpmProfileProposalReviewStatus
  reviewedBy: string
  reason: string
  reviewedAt?: string
  coordinate?: DpmProfileCoordinate
  relationshipHint?: DpmProfileRelationshipHintProposal
}

export type DpmGatewayProfileProposalReviewResult = {
  proposalId: string
  status: DpmProfileProposalReviewStatus
  reviewedBy: string
  reason: string
  reviewedAt?: string
  coordinate?: DpmProfileCoordinate
  relationshipHint?: DpmProfileRelationshipHintProposal
  diagnostics: DpmProfileDiagnostic[]
}

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
