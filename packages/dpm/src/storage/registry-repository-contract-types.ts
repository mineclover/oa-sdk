import type { RegistrySnapshot } from '../registry/registry-snapshot-types.js'
import type {
  DpmRegistryRelationshipAuditEventRequest,
  DpmRegistryRelationshipRowRequest,
  DpmRegistryRelationshipSaveInput,
  DpmRegistrySnapshotExportRequest,
} from './registry-repository-request-types.js'
import type {
  DpmRegistryRelationshipAuditEventRow,
} from './registry-audit-row-types.js'
import type { DpmRegistryRelationshipRow } from './registry-storage-row-types.js'

export type DpmRegistryRelationshipApprovalCommitInput = {
  relationshipRow: DpmRegistryRelationshipRow
  auditEvent: DpmRegistryRelationshipAuditEventRow
}

export type DpmRegistryRelationshipApprovalCommitResult = {
  relationshipRow: DpmRegistryRelationshipRow
  auditEvent: DpmRegistryRelationshipAuditEventRow
}

export type DpmRegistryStorageReader = {
  listRelationshipRows(
    request: DpmRegistryRelationshipRowRequest,
  ): Promise<readonly DpmRegistryRelationshipRow[]> | readonly DpmRegistryRelationshipRow[]
}

export type DpmRegistryAuditEventReader = {
  listRelationshipAuditEvents(
    request: DpmRegistryRelationshipAuditEventRequest,
  ): Promise<readonly DpmRegistryRelationshipAuditEventRow[]> | readonly DpmRegistryRelationshipAuditEventRow[]
}

type DpmRegistryStorageAuditEventCapabilities = {
  appendRelationshipAuditEvent?(row: DpmRegistryRelationshipAuditEventRow): Promise<void> | void
  listRelationshipAuditEvents?(
    request: DpmRegistryRelationshipAuditEventRequest,
  ): Promise<readonly DpmRegistryRelationshipAuditEventRow[]> | readonly DpmRegistryRelationshipAuditEventRow[]
}

type DpmRegistrySplitWriteStorage = DpmRegistryStorageReader
  & DpmRegistryStorageAuditEventCapabilities
  & {
    upsertRelationshipRow(row: DpmRegistryRelationshipRow): Promise<void> | void
    commitRelationshipApproval?: never
  }

type DpmRegistryApprovalCommitStorage = DpmRegistryStorageReader
  & DpmRegistryStorageAuditEventCapabilities
  & {
    commitRelationshipApproval(
      input: DpmRegistryRelationshipApprovalCommitInput,
    ): Promise<DpmRegistryRelationshipApprovalCommitResult> | DpmRegistryRelationshipApprovalCommitResult
    upsertRelationshipRow?(row: DpmRegistryRelationshipRow): Promise<void> | void
  }

export type DpmRegistryStorage = DpmRegistrySplitWriteStorage | DpmRegistryApprovalCommitStorage

export type DpmRegistryRepository = {
  exportSnapshot(request: DpmRegistrySnapshotExportRequest): Promise<RegistrySnapshot>
}

export type DpmRegistryWritableRepository = DpmRegistryRepository & {
  saveRelationship(input: DpmRegistryRelationshipSaveInput): Promise<DpmRegistryRelationshipRow>
  listRelationshipAuditEvents?(
    request: DpmRegistryRelationshipAuditEventRequest,
  ): Promise<readonly DpmRegistryRelationshipAuditEventRow[]>
}
