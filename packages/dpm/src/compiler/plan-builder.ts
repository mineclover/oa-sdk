import type { CatalogSnapshot } from '../catalog/types.js'
import type { RegistrySnapshot } from '../registry/registry-snapshot-types.js'
import { createColumnSteps } from './plan-column-steps.js'
import { createPlanFreshness } from './plan-freshness.js'
import { createNamespaceBindings } from './plan-namespace-bindings.js'
import { createRelationshipSteps } from './plan-relationship-steps.js'
import { getPlanStaleReasons } from './plan-staleness.js'
import {
  asRecord,
  asString,
} from './plan-value-utils.js'
import {
  DPM_COMPILED_PLAN_KIND,
  type DpmCompiledPlan,
} from './plan.js'

export type DpmCompiledPlanBuilderInput = {
  manifest: unknown
  catalog: CatalogSnapshot
  registry: RegistrySnapshot
}

export function createDpmCompiledPlan(input: DpmCompiledPlanBuilderInput): DpmCompiledPlan {
  const manifest = asRecord(input.manifest)
  const metadata = asRecord(manifest.metadata)
  const datasetId = asString(metadata.dataset_id) || input.registry.datasetId
  const policyVersion = asString(metadata.policy_version) || 'unversioned'
  const manifestId = `${datasetId}@${policyVersion}`
  const manifestCatalogVersionHash = asString(asRecord(manifest.catalog).version_hash)
  const freshness = createPlanFreshness({
    ...(manifestCatalogVersionHash ? { manifestCatalogVersionHash } : {}),
    catalog: input.catalog,
    registry: input.registry,
  })
  const staleReasons = getPlanStaleReasons({
    manifestCatalogVersionHash,
    catalog: input.catalog,
    registryReference: asRecord(manifest.relationship_registry),
    registry: input.registry,
  })
  const relationshipSteps = createRelationshipSteps(manifest, input.registry)
  const columnSteps = createColumnSteps(manifest, relationshipSteps)

  return {
    kind: DPM_COMPILED_PLAN_KIND,
    planVersion: '1.0',
    identity: `compiled-plan:${manifestId}:${input.registry.registryVersion}`,
    manifestId,
    datasetId,
    policyVersion,
    ...(manifestCatalogVersionHash ? { manifestCatalogVersionHash } : {}),
    freshness,
    stale: staleReasons.length > 0,
    staleReasons,
    namespaceBindings: createNamespaceBindings(manifest, relationshipSteps, columnSteps),
    relationshipSteps,
    columnSteps,
  }
}
