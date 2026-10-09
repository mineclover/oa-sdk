import type {
  CollaborationManifest,
  SourceReference,
  CollaborationReferenceIndex,
  CollaborationManagementProjection,
} from './types.js'

/**
 * Port representing the boundary to the host, Google Drive, and Git providers.
 * Access enforcement resides strictly inside this port implementation.
 * Schema validation alone is never authorization.
 */
export interface SharedContextHarnessPort {
  /** Checks if the actor has permission to read the collaboration manifest */
  canReadCollaboration(actorId: string, collaboration: CollaborationManifest): Promise<boolean>

  /** Checks if a reference is officially registered in the collaboration's reference index */
  isRegisteredReference(collaboration: CollaborationManifest, reference: SourceReference): Promise<boolean>

  /** Checks if the actor has permission to read the underlying source repository */
  canReadSource(actorId: string, reference: SourceReference): Promise<boolean>

  /** Reads the material content and commit/snapshot ID from the source provider */
  readSource(reference: SourceReference): Promise<{ content: string; snapshotId: string }>

  /** Retrieves the collaboration manifest by ID */
  readCollaboration(collaborationId: string): Promise<CollaborationManifest | null>

  /** Retrieves the reference index for a collaboration */
  readReferenceIndex(collaborationId: string): Promise<CollaborationReferenceIndex | null>

  /** Retrieves the management projection for a collaboration */
  readManagementProjection(collaborationId: string): Promise<CollaborationManagementProjection | null>

  /** Retrieves a specific reference card by collaboration and reference ID */
  readReference(collaborationId: string, referenceId: string): Promise<SourceReference | null>

  /** Optional write permission check (strictly for readback & negative barrier verification) */
  canWriteCollaboration?(actorId: string, collaboration: CollaborationManifest, folderKind: string): Promise<boolean>

  /** Optional Drive parent chain verification */
  verifyDriveParentChain?(rootFolderId: string, targetFolderId: string, folderKind: string): Promise<boolean>
}
