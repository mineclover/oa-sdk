/**
 * @oa-sdk/collab-workspace — Workspace Tree-Lattice Store
 *
 * Implements an algebraic Join Semi-Lattice over workspace files and lines.
 */
import { compareCrdtMetadata } from '@oa-sdk/chunk-stream-crdt'
import type { FileChunkCue, IntentLock, WorkspaceLimits } from './types.js'
import { validateClientId, validateContent, validateFileChunkCue, validateIntentLock, validateRelativeFilePath } from './security.js'

export class WorkspaceTreeLattice {
  // filePath -> Map<lineIndex, FileChunkCue>
  private files = new Map<string, Map<number, FileChunkCue>>()
  // lockId -> IntentLock
  private locks = new Map<string, IntentLock>()
  private lastTimestamp = 0
  private readonly maxFiles: number
  private readonly maxChunks: number
  private readonly maxContentBytes: number
  private readonly maxRenderLines: number
  private readonly maxLocks: number
  private contentBytes = 0

  constructor(options: WorkspaceLimits = {}) {
    this.maxFiles = options.maxFiles ?? 10_000
    this.maxChunks = options.maxChunks ?? 1_000_000
    this.maxContentBytes = options.maxContentBytes ?? 64 * 1024 * 1024
    this.maxRenderLines = options.maxRenderLines ?? 1_000_000
    this.maxLocks = options.maxLocks ?? 10_000
  }

  /**
   * Generate a monotonic timestamp ensuring strict causality
   */
  nextTimestamp(minTimestamp?: number): number {
    if (minTimestamp !== undefined && (!Number.isSafeInteger(minTimestamp) || minTimestamp < 0)) throw new RangeError('Invalid timestamp')
    const ts = Math.max(Date.now(), minTimestamp ?? 0, this.lastTimestamp + 1)
    if (!Number.isSafeInteger(ts)) throw new RangeError('CRDT timestamp exhausted')
    this.lastTimestamp = ts
    return ts
  }

  /**
   * Merge an incoming or local file chunk cue.
   * Total ordering ensures deterministic convergence without races.
   */
  mergeChunk(cue: FileChunkCue): boolean {
    cue = validateFileChunkCue(cue)
    const existingFile = this.files.get(cue.filePath)
    if (!existingFile && this.files.size >= this.maxFiles) this.compactTombstones()
    if (!existingFile && this.files.size >= this.maxFiles) throw new RangeError('workspace file limit exceeded')
    this.lastTimestamp = Math.max(this.lastTimestamp, cue.crdt.updatedAt)
    const lineMap = existingFile ?? new Map<number, FileChunkCue>()
    const existing = lineMap.get(cue.lineIndex)

    if (!existing) {
      if (this.totalChunks() >= this.maxChunks) this.compactTombstones()
      if (this.totalChunks() >= this.maxChunks) throw new RangeError('workspace chunk limit exceeded')
      if (this.contentBytes + cue.content.length > this.maxContentBytes) this.compactTombstones()
      if (this.contentBytes + cue.content.length > this.maxContentBytes) throw new RangeError('workspace content limit exceeded')
      if (!existingFile) this.files.set(cue.filePath, lineMap)
      lineMap.set(cue.lineIndex, cue)
      this.contentBytes += cue.content.length
      return true
    }

    // Compare CRDT metadata: updatedAt -> clientId -> tombstone -> seq
    const cmp = compareCrdtMetadata(cue.crdt, existing.crdt)
    // Peers may deliver different content under identical metadata. A stable
    // content tie-breaker preserves commutativity regardless of arrival order.
    if (cmp > 0 || (cmp === 0 && cue.content > existing.content)) {
      lineMap.set(cue.lineIndex, cue)
      this.contentBytes += cue.content.length - existing.content.length
      if (this.contentBytes > this.maxContentBytes) {
        lineMap.set(cue.lineIndex, existing)
        this.contentBytes -= cue.content.length - existing.content.length
        throw new RangeError('workspace content limit exceeded')
      }
      return true
    }

    return false
  }

  /**
   * Set or update a file's entire content from an editor with a specific clientId.
   */
  setFileContent(filePath: string, content: string, clientId: string, timestamp?: number): FileChunkCue[] {
    filePath = validateRelativeFilePath(filePath)
    validateContent(content)
    validateClientId(clientId)
    const ts = this.nextTimestamp(timestamp)
    const lines = content.split('\n')
    const cues: FileChunkCue[] = []

    for (let i = 0; i < lines.length; i++) {
      const cue: FileChunkCue = {
        id: `${filePath}#L${i}`,
        filePath,
        lineIndex: i,
        content: lines[i]!,
        crdt: {
          clientId,
          updatedAt: ts,
        },
      }
      this.mergeChunk(cue)
      cues.push(cue)
    }

    // Mark extra deleted lines if file shrank
    const lineMap = this.files.get(filePath)
    if (lineMap) {
      for (const [idx, oldCue] of lineMap.entries()) {
        if (idx >= lines.length && !oldCue.crdt.tombstone) {
          const tombCue: FileChunkCue = {
            ...oldCue,
            content: '',
            crdt: {
              ...oldCue.crdt,
              clientId,
              updatedAt: ts,
              tombstone: true,
            },
          }
          this.mergeChunk(tombCue)
          cues.push(tombCue)
        }
      }
    }

    return cues
  }

  /**
   * Render the merged file content
   */
  getFileContent(filePath: string): string | null {
    filePath = validateRelativeFilePath(filePath)
    const lineMap = this.files.get(filePath)
    if (!lineMap || lineMap.size === 0) return null

    let maxLine = 0
    for (const index of lineMap.keys()) maxLine = Math.max(maxLine, index)
    if (maxLine >= this.maxRenderLines) throw new RangeError('sparse file render limit exceeded')
    const lines: string[] = []

    for (let i = 0; i <= maxLine; i++) {
      const cue = lineMap.get(i)
      if (cue && !cue.crdt.tombstone) {
        lines.push(cue.content)
      } else if (!cue) {
        lines.push('')
      }
    }

    return lines.join('\n')
  }

  /**
   * List all tracked files in the workspace
   */
  listFiles(): string[] {
    return Array.from(this.files.keys())
  }

  /**
   * Acquire or update an IntentLock (e.g. AI or Human intent area)
   */
  setLock(lock: IntentLock): boolean {
    lock = validateIntentLock(lock)
    this.pruneExpiredLocks()
    const existing = this.locks.get(lock.id)
    if (existing && existing.clientId !== lock.clientId) return false
    if (existing && (lock.version ?? 0) <= (existing.version ?? 0)) return false
    if (lock.status !== 'active' || lock.expiresAt <= Date.now()) return false
    if (!existing && this.locks.size >= this.maxLocks) return false

    // Check conflict with active locks
    for (const active of this.locks.values()) {
      if (
        active.id !== lock.id &&
        active.filePath === lock.filePath &&
        active.status === 'active' &&
        active.clientId !== lock.clientId
      ) {
        // Range overlap test
        const overlap = Math.max(active.range.startLine, lock.range.startLine) <= Math.min(active.range.endLine, lock.range.endLine)
        if (overlap) {
          return false // Lock conflict
        }
      }
    }

    this.locks.set(lock.id, { ...lock, version: existing ? (lock.version ?? 0) : (lock.version ?? 0) })
    return true
  }

  /**
   * Release an IntentLock
   */
  releaseLock(lockId: string, clientId: string): boolean {
    if (this.locks.get(lockId)?.clientId !== clientId) return false
    return this.locks.delete(lockId)
  }

  /** Renew an owned lock with a strictly increasing version and bounded TTL. */
  renewLock(lockId: string, clientId: string, ttlMs: number): IntentLock | null {
    const existing = this.locks.get(lockId)
    if (!existing || existing.clientId !== clientId || existing.status !== 'active') return null
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 300_000) throw new RangeError('Lock TTL must be between 1ms and 5 minutes')
    const now = Date.now()
    const renewed: IntentLock = { ...existing, createdAt: now, expiresAt: now + ttlMs, version: (existing.version ?? 0) + 1 }
    if (!this.setLock(renewed)) return null
    return { ...renewed, range: { ...renewed.range } }
  }

  /**
   * Get all active locks
   */
  getActiveLocks(): IntentLock[] {
    this.pruneExpiredLocks()
    return Array.from(this.locks.values()).filter((l) => l.status === 'active').map((lock) => ({ ...lock, range: { ...lock.range } }))
  }

  private pruneExpiredLocks(): void {
    const now = Date.now()
    for (const [id, lock] of this.locks.entries()) {
      if (lock.expiresAt <= now) {
        this.locks.delete(id)
      }
    }
  }

  private totalChunks(): number {
    let total = 0
    for (const lines of this.files.values()) total += lines.size
    return total
  }

  /** Remove tombstones that are older than the supplied retention window. */
  compactTombstones(maxAgeMs = 86_400_000): number {
    if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) throw new RangeError('maxAgeMs must be a non-negative safe integer')
    const cutoff = Date.now() - maxAgeMs
    let removed = 0
    for (const [filePath, lineMap] of this.files.entries()) {
      for (const [line, cue] of lineMap.entries()) {
        if (cue.crdt.tombstone && cue.crdt.updatedAt <= cutoff) {
          lineMap.delete(line)
          this.contentBytes -= cue.content.length
          removed++
        }
      }
      if (lineMap.size === 0) this.files.delete(filePath)
    }
    return removed
  }
}
