import { BridgeError } from '../protocol/errors.js'

type Entry = { fingerprint: string; promise: Promise<unknown> }

/**
 * Executes a keyed operation at most once. A retry that arrives while the first attempt runs
 * shares its result; a retry after success gets the stored result. Failures are not stored, so a
 * retry after an error runs the operation again (a failed attempt must not have committed).
 */
export class IdempotencyStore {
  readonly #entries = new Map<string, Entry>()
  readonly #limit: number

  constructor(limit = 256) {
    this.#limit = limit
  }

  /**
   * @param scope isolates keys per method.
   * @param fingerprint canonical form of the params; reusing a key with different params throws.
   * @param shouldKeep called after the operation settles; return `false` to drop the entry
   *   (e.g. the attempt was cancelled and must be re-executable).
   */
  run<T>(scope: string, key: string, fingerprint: string, execute: () => Promise<T>, shouldKeep: () => boolean): Promise<T> {
    const id = `${scope}\u0000${key}`
    const existing = this.#entries.get(id)
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(
          new BridgeError('IDEMPOTENCY_CONFLICT', `Idempotency key "${key}" was already used with different params`),
        )
      }
      return existing.promise as Promise<T>
    }
    const promise = execute().then(
      value => {
        if (!shouldKeep()) this.#entries.delete(id)
        return value
      },
      error => {
        this.#entries.delete(id)
        throw error
      },
    )
    this.#entries.set(id, { fingerprint, promise })
    this.#evict()
    return promise
  }

  #evict(): void {
    while (this.#entries.size > this.#limit) {
      const oldest = this.#entries.keys().next().value
      if (oldest === undefined) return
      this.#entries.delete(oldest)
    }
  }

  /** Drops an entry so the next attempt with the key executes again. */
  forget(scope: string, key: string): void {
    this.#entries.delete(`${scope}\u0000${key}`)
  }

  clear(): void {
    this.#entries.clear()
  }
}

/** Stable text for comparing params. Params JSON cannot represent never match a stored entry. */
export function fingerprintParams(params: unknown): string {
  try {
    return JSON.stringify(params ?? null, (_key, value) =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : value,
    )
  } catch {
    return `unserializable:${Math.random()}`
  }
}
