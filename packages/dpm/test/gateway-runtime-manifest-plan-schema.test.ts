import { describe, expect, it } from 'vitest'

import { createDpmGatewayRuntime } from '../src/index.js'
import { compileGatewayComponentSchema } from './support/gateway-schema.js'
import { createRuntimeInput } from './support/gateway-runtime-manifest-fixtures.js'

describe('DPM gateway manifest runtime plan schemas', () => {
  it('rejects compiled plan taxonomy values outside the DPM plan contract', async () => {
    const runtime = createDpmGatewayRuntime()
    const compile = await runtime.compileDpmManifest(createRuntimeInput())
    const schema = compileGatewayComponentSchema('DpmCompiledPlan')

    expect(schema({
      ...compile.body.result.plan,
      planVersion: '2.0',
    }), 'DpmCompiledPlan unexpectedly accepted an unknown plan version').toBe(false)
    expect(schema({
      ...compile.body.result.plan,
      staleReasons: ['unknown_stale_reason'],
    }), 'DpmCompiledPlan unexpectedly accepted an unknown stale reason').toBe(false)
  })

  it('rejects relationship step taxonomy values outside the DPM plan contract', async () => {
    const runtime = createDpmGatewayRuntime()
    const compile = await runtime.compileDpmManifest(createRuntimeInput())
    const schema = compileGatewayComponentSchema('DpmRelationshipStep')
    const step = compile.body.result.plan.relationshipSteps[0]

    for (const [field, value] of [
      ['relationshipType', 'unknown_relationship_type'],
      ['cardinality', 'unknown_cardinality'],
      ['transformStrategy', 'unknown_transform_strategy'],
      ['orphanPolicy', 'unknown_orphan_policy'],
    ] as const) {
      expect(schema({
        ...step,
        [field]: value,
      }), `DpmRelationshipStep unexpectedly accepted ${field}=${value}`).toBe(false)
    }
  })
})
