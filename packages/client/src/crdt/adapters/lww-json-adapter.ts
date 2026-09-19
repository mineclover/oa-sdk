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

    try {
      const incoming = JSON.parse(text) as LwwUpdatePayload
      if (!incoming || typeof incoming !== 'object') return

      for (const [field, inEntry] of Object.entries(incoming)) {
        if (!inEntry || typeof inEntry.timestamp !== 'number') continue

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
    } catch {
      // ignore malformed payloads
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

    let peerVector: LwwStateVector = {}
    try {
      peerVector = JSON.parse(text) as LwwStateVector
    } catch {
      peerVector = {}
    }

    const diff: LwwUpdatePayload = {}
    for (const [field, entry] of this.properties.entries()) {
      const peerTimestamp = peerVector[field] ?? 0
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
