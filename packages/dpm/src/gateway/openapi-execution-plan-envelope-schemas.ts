import {
  DPM_COMPILED_PLAN_VERSIONS,
  DPM_PLAN_STALE_REASONS,
} from '../compiler/plan.js'
import {
  arrayOf,
  ref,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmGatewayCompiledPlanEnvelopeSchemas() {
  return {
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
  } as const
}
