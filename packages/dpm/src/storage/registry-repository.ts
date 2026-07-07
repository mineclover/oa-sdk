import type {
  DpmRegistryRelationshipSaveInput,
  DpmRegistryRepository,
  DpmRegistryStorage,
  DpmRegistryStorageReader,
  DpmRegistryWritableRepository,
} from './registry-repository-types.js'
import {
  copyDpmRegistryRelationshipAuditEventRow,
  createDpmRegistryRelationshipAuditEventRow,
} from './registry-audit-event.js'
import { registryRowsToSnapshot } from './registry-row-mapper.js'
import {
  copyDpmRegistryRelationshipRow,
  createDpmRegistryRelationshipRow,
} from './registry-row-relationship.js'

export type {
  DpmRegistryRelationshipAuditEventRequest,
  DpmRegistryRelationshipAuditEventRow,
  DpmRegistryRelationshipAuditEventType,
  DpmRegistryRelationshipRow,
  DpmRegistryRelationshipSaveInput,
  DpmRegistryRelationshipRowRequest,
  DpmRegistryRepository,
  DpmRegistryRowsToSnapshotInput,
  DpmRegistrySnapshotExportRequest,
  DpmRegistryStorage,
  DpmRegistryStorageReader,
  DpmRegistryWritableRepository,
} from './registry-repository-types.js'
export {
  DPM_REGISTRY_RELATIONSHIP_AUDIT_EVENT_TYPES,
} from './registry-audit-row-types.js'
export {
  copyDpmRegistryRelationshipAuditEventRow,
  createDpmRegistryRelationshipAuditEventRow,
  type DpmRegistryRelationshipAuditEventInput,
} from './registry-audit-event.js'
export { registryRowsToSnapshot } from './registry-row-mapper.js'
export {
  copyDpmRegistryRelationshipRow,
  createDpmRegistryRelationshipRow,
} from './registry-row-relationship.js'

export function createDpmRegistryRepository(storage: DpmRegistryStorage): DpmRegistryWritableRepository
export function createDpmRegistryRepository(reader: DpmRegistryStorageReader): DpmRegistryRepository
export function createDpmRegistryRepository(
  reader: DpmRegistryStorageReader,
): DpmRegistryRepository | DpmRegistryWritableRepository {
  const repository: DpmRegistryRepository = {
    async exportSnapshot(request) {
      const rows = await reader.listRelationshipRows({
        datasetId: request.datasetId,
        registryVersion: request.registryVersion,
      })

      return registryRowsToSnapshot({
        ...request,
        rows,
      })
    },
  }

  if (!isDpmRegistryStorage(reader)) {
    return repository
  }

  const writableRepository: DpmRegistryWritableRepository = {
    ...repository,
    async saveRelationship(input: DpmRegistryRelationshipSaveInput) {
      const row = createDpmRegistryRelationshipRow(input)
      const existingRows = await reader.listRelationshipRows({
        datasetId: input.datasetId,
        registryVersion: input.registryVersion,
      })
      assertNoConflictingApprovedRegistryRelationshipRow(row, existingRows)
      await reader.upsertRelationshipRow(copyDpmRegistryRelationshipRow(row))
      if (reader.appendRelationshipAuditEvent) {
        const auditEvent = createDpmRegistryRelationshipAuditEventRow({
          relationshipRow: row,
          ...(input.auditEventId ? { eventId: input.auditEventId } : {}),
          ...(input.auditOccurredAt ? { occurredAt: input.auditOccurredAt } : {}),
          ...(input.auditCreatedAt ? { createdAt: input.auditCreatedAt } : {}),
        })
        await reader.appendRelationshipAuditEvent(copyDpmRegistryRelationshipAuditEventRow(auditEvent))
      }
      return row
    },
  }
  if (reader.listRelationshipAuditEvents) {
    writableRepository.listRelationshipAuditEvents = async request => {
      const events = await reader.listRelationshipAuditEvents?.(request)
      return [...(events ?? [])].map(copyDpmRegistryRelationshipAuditEventRow)
    }
  }

  return writableRepository
}

function isDpmRegistryStorage(reader: DpmRegistryStorageReader): reader is DpmRegistryStorage {
  return 'upsertRelationshipRow' in reader && typeof reader.upsertRelationshipRow === 'function'
}

function assertNoConflictingApprovedRegistryRelationshipRow(
  row: ReturnType<typeof createDpmRegistryRelationshipRow>,
  existingRows: readonly ReturnType<typeof createDpmRegistryRelationshipRow>[],
): void {
  const conflictingApproved = existingRows.find(existing =>
    existing.status === 'approved'
    && existing.relationshipName === row.relationshipName
    && existing.relationshipVersion !== row.relationshipVersion
  )
  if (!conflictingApproved) return

  throw new Error(
    `DPM registry saveRelationship already has an approved relationship named ${row.relationshipName}: `
    + `existing version ${conflictingApproved.relationshipVersion}, attempted version ${row.relationshipVersion}.`,
  )
}
