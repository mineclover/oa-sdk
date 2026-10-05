/**
 * Zero-dependency pure TypeScript Last-Write-Wins (LWW) CRDT engine adapter.
 * Provides out-of-the-box conflict-free register and map semantics without external packages.
 */

import type { CrdtEngineAdapter } from '../crdt-types.js'

export interface LwwEntry {
  value: unknown
  timestamp: number
  actorId: string
  deleted?: boolean | undefined
}

export type LwwStateVector = Record<string, number>
export type LwwUpdatePayload = Record<string, LwwEntry>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A register entry received from a peer. Timestamps must be finite so a peer cannot pin the logical clock. */
function parseLwwEntry(value: unknown): LwwEntry | undefined {
  if (!isRecord(value) || typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) return undefined
  return {
    value: value.value,
    timestamp: value.timestamp,
    actorId: typeof value.actorId === 'string' ? value.actorId : '',
    ...(typeof value.deleted === 'boolean' ? { deleted: value.deleted } : {}),
  }
}

/** A peer update document (field -> entry). Malformed entries are skipped. */
const LwwUpdatePayloadSchema = {
  parse(value: unknown): Map<string, LwwEntry> {
    const entries = new Map<string, LwwEntry>()
    if (!isRecord(value)) return entries
    for (const [field, raw] of Object.entries(value)) {
      const entry = parseLwwEntry(raw)
      if (entry !== undefined) entries.set(field, entry)
    }
    return entries
  },
}

/** A peer state vector (field -> last seen timestamp). Non-finite timestamps are ignored. */
const LwwStateVectorSchema = {
  parse(value: unknown): Map<string, number> {
    const vector = new Map<string, number>()
    if (!isRecord(value)) return vector
    for (const [field, timestamp] of Object.entries(value)) {
      if (typeof timestamp === 'number' && Number.isFinite(timestamp)) vector.set(field, timestamp)
    }
    return vector
  },
}

export class LwwJsonAdapter<TDoc = Record<string, unknown>> implements CrdtEngineAdapter<TDoc> {
  public readonly name = 'lww-json'
  private readonly actorId: string
  private properties = new Map<string, LwwEntry>()
  private listeners = new Set<(update: string) => void>()
  private logicalClock = 0

  constructor(actorId?: string) {
    this.actorId = actorId ?? Math.random().toString(36).slice(2, 11)
  }

  public createDoc(): void {
    this.properties.clear()
    this.logicalClock = 0
  }

  private nextTimestamp(): number {
    const wallClock = Date.now()
    this.logicalClock = Math.max(wallClock, this.logicalClock + 1)
    return this.logicalClock
  }

  public updateField(field: string, value: unknown): string {
    const timestamp = this.nextTimestamp()
    const entry: LwwEntry = {
      value,
      timestamp,
      actorId: this.actorId,
      deleted: value === undefined,
    }

    this.properties.set(field, entry)

    const payload: LwwUpdatePayload = { [field]: entry }
    const serialized = JSON.stringify(payload)

    for (const listener of this.listeners) {
      listener(serialized)
    }

    return serialized
  }

  public applyUpdate(update: Uint8Array | string): void {
    const text = typeof update === 'string'
      ? update
      : new TextDecoder().decode(update)

    let incoming: Map<string, LwwEntry>
    try {
      incoming = LwwUpdatePayloadSchema.parse(JSON.parse(text))
    } catch {
      // ignore malformed payloads
      return
    }

    for (const [field, inEntry] of incoming) {
      const current = this.properties.get(field)
      if (!current) {
        this.properties.set(field, inEntry)
      } else if (
        inEntry.timestamp > current.timestamp ||
        (inEntry.timestamp === current.timestamp && (inEntry.actorId || '') > (current.actorId || ''))
      ) {
        this.properties.set(field, inEntry)
      }

      if (inEntry.timestamp > this.logicalClock) {
        this.logicalClock = inEntry.timestamp
      }
    }
  }

  public encodeStateVector(): string {
    const vector: LwwStateVector = {}
    for (const [field, entry] of this.properties.entries()) {
      vector[field] = entry.timestamp
    }
    return JSON.stringify(vector)
  }

  public encodeDiff(stateVector: Uint8Array | string): string {
    const text = typeof stateVector === 'string'
      ? stateVector
      : new TextDecoder().decode(stateVector)

    let peerVector = new Map<string, number>()
    try {
      peerVector = LwwStateVectorSchema.parse(JSON.parse(text))
    } catch {
      // A malformed vector is treated as empty: the peer receives every field.
    }

    const diff: LwwUpdatePayload = {}
    for (const [field, entry] of this.properties.entries()) {
      const peerTimestamp = peerVector.get(field) ?? 0
      if (entry.timestamp > peerTimestamp) {
        diff[field] = entry
      }
    }

    return JSON.stringify(diff)
  }

  public getState(): TDoc {
    const result: Record<string, unknown> = {}
    for (const [field, entry] of this.properties.entries()) {
      if (!entry.deleted) {
        result[field] = entry.value
      }
    }
    return result as TDoc
  }

  public onUpdate(callback: (update: string) => void): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }
}
