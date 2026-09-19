/**
 * Wire protocol, connection, and adapter interface types for CRDT collaboration.
 */

export type CrdtWireMessageType =
  | 'sync-step-1'
  | 'sync-step-2'
  | 'update'
  | 'awareness'

export interface CrdtWireMessage {
  type: CrdtWireMessageType
  roomId: string
  peerId?: string | undefined
  payload: Uint8Array | string | unknown
}

export type CrdtConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'synced'
  | 'error'

/**
 * Pluggable engine adapter contract for CRDT document synchronization.
 * Can be backed by pure LWW-JSON, Yjs, Automerge, or Fugue.
 */
export interface CrdtEngineAdapter<TDoc = Record<string, unknown>> {
  /** Adapter identifier (e.g. 'lww-json', 'yjs', 'automerge') */
  readonly name: string

  /** Initializes or resets the document state */
  createDoc(): void

  /** Merges an incoming binary or serialized update blob */
  applyUpdate(update: Uint8Array | string): void

  /** Computes the state vector representing the current version state */
  encodeStateVector(): Uint8Array | string

  /** Computes the difference payload between local state and a peer state vector */
  encodeDiff(stateVector: Uint8Array | string): Uint8Array | string

  /** Serializes and returns the current typed snapshot of the document */
  getState(): TDoc

  /** Mutates a specific field and produces an incremental update delta */
  updateField(field: string, value: unknown): Uint8Array | string

  /** Registers a listener invoked whenever local mutations produce updates */
  onUpdate(callback: (update: Uint8Array | string) => void): () => void
}
