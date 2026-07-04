import type { CatalogSnapshot } from '../catalog/types.js'
import type { RegistryRelationship, RegistrySnapshot } from '../registry/types.js'
import type { DpmValidationResult } from '../validator/diagnostics.js'
import {
  validateDpmManifest,
  type DpmValidationPhase,
} from '../validator/manifest.js'
import {
  DPM_COMPILED_PLAN_KIND,
  createPlanFreshness,
  type DpmColumnStep,
  type DpmCompiledPlan,
  type DpmNamespaceBinding,
  type DpmPlanStaleReason,
  type DpmRelationshipStepCardinality,
  type DpmRelationshipStep,
} from './plan.js'

export type DpmCompileInput = {
  manifest: unknown
  catalog: CatalogSnapshot
  registry: RegistrySnapshot
  phase?: DpmValidationPhase
}

export type DpmCompileSuccess = {
  ok: true
  plan: DpmCompiledPlan
  validation: DpmValidationResult
}

export type DpmCompileFailure = {
  ok: false
  diagnostics: DpmValidationResult['diagnostics']
  validation: DpmValidationResult
}

export type DpmCompileResult = DpmCompileSuccess | DpmCompileFailure

export function compileDpmPlan(input: DpmCompileInput): DpmCompileResult {
  const validation = validateDpmManifest({
    manifest: input.manifest,
    catalog: input.catalog,
    registry: input.registry,
    phase: input.phase ?? 'compile',
  })
  if (validation.summary.errors > 0) {
    return {
      ok: false,
      diagnostics: validation.diagnostics,
      validation,
    }
  }

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
  const staleReasons = getStaleReasons({
    manifestCatalogVersionHash,
    catalog: input.catalog,
    registryReference: asRecord(manifest.relationship_registry),
    registry: input.registry,
  })
  const relationshipSteps = createRelationshipSteps(manifest, input.registry)
  const columnSteps = createColumnSteps(manifest, relationshipSteps)

  return {
    ok: true,
    validation,
    plan: {
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
    },
  }
}

function createRelationshipSteps(
  manifest: Record<string, unknown>,
  registry: RegistrySnapshot,
): DpmRelationshipStep[] {
  const approvedByName = new Map(registry.approvedRelationships.map(relationship => [relationship.name, relationship]))
  return asArray(manifest.relationships)
    .map(asRecord)
    .map(relationship => {
      const approved = approvedByName.get(asString(relationship.name))
      if (!approved) return undefined
      return toRelationshipStep(approved)
    })
    .filter((step): step is DpmRelationshipStep => Boolean(step))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function toRelationshipStep(approved: RegistryRelationship): DpmRelationshipStep {
  return {
    name: approved.name,
    registryIdentity: approved.identity,
    registryStatus: 'approved',
    relationshipType: approved.type,
    cardinality: toCardinality(approved.type),
    parent: {
      table: approved.parent.table,
      columns: [...approved.parent.columns],
    },
    child: {
      table: approved.child.table,
      columns: [...approved.child.columns],
    },
    namespace: approved.namespace,
    transformStrategy: approved.transformStrategy,
    orphanPolicy: approved.orphanPolicy,
  }
}

function createColumnSteps(
  manifest: Record<string, unknown>,
  relationshipSteps: readonly DpmRelationshipStep[],
): DpmColumnStep[] {
  const namespaceByRelationship = new Map(relationshipSteps.map(step => [step.name, step.namespace]))
  return asArray(manifest.columns)
    .map(asRecord)
    .map(column => {
      const table = asString(column.table)
      const columnName = asString(column.column)
      const transform = asRecord(column.transform)
      const relationship = asString(column.relationship ?? transform.relationship)
      const namespace = namespaceByRelationship.get(relationship)
      return {
        table,
        column: columnName,
        columnRef: `${table}.${columnName}`,
        role: asString(column.role),
        pii: column.pii === true,
        transform: asString(transform.type),
        ...(relationship ? { relationship } : {}),
        ...(namespace ? { namespace } : {}),
      }
    })
    .sort((left, right) => left.columnRef.localeCompare(right.columnRef))
}

function createNamespaceBindings(
  manifest: Record<string, unknown>,
  relationshipSteps: readonly DpmRelationshipStep[],
  columnSteps: readonly DpmColumnStep[],
): DpmNamespaceBinding[] {
  return asArray(manifest.entities)
    .map(asRecord)
    .map(entity => {
      const namespace = asString(entity.namespace)
      const relationships = relationshipSteps
        .filter(step => step.namespace === namespace)
        .map(step => step.name)
        .sort()
      const columns = columnSteps
        .filter(step => step.namespace === namespace)
        .map(step => step.columnRef)
        .sort()
      return {
        namespace,
        entity: asString(entity.name),
        relationships,
        columns,
        transform: asString(asRecord(entity.transform).type),
      }
    })
    .filter(binding => binding.namespace.length > 0)
    .sort((left, right) => left.namespace.localeCompare(right.namespace))
}

function getStaleReasons(input: {
  manifestCatalogVersionHash: string
  catalog: CatalogSnapshot
  registryReference: Record<string, unknown>
  registry: RegistrySnapshot
}): DpmPlanStaleReason[] {
  const reasons: DpmPlanStaleReason[] = []
  if (input.manifestCatalogVersionHash && input.manifestCatalogVersionHash !== input.catalog.freshness.versionHash) {
    reasons.push('catalog_version_hash_changed')
  }
  const registryVersion = asString(input.registryReference.registry_version ?? input.registryReference.registryVersion)
  if (registryVersion && registryVersion !== input.registry.registryVersion) {
    reasons.push('registry_version_changed')
  }
  return reasons
}

function toCardinality(relationshipType: string): DpmRelationshipStepCardinality {
  if (relationshipType === 'one_to_one') return 'one_to_one'
  if (relationshipType === 'one_to_many') return 'one_to_many'
  if (relationshipType === 'many_to_one') return 'many_to_one'
  if (relationshipType === 'many_to_many_edge') return 'many_to_many'
  if (relationshipType === 'self_reference') return 'self_reference'
  return relationshipType as DpmRelationshipStepCardinality
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
