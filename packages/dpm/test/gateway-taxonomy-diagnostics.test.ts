import { describe, expect, it } from 'vitest'

import { DPM_DIAGNOSTIC_CODES } from '../src/index.js'
import { getDpmGatewaySchemaValue } from './support/gateway-taxonomy-fixtures.js'
import { formatSchemaPath } from './support/schema-path.js'

const diagnosticTaxonomyProjectionCases = [
  ['DpmDiagnostic', ['properties', 'code', 'enum'], DPM_DIAGNOSTIC_CODES],
] as const

describe('DPM gateway diagnostic taxonomy projection', () => {
  it('projects the runtime diagnostic code taxonomy into the gateway schema', () => {
    for (const [schemaName, path, expected] of diagnosticTaxonomyProjectionCases) {
      expect(getDpmGatewaySchemaValue(schemaName, path), `${schemaName}.${formatSchemaPath(path)}`).toEqual([
        ...expected,
      ])
    }
  })
})
