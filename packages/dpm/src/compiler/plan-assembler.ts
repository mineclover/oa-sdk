import type { DpmCompiledPlanBuilderInput } from './plan-builder-types.js'
import type { DpmCompiledPlan } from './plan-compiled-types.js'
import { createColumnSteps } from './plan-column-steps.js'
import { createPlanFreshness } from './plan-freshness.js'
import { createDpmCompiledPlanIdentity } from './plan-identity.js'
import { readDpmPlanManifestMetadata } from './plan-manifest-metadata.js'
import { createNamespaceBindings } from './plan-namespace-bindings.js'
import { createRelationshipSteps } from './plan-relationship-steps.js'
import { getPlanStaleReasons } from './plan-staleness.js'
import { DPM_COMPILED_PLAN_KIND } from './plan-taxonomy.js'
import {
  normalizeRegistrySnapshotCanonicalKeyEncodingVersion,
} from '../registry/registry-snapshot-encoding.js'

export function createDpmCompiledPlan(input: DpmCompiledPlanBuilderInput): DpmCompiledPlan {
  const registry = normalizeRegistrySnapshotCanonicalKeyEncodingVersion(input.registry)
  const {
    manifest,
    datasetId,
    policyVersion,
    manifestId,
    manifestCatalogVersionHash,
    registryReference,
  } = readDpmPlanManifestMetadata({
    manifest: input.manifest,
    registry,
  })
  const freshness = createPlanFreshness({
    ...(manifestCatalogVersionHash ? { manifestCatalogVersionHash } : {}),
    catalog: input.catalog,
    registry,
  })
  const staleReasons = getPlanStaleReasons({
    manifestCatalogVersionHash,
    catalog: input.catalog,
    registryReference,
    registry,
  })
  const relationshipSteps = createRelationshipSteps(manifest, registry)
  const columnSteps = createColumnSteps(manifest, relationshipSteps)
  const canonicalKeyEncodingVersion = registry.canonicalKeyEncodingVersion

  return {
    kind: DPM_COMPILED_PLAN_KIND,
    planVersion: '1.0',
    identity: createDpmCompiledPlanIdentity({
      manifestId,
      registryVersion: registry.registryVersion,
      canonicalKeyEncodingVersion,
    }),
    manifestId,
    datasetId,
    policyVersion,
    canonicalKeyEncodingVersion,
    ...(manifestCatalogVersionHash ? { manifestCatalogVersionHash } : {}),
    freshness,
    stale: staleReasons.length > 0,
    staleReasons,
    namespaceBindings: createNamespaceBindings(manifest, relationshipSteps, columnSteps),
    relationshipSteps,
    columnSteps,
  }
}
