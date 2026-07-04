import { DPM_MANIFEST_SCHEMA_ID } from '../schema/index.js'

export const DPM_GATEWAY_OPERATION_IDS = [
  'profileDpmCatalog',
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
        DpmRelationshipDiscoveryRequest: requiredObjectSchema({
          manifest: ref('DpmManifestPolicy'),
          catalogSnapshot: ref('DpmSnapshotRef'),
        }),
        DpmRelationshipDiscoveryReport: requiredObjectSchema({
          reportRef: stringSchema(),
          candidates: arrayOf(requiredObjectSchema({
            name: stringSchema(),
            recommendation: stringSchema(),
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
            status: stringSchema(),
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
          status: stringSchema(),
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
          planVersion: stringSchema(),
          identity: stringSchema(),
          manifestId: stringSchema(),
          datasetId: stringSchema(),
          policyVersion: stringSchema(),
          manifestCatalogVersionHash: stringSchema(),
          freshness: ref('DpmPlanFreshness'),
          stale: { type: 'boolean' },
          staleReasons: arrayOf(stringSchema()),
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
          relationshipType: stringSchema(),
          cardinality: stringSchema(),
          parent: ref('DpmRelationshipEndpoint'),
          child: ref('DpmRelationshipEndpoint'),
          namespace: stringSchema(),
          transformStrategy: stringSchema(),
          orphanPolicy: stringSchema(),
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
          code: stringSchema(),
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

function stringSchema() {
  return { type: 'string', minLength: 1 }
}

function integerSchema() {
  return { type: 'integer', minimum: 0 }
}
