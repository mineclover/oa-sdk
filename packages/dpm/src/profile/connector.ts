import {
  computeDpmProfileConnectorStructuralHash,
  createDpmProfileConnectorHashInput,
  createDpmProfileConnectorStructuralResult,
  sortDpmProfileConnectorSourceVersionHashes,
} from './connector-normalize.js'
import { collectDpmProfileConnectorDiagnostics } from './connector-validation.js'
import type {
  DpmProfileArtifact,
  DpmProfileCaptureMode,
  DpmProfileDiagnostic,
  DpmProfileSourceKind,
} from './types.js'

export const DPM_PROFILE_CONNECTOR_RESULT_KIND = 'dpm.profile.connector-result.v1' as const

export const DPM_PROFILE_CONNECTOR_STATUSES = [
  'completed',
  'completed_with_warnings',
  'failed',
] as const

export const DPM_PROFILE_CONNECTOR_EVIDENCE_KINDS = [
  'source',
  'evidence_source',
  'node',
  'edge',
  'metric',
  'diagnostic',
] as const

export type DpmProfileConnectorStatus = typeof DPM_PROFILE_CONNECTOR_STATUSES[number]
export type DpmProfileConnectorEvidenceKind = typeof DPM_PROFILE_CONNECTOR_EVIDENCE_KINDS[number]

export type DpmProfileConnectorCapabilities = {
  connectorId: string
  connectorVersion: string
  sourceKinds: DpmProfileSourceKind[]
  captureModes: DpmProfileCaptureMode[]
  supportedEvidenceKinds: DpmProfileConnectorEvidenceKind[]
  skippedEvidenceKinds: DpmProfileConnectorEvidenceKind[]
}

export type DpmProfileConnectorFreshness = {
  runHash: string
  profileVersionHash?: string
  sourceVersionHashes?: Record<string, string>
}

export type DpmProfileConnectorResult = {
  kind: typeof DPM_PROFILE_CONNECTOR_RESULT_KIND
  connectorId: string
  connectorVersion: string
  sourceKind: DpmProfileSourceKind
  captureMode: DpmProfileCaptureMode
  status: DpmProfileConnectorStatus
  capabilities: DpmProfileConnectorCapabilities
  observedEvidenceKinds: DpmProfileConnectorEvidenceKind[]
  diagnostics: DpmProfileDiagnostic[]
  freshness: DpmProfileConnectorFreshness
  profileArtifact?: DpmProfileArtifact
}

export type DpmProfileConnectorResultInput = Omit<DpmProfileConnectorResult, 'kind' | 'freshness'>

export type DpmProfileConnectorValidationResult = {
  valid: boolean
  diagnostics: DpmProfileDiagnostic[]
}

export function normalizeDpmProfileConnectorResult(input: DpmProfileConnectorResultInput): DpmProfileConnectorResult {
  const structural = createDpmProfileConnectorStructuralResult(input, DPM_PROFILE_CONNECTOR_RESULT_KIND)

  return {
    ...structural,
    freshness: {
      runHash: computeDpmProfileConnectorRunHash(structural),
      ...(input.profileArtifact ? { profileVersionHash: input.profileArtifact.freshness.versionHash } : {}),
      ...(input.profileArtifact?.freshness.sourceVersionHashes
        ? { sourceVersionHashes: sortDpmProfileConnectorSourceVersionHashes(input.profileArtifact.freshness.sourceVersionHashes) }
        : {}),
    },
  }
}

export function computeDpmProfileConnectorRunHash(
  input: Omit<DpmProfileConnectorResult, 'freshness'> | DpmProfileConnectorResultInput,
): string {
  const structural = 'kind' in input
    ? input
    : createDpmProfileConnectorHashInput(input, DPM_PROFILE_CONNECTOR_RESULT_KIND)

  return computeDpmProfileConnectorStructuralHash(structural)
}

export function validateDpmProfileConnectorResult(
  result: DpmProfileConnectorResult,
): DpmProfileConnectorValidationResult {
  const diagnostics = collectDpmProfileConnectorDiagnostics(result)

  return {
    valid: diagnostics.length === 0,
    diagnostics,
  }
}
