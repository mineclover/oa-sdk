import type { DpmProfileConnectorResult } from './connector.js'
import { validateDpmProfileArtifactSchema } from './schema.js'
import type { DpmProfileDiagnostic } from './profile-artifact-types.js'

export function collectDpmProfileConnectorDiagnostics(
  result: DpmProfileConnectorResult,
): DpmProfileDiagnostic[] {
  const diagnostics: DpmProfileDiagnostic[] = []

  if (result.capabilities.connectorId !== result.connectorId || result.capabilities.connectorVersion !== result.connectorVersion) {
    diagnostics.push(connectorDiagnostic(
      'CONN101',
      `Connector result identity must match capability metadata for ${result.connectorId}.`,
      result.connectorId,
    ))
  }

  if (!result.capabilities.sourceKinds.includes(result.sourceKind)) {
    diagnostics.push(connectorDiagnostic(
      'CONN102',
      `Connector ${result.connectorId} does not support source kind ${result.sourceKind}.`,
      result.connectorId,
    ))
  }

  if (!result.capabilities.captureModes.includes(result.captureMode)) {
    diagnostics.push(connectorDiagnostic(
      'CONN103',
      `Connector ${result.connectorId} does not support capture mode ${result.captureMode}.`,
      result.connectorId,
    ))
  }

  const unsupportedEvidenceKinds = result.observedEvidenceKinds.filter(kind =>
    !result.capabilities.supportedEvidenceKinds.includes(kind) ||
    result.capabilities.skippedEvidenceKinds.includes(kind),
  )
  if (unsupportedEvidenceKinds.length > 0) {
    diagnostics.push(connectorDiagnostic(
      'CONN104',
      `Connector ${result.connectorId} claimed unsupported observed evidence kinds: ${unsupportedEvidenceKinds.join(', ')}.`,
      result.connectorId,
    ))
  }

  if (result.status === 'failed' && result.diagnostics.length === 0) {
    diagnostics.push(connectorDiagnostic(
      'CONN105',
      `Failed connector result ${result.connectorId} must include at least one diagnostic.`,
      result.connectorId,
    ))
  }

  if (result.status !== 'failed' && !result.profileArtifact) {
    diagnostics.push(connectorDiagnostic(
      'CONN106',
      `Completed connector result ${result.connectorId} must include a profile artifact.`,
      result.connectorId,
    ))
  }

  if (result.profileArtifact) {
    const artifactSchemaResult = validateDpmProfileArtifactSchema(result.profileArtifact)
    if (!artifactSchemaResult.valid) {
      diagnostics.push(connectorDiagnostic(
        'CONN107',
        `Connector ${result.connectorId} emitted an invalid profile artifact.`,
        result.connectorId,
      ))
    }

    const mismatchedSource = result.profileArtifact.sources.find(source =>
      source.connectorId !== result.connectorId || source.connectorVersion !== result.connectorVersion,
    )
    if (mismatchedSource) {
      diagnostics.push(connectorDiagnostic(
        'CONN108',
        `Profile source ${mismatchedSource.id} does not match connector result identity ${result.connectorId}.`,
        result.connectorId,
      ))
    }
  }

  return diagnostics
}

function connectorDiagnostic(code: DpmProfileDiagnostic['code'], message: string, connectorId: string): DpmProfileDiagnostic {
  return {
    severity: 'error',
    code,
    message,
    connectorId,
    coordinate: {
      kind: 'manual_import',
      path: connectorId,
    },
  }
}
