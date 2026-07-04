import { describe, expect, it } from 'vitest'

import { createDpmGatewayRuntime } from '../src/index.js'
import { runDpmCli } from '../src/cli/index.js'
import { compileGatewayComponentSchema } from './support/gateway-schema.js'
import {
  catalogPath,
  createRuntimeInput,
  manifestPath,
  parseStdout,
  registryPath,
} from './support/gateway-runtime-fixtures.js'

describe('DPM gateway manifest runtime adapter', () => {
  it('serves validate with the same machine-readable body as the CLI', async () => {
    const runtime = createDpmGatewayRuntime()
    const response = await runtime.validateDpmManifest(createRuntimeInput())
    const cli = await runDpmCli([
      'validate',
      '--manifest',
      manifestPath,
      '--catalog',
      catalogPath,
      '--registry',
      registryPath,
    ])

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual(parseStdout(cli.stdout))
  })

  it('serves compile and dry-run with CLI-equivalent payloads without source DB access', async () => {
    const runtime = createDpmGatewayRuntime()
    const input = createRuntimeInput()

    const compile = await runtime.compileDpmManifest(input)
    const cliCompile = await runDpmCli([
      'compile',
      '--manifest',
      manifestPath,
      '--catalog',
      catalogPath,
      '--registry',
      registryPath,
    ])

    expect(compile.statusCode).toBe(200)
    expect(compile.body).toEqual(parseStdout(cliCompile.stdout))

    const dryRun = await runtime.dryRunDpmManifest(input)
    const cliDryRun = await runDpmCli([
      'dry-run',
      '--manifest',
      manifestPath,
      '--catalog',
      catalogPath,
      '--registry',
      registryPath,
    ])

    expect(dryRun.statusCode).toBe(200)
    expect(dryRun.body).toEqual(parseStdout(cliDryRun.stdout))
    expect(JSON.stringify(dryRun.body)).not.toContain('C-001')
  })

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
    const diagnostic = {
      severity: 'error',
      code: 'REL001',
      message: 'missing relationship',
      sourcePointer: '/relationships/0/name',
    }

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
      ...diagnostic,
      catalogCoordinate: {},
    }), 'DpmDiagnostic unexpectedly accepted an empty catalog coordinate').toBe(false)
    expect(diagnosticSchema({
      ...diagnostic,
      registryCoordinate: {},
    }), 'DpmDiagnostic unexpectedly accepted an empty registry coordinate').toBe(false)
  })

  it('accepts minimal informative diagnostic coordinates', () => {
    const diagnosticSchema = compileGatewayComponentSchema('DpmDiagnostic')
    const diagnostic = {
      severity: 'error',
      code: 'REL001',
      message: 'missing relationship',
      sourcePointer: '/relationships/0/name',
    }

    expect(diagnosticSchema({
      ...diagnostic,
      catalogCoordinate: { table: 'orders' },
    }), JSON.stringify(diagnosticSchema.errors, null, 2)).toBe(true)
    expect(diagnosticSchema({
      ...diagnostic,
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

  it('returns blocking diagnostics as a structured runtime response', async () => {
    const runtime = createDpmGatewayRuntime()
    const input = createRuntimeInput()
    const manifest = input.manifest as Record<string, any>
    manifest.columns[0].transform = { type: 'keep' }

    const response = await runtime.validateDpmManifest({
      ...input,
      manifest,
    })

    expect(response.statusCode).toBe(400)
    expect(response.body.command).toBe('validate')
    expect(response.body.result.valid).toBe(false)
    expect(response.body.result.diagnostics.map((diagnostic: any) => diagnostic.code)).toContain('SAF001')
  })
})
