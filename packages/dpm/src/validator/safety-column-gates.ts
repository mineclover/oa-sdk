import {
  createDpmDiagnostic,
  type DpmDiagnostic,
} from './diagnostics.js'
import type { SafetyLookupContext } from './safety-types.js'
import {
  asRecord,
  asString,
} from './value-utils.js'

export function validateSafetyColumnGates(input: SafetyLookupContext & {
  column: Record<string, unknown>
  index: number
}): DpmDiagnostic[] {
  const diagnostics: DpmDiagnostic[] = []
  const pointer = `/columns/${input.index}`
  const role = asString(input.column.role)
  const pii = input.column.pii === true
  const transform = asRecord(input.column.transform)
  const transformType = asString(transform.type)
  const relationshipName = asString(input.column.relationship ?? transform.relationship)

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
  if (relationshipName && !input.relationshipByName.has(relationshipName)) {
    diagnostics.push(createDpmDiagnostic({
      severity: 'error',
      code: 'SAF012',
      message: `Column relationship ${relationshipName} must exist in manifest relationships.`,
      sourcePointer: input.column.relationship ? `${pointer}/relationship` : `${pointer}/transform/relationship`,
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

  const entityName = asString(input.column.entity)
  if (relationshipName && entityName) {
    const relationship = input.relationshipByName.get(relationshipName)
    const entity = input.entityByName.get(entityName)
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

  return diagnostics
}
