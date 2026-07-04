import {
  DPM_COMPILED_PLAN_VERSIONS,
  DPM_PLAN_STALE_REASONS,
  DPM_RELATIONSHIP_STEP_CARDINALITIES,
} from '../compiler/plan.js'
import {
  REGISTRY_ORPHAN_POLICIES,
  REGISTRY_RELATIONSHIP_KINDS,
  REGISTRY_TRANSFORM_STRATEGIES,
} from '../registry/types.js'
import { DPM_DIAGNOSTIC_CODES } from '../validator/diagnostics.js'
import {
  arrayOf,
  informativeObjectSchema,
  integerSchema,
  ref,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmGatewayExecutionSchemas() {
  return {
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
