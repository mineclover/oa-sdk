import {
  DPM_COMPILED_PLAN_VERSIONS,
  DPM_PLAN_STALE_REASONS,
  DPM_RELATIONSHIP_STEP_CARDINALITIES,
} from '../compiler/plan.js'
import { DISCOVERY_CANDIDATE_RECOMMENDATIONS } from '../discovery/types.js'
import {
  DPM_PROFILE_ANALYSIS_REPORT_KIND,
  DPM_PROFILE_DRIFT_SIGNAL_KINDS,
  DPM_PROFILE_KEY_CANDIDATE_KINDS,
  DPM_PROFILE_RELATIONSHIP_HINT_STATUSES,
  DPM_PROFILE_RISK_INDICATOR_KINDS,
} from '../profile/analyze.js'
import {
  DPM_PROFILE_ARTIFACT_KIND,
  DPM_PROFILE_CAPTURE_MODES,
  DPM_PROFILE_EDGE_KINDS,
  DPM_PROFILE_METRIC_KINDS,
  DPM_PROFILE_NODE_KINDS,
  DPM_PROFILE_SOURCE_KINDS,
} from '../profile/types.js'
import {
  REGISTRY_ORPHAN_POLICIES,
  REGISTRY_RELATIONSHIP_KINDS,
  REGISTRY_RELATIONSHIP_STATUSES,
  REGISTRY_TRANSFORM_STRATEGIES,
} from '../registry/types.js'
import { DPM_MANIFEST_SCHEMA_ID } from '../schema/index.js'
import { DPM_DIAGNOSTIC_CODES } from '../validator/diagnostics.js'
import { DPM_PROFILE_PROPOSAL_REVIEW_STATUSES } from './profile-proposal.js'

export const DPM_GATEWAY_OPERATION_IDS = [
  'profileDpmCatalog',
  'inspectDpmProfile',
  'analyzeDpmProfile',
  'reviewDpmProfileProposal',
  'discoverDpmRelationships',
  'importDpmRelationshipCandidates',
  'approveDpmRelationshipCandidate',
  'exportDpmRegistrySnapshot',
  'validateDpmManifest',
  'compileDpmManifest',
  'dryRunDpmManifest',
  'executeDpmJob',
  'getDpmValidationReport',
] as const

export type DpmGatewayOperationId = typeof DPM_GATEWAY_OPERATION_IDS[number]
export type DpmGatewayOpenApiDocument = ReturnType<typeof createDpmGatewayOpenApiDocument>

export function getDpmGatewayOpenApiDocument(): DpmGatewayOpenApiDocument {
  return createDpmGatewayOpenApiDocument()
}

function createDpmGatewayOpenApiDocument() {
  return {
    openapi: '3.2.0',
    info: {
      title: 'OA SDK DPM Gateway',
      version: '1.0.0',
      summary: 'Relationship-first Data Pseudonymization Manifest gateway contract.',
    },
    servers: [
      {
        url: 'https://api.example.com',
        description: 'Deployment-specific DPM gateway host.',
      },
    ],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'catalog', description: 'Catalog profiling and structural evidence.' },
      { name: 'profiles', description: 'Profile artifact inspection, analysis, and editor-safe proposal review.' },
      { name: 'relationships', description: 'Relationship discovery, candidate review, and registry snapshots.' },
      { name: 'manifests', description: 'Manifest validation, compilation, and dry-run workflows.' },
      { name: 'jobs', description: 'Execution jobs and validation reports.' },
    ],
    paths: {
      '/dpm/catalog/profile': {
        post: operation({
          operationId: 'profileDpmCatalog',
          tags: ['catalog'],
          summary: 'Profile catalog evidence for a DPM dataset.',
          requestBody: requestBody('DpmCatalogProfileRequest'),
          responseSchema: 'DpmCatalogProfileResponse',
        }),
      },
      '/dpm/profiles/inspect': {
        post: operation({
          operationId: 'inspectDpmProfile',
          tags: ['profiles'],
          summary: 'Inspect a normalized profile artifact for editor visualization.',
          requestBody: requestBody('DpmProfileInspectionRequest'),
          responseSchema: 'DpmProfileInspectionResponse',
        }),
      },
      '/dpm/profiles/analyze': {
        post: operation({
          operationId: 'analyzeDpmProfile',
          tags: ['profiles'],
          summary: 'Analyze profile evidence into reviewable hints, risks, drift, and coverage.',
          requestBody: requestBody('DpmProfileAnalysisRequest'),
          responseSchema: 'DpmProfileAnalysisResponse',
        }),
      },
      '/dpm/profiles/proposals/{proposalId}/review': {
        post: operation({
          operationId: 'reviewDpmProfileProposal',
          tags: ['profiles'],
          summary: 'Record an editor-safe review decision for a profile proposal.',
          parameters: [pathParameter('proposalId')],
          requestBody: requestBody('DpmProfileProposalReviewRequest'),
          responseSchema: 'DpmProfileProposalReviewResponse',
        }),
      },
      '/dpm/relationships/discover': {
        post: operation({
          operationId: 'discoverDpmRelationships',
          tags: ['relationships'],
          summary: 'Discover candidate logical relationships from catalog evidence.',
          requestBody: requestBody('DpmRelationshipDiscoveryRequest'),
          responseSchema: 'DpmRelationshipDiscoveryReport',
        }),
      },
      '/dpm/relationships/candidates/import': {
        post: operation({
          operationId: 'importDpmRelationshipCandidates',
          tags: ['relationships'],
          summary: 'Import reviewable relationship candidates.',
          requestBody: requestBody('DpmCandidateImportRequest'),
          responseSchema: 'DpmCandidateImportResponse',
        }),
      },
      '/dpm/relationships/{relationshipName}/approve': {
        post: operation({
          operationId: 'approveDpmRelationshipCandidate',
          tags: ['relationships'],
          summary: 'Approve a candidate logical relationship.',
          parameters: [pathParameter('relationshipName')],
          requestBody: requestBody('DpmRelationshipApprovalRequest'),
          responseSchema: 'DpmRelationshipApprovalResponse',
        }),
      },
      '/dpm/registry/snapshots/{datasetId}/{registryVersion}': {
        get: operation({
          operationId: 'exportDpmRegistrySnapshot',
          tags: ['relationships'],
          summary: 'Export an approved relationship registry snapshot.',
          parameters: [pathParameter('datasetId'), pathParameter('registryVersion')],
          responseSchema: 'DpmRegistrySnapshotResponse',
        }),
      },
      '/dpm/manifests/validate': {
        post: operation({
          operationId: 'validateDpmManifest',
          tags: ['manifests'],
          summary: 'Validate a DPM manifest against catalog and registry snapshots.',
          requestBody: requestBody('DpmManifestValidationRequest'),
          responseSchema: 'DpmValidationResult',
        }),
      },
      '/dpm/manifests/compile': {
        post: operation({
          operationId: 'compileDpmManifest',
          tags: ['manifests'],
          summary: 'Compile a validated DPM manifest into an execution plan.',
          requestBody: requestBody('DpmManifestCompileRequest'),
          responseSchema: 'DpmCompileResult',
        }),
      },
      '/dpm/manifests/dry-run': {
        post: operation({
          operationId: 'dryRunDpmManifest',
          tags: ['manifests'],
          summary: 'Create a dry-run impact report from a compiled DPM plan.',
          requestBody: requestBody('DpmManifestDryRunRequest'),
          responseSchema: 'DpmDryRunResult',
        }),
      },
      '/dpm/jobs/execute': {
        post: operation({
          operationId: 'executeDpmJob',
          tags: ['jobs'],
          summary: 'Start a DPM execution job from a compiled plan reference.',
          requestBody: requestBody('DpmExecuteJobRequest'),
          responseSchema: 'DpmExecuteJobResponse',
          statusCode: '202',
        }),
      },
      '/dpm/jobs/{jobId}/report': {
        get: operation({
          operationId: 'getDpmValidationReport',
          tags: ['jobs'],
          summary: 'Fetch a DPM execution validation report.',
          parameters: [pathParameter('jobId')],
          responseSchema: 'DpmJobReport',
        }),
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
        },
      },
      schemas: {
        DpmManifestPolicy: {
          type: 'object',
          additionalProperties: true,
          description: 'Opaque DPM policy body. Syntax ownership stays with the DPM JSON Schema.',
          'x-dpm-manifest-schema-id': DPM_MANIFEST_SCHEMA_ID,
        },
        DpmManifestRef: requiredObjectSchema({
          manifestId: stringSchema(),
          policyVersion: stringSchema(),
          manifest: ref('DpmManifestPolicy'),
        }),
        DpmSnapshotRef: requiredObjectSchema({
          ref: stringSchema(),
          versionHash: stringSchema(),
        }),
        DpmCatalogProfileRequest: requiredObjectSchema({
          datasetId: stringSchema(),
          catalogSourceRef: stringSchema(),
          manifest: ref('DpmManifestPolicy'),
        }),
        DpmCatalogProfileResponse: requiredObjectSchema({
          catalogSnapshotRef: stringSchema(),
          catalogVersionHash: stringSchema(),
          diagnostics: arrayOf(ref('DpmDiagnostic')),
        }),
        DpmProfileCoordinate: requiredObjectSchema({
          kind: { type: 'string', enum: [...DPM_PROFILE_SOURCE_KINDS] },
          path: stringSchema(),
          sourceId: stringSchema(),
          pointer: stringSchema(),
          externalId: stringSchema(),
        }, ['kind', 'path']),
        DpmProfileSourceDescriptor: requiredObjectSchema({
          id: stringSchema(),
          kind: { type: 'string', enum: [...DPM_PROFILE_SOURCE_KINDS] },
          connectorId: stringSchema(),
          connectorVersion: stringSchema(),
          refs: arrayOf(stringSchema()),
          captureMode: { type: 'string', enum: [...DPM_PROFILE_CAPTURE_MODES] },
          capturedAt: stringSchema(),
          sourceVersionHash: stringSchema(),
        }, ['id', 'kind', 'connectorId', 'connectorVersion', 'refs', 'captureMode']),
        DpmProfileEvidenceSource: requiredObjectSchema({
          coordinate: ref('DpmProfileCoordinate'),
          connectorId: stringSchema(),
          capturedAt: stringSchema(),
          description: stringSchema(),
        }, ['coordinate']),
        DpmProfileNode: requiredObjectSchema({
          id: stringSchema(),
          kind: { type: 'string', enum: [...DPM_PROFILE_NODE_KINDS] },
          label: stringSchema(),
          coordinate: ref('DpmProfileCoordinate'),
          dataType: stringSchema(),
          shape: recordOf({ oneOf: [stringSchema(), numberSchema(), { type: 'boolean' }, { type: 'null' }] }),
        }, ['id', 'kind', 'label', 'coordinate']),
        DpmProfileEdge: requiredObjectSchema({
          id: stringSchema(),
          kind: { type: 'string', enum: [...DPM_PROFILE_EDGE_KINDS] },
          fromNodeId: stringSchema(),
          toNodeId: stringSchema(),
          evidenceIds: arrayOf(stringSchema()),
          confidence: ratioSchema(),
        }, ['id', 'kind', 'fromNodeId', 'toNodeId', 'evidenceIds']),
        DpmProfileMetric: requiredObjectSchema({
          id: stringSchema(),
          kind: { type: 'string', enum: [...DPM_PROFILE_METRIC_KINDS] },
          subjectId: stringSchema(),
          value: { oneOf: [numberSchema(), stringSchema()] },
          unit: stringSchema(),
          evidenceIds: arrayOf(stringSchema()),
        }, ['id', 'kind', 'subjectId', 'value', 'evidenceIds']),
        DpmProfileDiagnostic: requiredObjectSchema({
          severity: { type: 'string', enum: ['error', 'warning', 'info'] },
          code: { type: 'string', pattern: '^(PROF|CONN)[0-9]{3}$' },
          message: stringSchema(),
          connectorId: stringSchema(),
          coordinate: ref('DpmProfileCoordinate'),
          evidenceIds: arrayOf(stringSchema()),
        }, ['severity', 'code', 'message']),
        DpmProfileFreshness: requiredObjectSchema({
          versionHash: stringSchema(),
          sourceVersionHashes: recordOf(stringSchema()),
        }, ['versionHash']),
        DpmProfileArtifact: requiredObjectSchema({
          kind: { type: 'string', const: DPM_PROFILE_ARTIFACT_KIND },
          profileId: stringSchema(),
          datasetId: stringSchema(),
          profileVersion: stringSchema(),
          createdAt: stringSchema(),
          sources: arrayOf(ref('DpmProfileSourceDescriptor')),
          evidenceSources: recordOf(ref('DpmProfileEvidenceSource')),
          nodes: arrayOf(ref('DpmProfileNode')),
          edges: arrayOf(ref('DpmProfileEdge')),
          metrics: arrayOf(ref('DpmProfileMetric')),
          diagnostics: arrayOf(ref('DpmProfileDiagnostic')),
          freshness: ref('DpmProfileFreshness'),
        }),
        DpmProfileInspectionRequest: requiredObjectSchema({
          profileArtifact: ref('DpmProfileArtifact'),
        }),
        DpmProfileInspectionResponse: requiredObjectSchema({
          profileArtifact: ref('DpmProfileArtifact'),
          nodeCount: integerSchema(),
          edgeCount: integerSchema(),
          metricCount: integerSchema(),
          diagnostics: arrayOf(ref('DpmProfileDiagnostic')),
        }),
        DpmProfileAnalysisRequest: requiredObjectSchema({
          profileArtifact: ref('DpmProfileArtifact'),
          previousProfileArtifact: ref('DpmProfileArtifact'),
          reportId: stringSchema(),
          analyzedAt: stringSchema(),
        }, ['profileArtifact']),
        DpmProfileAnalysisResponse: requiredObjectSchema({
          analysisReport: ref('DpmProfileAnalysisReport'),
        }),
        DpmProfileAnalysisReport: requiredObjectSchema({
          kind: { type: 'string', const: DPM_PROFILE_ANALYSIS_REPORT_KIND },
          reportId: stringSchema(),
          profileId: stringSchema(),
          datasetId: stringSchema(),
          profileVersion: stringSchema(),
          analyzedAt: stringSchema(),
          profileVersionHash: stringSchema(),
          coverage: ref('DpmProfileAnalysisCoverage'),
          relationshipHints: arrayOf(ref('DpmProfileRelationshipHintProposal')),
          keyCandidates: arrayOf(ref('DpmProfileKeyCandidate')),
          driftSignals: arrayOf(ref('DpmProfileDriftSignal')),
          riskIndicators: arrayOf(ref('DpmProfileRiskIndicator')),
          diagnostics: arrayOf(ref('DpmProfileDiagnostic')),
          summary: ref('DpmProfileAnalysisSummary'),
          freshness: ref('DpmProfileAnalysisFreshness'),
        }),
        DpmProfileAnalysisCoverage: requiredObjectSchema({
          sourceKindCounts: countRecordSchema(DPM_PROFILE_SOURCE_KINDS),
          nodeKindCounts: countRecordSchema(DPM_PROFILE_NODE_KINDS),
          metricKindCounts: countRecordSchema(DPM_PROFILE_METRIC_KINDS),
          measuredNodeCount: integerSchema(),
          measuredNodeRatio: ratioSchema(),
        }),
        DpmProfileRelationshipHintProposal: requiredObjectSchema({
          id: stringSchema(),
          status: { type: 'string', enum: [...DPM_PROFILE_RELATIONSHIP_HINT_STATUSES] },
          fromNodeId: stringSchema(),
          hintNodeId: stringSchema(),
          targetRef: stringSchema(),
          confidence: ratioSchema(),
          evidenceIds: arrayOf(stringSchema()),
          explanation: stringSchema(),
        }, ['id', 'status', 'fromNodeId', 'hintNodeId', 'confidence', 'evidenceIds', 'explanation']),
        DpmProfileKeyCandidate: requiredObjectSchema({
          id: stringSchema(),
          kind: { type: 'string', enum: [...DPM_PROFILE_KEY_CANDIDATE_KINDS] },
          nodeId: stringSchema(),
          confidence: ratioSchema(),
          reason: stringSchema(),
          evidenceIds: arrayOf(stringSchema()),
        }),
        DpmProfileDriftSignal: requiredObjectSchema({
          id: stringSchema(),
          kind: { type: 'string', enum: [...DPM_PROFILE_DRIFT_SIGNAL_KINDS] },
          severity: { type: 'string', enum: ['warning', 'info'] },
          nodeId: stringSchema(),
          metricId: stringSchema(),
          sourceId: stringSchema(),
          previousValue: { oneOf: [numberSchema(), stringSchema()] },
          currentValue: { oneOf: [numberSchema(), stringSchema()] },
          explanation: stringSchema(),
        }, ['id', 'kind', 'severity', 'explanation']),
        DpmProfileRiskIndicator: requiredObjectSchema({
          id: stringSchema(),
          kind: { type: 'string', enum: [...DPM_PROFILE_RISK_INDICATOR_KINDS] },
          severity: { type: 'string', enum: ['warning', 'info'] },
          nodeId: stringSchema(),
          metricId: stringSchema(),
          evidenceIds: arrayOf(stringSchema()),
          explanation: stringSchema(),
        }, ['id', 'kind', 'severity', 'evidenceIds', 'explanation']),
        DpmProfileAnalysisSummary: requiredObjectSchema({
          nodeCount: integerSchema(),
          edgeCount: integerSchema(),
          metricCount: integerSchema(),
          diagnosticCount: integerSchema(),
          relationshipHintCount: integerSchema(),
          keyCandidateCount: integerSchema(),
          riskIndicatorCount: integerSchema(),
          driftSignalCount: integerSchema(),
        }),
        DpmProfileAnalysisFreshness: requiredObjectSchema({
          reportHash: stringSchema(),
          profileVersionHash: stringSchema(),
          previousProfileVersionHash: stringSchema(),
        }, ['reportHash', 'profileVersionHash']),
        DpmProfileProposalReviewRequest: requiredObjectSchema({
          proposalId: stringSchema(),
          status: { type: 'string', enum: [...DPM_PROFILE_PROPOSAL_REVIEW_STATUSES] },
          reviewedBy: stringSchema(),
          reason: stringSchema(),
          reviewedAt: stringSchema(),
          coordinate: ref('DpmProfileCoordinate'),
          relationshipHint: ref('DpmProfileRelationshipHintProposal'),
        }, ['proposalId', 'status', 'reviewedBy', 'reason']),
        DpmProfileProposalReviewResponse: requiredObjectSchema({
          proposalId: stringSchema(),
          status: { type: 'string', enum: [...DPM_PROFILE_PROPOSAL_REVIEW_STATUSES] },
          reviewedBy: stringSchema(),
          reason: stringSchema(),
          reviewedAt: stringSchema(),
          coordinate: ref('DpmProfileCoordinate'),
          relationshipHint: ref('DpmProfileRelationshipHintProposal'),
          diagnostics: arrayOf(ref('DpmProfileDiagnostic')),
        }, ['proposalId', 'status', 'reviewedBy', 'reason', 'diagnostics']),
        DpmRelationshipDiscoveryRequest: requiredObjectSchema({
          manifest: ref('DpmManifestPolicy'),
          catalogSnapshot: ref('DpmSnapshotRef'),
        }),
        DpmRelationshipDiscoveryReport: requiredObjectSchema({
          reportRef: stringSchema(),
          candidates: arrayOf(requiredObjectSchema({
            name: stringSchema(),
            recommendation: { type: 'string', enum: [...DISCOVERY_CANDIDATE_RECOMMENDATIONS] },
          })),
        }),
        DpmCandidateImportRequest: requiredObjectSchema({
          datasetId: stringSchema(),
          candidates: arrayOf(requiredObjectSchema({
            name: stringSchema(),
            evidenceRef: stringSchema(),
          })),
        }),
        DpmCandidateImportResponse: requiredObjectSchema({
          imported: integerSchema(),
          rejected: integerSchema(),
        }),
        DpmRelationshipApprovalRequest: requiredObjectSchema({
          owner: stringSchema(),
          approvedBy: stringSchema(),
          reason: stringSchema(),
        }),
        DpmRelationshipApprovalResponse: requiredObjectSchema({
          relationshipName: stringSchema(),
          status: { type: 'string', enum: ['approved'] },
        }),
        DpmRegistrySnapshotResponse: requiredObjectSchema({
          datasetId: stringSchema(),
          registryVersion: stringSchema(),
          relationships: arrayOf(requiredObjectSchema({
            name: stringSchema(),
            status: { type: 'string', enum: [...REGISTRY_RELATIONSHIP_STATUSES] },
          })),
        }),
        DpmManifestValidationRequest: requiredObjectSchema({
          manifest: ref('DpmManifestPolicy'),
          catalogSnapshot: ref('DpmSnapshotRef'),
          registrySnapshot: ref('DpmSnapshotRef'),
        }),
        DpmManifestCompileRequest: requiredObjectSchema({
          manifest: ref('DpmManifestPolicy'),
          catalogSnapshot: ref('DpmSnapshotRef'),
          registrySnapshot: ref('DpmSnapshotRef'),
        }),
        DpmManifestDryRunRequest: requiredObjectSchema({
          manifest: ref('DpmManifestPolicy'),
          catalogSnapshot: ref('DpmSnapshotRef'),
          registrySnapshot: ref('DpmSnapshotRef'),
          estimatedRows: {
            type: 'object',
            additionalProperties: { type: 'number' },
          },
        }, ['manifest', 'catalogSnapshot', 'registrySnapshot']),
        DpmExecuteJobRequest: requiredObjectSchema({
          planRef: stringSchema(),
          targetDatasetRef: stringSchema(),
        }),
        DpmExecuteJobResponse: requiredObjectSchema({
          jobId: stringSchema(),
          status: { type: 'string', enum: ['accepted'] },
        }),
        DpmJobReport: requiredObjectSchema({
          jobId: stringSchema(),
          status: { type: 'string', enum: ['completed', 'failed'] },
          validationReportRef: stringSchema(),
          diagnostics: arrayOf(ref('DpmDiagnostic')),
        }),
        DpmCompileResult: requiredObjectSchema({
          ok: { type: 'boolean' },
          plan: ref('DpmCompiledPlan'),
          diagnostics: arrayOf(ref('DpmDiagnostic')),
          validation: ref('DpmValidationResult'),
        }, ['ok']),
        DpmDryRunResult: requiredObjectSchema({
          kind: { type: 'string', const: 'dpm.dry-run-report.v1' },
          planIdentity: stringSchema(),
          manifestId: stringSchema(),
          stale: { type: 'boolean' },
          impact: requiredObjectSchema({
            namespaces: integerSchema(),
            relationships: integerSchema(),
            columns: integerSchema(),
            piiColumns: integerSchema(),
            estimatedRows: integerSchema(),
          }),
          categories: arrayOf(ref('DpmDryRunCategory')),
          rawValuesIncluded: { type: 'boolean', const: false },
        }),
        DpmCompiledPlan: requiredObjectSchema({
          kind: { type: 'string', const: 'dpm.compiled-plan.v1' },
          planVersion: { type: 'string', enum: [...DPM_COMPILED_PLAN_VERSIONS] },
          identity: stringSchema(),
          manifestId: stringSchema(),
          datasetId: stringSchema(),
          policyVersion: stringSchema(),
          manifestCatalogVersionHash: stringSchema(),
          freshness: ref('DpmPlanFreshness'),
          stale: { type: 'boolean' },
          staleReasons: arrayOf({ type: 'string', enum: [...DPM_PLAN_STALE_REASONS] }),
          namespaceBindings: arrayOf(ref('DpmNamespaceBinding')),
          relationshipSteps: arrayOf(ref('DpmRelationshipStep')),
          columnSteps: arrayOf(ref('DpmColumnStep')),
        }, [
          'kind',
          'planVersion',
          'identity',
          'manifestId',
          'datasetId',
          'policyVersion',
          'freshness',
          'stale',
          'staleReasons',
          'namespaceBindings',
          'relationshipSteps',
          'columnSteps',
        ]),
        DpmPlanFreshness: requiredObjectSchema({
          manifestCatalogVersionHash: stringSchema(),
          catalogVersionHash: stringSchema(),
          registryVersion: stringSchema(),
          registryIdentity: stringSchema(),
        }, ['catalogVersionHash', 'registryVersion', 'registryIdentity']),
        DpmNamespaceBinding: requiredObjectSchema({
          namespace: stringSchema(),
          entity: stringSchema(),
          relationships: arrayOf(stringSchema()),
          columns: arrayOf(stringSchema()),
          transform: stringSchema(),
        }),
        DpmRelationshipStep: requiredObjectSchema({
          name: stringSchema(),
          registryIdentity: stringSchema(),
          registryStatus: { type: 'string', enum: ['approved'] },
          relationshipType: { type: 'string', enum: [...REGISTRY_RELATIONSHIP_KINDS] },
          cardinality: { type: 'string', enum: [...DPM_RELATIONSHIP_STEP_CARDINALITIES] },
          parent: ref('DpmRelationshipEndpoint'),
          child: ref('DpmRelationshipEndpoint'),
          namespace: stringSchema(),
          transformStrategy: { type: 'string', enum: [...REGISTRY_TRANSFORM_STRATEGIES] },
          orphanPolicy: { type: 'string', enum: [...REGISTRY_ORPHAN_POLICIES] },
        }),
        DpmRelationshipEndpoint: requiredObjectSchema({
          table: stringSchema(),
          columns: arrayOf(stringSchema()),
        }),
        DpmColumnStep: requiredObjectSchema({
          table: stringSchema(),
          column: stringSchema(),
          columnRef: stringSchema(),
          role: stringSchema(),
          pii: { type: 'boolean' },
          transform: stringSchema(),
          relationship: stringSchema(),
          namespace: stringSchema(),
        }, ['table', 'column', 'columnRef', 'role', 'pii', 'transform']),
        DpmDryRunCategory: requiredObjectSchema({
          name: {
            type: 'string',
            enum: ['namespace_bindings', 'relationship_steps', 'column_steps', 'pii_columns', 'estimated_rows'],
          },
          count: integerSchema(),
        }),
        DpmValidationResult: requiredObjectSchema({
          valid: { type: 'boolean' },
          diagnostics: arrayOf(ref('DpmDiagnostic')),
          summary: requiredObjectSchema({
            errors: integerSchema(),
            warnings: integerSchema(),
            infos: integerSchema(),
          }),
        }),
        DpmDiagnostic: requiredObjectSchema({
          severity: { type: 'string', enum: ['error', 'warning', 'info'] },
          code: { type: 'string', enum: [...DPM_DIAGNOSTIC_CODES] },
          message: stringSchema(),
          sourcePointer: stringSchema(),
          catalogCoordinate: informativeObjectSchema({
            table: stringSchema(),
            column: stringSchema(),
            columns: arrayOf(stringSchema()),
          }),
          registryCoordinate: informativeObjectSchema({
            datasetId: stringSchema(),
            registryVersion: stringSchema(),
            relationshipName: stringSchema(),
            relationshipVersion: stringSchema(),
            status: stringSchema(),
          }),
        }, ['severity', 'code', 'message', 'sourcePointer']),
      },
    },
  } as const
}

function operation(input: {
  operationId: DpmGatewayOperationId
  tags: string[]
  summary: string
  requestBody?: unknown
  responseSchema: string
  parameters?: unknown[]
  statusCode?: '200' | '202'
}) {
  return {
    operationId: input.operationId,
    tags: input.tags,
    summary: input.summary,
    ...(input.parameters ? { parameters: input.parameters } : {}),
    ...(input.requestBody ? { requestBody: input.requestBody } : {}),
    responses: {
      [input.statusCode ?? '200']: {
        description: 'JSON response.',
        content: {
          'application/json': {
            schema: ref(input.responseSchema),
          },
        },
      },
    },
  }
}

function requestBody(schemaName: string) {
  return {
    required: true,
    content: {
      'application/json': {
        schema: ref(schemaName),
      },
    },
  }
}

function pathParameter(name: string) {
  return {
    name,
    in: 'path',
    required: true,
    schema: stringSchema(),
  }
}

function ref(schemaName: string) {
  return { $ref: `#/components/schemas/${schemaName}` }
}

function objectSchema(properties: Record<string, unknown>) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
  }
}

function requiredObjectSchema(
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) {
  return {
    ...objectSchema(properties),
    required,
  }
}

function informativeObjectSchema(properties: Record<string, unknown>) {
  return {
    ...objectSchema(properties),
    minProperties: 1,
  }
}

function arrayOf(items: unknown) {
  return {
    type: 'array',
    items,
  }
}

function recordOf(additionalProperties: unknown) {
  return {
    type: 'object',
    additionalProperties,
  }
}

function stringSchema() {
  return { type: 'string', minLength: 1 }
}

function numberSchema() {
  return { type: 'number' }
}

function ratioSchema() {
  return { type: 'number', minimum: 0, maximum: 1 }
}

function integerSchema() {
  return { type: 'integer', minimum: 0 }
}

function countRecordSchema(keys: readonly string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(keys.map(key => [key, integerSchema()])),
  }
}
