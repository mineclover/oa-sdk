import {
  DPM_COMPILED_PLAN_VERSIONS,
  DPM_PLAN_STALE_REASONS,
  DPM_RELATIONSHIP_STEP_CARDINALITIES,
} from '../compiler/plan.js'
import { DISCOVERY_CANDIDATE_RECOMMENDATIONS } from '../discovery/types.js'
import {
  REGISTRY_ORPHAN_POLICIES,
  REGISTRY_RELATIONSHIP_KINDS,
  REGISTRY_RELATIONSHIP_STATUSES,
  REGISTRY_TRANSFORM_STRATEGIES,
} from '../registry/types.js'
import { DPM_MANIFEST_SCHEMA_ID } from '../schema/index.js'
import { DPM_DIAGNOSTIC_CODES } from '../validator/diagnostics.js'
import {
  arrayOf,
  informativeObjectSchema,
  integerSchema,
  ref,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmGatewayCoreSchemas() {
  return {
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
  } as const
}
