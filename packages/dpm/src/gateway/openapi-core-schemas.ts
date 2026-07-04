import { DISCOVERY_CANDIDATE_RECOMMENDATIONS } from '../discovery/types.js'
import {
  REGISTRY_RELATIONSHIP_STATUSES,
} from '../registry/types.js'
import { DPM_MANIFEST_SCHEMA_ID } from '../schema/index.js'
import {
  arrayOf,
  integerSchema,
  ref,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'
import { createDpmGatewayExecutionSchemas } from './openapi-execution-schemas.js'

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
    ...createDpmGatewayExecutionSchemas(),
  } as const
}
