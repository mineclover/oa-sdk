import type {
  DpmProfileConnectorResult,
  DpmProfileConnectorResultInput,
} from './connector-types.js'
import { copyDpmProfileConnectorCapabilities } from './connector-capability-copy.js'
import {
  byConnectorDiagnostic,
  copyDpmProfileConnectorDiagnostic,
} from './connector-diagnostic-copy.js'

export function createDpmProfileConnectorStructuralResult(
  input: DpmProfileConnectorResultInput,
  kind: DpmProfileConnectorResult['kind'],
): Omit<DpmProfileConnectorResult, 'freshness'> {
  return {
    kind,
    connectorId: input.connectorId,
    connectorVersion: input.connectorVersion,
    sourceKind: input.sourceKind,
    captureMode: input.captureMode,
    status: input.status,
    capabilities: copyDpmProfileConnectorCapabilities(input.capabilities),
    observedEvidenceKinds: [...input.observedEvidenceKinds].sort(),
    diagnostics: input.diagnostics.map(copyDpmProfileConnectorDiagnostic).sort(byConnectorDiagnostic),
    ...(input.profileArtifact ? { profileArtifact: input.profileArtifact } : {}),
  }
}
