import { describe, expect, it } from 'vitest'

import { createDpmGatewayRuntime } from '../src/index.js'
import { createBlockingRuntimeInput } from './support/gateway-runtime-manifest-fixtures.js'

describe('DPM gateway manifest blocking diagnostic runtime response', () => {
  it('returns blocking diagnostics as a structured runtime response', async () => {
    const runtime = createDpmGatewayRuntime()
    const response = await runtime.validateDpmManifest(createBlockingRuntimeInput())

    expect(response.statusCode).toBe(400)
    expect(response.body.command).toBe('validate')
    expect(response.body.result.valid).toBe(false)
    expect(response.body.result.diagnostics.map((diagnostic: any) => diagnostic.code)).toContain('SAF001')
  })
})
