import type { DpmProfileConnectorResult } from './connector-types.js'
import {
  addDpmProfileConnectorCapabilityDiagnostics,
} from './connector-validation-capability-gates.js'
import {
  addDpmProfileConnectorPayloadDiagnostics,
} from './connector-validation-payload-gates.js'
import type { DpmProfileDiagnostic } from './profile-artifact-types.js'

export function collectDpmProfileConnectorDiagnostics(
  result: DpmProfileConnectorResult,
): DpmProfileDiagnostic[] {
  const diagnostics: DpmProfileDiagnostic[] = []

  addDpmProfileConnectorCapabilityDiagnostics(diagnostics, result)
  addDpmProfileConnectorPayloadDiagnostics(diagnostics, result)

  return diagnostics
}
