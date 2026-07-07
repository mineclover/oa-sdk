import { describe, expect, it } from 'vitest'

import { createDpmGatewayRuntime } from '../src/index.js'
import { createKafkaProfileArtifact } from './support/gateway-runtime-profile-artifact-fixtures.js'
import {
  GATEWAY_PROFILE_RUNTIME_UNSAFE_RESULT_FRAGMENTS,
} from './support/gateway-runtime-profile-safety-fixtures.js'
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

  it('keeps profile identity mismatch drift schema-valid', async () => {
    const runtime = createDpmGatewayRuntime()
    const profileArtifact = createKafkaProfileArtifact()
    const previousProfileArtifact = {
      ...profileArtifact,
      datasetId: 'other_dataset',
      profileId: 'profile:kafka:other-orders-created',
    }
    const response = await runtime.analyzeDpmProfile({
      profileArtifact,
      previousProfileArtifact,
    })
    const analysisSchema = compileGatewayComponentSchema('DpmProfileAnalysisResponse')

    expect(response.statusCode).toBe(200)
    expect(
      analysisSchema(response.body.result),
      JSON.stringify(analysisSchema.errors, null, 2),
    ).toBe(true)
    expect(response.body.result.analysisReport.driftSignals).toContainEqual(expect.objectContaining({
      kind: 'profile_identity_mismatch',
      previousValue: 'other_dataset:profile:kafka:other-orders-created',
      currentValue: `${profileArtifact.datasetId}:${profileArtifact.profileId}`,
    }))
  })

  it('keeps profile graph integrity diagnostics schema-valid', async () => {
    const runtime = createDpmGatewayRuntime()
    const profileArtifact = createKafkaProfileArtifact()
    const response = await runtime.analyzeDpmProfile({
      profileArtifact: {
        ...profileArtifact,
        edges: [
          ...profileArtifact.edges,
          {
            id: 'edge:relationship-hint:missing-source',
            kind: 'candidate_relationship',
            fromNodeId: 'node:field:orders.created.value.customer.missing_field',
            toNodeId: 'node:relationship-hint:hint:orders-created-customer',
            confidence: 0.72,
            evidenceIds: ['evidence:kafka:missing-edge'],
          },
        ],
      },
    })
    const analysisSchema = compileGatewayComponentSchema('DpmProfileAnalysisResponse')

    expect(response.statusCode).toBe(200)
    expect(
      analysisSchema(response.body.result),
      JSON.stringify(analysisSchema.errors, null, 2),
    ).toBe(true)
    expect(response.body.result.analysisReport.diagnostics).toContainEqual(expect.objectContaining({
      code: 'PROF302',
    }))
    expect(response.body.result.analysisReport.diagnostics).toContainEqual(expect.objectContaining({
      code: 'PROF306',
    }))
  })
})
