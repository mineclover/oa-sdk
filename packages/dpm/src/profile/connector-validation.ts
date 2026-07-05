import type { DpmProfileConnectorResult } from './connector-types.js'
import {
  addDpmProfileConnectorCapabilityDiagnostics,
  addDpmProfileConnectorPayloadDiagnostics,
} from './connector-validation-gates.js'
import type { DpmProfileDiagnostic } from './profile-artifact-types.js'

export function collectDpmProfileConnectorDiagnostics(
  result: DpmProfileConnectorResult,
): DpmProfileDiagnostic[] {
  const diagnostics: DpmProfileDiagnostic[] = []

  addDpmProfileConnectorCapabilityDiagnostics(diagnostics, result)
  addDpmProfileConnectorPayloadDiagnostics(diagnostics, result)

  return diagnostics
}
