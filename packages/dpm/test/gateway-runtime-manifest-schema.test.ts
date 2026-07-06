import { describe, expect, it } from 'vitest'

import { createDpmGatewayRuntime } from '../src/index.js'
import { compileGatewayComponentSchema } from './support/gateway-schema.js'
import {
  createRuntimeInput,
} from './support/gateway-runtime-fixtures.js'

const missingRelationshipDiagnostic = {
  severity: 'error',
  code: 'REL001',
  message: 'missing relationship',
  sourcePointer: '/relationships/0/name',
}

describe('DPM gateway manifest runtime response schemas', () => {
  it('keeps gateway response schemas aligned with actual runtime response payloads', async () => {
    const runtime = createDpmGatewayRuntime()
    const input = createRuntimeInput()
    const compile = await runtime.compileDpmManifest(input)
    const dryRun = await runtime.dryRunDpmManifest(input)

    const compileSchema = compileGatewayComponentSchema('DpmCompileResult')
    const dryRunSchema = compileGatewayComponentSchema('DpmDryRunResult')

    expect(compileSchema(compile.body.result), JSON.stringify(compileSchema.errors, null, 2)).toBe(true)
    expect(dryRunSchema(dryRun.body.result), JSON.stringify(dryRunSchema.errors, null, 2)).toBe(true)
  })

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

  it('rejects incomplete gateway response payloads for core runtime schemas', () => {
    for (const schemaName of ['DpmValidationResult', 'DpmCompileResult', 'DpmDryRunResult']) {
      const schema = compileGatewayComponentSchema(schemaName)
      expect(schema({}), `${schemaName} unexpectedly accepted an empty object`).toBe(false)
    }
  })

  it('rejects information-empty nested runtime response objects', () => {
    const dryRunSchema = compileGatewayComponentSchema('DpmDryRunResult')
    const diagnosticSchema = compileGatewayComponentSchema('DpmDiagnostic')

    expect(dryRunSchema({
      kind: 'dpm.dry-run-report.v1',
      planIdentity: 'plan-001',
      manifestId: 'manifest-001',
      stale: false,
      impact: {},
      categories: [],
      rawValuesIncluded: false,
    }), 'DpmDryRunResult unexpectedly accepted an empty impact object').toBe(false)
    expect(diagnosticSchema({
      ...missingRelationshipDiagnostic,
      catalogCoordinate: {},
    }), 'DpmDiagnostic unexpectedly accepted an empty catalog coordinate').toBe(false)
    expect(diagnosticSchema({
      ...missingRelationshipDiagnostic,
      registryCoordinate: {},
    }), 'DpmDiagnostic unexpectedly accepted an empty registry coordinate').toBe(false)
  })

  it('accepts minimal informative diagnostic coordinates', () => {
    const diagnosticSchema = compileGatewayComponentSchema('DpmDiagnostic')

    expect(diagnosticSchema({
      ...missingRelationshipDiagnostic,
      catalogCoordinate: { table: 'orders' },
    }), JSON.stringify(diagnosticSchema.errors, null, 2)).toBe(true)
    expect(diagnosticSchema({
      ...missingRelationshipDiagnostic,
      registryCoordinate: { relationshipName: 'rel_orders_customer' },
    }), JSON.stringify(diagnosticSchema.errors, null, 2)).toBe(true)
  })

  it('rejects diagnostic codes outside the DPM diagnostic taxonomy', () => {
    const diagnosticSchema = compileGatewayComponentSchema('DpmDiagnostic')

    expect(diagnosticSchema({
      severity: 'error',
      code: 'FOO999',
      message: 'unknown code',
      sourcePointer: '/relationships/0/name',
    }), 'DpmDiagnostic unexpectedly accepted an unknown diagnostic code').toBe(false)
  })
})
