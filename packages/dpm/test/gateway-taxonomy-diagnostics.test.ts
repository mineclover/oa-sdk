import { describe, expect, it } from 'vitest'

import { DPM_DIAGNOSTIC_CODES } from '../src/index.js'
import { getDpmGatewaySchema } from './support/gateway-taxonomy-fixtures.js'

describe('DPM gateway diagnostic taxonomy projection', () => {
  it('projects the runtime diagnostic code taxonomy into the gateway schema', () => {
    const diagnosticSchema = getDpmGatewaySchema('DpmDiagnostic')

    expect(diagnosticSchema.properties.code.enum).toEqual([...DPM_DIAGNOSTIC_CODES])
  })
})
