import type { CatalogSnapshot } from '../catalog/types.js'
import type { RegistrySnapshot } from '../registry/types.js'
import { validateDpmManifestSchema } from '../schema/index.js'
import {
  createDpmDiagnostic,
  sortDpmDiagnostics,
  summarizeDpmDiagnostics,
  type DpmDiagnostic,
  type DpmValidationResult,
} from './diagnostics.js'
import {
  validateManifestRelationships,
  type ManifestRelationship,
  type RelationshipRegistryReference,
} from './relationships.js'

export type DpmValidationPhase = 'validate' | 'compile' | 'dry_run' | 'runtime'

export type DpmValidationInput = {
  manifest: unknown
  catalog: CatalogSnapshot
  registry: RegistrySnapshot
  phase?: DpmValidationPhase
}

export function validateDpmManifest(input: DpmValidationInput): DpmValidationResult {
  const manifest = asRecord(input.manifest)
  const registryReference = manifest.relationship_registry as RelationshipRegistryReference | undefined
  const diagnostics: DpmDiagnostic[] = [
    ...validateSyntax(input.manifest),
    ...validateManifestRelationships({
      relationships: asArray(manifest.relationships) as ManifestRelationship[],
      scopeTables: getScopeTables(manifest),
      ...(registryReference ? { registryReference } : {}),
      catalog: input.catalog,
      registry: input.registry,
    }),
    ...validateSafetyRules({
      manifest,
      registry: input.registry,
      phase: input.phase ?? 'validate',
    }),
  ]
  const sorted = sortDpmDiagnostics(diagnostics)
  const summary = summarizeDpmDiagnostics(sorted)

  return {
    valid: summary.errors === 0,
    diagnostics: sorted,
    summary,
  }
}

function validateSyntax(manifest: unknown): DpmDiagnostic[] {
  return validateDpmManifestSchema(manifest).issues.map(issue => createDpmDiagnostic({
    severity: 'error',
    code: 'SYN001',
    message: issue.message,
    sourcePointer: issue.instancePath,
  }))
}

function validateSafetyRules(input: {
  manifest: Record<string, unknown>
  registry: RegistrySnapshot
  phase: DpmValidationPhase
}): DpmDiagnostic[] {
  const diagnostics: DpmDiagnostic[] = []
  const relationships = asArray(input.manifest.relationships) as Array<Record<string, unknown>>
  const columns = asArray(input.manifest.columns) as Array<Record<string, unknown>>
  const entities = asArray(input.manifest.entities) as Array<Record<string, unknown>>
  const relationshipByName = new Map(
    relationships
      .map(relationship => [asString(relationship.name), relationship] as const)
      .filter(([name]) => name.length > 0),
  )
  const entityByName = new Map(
    entities
      .map(entity => [asString(entity.name), entity] as const)
      .filter(([name]) => name.length > 0),
  )

  columns.forEach((column, index) => {
    const pointer = `/columns/${index}`
    const role = asString(column.role)
    const pii = column.pii === true
    const transform = asRecord(column.transform)
    const transformType = asString(transform.type)
    const relationshipName = asString(column.relationship ?? transform.relationship)

    if (role === 'direct_identifier' && transformType === 'keep') {
      diagnostics.push(createDpmDiagnostic({
        severity: 'error',
        code: 'SAF001',
        message: 'direct_identifier columns cannot use keep transform.',
        sourcePointer: `${pointer}/transform/type`,
      }))
    }
    if (role === 'foreign_identifier' && pii && !relationshipName) {
      diagnostics.push(createDpmDiagnostic({
        severity: 'error',
        code: 'SAF002',
        message: 'pii=true foreign_identifier columns require a relationship reference.',
        sourcePointer: `${pointer}/relationship`,
      }))
    }
    if (relationshipName && !relationshipByName.has(relationshipName)) {
      diagnostics.push(createDpmDiagnostic({
        severity: 'error',
        code: 'SAF012',
        message: `Column relationship ${relationshipName} must exist in manifest relationships.`,
        sourcePointer: column.relationship ? `${pointer}/relationship` : `${pointer}/transform/relationship`,
        registryCoordinate: {
          datasetId: input.registry.datasetId,
          registryVersion: input.registry.registryVersion,
          relationshipName,
        },
      }))
    }
    if (pii && transformType === 'keep' && role !== 'direct_identifier') {
      diagnostics.push(createDpmDiagnostic({
        severity: 'error',
        code: 'SAF010',
        message: 'pii=true columns cannot leak raw values with keep transform.',
        sourcePointer: `${pointer}/transform/type`,
      }))
    }

    const entityName = asString(column.entity)
    if (relationshipName && entityName) {
      const relationship = relationshipByName.get(relationshipName)
      const entity = entityByName.get(entityName)
      const relationshipNamespace = asString(relationship?.namespace)
      const entityNamespace = asString(entity?.namespace)
      if (relationshipNamespace && entityNamespace && relationshipNamespace !== entityNamespace) {
        diagnostics.push(createDpmDiagnostic({
          severity: 'error',
          code: 'SAF009',
          message: `Column entity ${entityName} namespace does not match relationship ${relationshipName}.`,
          sourcePointer: `${pointer}/entity`,
          registryCoordinate: {
            datasetId: input.registry.datasetId,
            registryVersion: input.registry.registryVersion,
            relationshipName,
          },
        }))
      }
    }
  })

  if (!hasRelationshipDriftGate(asArray(input.manifest.quality_gates))) {
    diagnostics.push(createDpmDiagnostic({
      severity: 'warning',
      code: 'SAF007',
      message: 'Manifest is missing a relationship drift quality gate.',
      sourcePointer: '/quality_gates',
    }))
  }

  const vault = asRecord(input.manifest.vault)
  if (input.phase !== 'runtime' && asString(vault.mode) === 'runtime') {
    diagnostics.push(createDpmDiagnostic({
      severity: 'error',
      code: 'SAF011',
      message: 'runtime vault operations are only allowed in runtime phase.',
      sourcePointer: '/vault/mode',
    }))
  }

  return diagnostics
}

function getScopeTables(manifest: Record<string, unknown>): string[] {
  return asArray(asRecord(manifest.scope).include_tables).filter((table): table is string => typeof table === 'string')
}

function hasRelationshipDriftGate(qualityGates: readonly unknown[]): boolean {
  return qualityGates.some(gate => {
    const record = asRecord(gate)
    return asString(record.name) === 'relationship_drift' || asString(record.type) === 'relationship_drift'
  })
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
