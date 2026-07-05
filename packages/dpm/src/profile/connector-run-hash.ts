import {
  computeDpmProfileConnectorStructuralHash,
  createDpmProfileConnectorHashInput,
} from './connector-freshness.js'
import {
  DPM_PROFILE_CONNECTOR_RESULT_KIND,
  type DpmProfileConnectorResult,
  type DpmProfileConnectorResultInput,
} from './connector-types.js'

export function computeDpmProfileConnectorRunHash(
  input: Omit<DpmProfileConnectorResult, 'freshness'> | DpmProfileConnectorResultInput,
): string {
  const structural = 'kind' in input
    ? input
    : createDpmProfileConnectorHashInput(input, DPM_PROFILE_CONNECTOR_RESULT_KIND)

  return computeDpmProfileConnectorStructuralHash(structural)
}
