/**
 * @oa-sdk/collab-workspace — Types & Data Contracts
 *
 * Models folder-level Tree-Lattice CRDT and AI as a First-Class Co-Editor.
 */
import type { CrdtMetadata } from '@oa-sdk/chunk-stream-crdt'

export type EditorRole = 'human' | 'ai'

export interface EditorPresence {
  clientId: string
  role: EditorRole
  name: string
  currentFile?: string | undefined
  cursor?: { line: number; column: number } | undefined
  lastActiveAt: number
}

export interface IntentLock {
  id: string
  clientId: string
  role: EditorRole
  filePath: string
  range: {
    startLine: number
    endLine: number
  }
  intent: string
  status: 'active' | 'completed' | 'cancelled'
  createdAt: number
  expiresAt: number
  /** Monotonically increasing renewal version (initial acquisition is 0). */
  version?: number | undefined
}

export interface WorkspaceLimits {
  maxFiles?: number | undefined
  maxChunks?: number | undefined
  maxContentBytes?: number | undefined
  maxRenderLines?: number | undefined
  maxLocks?: number | undefined
}

export interface FileChunkCue {
  id: string
  filePath: string
  lineIndex: number
  content: string
  crdt: CrdtMetadata
}

export interface CollabFolderConfig {
  /** Target workspace root directory */
  rootPath: string
  /** Shared workspace / project identifier */
  workspaceId: string
  /** Local client identifier (e.g. 'client:human:dev1' or 'client:ai:gemini') */
  clientId: string
  /** Editor role */
  role: EditorRole
  /** Allowed file extensions to track (default: all text files) */
  allowedExtensions?: string[] | undefined
  /** Auto lock expiration in ms (default: 15000) */
  lockTtlMs?: number | undefined
  /** Optional allowlist of remote identities already authenticated by the transport. */
  allowedRemoteClientIds?: string[] | undefined
  /** Verify the opaque capability against a live, authenticated transport session. */
  authenticateRemoteSource?: ((source: RemoteChunkSource) => boolean) | undefined
  limits?: WorkspaceLimits | undefined
  maxRemoteClients?: number | undefined
  maxRemoteAgeMs?: number | undefined
  maxPresences?: number | undefined
  presenceTtlMs?: number | undefined
}

/** Identity supplied by the authenticated transport, never taken from the cue payload. */
export interface RemoteChunkSource {
  workspaceId: string
  clientId: string
  /** Transport-owned capability; never deserialize this from a peer payload. */
  capability: import('./security.js').RemoteTransportCapability
}
