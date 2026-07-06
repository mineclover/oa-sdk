import { describe, expect, it } from 'vitest'

import { createDpmGatewayRuntime } from '../src/index.js'
import {
  GATEWAY_PROFILE_RUNTIME_UNSAFE_RESULT_FRAGMENTS,
  createKafkaProfileArtifact,
} from './support/gateway-runtime-profile-fixtures.js'
import { compileGatewayComponentSchema } from './support/gateway-schema.js'

describe('DPM gateway profile analysis runtime adapter', () => {
  it('keeps profile analysis output aligned with the gateway response schema', async () => {
    const runtime = createDpmGatewayRuntime()
    const profileArtifact = createKafkaProfileArtifact()
    const response = await runtime.analyzeDpmProfile({ profileArtifact })
    const analysisSchema = compileGatewayComponentSchema('DpmProfileAnalysisResponse')

    expect(response.statusCode).toBe(200)
    expect(response.body.command).toBe('analyze-profile')
    expect(response.body.result.analysisReport.relationshipHints.length).toBeGreaterThan(0)
    expect(
      analysisSchema(response.body.result),
      JSON.stringify(analysisSchema.errors, null, 2),
    ).toBe(true)

    const serialized = JSON.stringify(response.body.result)
    for (const unsafeFragment of GATEWAY_PROFILE_RUNTIME_UNSAFE_RESULT_FRAGMENTS) {
      expect(serialized).not.toContain(unsafeFragment)
    }
  })
})
