import { createPostgresCatalogSnapshot } from '../catalog/postgres.js'
import type { CatalogSnapshot, PostgresCatalogSnapshotInput } from '../catalog/types.js'
import { compileDpmPlan, type DpmCompileResult } from '../compiler/compile.js'
import { createDpmDryRunReport, type DpmDryRunReport } from '../dry-run/report.js'
import {
  createDpmProfileAnalysisReport,
} from '../profile/analyze.js'
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
import { validateDpmManifest } from '../validator/manifest.js'
import type { DpmValidationResult } from '../validator/diagnostics.js'
import type { DpmProfileProposalReviewStatus } from './profile-proposal.js'

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
    async inspectDpmProfile(input) {
      return runtimeResponse({
        operationId: 'inspectDpmProfile',
        statusCode: 200,
        command: 'inspect-profile',
        result: {
          profileArtifact: input.profileArtifact,
          nodeCount: input.profileArtifact.nodes.length,
          edgeCount: input.profileArtifact.edges.length,
          metricCount: input.profileArtifact.metrics.length,
          diagnostics: [...input.profileArtifact.diagnostics],
        },
      })
    },
    async analyzeDpmProfile(input) {
      return runtimeResponse({
        operationId: 'analyzeDpmProfile',
        statusCode: 200,
        command: 'analyze-profile',
        result: {
          analysisReport: createDpmProfileAnalysisReport(input),
        },
      })
    },
    async reviewDpmProfileProposal(input) {
      return runtimeResponse({
        operationId: 'reviewDpmProfileProposal',
        statusCode: 200,
        command: 'review-profile-proposal',
        result: {
          proposalId: input.proposalId,
          status: input.status,
          reviewedBy: input.reviewedBy,
          reason: input.reason,
          ...(input.reviewedAt ? { reviewedAt: input.reviewedAt } : {}),
          ...(input.coordinate ? { coordinate: input.coordinate } : {}),
          ...(input.relationshipHint ? { relationshipHint: input.relationshipHint } : {}),
          diagnostics: [],
        },
      })
    },
    async validateDpmManifest(input) {
      const result = validateDpmManifest({
        manifest: input.manifest,
        catalog: resolveCatalogSnapshot(input.catalog),
        registry: input.registry,
        phase: 'validate',
      })

      return runtimeResponse({
        operationId: 'validateDpmManifest',
        statusCode: result.summary.errors > 0 ? 400 : 200,
        command: 'validate',
        result,
      })
    },
    async compileDpmManifest(input) {
      const result = compileDpmPlan({
        manifest: input.manifest,
        catalog: resolveCatalogSnapshot(input.catalog),
        registry: input.registry,
        phase: 'compile',
      })

      return runtimeResponse({
        operationId: 'compileDpmManifest',
        statusCode: result.ok ? 200 : 400,
        command: 'compile',
        result,
      })
    },
    async dryRunDpmManifest(input) {
      const compiled = compileDpmPlan({
        manifest: input.manifest,
        catalog: resolveCatalogSnapshot(input.catalog),
        registry: input.registry,
        phase: 'dry_run',
      })
      if (!compiled.ok) {
        return runtimeResponse({
          operationId: 'dryRunDpmManifest',
          statusCode: 400,
          command: 'dry-run',
          result: compiled,
        })
      }

      return runtimeResponse({
        operationId: 'dryRunDpmManifest',
        statusCode: 200,
        command: 'dry-run',
        result: createDpmDryRunReport({
          plan: compiled.plan,
          ...(input.estimatedRows ? { estimatedRows: input.estimatedRows } : {}),
        }),
      })
    },
  }
}

function runtimeResponse<TResult>(input: {
  operationId: DpmGatewayRuntimeOperationId
  statusCode: DpmGatewayRuntimeStatusCode
  command: DpmGatewayRuntimeCommand
  result: TResult
}): DpmGatewayRuntimeResponse<TResult> {
  return {
    operationId: input.operationId,
    statusCode: input.statusCode,
    body: {
      command: input.command,
      result: input.result,
    },
  }
}

function resolveCatalogSnapshot(catalog: CatalogSnapshot | PostgresCatalogSnapshotInput): CatalogSnapshot {
  if (isCatalogSnapshot(catalog)) return catalog
  return createPostgresCatalogSnapshot(catalog)
}

function isCatalogSnapshot(catalog: CatalogSnapshot | PostgresCatalogSnapshotInput): catalog is CatalogSnapshot {
  return 'kind' in catalog && catalog.kind === 'dpm.catalog.snapshot.v1'
}
