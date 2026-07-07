import { describe, expect, it } from 'vitest'

import {
  createDpmGatewayRuntime,
  createDpmProfileBaselineRepository,
  resolveDpmGatewayProfileAnalysisRuntimeInput,
  type DpmProfileBaselineRow,
} from '../src/index.js'
import {
  createKafkaProfileArtifact,
  createKafkaProfileArtifactWithCustomerNoPresence,
} from './support/profile-analysis-fixtures.js'
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

  it('resolves previous profile artifacts from stored baseline refs before runtime analysis', async () => {
    const runtime = createDpmGatewayRuntime()
    const rows = new Map<string, DpmProfileBaselineRow>()
    const profileBaselineRepository = createDpmProfileBaselineRepository({
      upsertProfileBaseline: row => rows.set(row.baselineRef, row),
      getProfileBaseline: request => rows.get(request.baselineRef),
      listProfileBaselines: () => [...rows.values()],
    })
    const profileArtifact = createKafkaProfileArtifact()
    const previousProfileArtifact = createKafkaProfileArtifactWithCustomerNoPresence(0.91)
    const baseline = await profileBaselineRepository.saveProfileBaseline({
      profileArtifact: previousProfileArtifact,
      storedAt: '2026-07-07T00:00:00.000Z',
    })
    const requestSchema = compileGatewayComponentSchema('DpmProfileAnalysisRequest')

    const runtimeInput = await resolveDpmGatewayProfileAnalysisRuntimeInput({
      request: {
        profileArtifact,
        previousProfileBaseline: { baselineRef: baseline.baselineRef },
      },
      profileBaselineRepository,
    })
    const response = await runtime.analyzeDpmProfile(runtimeInput)

    expect(
      requestSchema({
        profileArtifact,
        previousProfileBaseline: { baselineRef: baseline.baselineRef },
      }),
      JSON.stringify(requestSchema.errors, null, 2),
    ).toBe(true)
    expect(runtimeInput.previousProfileArtifact?.freshness.versionHash)
      .toBe(previousProfileArtifact.freshness.versionHash)
    expect(response.statusCode).toBe(200)
    expect(response.body.result.analysisReport.freshness.previousProfileVersionHash)
      .toBe(previousProfileArtifact.freshness.versionHash)
    expect(response.body.result.analysisReport.driftSignals).toContainEqual(expect.objectContaining({
      kind: 'metric_value_changed',
      metricId: 'metric:orders.created.value.customer.customer_no.presence',
      previousValue: 0.91,
      currentValue: 0.997,
    }))
  })

  it('rejects unresolved or ambiguous profile baseline analysis requests', async () => {
    const profileArtifact = createKafkaProfileArtifact()
    const previousProfileArtifact = createKafkaProfileArtifactWithCustomerNoPresence(0.91)
    const profileBaselineRepository = {
      getProfileBaseline: async () => undefined,
    }

    await expect(resolveDpmGatewayProfileAnalysisRuntimeInput({
      request: {
        profileArtifact,
        previousProfileBaseline: { baselineRef: 'missing-profile-baseline' },
      },
      profileBaselineRepository,
    })).rejects.toThrow('profile baseline not found: missing-profile-baseline')

    await expect(resolveDpmGatewayProfileAnalysisRuntimeInput({
      request: {
        profileArtifact,
        previousProfileArtifact,
        previousProfileBaseline: { baselineRef: 'ambiguous-profile-baseline' },
      },
      profileBaselineRepository,
    })).rejects.toThrow('either previousProfileArtifact or previousProfileBaseline')
  })
})
