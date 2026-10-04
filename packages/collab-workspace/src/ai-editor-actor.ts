/**
 * @oa-sdk/collab-workspace — AI First-Class Co-Editor Actor
 *
 * Coordinates AI edits via IntentLocks and micro-chunk streaming deltas.
 */
import type { EditorPresence, FileChunkCue, IntentLock } from './types.js'
import { WorkspaceTreeLattice } from './tree-lattice.js'
import { randomUUID } from 'node:crypto'
import { MAX_LOCK_TTL_MS, assertAllowedFilePath, validateClientId, validateContent, validateLineIndex, validateLineRange, validatePresence } from './security.js'

export interface AiEditorConfig {
  aiId: string
  modelName: string
  lattice: WorkspaceTreeLattice
  defaultLockTtlMs?: number | undefined
  allowedExtensions?: readonly string[] | undefined
  onDelta?: ((cue: FileChunkCue) => void) | undefined
  onPresence?: ((presence: EditorPresence) => void) | undefined
}

export class AiEditorActor {
  readonly clientId: string
  readonly modelName: string
  private lattice: WorkspaceTreeLattice
  private defaultLockTtlMs: number
  private activeLocks = new Map<string, IntentLock>()
  private allowedExtensions?: readonly string[] | undefined
  private onDelta?: ((cue: FileChunkCue) => void) | undefined
  private onPresence?: ((presence: EditorPresence) => void) | undefined

  constructor(config: AiEditorConfig) {
    this.clientId = `client:ai:${config.aiId}`
    validateClientId(this.clientId)
    this.modelName = config.modelName
    this.lattice = config.lattice
    this.defaultLockTtlMs = config.defaultLockTtlMs ?? 15000
    this.allowedExtensions = config.allowedExtensions
    this.onDelta = config.onDelta
    this.onPresence = config.onPresence
  }

  /**
   * Broadcast current AI presence and cursor location
   */
  updatePresence(filePath?: string, cursor?: { line: number; column: number }): EditorPresence {
    const presence = validatePresence({
      clientId: this.clientId,
      role: 'ai',
      name: this.modelName,
      currentFile: filePath,
      cursor,
      lastActiveAt: Date.now(),
    })
    this.onPresence?.(presence)
    return presence
  }

  /**
   * Acquire an intent lock on a code region before editing
   */
  acquireIntent(
    filePath: string,
    range: { startLine: number; endLine: number },
    intent: string,
    ttlMs = this.defaultLockTtlMs,
  ): IntentLock | null {
    filePath = assertAllowedFilePath(filePath, this.allowedExtensions)
    range = validateLineRange(range)
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_LOCK_TTL_MS) throw new RangeError('Lock TTL must be between 1ms and 5 minutes')
    const lockId = `lock_${randomUUID()}`
    const now = Date.now()
    const lock: IntentLock = {
      id: lockId,
      clientId: this.clientId,
      role: 'ai',
      filePath,
      range,
      intent,
      status: 'active',
      createdAt: now,
      expiresAt: now + ttlMs,
      version: 0,
    }

    const ok = this.lattice.setLock(lock)
    if (!ok) return null

    this.activeLocks.set(lockId, lock)
    this.updatePresence(filePath, { line: range.startLine, column: 0 })
    return lock
  }

  /**
   * Stream a line-level modification directly into the CRDT tree
   */
  streamLineEdit(filePath: string, lineIndex: number, content: string): FileChunkCue {
    filePath = assertAllowedFilePath(filePath, this.allowedExtensions)
    validateLineIndex(lineIndex)
    validateContent(content)
    if (content.includes('\n')) throw new Error('line content must contain one line')
    this.assertOwnIntent(filePath, lineIndex, lineIndex)
    const cue: FileChunkCue = {
      id: `${filePath}#L${lineIndex}`,
      filePath,
      lineIndex,
      content,
      crdt: {
        clientId: this.clientId,
        updatedAt: this.lattice.nextTimestamp(),
      },
    }

    this.lattice.mergeChunk(cue)
    this.onDelta?.(cue)
    this.updatePresence(filePath, { line: lineIndex, column: content.length })
    return cue
  }

  /**
   * Stream a block replacement for a given intent range
   */
  streamBlockEdit(filePath: string, startLine: number, newLines: string[]): FileChunkCue[] {
    filePath = assertAllowedFilePath(filePath, this.allowedExtensions)
    validateLineIndex(startLine)
    if (!Array.isArray(newLines)) throw new TypeError('newLines must be an array')
    if (newLines.length === 0) return []
    const endLine = validateLineIndex(startLine + newLines.length - 1)
    for (const content of newLines) {
      validateContent(content)
      if (content.includes('\n')) throw new Error('line content must contain one line')
    }
    this.assertOwnIntent(filePath, startLine, endLine)
    const cues: FileChunkCue[] = []
    const now = this.lattice.nextTimestamp()

    for (let i = 0; i < newLines.length; i++) {
      const lineIndex = startLine + i
      const cue: FileChunkCue = {
        id: `${filePath}#L${lineIndex}`,
        filePath,
        lineIndex,
        content: newLines[i]!,
        crdt: {
          clientId: this.clientId,
          updatedAt: now,
        },
      }
      this.lattice.mergeChunk(cue)
      this.onDelta?.(cue)
      cues.push(cue)
    }

    this.updatePresence(filePath, {
      line: startLine + newLines.length - 1,
      column: (newLines[newLines.length - 1] ?? '').length,
    })
    return cues
  }

  /**
   * Complete the editing session and release the lock
   */
  completeIntent(lockId: string): void {
    const lock = this.activeLocks.get(lockId)
    if (lock) {
      lock.status = 'completed'
      this.lattice.releaseLock(lockId, this.clientId)
      this.activeLocks.delete(lockId)
    }
  }

  renewIntent(lockId: string, ttlMs = this.defaultLockTtlMs): IntentLock | null {
    const current = this.activeLocks.get(lockId)
    if (!current) return null
    const renewed = this.lattice.renewLock(lockId, this.clientId, ttlMs)
    if (renewed) this.activeLocks.set(lockId, renewed)
    return renewed
  }

  private assertOwnIntent(filePath: string, startLine: number, endLine: number): void {
    const ownsRange = this.lattice.getActiveLocks().some((lock) =>
      lock.clientId === this.clientId && this.activeLocks.has(lock.id) && lock.filePath === filePath &&
      lock.range.startLine <= startLine && lock.range.endLine >= endLine,
    )
    if (!ownsRange) throw new Error('AI edits require an active owned IntentLock covering the entire range')
  }
}
