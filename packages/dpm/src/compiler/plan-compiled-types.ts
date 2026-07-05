import type { DpmPlanFreshness } from './plan-freshness-types.js'
import type {
  DPM_COMPILED_PLAN_KIND,
  DpmCompiledPlanVersion,
  DpmPlanStaleReason,
} from './plan-taxonomy.js'
import type {
  DpmColumnStep,
  DpmNamespaceBinding,
  DpmRelationshipStep,
} from './plan-step-types.js'

export type DpmCompiledPlan = {
  kind: typeof DPM_COMPILED_PLAN_KIND
  planVersion: DpmCompiledPlanVersion
  identity: string
  manifestId: string
  datasetId: string
  policyVersion: string
  manifestCatalogVersionHash?: string
  freshness: DpmPlanFreshness
  stale: boolean
  staleReasons: DpmPlanStaleReason[]
  namespaceBindings: DpmNamespaceBinding[]
  relationshipSteps: DpmRelationshipStep[]
  columnSteps: DpmColumnStep[]
}
