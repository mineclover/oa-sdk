import type {
  DpmProfileConnectorResult,
  DpmProfileConnectorResultInput,
} from './connector-types.js'

export function createDpmProfileConnectorHashInput(
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
    capabilities: input.capabilities,
    observedEvidenceKinds: input.observedEvidenceKinds,
    diagnostics: input.diagnostics,
    ...(input.profileArtifact ? { profileArtifact: input.profileArtifact } : {}),
  }
}
