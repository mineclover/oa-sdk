/**
 * Event replay: a bounded per-event buffer in the popup lets a host that missed events (a dropped
 * notification, a back/forward cache restore) fetch them again instead of only a snapshot.
 *
 * Revisions are per event and consumed one per wire event, so the buffer is a window over the most
 * recent revisions. It never claims to cover more than it holds: `oldest` says where the window
 * starts, and a revision that cannot be replayed (an event sent with a transfer list) empties it.
 *
 * Buffer contents are readable by anyone who can call `bridge.replay` on the popup, i.e. whoever
 * may subscribe to the event.
 */
import { BridgeError } from '../protocol/errors.js'
import { isDataCloneError } from '../rpc/transfer.js'

/** Built-in request that returns the events after a revision. Gated by `events.replay`. */
export const REPLAY_METHOD = 'bridge.replay'

/** Upper bound on the capacity of one event buffer, and so on the size of one replay reply. */
export const MAX_REPLAY_CAPACITY = 1_000

const MAX_EPOCH_LENGTH = 128

export type ReplayEntry = {
  revision: number
  /** How many emits were merged into this event; omitted for an event that stands for one emit. */
  coalesced?: number
  payload: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Checks a replay capacity written by a developer. `min` is 1 for an event declaration, where 0
 * would just be "no replay" and is spelled by omitting the option.
 */
export function assertReplayCapacity(value: unknown, subject: string, min = 1): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > MAX_REPLAY_CAPACITY) {
    throw new TypeError(`${subject} must be an integer from ${min} to ${MAX_REPLAY_CAPACITY}, got ${String(value)}`)
  }
}

/** The most recent revisions of one event, oldest first. */
export class ReplayBuffer {
  readonly capacity: number
  readonly #entries: ReplayEntry[] = []
  #current: number

  /** @param startRevision the revision already consumed before the buffer was created. */
  constructor(capacity: number, startRevision = 0) {
    assertReplayCapacity(capacity, 'Replay capacity')
    this.capacity = capacity
    this.#current = startRevision
  }

  /** The newest revision consumed so far; 0 before the first. */
  get current(): number {
    return this.#current
  }

  /** The first revision still held; `current + 1` while the buffer is empty. */
  get oldest(): number {
    return this.#entries[0]?.revision ?? this.#current + 1
  }

  get size(): number {
    return this.#entries.length
  }

  /** Appends the next revision, dropping the oldest entry when the buffer is full. */
  record(revision: number, payload: unknown, coalesced?: number): void {
    if (revision !== this.#current + 1) throw new RangeError(`Revision ${revision} does not follow ${this.#current}`)
    this.#entries.push({ revision, ...(coalesced === undefined ? {} : { coalesced }), payload })
    if (this.#entries.length > this.capacity) this.#entries.shift()
    this.#current = revision
  }

  /**
   * Consumes `revision` without keeping it (its payload could not be copied, e.g. it was
   * transferred). Everything older is dropped too: a window with a hole would claim a continuity
   * it does not have.
   */
  evictThrough(revision: number): void {
    if (revision !== this.#current + 1) throw new RangeError(`Revision ${revision} does not follow ${this.#current}`)
    this.#entries.length = 0
    this.#current = revision
  }

  /** The entries after `since`, oldest first. */
  since(since: number): ReplayEntry[] {
    return this.#entries.filter(entry => entry.revision > since)
  }
}

/**
 * A private copy of an event payload, so later changes by the emitter cannot alter what was kept.
 * Throws `NOT_CLONEABLE` for a value that cannot be cloned.
 */
export function copyPayload(name: string, payload: unknown, purpose: string): unknown {
  try {
    return structuredClone(payload)
  } catch (error) {
    if (!isDataCloneError(error)) throw error
    throw new BridgeError('NOT_CLONEABLE', `The payload of ${name} cannot be ${purpose}: it holds a value that cannot be cloned`, { data: { method: name }, cause: error })
  }
}

export type ReplayRequest = { name: string; since: number }

/** Validates the params of `bridge.replay`; throws `INVALID_PARAMS`. */
export function parseReplayRequest(params: unknown): ReplayRequest {
  if (!isRecord(params) || typeof params.name !== 'string' || !isCount(params.since)) {
    throw new BridgeError('INVALID_PARAMS', 'bridge.replay expects { name: string, since: non-negative integer }')
  }
  return { name: params.name, since: params.since }
}

/** What the popup answers: its identity, how far it got and what it still holds after `since`. */
export type ReplayReply = {
  /** Identifies one popup runtime; revisions are only comparable within the same epoch. */
  epoch: string
  /** The newest revision consumed. */
  revision: number
  /** The first revision still held; `revision + 1` when none is. */
  oldest: number
  /** Buffer capacity of the event; 0 when the popup keeps no history for it. */
  capacity: number
  entries: ReplayEntry[]
}

export function buildReplayReply(epoch: string, revision: number, buffer: ReplayBuffer | undefined, since: number): ReplayReply {
  if (buffer === undefined) return { epoch, revision, oldest: revision + 1, capacity: 0, entries: [] }
  return { epoch, revision: buffer.current, oldest: buffer.oldest, capacity: buffer.capacity, entries: buffer.since(since) }
}

/**
 * Strict reading of an untrusted reply: anything that does not hold together (entries out of
 * order, beyond `revision`, below `oldest`, more than the maximum capacity) is refused as a whole.
 */
export function parseReplayReply(value: unknown): ReplayReply | undefined {
  if (!isRecord(value)) return undefined
  const { epoch, revision, oldest, capacity, entries } = value
  if (typeof epoch !== 'string' || epoch === '' || epoch.length > MAX_EPOCH_LENGTH) return undefined
  if (!isCount(revision) || !isCount(oldest) || oldest > revision + 1) return undefined
  if (!isCount(capacity) || capacity > MAX_REPLAY_CAPACITY) return undefined
  if (!Array.isArray(entries) || entries.length > MAX_REPLAY_CAPACITY) return undefined
  const parsed: ReplayEntry[] = []
  let previous = 0
  for (const entry of entries as unknown[]) {
    if (!isRecord(entry) || !isCount(entry.revision) || entry.revision < 1) return undefined
    if (entry.revision <= previous || entry.revision > revision || entry.revision < oldest) return undefined
    const { coalesced } = entry
    if (coalesced !== undefined && (!isCount(coalesced) || coalesced < 2)) return undefined
    parsed.push({ revision: entry.revision, ...(coalesced === undefined ? {} : { coalesced }), payload: entry.payload })
    previous = entry.revision
  }
  return { epoch, revision, oldest, capacity, entries: parsed }
}
