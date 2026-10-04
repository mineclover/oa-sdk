/**
 * Validation shared by the collaborative workspace ingress points.
 *
 * Chunks and locks can arrive from an untrusted browser peer.  Keeping the
 * checks in one module prevents the lattice, syncer, and AI actor from
 * accepting subtly different representations of the same path/range.
 */
import { isAbsolute, normalize, posix } from 'node:path'
import type { CollabFolderConfig, EditorPresence, FileChunkCue, IntentLock } from './types.js'

const MAX_PATH_LENGTH = 1024
const MAX_CONTENT_LENGTH = 16 * 1024 * 1024
const MAX_LINE_INDEX = 10_000_000
const MAX_LOCK_RANGE = 1_000_000
const MAX_INTENT_LENGTH = 4096
export const MAX_LOCK_TTL_MS = 300_000

const unsafePathPart = (part: string): boolean => part === '..' || part === '.' || part.length === 0
const REMOTE_TRANSPORT_CAPABILITY = Symbol('oa-sdk authenticated remote transport')

export interface RemoteTransportCapability {
  readonly [REMOTE_TRANSPORT_CAPABILITY]: true
}

/** Create an opaque source capability after a transport has authenticated a peer. */
export function createRemoteTransportCapability(): RemoteTransportCapability {
  return Object.freeze({ [REMOTE_TRANSPORT_CAPABILITY]: true }) as RemoteTransportCapability
}

export function isRemoteTransportCapability(value: unknown): value is RemoteTransportCapability {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[REMOTE_TRANSPORT_CAPABILITY] === true
}

/** Validate and canonicalize a workspace-relative path. */
export function validateRelativeFilePath(filePath: string): string {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TypeError('filePath must be a non-empty string')
  }
  if (filePath.length > MAX_PATH_LENGTH || filePath.includes('\0')) {
    throw new RangeError('filePath is too long or contains a NUL byte')
  }

  // Treat Windows separators as separators even when this package runs on
  // POSIX.  This closes the common "..\\secret" traversal variant.
  const slashPath = filePath.replaceAll('\\', '/')
  if (isAbsolute(filePath) || posix.isAbsolute(slashPath) || /^[A-Za-z]:\//.test(slashPath)) {
    throw new Error('filePath must be workspace-relative')
  }
  const parts = slashPath.split('/')
  if (parts.some(unsafePathPart)) {
    throw new Error('filePath contains an invalid path segment')
  }
  const canonical = normalize(slashPath).replaceAll('\\', '/')
  if (!canonical || canonical === '.' || canonical.startsWith('../') || canonical.includes('/../')) {
    throw new Error('filePath escapes the workspace')
  }
  return canonical
}

export function validateClientId(clientId: string): string {
  if (typeof clientId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(clientId)) {
    throw new Error('clientId contains unsupported characters')
  }
  return clientId
}

export function validateLineIndex(lineIndex: number): number {
  if (!Number.isSafeInteger(lineIndex) || lineIndex < 0 || lineIndex > MAX_LINE_INDEX) {
    throw new RangeError('lineIndex must be a non-negative safe integer')
  }
  return lineIndex
}

export function validateLineRange(range: { startLine: number; endLine: number }): { startLine: number; endLine: number } {
  if (!range || !Number.isSafeInteger(range.startLine) || !Number.isSafeInteger(range.endLine)) {
    throw new TypeError('lock range must contain integer line numbers')
  }
  if (range.startLine < 0 || range.endLine < range.startLine || range.endLine > MAX_LINE_INDEX) {
    throw new RangeError('lock range is outside the workspace')
  }
  if (range.endLine - range.startLine > MAX_LOCK_RANGE) {
    throw new RangeError('lock range is too large')
  }
  return { startLine: range.startLine, endLine: range.endLine }
}

export function validateContent(content: string): string {
  if (typeof content !== 'string' || content.length > MAX_CONTENT_LENGTH || content.includes('\0')) {
    throw new RangeError('content is invalid or exceeds the maximum size')
  }
  return content
}

export function validateIntentLock(lock: IntentLock): IntentLock {
  if (!lock || typeof lock !== 'object') throw new TypeError('lock must be an object')
  if (typeof lock.id !== 'string' || !/^[A-Za-z0-9:_-]{1,256}$/.test(lock.id)) {
    throw new Error('lock id contains unsupported characters')
  }
  validateClientId(lock.clientId)
  if (lock.role !== 'human' && lock.role !== 'ai') throw new Error('lock role is invalid')
  const filePath = validateRelativeFilePath(lock.filePath)
  const range = validateLineRange(lock.range)
  if (typeof lock.intent !== 'string' || lock.intent.trim().length === 0 || lock.intent.length > MAX_INTENT_LENGTH) {
    throw new Error('lock intent must be a non-empty bounded string')
  }
  if (lock.status !== 'active' && lock.status !== 'completed' && lock.status !== 'cancelled') {
    throw new Error('lock status is invalid')
  }
  if (!Number.isSafeInteger(lock.createdAt) || !Number.isSafeInteger(lock.expiresAt) || lock.expiresAt <= lock.createdAt) {
    throw new Error('lock timestamps are invalid')
  }
  const now = Date.now()
  if (lock.createdAt < 0 || lock.createdAt > now || lock.expiresAt - lock.createdAt > MAX_LOCK_TTL_MS || lock.expiresAt > now + MAX_LOCK_TTL_MS) {
    throw new RangeError('Lock TTL must not exceed 5 minutes or begin in the future')
  }
  if (lock.version !== undefined && (!Number.isSafeInteger(lock.version) || lock.version < 0)) throw new RangeError('Lock version is invalid')
  return {
    ...lock,
    filePath,
    range,
    intent: lock.intent.trim(),
  }
}

export function validateFileChunkCue(cue: FileChunkCue): FileChunkCue {
  if (!cue || typeof cue !== 'object') throw new TypeError('chunk cue must be an object')
  if (typeof cue.id !== 'string' || cue.id.length === 0 || cue.id.length > MAX_PATH_LENGTH + 32 || cue.id.includes('\0')) {
    throw new Error('chunk id is invalid')
  }
  const filePath = validateRelativeFilePath(cue.filePath)
  const lineIndex = validateLineIndex(cue.lineIndex)
  if (cue.id !== `${filePath}#L${lineIndex}`) throw new Error('chunk id does not match filePath and lineIndex')
  validateContent(cue.content)
  if (cue.content.includes('\n')) throw new Error('chunk content must contain one line')
  if (!cue.crdt || typeof cue.crdt !== 'object') throw new TypeError('chunk CRDT metadata is required')
  validateClientId(cue.crdt.clientId)
  if (!Number.isSafeInteger(cue.crdt.updatedAt) || cue.crdt.updatedAt < 0) {
    throw new Error('chunk updatedAt must be a non-negative safe integer')
  }
  if (cue.crdt.seq !== undefined && (!Number.isSafeInteger(cue.crdt.seq) || cue.crdt.seq < 0)) {
    throw new Error('chunk sequence must be a non-negative safe integer')
  }
  if (cue.crdt.tombstone !== undefined && typeof cue.crdt.tombstone !== 'boolean') throw new Error('chunk tombstone must be boolean')
  if (cue.crdt.vectorClock) {
    for (const [id, value] of Object.entries(cue.crdt.vectorClock)) {
      validateClientId(id)
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('chunk vector clock contains an invalid counter')
    }
  }
  return {
    ...cue,
    filePath,
    lineIndex,
    crdt: { ...cue.crdt, clientId: cue.crdt.clientId, ...(cue.crdt.vectorClock ? { vectorClock: { ...cue.crdt.vectorClock } } : {}) },
  }
}

export function validateWorkspaceConfig(config: CollabFolderConfig): CollabFolderConfig {
  if (!config || typeof config !== 'object') throw new TypeError('workspace config is required')
  if (typeof config.rootPath !== 'string' || !isAbsolute(config.rootPath)) {
    throw new Error('rootPath must be an absolute path')
  }
  if (typeof config.workspaceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(config.workspaceId)) {
    throw new Error('workspaceId contains unsupported characters')
  }
  validateClientId(config.clientId)
  if (config.role !== 'human' && config.role !== 'ai') throw new Error('workspace role is invalid')
  const allowedExtensions = config.allowedExtensions?.map((ext) => {
    if (typeof ext !== 'string' || !/^\.?[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ext)) {
      throw new Error('allowedExtensions contains an invalid extension')
    }
    return ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
  })
  if (config.lockTtlMs !== undefined && (!Number.isSafeInteger(config.lockTtlMs) || config.lockTtlMs <= 0 || config.lockTtlMs > MAX_LOCK_TTL_MS)) {
    throw new RangeError('lockTtlMs must be between 1ms and 5 minutes')
  }
  for (const key of ['maxRemoteClients', 'maxRemoteAgeMs', 'maxPresences', 'presenceTtlMs'] as const) {
    const value = config[key]
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > 86_400_000)) throw new RangeError(`${key} is invalid`)
  }
  if (config.limits) {
    for (const [key, value] of Object.entries(config.limits)) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > 100_000_000)) throw new RangeError(`limits.${key} is invalid`)
    }
  }
  if (config.authenticateRemoteSource !== undefined && typeof config.authenticateRemoteSource !== 'function') throw new TypeError('authenticateRemoteSource must be a function')
  const allowedRemoteClientIds = config.allowedRemoteClientIds?.map(validateClientId)
  return { ...config, allowedExtensions, allowedRemoteClientIds }
}

export function assertAllowedFilePath(filePath: string, allowedExtensions?: readonly string[]): string {
  const canonical = validateRelativeFilePath(filePath)
  if (allowedExtensions && allowedExtensions.length > 0) {
    const lower = canonical.toLowerCase()
    if (!allowedExtensions.some((ext) => lower.endsWith(ext.toLowerCase()))) {
      throw new Error(`file extension is not allowed: ${canonical}`)
    }
  }
  return canonical
}

export function validatePresence(presence: EditorPresence): EditorPresence {
  validateClientId(presence.clientId)
  if (presence.role !== 'human' && presence.role !== 'ai') throw new Error('presence role is invalid')
  if (typeof presence.name !== 'string' || presence.name.length === 0 || presence.name.length > 256) {
    throw new Error('presence name is invalid')
  }
  if (presence.currentFile !== undefined) validateRelativeFilePath(presence.currentFile)
  if (presence.cursor) {
    validateLineIndex(presence.cursor.line)
    if (!Number.isSafeInteger(presence.cursor.column) || presence.cursor.column < 0) {
      throw new RangeError('presence cursor column is invalid')
    }
  }
  if (!Number.isFinite(presence.lastActiveAt) || presence.lastActiveAt < 0) {
    throw new RangeError('presence timestamp is invalid')
  }
  return { ...presence }
}
