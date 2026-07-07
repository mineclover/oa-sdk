import type {
  DpmRegistryRelationshipSaveInput,
  DpmRegistryRelationshipSaveResult,
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
  DpmPostgresRegistryClient,
  DpmPostgresRegistryQueryClient,
} from './registry-postgres-storage.js'
export type {
  DpmRegistryRelationshipApprovalCommitInput,
  DpmRegistryRelationshipApprovalCommitResult,
  DpmRegistryRelationshipSaveResult,
  DpmRegistryRelationshipAuditEventRequest,
  DpmRegistryRelationshipAuditEventRow,
  DpmRegistryRelationshipAuditEventType,
  DpmRegistryRelationshipRow,
  DpmRegistryRelationshipSaveInput,
  DpmRegistryRelationshipRowRequest,
  DpmRegistryAuditEventReader,
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
export {
  appendDpmPostgresRegistryRelationshipAuditEvent,
  commitDpmPostgresRegistryRelationshipApproval,
  createDpmPostgresRegistryStorage,
  listDpmPostgresRegistryRelationshipAuditEvents,
  listDpmPostgresRegistryRelationshipRows,
  upsertDpmPostgresRegistryRelationshipRow,
} from './registry-postgres-storage.js'

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
  const storage = reader

  const writableRepository: DpmRegistryWritableRepository = {
    ...repository,
    async saveRelationship(input: DpmRegistryRelationshipSaveInput) {
      const result = await saveRelationshipWithAuditEvent(input)
      return copyDpmRegistryRelationshipRow(result.relationshipRow)
    },
    saveRelationshipWithAuditEvent,
  }
  if (storage.listRelationshipAuditEvents) {
    writableRepository.listRelationshipAuditEvents = async request => {
      const events = await storage.listRelationshipAuditEvents?.(request)
      return [...(events ?? [])].map(copyDpmRegistryRelationshipAuditEventRow)
    }
  }

  return writableRepository

  async function saveRelationshipWithAuditEvent(
    input: DpmRegistryRelationshipSaveInput,
  ): Promise<DpmRegistryRelationshipSaveResult> {
    const row = createDpmRegistryRelationshipRow(input)
    const existingRows = await reader.listRelationshipRows({
      datasetId: input.datasetId,
      registryVersion: input.registryVersion,
    })
    assertNoConflictingApprovedRegistryRelationshipRow(row, existingRows)
    const auditEvent = storage.commitRelationshipApproval || storage.appendRelationshipAuditEvent
      ? createDpmRegistryRelationshipAuditEventRow({
          relationshipRow: row,
          ...(input.auditEventId ? { eventId: input.auditEventId } : {}),
          ...(input.auditOccurredAt ? { occurredAt: input.auditOccurredAt } : {}),
          ...(input.auditCreatedAt ? { createdAt: input.auditCreatedAt } : {}),
        })
      : undefined
    if (storage.commitRelationshipApproval && auditEvent) {
      const committed = await storage.commitRelationshipApproval({
        relationshipRow: copyDpmRegistryRelationshipRow(row),
        auditEvent: copyDpmRegistryRelationshipAuditEventRow(auditEvent),
      })
      return {
        relationshipRow: copyDpmRegistryRelationshipRow(committed.relationshipRow),
        approvalAuditEvent: copyDpmRegistryRelationshipAuditEventRow(committed.auditEvent),
      }
    }
    if (!storage.upsertRelationshipRow) {
      throw new Error('DPM registry writable storage must provide upsertRelationshipRow or commitRelationshipApproval.')
    }
    await storage.upsertRelationshipRow(copyDpmRegistryRelationshipRow(row))
    if (storage.appendRelationshipAuditEvent && auditEvent) {
      await storage.appendRelationshipAuditEvent(copyDpmRegistryRelationshipAuditEventRow(auditEvent))
      return {
        relationshipRow: copyDpmRegistryRelationshipRow(row),
        approvalAuditEvent: copyDpmRegistryRelationshipAuditEventRow(auditEvent),
      }
    }
    return {
      relationshipRow: copyDpmRegistryRelationshipRow(row),
    }
  }
}

function isDpmRegistryStorage(reader: DpmRegistryStorageReader): reader is DpmRegistryStorage {
  return (
    'upsertRelationshipRow' in reader && typeof reader.upsertRelationshipRow === 'function'
  ) || (
    'commitRelationshipApproval' in reader && typeof reader.commitRelationshipApproval === 'function'
  )
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
