import { describe, expect, it } from 'vitest'

import { createDpmGatewayRuntime } from '../src/index.js'
import { createKafkaProfileArtifact } from './support/gateway-runtime-profile-fixtures.js'
import { compileGatewayComponentSchema } from './support/gateway-schema.js'

describe('DPM gateway profile inspection runtime adapter', () => {
  it('keeps profile inspection output aligned with the gateway response schema', async () => {
    const runtime = createDpmGatewayRuntime()
    const profileArtifact = createKafkaProfileArtifact()
    const response = await runtime.inspectDpmProfile({ profileArtifact })
    const inspectionSchema = compileGatewayComponentSchema('DpmProfileInspectionResponse')

    expect(response.statusCode).toBe(200)
    expect(response.body.command).toBe('inspect-profile')
    expect(response.body.result.nodeCount).toBe(profileArtifact.nodes.length)
    expect(response.body.result.edgeCount).toBe(profileArtifact.edges.length)
    expect(response.body.result.metricCount).toBe(profileArtifact.metrics.length)
    expect(
      inspectionSchema(response.body.result),
      JSON.stringify(inspectionSchema.errors, null, 2),
    ).toBe(true)
  })
})
