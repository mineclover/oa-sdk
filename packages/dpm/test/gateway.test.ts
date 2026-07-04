import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'

import { parseDocument } from '../../parser/src/index.js'
import {
  DISCOVERY_CANDIDATE_RECOMMENDATIONS,
  DPM_COMPILED_PLAN_VERSIONS,
  DPM_DIAGNOSTIC_CODES,
  DPM_GATEWAY_OPERATION_IDS,
  DPM_MANIFEST_SCHEMA_ID,
  DPM_PLAN_STALE_REASONS,
  DPM_PROFILE_DRIFT_SIGNAL_KINDS,
  DPM_PROFILE_EDGE_KINDS,
  DPM_PROFILE_KEY_CANDIDATE_KINDS,
  DPM_PROFILE_METRIC_KINDS,
  DPM_PROFILE_NODE_KINDS,
  DPM_PROFILE_PROPOSAL_REVIEW_STATUSES,
  DPM_PROFILE_RELATIONSHIP_HINT_STATUSES,
  DPM_PROFILE_RISK_INDICATOR_KINDS,
  DPM_PROFILE_SOURCE_KINDS,
  DPM_RELATIONSHIP_STEP_CARDINALITIES,
  REGISTRY_ORPHAN_POLICIES,
  REGISTRY_RELATIONSHIP_KINDS,
  REGISTRY_RELATIONSHIP_STATUSES,
  REGISTRY_TRANSFORM_STRATEGIES,
  getDpmGatewayOpenApiDocument,
} from '../src/index.js'

function compileGatewayComponentSchema(name: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  ajv.addSchema(getDpmGatewayOpenApiDocument(), 'dpm-gateway')
  return ajv.compile({ $ref: `dpm-gateway#/components/schemas/${name}` })
}

const profileCoordinate = {
  kind: 'kafka_topic_bundle',
  path: 'orders.created.value.customer.customer_no',
  sourceId: 'source:kafka:orders.created',
  pointer: '/value/customer/customer_no',
  externalId: 'kafka://commerce/orders.created',
}

const profileArtifact = {
  kind: 'dpm.profile.artifact.v1',
  profileId: 'profile:kafka:orders.created',
  datasetId: 'commerce_ai',
  profileVersion: '2026-07-04',
  createdAt: '2026-07-04T00:00:00.000Z',
  sources: [{
    id: 'source:kafka:orders.created',
    kind: 'kafka_topic_bundle',
    connectorId: 'dpm.kafka.fixture',
    connectorVersion: '1.0.0',
    refs: ['kafka://commerce/orders.created'],
    captureMode: 'fixture',
  }],
  evidenceSources: {
    'evidence:kafka:orders.created.customer_no': {
      coordinate: profileCoordinate,
      connectorId: 'dpm.kafka.fixture',
    },
  },
  nodes: [{
    id: 'node:field:orders.created.value.customer.customer_no',
    kind: 'message_field',
    label: 'value.customer.customer_no',
    coordinate: profileCoordinate,
    dataType: 'string',
  }],
  edges: [],
  metrics: [],
  diagnostics: [],
  freshness: {
    versionHash: 'sha256:profile',
  },
}

const relationshipHint = {
  id: 'proposal:edge:relationship-hint:orders-created-customer',
  status: 'review',
  fromNodeId: 'node:field:orders.created.value.customer.customer_no',
  hintNodeId: 'node:relationship-hint:orders-created-customer',
  targetRef: 'catalog://commerce/public.customers.customer_no',
  confidence: 0.93,
  evidenceIds: ['evidence:kafka:orders.created.customer_no'],
  explanation: 'Review orders.created customer_no as a relationship hint.',
}

const profileAnalysisReport = {
  kind: 'dpm.profile.analysis-report.v1',
  reportId: 'profile-analysis:orders.created',
  profileId: 'profile:kafka:orders.created',
  datasetId: 'commerce_ai',
  profileVersion: '2026-07-04',
  analyzedAt: '2026-07-04T00:00:00.000Z',
  profileVersionHash: 'sha256:profile',
  coverage: {
    sourceKindCounts: { kafka_topic_bundle: 1 },
    nodeKindCounts: { message_field: 1 },
    metricKindCounts: {},
    measuredNodeCount: 0,
    measuredNodeRatio: 0,
  },
  relationshipHints: [relationshipHint],
  keyCandidates: [],
  driftSignals: [],
  riskIndicators: [],
  diagnostics: [],
  summary: {
    nodeCount: 1,
    edgeCount: 0,
    metricCount: 0,
    diagnosticCount: 0,
    relationshipHintCount: 1,
    keyCandidateCount: 0,
    riskIndicatorCount: 0,
    driftSignalCount: 0,
  },
  freshness: {
    reportHash: 'sha256:analysis',
    profileVersionHash: 'sha256:profile',
  },
}

describe('DPM gateway OpenAPI contract', () => {
  it('parses as an OpenAPI 3.2 gateway artifact through the OA SDK parser path', () => {
    const document = getDpmGatewayOpenApiDocument()
    const parsed = parseDocument(document)

    expect(parsed.openapi).toBe('3.2.0')
    expect(parsed.operations.map(operation => operation.operationId).sort()).toEqual([
      ...DPM_GATEWAY_OPERATION_IDS,
    ].sort())
    expect(parsed.operations).toHaveLength(13)
  })

  it('models the full DPM gateway workflow without exposing secret-bearing operations', () => {
    const document = getDpmGatewayOpenApiDocument()

    expect(Object.keys(document.paths).sort()).toEqual([
      '/dpm/catalog/profile',
      '/dpm/jobs/execute',
      '/dpm/jobs/{jobId}/report',
      '/dpm/manifests/compile',
      '/dpm/manifests/dry-run',
      '/dpm/manifests/validate',
      '/dpm/profiles/analyze',
      '/dpm/profiles/inspect',
      '/dpm/profiles/proposals/{proposalId}/review',
      '/dpm/registry/snapshots/{datasetId}/{registryVersion}',
      '/dpm/relationships/candidates/import',
      '/dpm/relationships/discover',
      '/dpm/relationships/{relationshipName}/approve',
    ])
    const serialized = JSON.stringify(document).toLowerCase()

    expect(serialized).not.toContain('sourcedbcredential')
    expect(serialized).not.toContain('source_db_credential')
    expect(serialized).not.toContain('vaultkey')
    expect(serialized).not.toContain('reverse token')
    expect(serialized).not.toContain('/tokens/resolve')
  })

  it('references the DPM manifest JSON Schema without taking ownership of policy semantics', () => {
    const document = getDpmGatewayOpenApiDocument()
    const manifestSchema = document.components?.schemas?.DpmManifestPolicy as Record<string, any>
    const compiledManifestPolicy = compileGatewayComponentSchema('DpmManifestPolicy')

    expect(manifestSchema['x-dpm-manifest-schema-id']).toBe(DPM_MANIFEST_SCHEMA_ID)
    expect(manifestSchema.additionalProperties).toBe(true)
    expect(manifestSchema.properties).toBeUndefined()
    expect(compiledManifestPolicy({})).toBe(true)
  })

  it('projects the runtime diagnostic code taxonomy into the gateway schema', () => {
    const document = getDpmGatewayOpenApiDocument()
    const diagnosticSchema = document.components?.schemas?.DpmDiagnostic as Record<string, any>

    expect(diagnosticSchema.properties.code.enum).toEqual([...DPM_DIAGNOSTIC_CODES])
  })

  it('projects compiled plan runtime taxonomies into the gateway schema', () => {
    const document = getDpmGatewayOpenApiDocument()
    const compiledPlanSchema = document.components?.schemas?.DpmCompiledPlan as Record<string, any>

    expect(compiledPlanSchema.properties.planVersion.enum).toEqual([...DPM_COMPILED_PLAN_VERSIONS])
    expect(compiledPlanSchema.properties.staleReasons.items.enum).toEqual([...DPM_PLAN_STALE_REASONS])
  })

  it('projects workflow response runtime taxonomies into the gateway schema', () => {
    const document = getDpmGatewayOpenApiDocument()
    const discoverySchema = document.components?.schemas?.DpmRelationshipDiscoveryReport as Record<string, any>
    const registrySchema = document.components?.schemas?.DpmRegistrySnapshotResponse as Record<string, any>

    expect(discoverySchema.properties.candidates.items.properties.recommendation.enum).toEqual([
      ...DISCOVERY_CANDIDATE_RECOMMENDATIONS,
    ])
    expect(registrySchema.properties.relationships.items.properties.status.enum).toEqual([
      ...REGISTRY_RELATIONSHIP_STATUSES,
    ])
  })

  it('projects relationship step runtime taxonomies into the gateway schema', () => {
    const document = getDpmGatewayOpenApiDocument()
    const relationshipStepSchema = document.components?.schemas?.DpmRelationshipStep as Record<string, any>

    expect(relationshipStepSchema.properties.relationshipType.enum).toEqual([...REGISTRY_RELATIONSHIP_KINDS])
    expect(relationshipStepSchema.properties.cardinality.enum).toEqual([...DPM_RELATIONSHIP_STEP_CARDINALITIES])
    expect(relationshipStepSchema.properties.transformStrategy.enum).toEqual([...REGISTRY_TRANSFORM_STRATEGIES])
    expect(relationshipStepSchema.properties.orphanPolicy.enum).toEqual([...REGISTRY_ORPHAN_POLICIES])
  })

  it('projects profile runtime taxonomies into the gateway schema', () => {
    const document = getDpmGatewayOpenApiDocument()
    const coordinateSchema = document.components?.schemas?.DpmProfileCoordinate as Record<string, any>
    const sourceSchema = document.components?.schemas?.DpmProfileSourceDescriptor as Record<string, any>
    const nodeSchema = document.components?.schemas?.DpmProfileNode as Record<string, any>
    const edgeSchema = document.components?.schemas?.DpmProfileEdge as Record<string, any>
    const metricSchema = document.components?.schemas?.DpmProfileMetric as Record<string, any>
    const hintSchema = document.components?.schemas?.DpmProfileRelationshipHintProposal as Record<string, any>
    const keySchema = document.components?.schemas?.DpmProfileKeyCandidate as Record<string, any>
    const driftSchema = document.components?.schemas?.DpmProfileDriftSignal as Record<string, any>
    const riskSchema = document.components?.schemas?.DpmProfileRiskIndicator as Record<string, any>
    const reviewSchema = document.components?.schemas?.DpmProfileProposalReviewRequest as Record<string, any>

    expect(coordinateSchema.properties.kind.enum).toEqual([...DPM_PROFILE_SOURCE_KINDS])
    expect(sourceSchema.properties.kind.enum).toEqual([...DPM_PROFILE_SOURCE_KINDS])
    expect(nodeSchema.properties.kind.enum).toEqual([...DPM_PROFILE_NODE_KINDS])
    expect(edgeSchema.properties.kind.enum).toEqual([...DPM_PROFILE_EDGE_KINDS])
    expect(metricSchema.properties.kind.enum).toEqual([...DPM_PROFILE_METRIC_KINDS])
    expect(hintSchema.properties.status.enum).toEqual([...DPM_PROFILE_RELATIONSHIP_HINT_STATUSES])
    expect(keySchema.properties.kind.enum).toEqual([...DPM_PROFILE_KEY_CANDIDATE_KINDS])
    expect(driftSchema.properties.kind.enum).toEqual([...DPM_PROFILE_DRIFT_SIGNAL_KINDS])
    expect(riskSchema.properties.kind.enum).toEqual([...DPM_PROFILE_RISK_INDICATOR_KINDS])
    expect(reviewSchema.properties.status.enum).toEqual([...DPM_PROFILE_PROPOSAL_REVIEW_STATUSES])
  })

  it('rejects empty objects for every non-opaque gateway component schema', () => {
    const document = getDpmGatewayOpenApiDocument()
    const schemaNames = Object.keys(document.components?.schemas ?? {})
      .filter(schemaName => schemaName !== 'DpmManifestPolicy')

    for (const schemaName of schemaNames) {
      const schema = compileGatewayComponentSchema(schemaName)
      expect(schema({}), `${schemaName} unexpectedly accepted an empty object`).toBe(false)
    }
  })

  it('rejects incomplete request payloads for gateway write operations', () => {
    for (const schemaName of [
      'DpmCatalogProfileRequest',
      'DpmProfileInspectionRequest',
      'DpmProfileAnalysisRequest',
      'DpmProfileProposalReviewRequest',
      'DpmRelationshipDiscoveryRequest',
      'DpmCandidateImportRequest',
      'DpmRelationshipApprovalRequest',
      'DpmManifestValidationRequest',
      'DpmManifestCompileRequest',
      'DpmManifestDryRunRequest',
      'DpmExecuteJobRequest',
    ]) {
      const schema = compileGatewayComponentSchema(schemaName)
      expect(schema({}), `${schemaName} unexpectedly accepted an empty object`).toBe(false)
    }
  })

  it('accepts minimal request payloads for gateway write operations', () => {
    const snapshotRef = { ref: 'catalog://commerce/v1', versionHash: 'sha256:test' }
    const manifest = { dpm_version: '1.0' }
    const cases: Array<[string, Record<string, unknown>]> = [
      ['DpmCatalogProfileRequest', { datasetId: 'commerce_ai', catalogSourceRef: 'source://catalog', manifest }],
      ['DpmProfileInspectionRequest', { profileArtifact }],
      ['DpmProfileAnalysisRequest', { profileArtifact }],
      ['DpmProfileProposalReviewRequest', {
        proposalId: relationshipHint.id,
        status: 'accepted',
        reviewedBy: 'privacy-reviewer',
        reason: 'reviewed against catalog evidence',
        coordinate: profileCoordinate,
        relationshipHint,
      }],
      ['DpmRelationshipDiscoveryRequest', { manifest, catalogSnapshot: snapshotRef }],
      ['DpmCandidateImportRequest', { datasetId: 'commerce_ai', candidates: [{ name: 'rel_orders_customer', evidenceRef: 'evidence://rel' }] }],
      ['DpmRelationshipApprovalRequest', { owner: 'privacy', approvedBy: 'reviewer', reason: 'reviewed' }],
      ['DpmManifestValidationRequest', { manifest, catalogSnapshot: snapshotRef, registrySnapshot: snapshotRef }],
      ['DpmManifestCompileRequest', { manifest, catalogSnapshot: snapshotRef, registrySnapshot: snapshotRef }],
      ['DpmManifestDryRunRequest', { manifest, catalogSnapshot: snapshotRef, registrySnapshot: snapshotRef }],
      ['DpmExecuteJobRequest', { planRef: 'compiled-plan://commerce', targetDatasetRef: 'target://ai' }],
    ]

    for (const [schemaName, payload] of cases) {
      const schema = compileGatewayComponentSchema(schemaName)
      expect(schema(payload), JSON.stringify(schema.errors, null, 2)).toBe(true)
    }
  })

  it('rejects incomplete response payloads for gateway workflow schemas', () => {
    for (const schemaName of [
      'DpmCatalogProfileResponse',
      'DpmProfileInspectionResponse',
      'DpmProfileAnalysisResponse',
      'DpmProfileProposalReviewResponse',
      'DpmRelationshipDiscoveryReport',
      'DpmCandidateImportResponse',
      'DpmRelationshipApprovalResponse',
      'DpmRegistrySnapshotResponse',
      'DpmExecuteJobResponse',
      'DpmJobReport',
    ]) {
      const schema = compileGatewayComponentSchema(schemaName)
      expect(schema({}), `${schemaName} unexpectedly accepted an empty object`).toBe(false)
    }
  })

  it('accepts minimal response payloads for gateway workflow schemas', () => {
    const diagnostic = {
      severity: 'info',
      code: 'SAF007',
      message: 'ok',
      sourcePointer: '/quality_gates',
    }
    const cases: Array<[string, Record<string, unknown>]> = [
      ['DpmCatalogProfileResponse', {
        catalogSnapshotRef: 'catalog://commerce/v1',
        catalogVersionHash: 'sha256:test',
        diagnostics: [diagnostic],
      }],
      ['DpmProfileInspectionResponse', {
        profileArtifact,
        nodeCount: 1,
        edgeCount: 0,
        metricCount: 0,
        diagnostics: [],
      }],
      ['DpmProfileAnalysisResponse', {
        analysisReport: profileAnalysisReport,
      }],
      ['DpmProfileProposalReviewResponse', {
        proposalId: relationshipHint.id,
        status: 'accepted',
        reviewedBy: 'privacy-reviewer',
        reason: 'reviewed against catalog evidence',
        coordinate: profileCoordinate,
        relationshipHint,
        diagnostics: [],
      }],
      ['DpmRelationshipDiscoveryReport', {
        reportRef: 'report://discovery',
        candidates: [{ name: 'rel_orders_customer', recommendation: 'review' }],
      }],
      ['DpmCandidateImportResponse', { imported: 1, rejected: 0 }],
      ['DpmRelationshipApprovalResponse', { relationshipName: 'rel_orders_customer', status: 'approved' }],
      ['DpmRegistrySnapshotResponse', {
        datasetId: 'commerce_ai',
        registryVersion: 'reg-2026-07-01',
        relationships: [{ name: 'rel_orders_customer', status: 'approved' }],
      }],
      ['DpmExecuteJobResponse', { jobId: 'job_001', status: 'accepted' }],
      ['DpmJobReport', {
        jobId: 'job_001',
        status: 'completed',
        validationReportRef: 'dpm-report:job_001',
        diagnostics: [],
      }],
    ]

    for (const [schemaName, payload] of cases) {
      const schema = compileGatewayComponentSchema(schemaName)
      expect(schema(payload), JSON.stringify(schema.errors, null, 2)).toBe(true)
    }
  })

  it('rejects job report statuses outside the persisted validation report lifecycle', () => {
    const schema = compileGatewayComponentSchema('DpmJobReport')

    expect(schema({
      jobId: 'job_001',
      status: 'accepted',
      validationReportRef: 'dpm-report:job_001',
      diagnostics: [],
    }), 'DpmJobReport unexpectedly accepted a pre-report job status').toBe(false)
    expect(schema({
      jobId: 'job_001',
      status: 'failed',
      validationReportRef: 'dpm-report:job_001',
      diagnostics: [],
    }), JSON.stringify(schema.errors, null, 2)).toBe(true)
  })

  it('rejects workflow response taxonomy values outside DPM review and registry contracts', () => {
    const discoverySchema = compileGatewayComponentSchema('DpmRelationshipDiscoveryReport')
    const registrySchema = compileGatewayComponentSchema('DpmRegistrySnapshotResponse')

    expect(discoverySchema({
      reportRef: 'report://discovery',
      candidates: [{ name: 'rel_orders_customer', recommendation: 'auto_approve' }],
    }), 'DpmRelationshipDiscoveryReport unexpectedly accepted an unknown recommendation').toBe(false)
    expect(registrySchema({
      datasetId: 'commerce_ai',
      registryVersion: 'reg-2026-07-01',
      relationships: [{ name: 'rel_orders_customer', status: 'unknown_status' }],
    }), 'DpmRegistrySnapshotResponse unexpectedly accepted an unknown relationship status').toBe(false)
  })

  it('rejects incomplete profile analysis payloads and editor evidence mutation patches', () => {
    const analysisRequestSchema = compileGatewayComponentSchema('DpmProfileAnalysisRequest')
    const analysisResponseSchema = compileGatewayComponentSchema('DpmProfileAnalysisResponse')
    const reviewRequestSchema = compileGatewayComponentSchema('DpmProfileProposalReviewRequest')

    expect(analysisRequestSchema({
      profileArtifact: {},
    }), 'DpmProfileAnalysisRequest unexpectedly accepted an incomplete profile artifact').toBe(false)
    expect(analysisResponseSchema({
      analysisReport: {
        kind: 'dpm.profile.analysis-report.v1',
        reportId: 'profile-analysis:orders.created',
      },
    }), 'DpmProfileAnalysisResponse unexpectedly accepted an incomplete analysis report').toBe(false)
    expect(reviewRequestSchema({
      proposalId: relationshipHint.id,
      status: 'accepted',
      reviewedBy: 'privacy-reviewer',
      reason: 'reviewed against catalog evidence',
      rawPatch: { evidenceSources: {} },
    }), 'DpmProfileProposalReviewRequest unexpectedly accepted a raw evidence patch').toBe(false)
    expect(reviewRequestSchema({
      proposalId: relationshipHint.id,
      status: 'accepted',
      reviewedBy: 'privacy-reviewer',
      reason: 'reviewed against catalog evidence',
      profileArtifact,
    }), 'DpmProfileProposalReviewRequest unexpectedly accepted a profile artifact overwrite').toBe(false)
    expect(reviewRequestSchema({
      proposalId: relationshipHint.id,
      status: 'review',
      reviewedBy: 'privacy-reviewer',
      reason: 'reviewed against catalog evidence',
    }), 'DpmProfileProposalReviewRequest unexpectedly accepted the pre-decision relationship hint status').toBe(false)
  })
})
