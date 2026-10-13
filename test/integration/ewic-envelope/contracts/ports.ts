import type {
  EntitySourceEnvelope,
  EntityDerivedEnvelope,
  ColabRunPacket,
} from './ewic-types.js'

/**
 * Port interface for reading and verifying EWIC envelopes across
 * Google Drive, Git, and Colab execution environments.
 * Access control and authorization reside strictly at this boundary.
 */
export interface EwicEnvelopePort {
  /**
   * Determine if an actor is authorized to read an envelope.
   * Authorization must be checked before returning envelope data.
   */
  canReadEnvelope(
    actorId: string,
    envelope: EntitySourceEnvelope | EntityDerivedEnvelope
  ): Promise<boolean>

  /**
   * Read an entity source envelope by URI (e.g. `entity://project.scope/kind/id@revision`).
   */
  readSourceEnvelope(uri: string): Promise<EntitySourceEnvelope | null>

  /**
   * Read an entity derived envelope by entity URI and optional pipeline runId.
   */
  readDerivedEnvelope(
    entityRef: string,
    runId?: string
  ): Promise<EntityDerivedEnvelope | null>

  /**
   * Verify snapshot integrity: checks if current state matches expected contentHash / snapshotId.
   */
  verifySnapshot(
    uri: string,
    expectedHash: string,
    expectedSnapshotId?: string
  ): Promise<{
    match: boolean
    currentHash: string
    currentSnapshotId?: string
  }>

  /**
   * Read a Colab run execution packet.
   */
  readColabRunPacket(runId: string): Promise<ColabRunPacket | null>
}
