import type {
  DpmProfileConnectorCapabilities,
  DpmProfileConnectorResult,
  DpmProfileConnectorResultInput,
} from './connector-types.js'
import type { DpmProfileDiagnostic } from './profile-artifact-types.js'

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
    capabilities: copyCapabilities(input.capabilities),
    observedEvidenceKinds: [...input.observedEvidenceKinds].sort(),
    diagnostics: input.diagnostics.map(copyDiagnostic).sort(byDiagnostic),
    ...(input.profileArtifact ? { profileArtifact: input.profileArtifact } : {}),
  }
}

function copyCapabilities(capabilities: DpmProfileConnectorCapabilities): DpmProfileConnectorCapabilities {
  return {
    connectorId: capabilities.connectorId,
    connectorVersion: capabilities.connectorVersion,
    sourceKinds: [...capabilities.sourceKinds].sort(),
    captureModes: [...capabilities.captureModes].sort(),
    supportedEvidenceKinds: [...capabilities.supportedEvidenceKinds].sort(),
    skippedEvidenceKinds: [...capabilities.skippedEvidenceKinds].sort(),
  }
}

function copyDiagnostic(diagnostic: DpmProfileDiagnostic): DpmProfileDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.connectorId ? { connectorId: diagnostic.connectorId } : {}),
    ...(diagnostic.coordinate ? { coordinate: { ...diagnostic.coordinate } } : {}),
    ...(diagnostic.evidenceIds ? { evidenceIds: [...diagnostic.evidenceIds].sort() } : {}),
  }
}

function byDiagnostic(left: DpmProfileDiagnostic, right: DpmProfileDiagnostic): number {
  const leftKey = `${left.severity}.${left.code}.${left.message}`
  const rightKey = `${right.severity}.${right.code}.${right.message}`
  return leftKey.localeCompare(rightKey)
}
