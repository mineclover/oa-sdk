import {
  computeDpmProfileConnectorStructuralHash,
  createDpmProfileConnectorHashInput,
  sortDpmProfileConnectorSourceVersionHashes,
} from './connector-freshness.js'
import { createDpmProfileConnectorStructuralResult } from './connector-normalize.js'
import {
  DPM_PROFILE_CONNECTOR_RESULT_KIND,
  type DpmProfileConnectorResult,
  type DpmProfileConnectorResultInput,
  type DpmProfileConnectorValidationResult,
} from './connector-types.js'
import { collectDpmProfileConnectorDiagnostics } from './connector-validation.js'

export {
  DPM_PROFILE_CONNECTOR_EVIDENCE_KINDS,
  DPM_PROFILE_CONNECTOR_RESULT_KIND,
  DPM_PROFILE_CONNECTOR_STATUSES,
} from './connector-types.js'
export type {
  DpmProfileConnectorCapabilities,
  DpmProfileConnectorEvidenceKind,
  DpmProfileConnectorFreshness,
  DpmProfileConnectorResult,
  DpmProfileConnectorResultInput,
  DpmProfileConnectorStatus,
  DpmProfileConnectorValidationResult,
} from './connector-types.js'

export function normalizeDpmProfileConnectorResult(input: DpmProfileConnectorResultInput): DpmProfileConnectorResult {
  const structural = createDpmProfileConnectorStructuralResult(input, DPM_PROFILE_CONNECTOR_RESULT_KIND)

  return {
    ...structural,
    freshness: {
      runHash: computeDpmProfileConnectorRunHash(structural),
      ...(input.profileArtifact ? { profileVersionHash: input.profileArtifact.freshness.versionHash } : {}),
      ...(input.profileArtifact?.freshness.sourceVersionHashes
        ? {
            sourceVersionHashes: sortDpmProfileConnectorSourceVersionHashes(
              input.profileArtifact.freshness.sourceVersionHashes,
            ),
          }
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
