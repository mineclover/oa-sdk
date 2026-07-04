import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'

import {
  DPM_GATEWAY_RUNTIME_OPERATION_IDS,
  DPM_PROFILE_PROPOSAL_REVIEW_STATUSES,
  createDpmGatewayRuntime,
  createPostgresCatalogSnapshot,
  getDpmGatewayOpenApiDocument,
  parseRegistrySnapshotYaml,
  profileKafkaTopicFixture,
  type DpmKafkaTopicProfileFixture,
} from '../src/index.js'
import { runDpmCli } from '../src/cli/index.js'

const fixturesRoot = new URL('./fixtures/', import.meta.url)
const manifestPath = join(fixturesRoot.pathname, 'valid/customer-orders.json')
const catalogPath = join(fixturesRoot.pathname, 'catalog/postgres-commerce.json')
const registryPath = join(fixturesRoot.pathname, 'registry/commerce-registry.yaml')
const kafkaProfilePath = join(fixturesRoot.pathname, 'profile/kafka-orders-created.json')

function readJsonFixture<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function parseStdout(stdout: string): Record<string, any> {
  return JSON.parse(stdout) as Record<string, any>
}

function createRuntimeInput() {
  return {
    manifest: readJsonFixture(manifestPath),
    catalog: createPostgresCatalogSnapshot(readJsonFixture(catalogPath)),
    registry: parseRegistrySnapshotYaml(readFileSync(registryPath, 'utf8')),
  }
}

function createKafkaProfileArtifact() {
  const result = profileKafkaTopicFixture(readJsonFixture<DpmKafkaTopicProfileFixture>(kafkaProfilePath))
  if (!result.profileArtifact) throw new Error('expected Kafka profile artifact')
  return result.profileArtifact
}

function compileGatewayComponentSchema(name: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  ajv.addSchema(getDpmGatewayOpenApiDocument(), 'dpm-gateway')
  return ajv.compile({ $ref: `dpm-gateway#/components/schemas/${name}` })
}

describe('DPM gateway runtime adapter', () => {
  it('exposes only local profile and manifest runtime operations', () => {
    expect(DPM_GATEWAY_RUNTIME_OPERATION_IDS).toEqual([
      'inspectDpmProfile',
      'analyzeDpmProfile',
      'reviewDpmProfileProposal',
      'validateDpmManifest',
      'compileDpmManifest',
      'dryRunDpmManifest',
    ])
    expect(DPM_PROFILE_PROPOSAL_REVIEW_STATUSES).toEqual(['accepted', 'rejected', 'needs_changes'])
    expect(DPM_GATEWAY_RUNTIME_OPERATION_IDS).not.toContain('executeDpmJob')
    expect(DPM_GATEWAY_RUNTIME_OPERATION_IDS).not.toContain('getDpmValidationReport')
  })

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

  it('keeps profile inspection and analysis outputs aligned with gateway response schemas', async () => {
    const runtime = createDpmGatewayRuntime()
    const profileArtifact = createKafkaProfileArtifact()

    const inspection = await runtime.inspectDpmProfile({ profileArtifact })
    const analysis = await runtime.analyzeDpmProfile({ profileArtifact })
    const inspectionSchema = compileGatewayComponentSchema('DpmProfileInspectionResponse')
    const analysisSchema = compileGatewayComponentSchema('DpmProfileAnalysisResponse')

    expect(inspection.statusCode).toBe(200)
    expect(inspection.body.command).toBe('inspect-profile')
    expect(inspection.body.result.nodeCount).toBe(profileArtifact.nodes.length)
    expect(inspection.body.result.edgeCount).toBe(profileArtifact.edges.length)
    expect(inspection.body.result.metricCount).toBe(profileArtifact.metrics.length)
    expect(inspectionSchema(inspection.body.result), JSON.stringify(inspectionSchema.errors, null, 2)).toBe(true)

    expect(analysis.statusCode).toBe(200)
    expect(analysis.body.command).toBe('analyze-profile')
    expect(analysis.body.result.analysisReport.relationshipHints.length).toBeGreaterThan(0)
    expect(analysisSchema(analysis.body.result), JSON.stringify(analysisSchema.errors, null, 2)).toBe(true)
    expect(JSON.stringify(analysis.body.result)).not.toContain('rawSample')
    expect(JSON.stringify(analysis.body.result)).not.toContain('C-001')
  })

  it('keeps profile proposal review output editor-safe and schema-valid', async () => {
    const runtime = createDpmGatewayRuntime()
    const profileArtifact = createKafkaProfileArtifact()
    const analysis = await runtime.analyzeDpmProfile({ profileArtifact })
    const relationshipHint = analysis.body.result.analysisReport.relationshipHints[0]
    const coordinate = profileArtifact.nodes.find(node => node.id === relationshipHint?.fromNodeId)?.coordinate
    if (!relationshipHint || !coordinate) throw new Error('expected relationship hint and source coordinate')

    const response = await runtime.reviewDpmProfileProposal({
      proposalId: relationshipHint.id,
      status: 'accepted',
      reviewedBy: 'privacy-reviewer',
      reason: 'reviewed as a logical relationship candidate',
      reviewedAt: '2026-07-04T00:00:00.000Z',
      coordinate,
      relationshipHint,
    })
    const reviewSchema = compileGatewayComponentSchema('DpmProfileProposalReviewResponse')

    expect(response.statusCode).toBe(200)
    expect(response.body.command).toBe('review-profile-proposal')
    expect(reviewSchema(response.body.result), JSON.stringify(reviewSchema.errors, null, 2)).toBe(true)
    expect(response.body.result).not.toHaveProperty('profileArtifact')
    expect(response.body.result).not.toHaveProperty('evidenceSources')
    expect(JSON.stringify(response.body.result)).not.toContain('rawSample')
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
