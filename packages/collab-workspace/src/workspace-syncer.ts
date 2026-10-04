/**
 * @oa-sdk/collab-workspace — Workspace Syncer Orchestrator
 */
import { WorkspaceTreeLattice } from './tree-lattice.js'
import { AiEditorActor } from './ai-editor-actor.js'
import type { CollabFolderConfig, EditorPresence, FileChunkCue, IntentLock, RemoteChunkSource } from './types.js'
import { assertAllowedFilePath, isRemoteTransportCapability, validateFileChunkCue, validateWorkspaceConfig } from './security.js'

export class WorkspaceSyncer {
  readonly config: CollabFolderConfig
  readonly lattice: WorkspaceTreeLattice
  private presences = new Map<string, EditorPresence>()
  private deltaListeners = new Set<(cue: FileChunkCue) => void>()
  private presenceListeners = new Set<(presence: EditorPresence) => void>()
  private remoteWatermarks = new Map<string, number>()

  constructor(config: CollabFolderConfig) {
    this.config = validateWorkspaceConfig(config)
    this.lattice = new WorkspaceTreeLattice(this.config.limits)

    // Register local presence
    this.updatePresence({
      clientId: config.clientId,
      role: config.role,
      name: config.clientId.replace(/^client:(human|ai):/, ''),
      lastActiveAt: Date.now(),
    })
  }

  /**
   * Apply a human edit to a file in the workspace
   */
  applyHumanEdit(filePath: string, content: string): FileChunkCue[] {
    filePath = assertAllowedFilePath(filePath, this.config.allowedExtensions)
    const cues = this.lattice.setFileContent(filePath, content, this.config.clientId)
    for (const cue of cues) {
      this.broadcastDelta(cue)
    }
    return cues
  }

  /**
   * Ingest a remote CRDT chunk (from WebMCP browser peer or remote collaborator)
   */
  ingestRemoteChunk(cue: FileChunkCue, source: RemoteChunkSource): boolean {
    if (!source || !isRemoteTransportCapability(source.capability) || source.workspaceId !== this.config.workspaceId || source.clientId !== cue?.crdt?.clientId || source.clientId === this.config.clientId) {
      throw new Error('Remote chunk identity does not match the authenticated workspace source')
    }
    if (this.config.authenticateRemoteSource && !this.config.authenticateRemoteSource(source)) throw new Error('Remote transport capability is not authenticated')
    if (this.config.allowedRemoteClientIds && !this.config.allowedRemoteClientIds.includes(source.clientId)) {
      throw new Error('Remote client is not allowed in this workspace')
    }
    if (!this.remoteWatermarks.has(source.clientId) && this.remoteWatermarks.size >= (this.config.maxRemoteClients ?? 1024)) {
      throw new Error('workspace remote client limit exceeded')
    }
    cue = validateFileChunkCue(cue)
    assertAllowedFilePath(cue.filePath, this.config.allowedExtensions)
    const maxAge = this.config.maxRemoteAgeMs ?? 86_400_000
    if (cue.crdt.updatedAt > Date.now() + 300_000 || cue.crdt.updatedAt < Date.now() - maxAge) throw new Error('Remote chunk timestamp is outside the accepted window')
    const watermark = this.remoteWatermarks.get(source.clientId) ?? 0
    const sequence = cue.crdt.seq ?? cue.crdt.updatedAt
    if (sequence <= watermark) return false
    const merged = this.lattice.mergeChunk(cue)
    this.remoteWatermarks.set(source.clientId, sequence)
    if (merged) {
      this.broadcastDelta(cue)
    }
    return merged
  }

  /**
   * Spawn an AI Co-Editor Actor bound to this workspace
   */
  createAiEditor(aiId = 'agent', modelName = 'AI Co-Editor'): AiEditorActor {
    return new AiEditorActor({
      aiId,
      modelName,
      lattice: this.lattice,
      defaultLockTtlMs: this.config.lockTtlMs,
      allowedExtensions: this.config.allowedExtensions,
      onDelta: (cue) => this.broadcastDelta(cue),
      onPresence: (p) => this.updatePresence(p),
    })
  }

  /**
   * Get merged content of a file
   */
  getFileContent(filePath: string): string | null {
    return this.lattice.getFileContent(filePath)
  }

  /**
   * Get active intent locks in the workspace
   */
  getActiveLocks(): IntentLock[] {
    return this.lattice.getActiveLocks()
  }

  /**
   * Get all active presences
   */
  getPresences(): EditorPresence[] {
    const cutoff = Date.now() - (this.config.presenceTtlMs ?? 300_000)
    for (const [clientId, presence] of this.presences) {
      if (presence.lastActiveAt < cutoff) this.presences.delete(clientId)
    }
    return Array.from(this.presences.values()).map((presence) => ({ ...presence, ...(presence.cursor ? { cursor: { ...presence.cursor } } : {}) }))
  }

  /**
   * Subscribe to CRDT delta events
   */
  onDelta(listener: (cue: FileChunkCue) => void): () => void {
    this.deltaListeners.add(listener)
    return () => this.deltaListeners.delete(listener)
  }

  /**
   * Subscribe to presence updates
   */
  onPresence(listener: (presence: EditorPresence) => void): () => void {
    this.presenceListeners.add(listener)
    return () => this.presenceListeners.delete(listener)
  }

  private broadcastDelta(cue: FileChunkCue): void {
    for (const l of this.deltaListeners) {
      l(cue)
    }
  }

  private updatePresence(presence: EditorPresence): void {
    const ttl = this.config.presenceTtlMs ?? 300_000
    if (presence.lastActiveAt < Date.now() - ttl) return
    const maxPresences = this.config.maxPresences ?? 10_000
    if (!this.presences.has(presence.clientId) && this.presences.size >= maxPresences) return
    this.presences.set(presence.clientId, presence)
    for (const l of this.presenceListeners) {
      l(presence)
    }
  }
}
