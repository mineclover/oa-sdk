import type { DpmCompiledPlanBuilderInput } from './plan-builder-types.js'
import { createColumnSteps } from './plan-column-steps.js'
import { createPlanFreshness } from './plan-freshness.js'
import { readDpmPlanManifestMetadata } from './plan-manifest-metadata.js'
import { createNamespaceBindings } from './plan-namespace-bindings.js'
import { createRelationshipSteps } from './plan-relationship-steps.js'
import { getPlanStaleReasons } from './plan-staleness.js'
import { DPM_COMPILED_PLAN_KIND } from './plan-taxonomy.js'
import type { DpmCompiledPlan } from './plan-compiled-types.js'

export type { DpmCompiledPlanBuilderInput } from './plan-builder-types.js'

export function createDpmCompiledPlan(input: DpmCompiledPlanBuilderInput): DpmCompiledPlan {
  const {
    manifest,
    datasetId,
    policyVersion,
    manifestId,
    manifestCatalogVersionHash,
    registryReference,
  } = readDpmPlanManifestMetadata({
    manifest: input.manifest,
    registry: input.registry,
  })
  const freshness = createPlanFreshness({
    ...(manifestCatalogVersionHash ? { manifestCatalogVersionHash } : {}),
    catalog: input.catalog,
    registry: input.registry,
  })
  const staleReasons = getPlanStaleReasons({
    manifestCatalogVersionHash,
    catalog: input.catalog,
    registryReference,
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
