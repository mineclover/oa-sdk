/**
 * Shared state: one page owns the authoritative copy of a named value and any linked window keeps
 * a live replica of it. Every change travels as a complete, revisioned snapshot, so a replica that
 * missed an update, or reconnected after a reload, catches up with the next one (or a re-sync)
 * and never has to merge anything.
 *
 *   owner:   const selection = node.state.own(selectionState)       // get / set / update / onChange
 *   replica: const view = popupLink.replicate(selectionState)       // ready / get / onChange / set / update
 *
 * Replicas are read-only unless the definition says `writable`; a write is a proposal the owner
 * validates, optionally against the revision the writer last saw (`STATE_CONFLICT` otherwise).
 */
import { assertName } from '../contract/define.js'
import { runSchema, type SchemaLike } from '../contract/schema.js'
import { BridgeError, isBridgeError } from '../protocol/errors.js'
import type { LinkController, PeerLink } from '../node/link.js'
import type { NodeCore } from '../node/node.js'

export const STATE_SUBSCRIBE_METHOD = 'bridge.state.subscribe'
export const STATE_UNSUBSCRIBE_METHOD = 'bridge.state.unsubscribe'
export const STATE_SET_METHOD = 'bridge.state.set'
export const STATE_CHANGED_METHOD = 'bridge.state.changed'

export interface SharedStateDefinition<T> {
  /** Dotted lowerCamelCase, like method and event names: `document.selection`. */
  readonly name: string
  readonly initial: T
  /** Checks every value an owner commits and every snapshot a replica receives. */
  readonly schema?: SchemaLike<T>
  /** Whether replicas may propose changes. Default `false`. */
  readonly writable: boolean
}

export type SharedStateInput<T> = {
  name: string
  initial: T
  schema?: SchemaLike<T>
  writable?: boolean
}

export function defineSharedState<T>(input: SharedStateInput<T>): SharedStateDefinition<T> {
  assertName(input.name, 'state')
  return Object.freeze({
    name: input.name,
    initial: input.initial,
    ...(input.schema === undefined ? {} : { schema: input.schema }),
    writable: input.writable ?? false,
  })
}

export type StateSnapshot<T> = { value: T; revision: number }

export type StateChange = { source: 'local' | 'remote'; link?: PeerLink }

export type OwnedStateOptions<T> = {
  /** Decide per link whether it may read or write. Reads are open and writes follow `writable` by default. */
  authorize?: (operation: 'read' | 'write', link: PeerLink) => boolean
  /** Called when a replica's proposed value is committed or refused, for logging. */
  onError?: (error: unknown) => void
  /** Initial value override; defaults to the definition's. */
  initial?: T
}

export interface OwnedState<T> {
  readonly name: string
  get(): StateSnapshot<T>
  /** Commits a new value and pushes it to every subscribed replica. Returns the new revision. */
  set(value: T): number
  update(change: (current: T) => T): number
  onChange(listener: (snapshot: StateSnapshot<T>, change: StateChange) => void): () => void
  /** Replicas currently subscribed. */
  readonly subscribers: number
  dispose(): void
}

export interface SharedStates {
  /** Makes this page the owner of `definition`. A name can be owned once per node. */
  own<T>(definition: SharedStateDefinition<T>, options?: OwnedStateOptions<T>): OwnedState<T>
}

export type ReplicaStatus = 'connecting' | 'ready' | 'unavailable' | 'closed'

export interface ReplicaState<T> {
  readonly name: string
  readonly status: ReplicaStatus
  /** Resolves with the first snapshot; rejects when the peer does not own this state or refuses to share it. */
  readonly ready: Promise<StateSnapshot<T>>
  /** The latest snapshot, or `undefined` before the first one arrived. */
  get(): StateSnapshot<T> | undefined
  onChange(listener: (snapshot: StateSnapshot<T>, change: StateChange) => void): () => void
  /**
   * Proposes a value. With `baseRevision` the owner refuses it (`STATE_CONFLICT`) unless that is
   * still the current revision. Requires `writable` on the definition.
   */
  set(value: T, options?: { baseRevision?: number }): Promise<StateSnapshot<T>>
  /** Read-modify-write that retries on `STATE_CONFLICT` with the owner's newer value. */
  update(change: (current: T) => T, options?: { retries?: number }): Promise<StateSnapshot<T>>
  dispose(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nameOf(params: unknown): string {
  const name = isRecord(params) ? params.name : undefined
  if (typeof name !== 'string' || name.length === 0 || name.length > 128) {
    throw new BridgeError('INVALID_PARAMS', 'name must be the name of a shared state')
  }
  return name
}

function revisionOf(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new BridgeError('INVALID_PARAMS', `${field} must be a non-negative integer`)
  }
  return value
}

function assertCloneable(value: unknown, name: string): void {
  try {
    structuredClone(value)
  } catch (error) {
    throw new BridgeError('NOT_CLONEABLE', `The value of shared state "${name}" cannot be sent: it holds something that cannot be cloned`, { cause: error })
  }
}

// ---- owner -------------------------------------------------------------------------------------

class OwnedStateImpl<T> implements OwnedState<T> {
  readonly name: string
  readonly #definition: SharedStateDefinition<T>
  readonly #node: NodeCore
  readonly #options: OwnedStateOptions<T>
  readonly #subscribers = new Set<LinkController>()
  readonly #listeners = new Set<(snapshot: StateSnapshot<T>, change: StateChange) => void>()
  readonly #release: () => void
  #value: T
  #revision = 0

  constructor(definition: SharedStateDefinition<T>, node: NodeCore, options: OwnedStateOptions<T>, release: () => void) {
    this.name = definition.name
    this.#definition = definition
    this.#node = node
    this.#options = options
    this.#release = release
    const initial = options.initial ?? definition.initial
    this.#value = this.#check(initial)
    assertCloneable(this.#value, this.name)
  }

  get subscribers(): number {
    return this.#subscribers.size
  }

  get(): StateSnapshot<T> {
    return { value: this.#value, revision: this.#revision }
  }

  set(value: T): number {
    return this.#commit(this.#check(value), { source: 'local' })
  }

  update(change: (current: T) => T): number {
    return this.set(change(this.#value))
  }

  onChange(listener: (snapshot: StateSnapshot<T>, change: StateChange) => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  dispose(): void {
    this.#subscribers.clear()
    this.#listeners.clear()
    this.#release()
  }

  // ---- called by the node's wire handlers ------------------------------------------------------

  subscribe(link: LinkController): StateSnapshot<T> {
    this.#assertAccess('read', link)
    this.#subscribers.add(link)
    return this.get()
  }

  unsubscribe(link: LinkController): void {
    this.#subscribers.delete(link)
  }

  detached(link: LinkController): void {
    this.#subscribers.delete(link)
  }

  propose(link: LinkController, value: unknown, baseRevision: number | undefined): StateSnapshot<T> {
    this.#assertAccess('write', link)
    if (!this.#definition.writable) {
      throw new BridgeError('PERMISSION_DENIED', `Shared state "${this.name}" is read-only for peers`)
    }
    const next = this.#check(value)
    if (baseRevision !== undefined && baseRevision !== this.#revision) {
      throw new BridgeError('STATE_CONFLICT', `Shared state "${this.name}" changed since revision ${baseRevision}`, {
        data: { revision: this.#revision, value: this.#value },
      })
    }
    this.#commit(next, { source: 'remote', link })
    return this.get()
  }

  #assertAccess(operation: 'read' | 'write', link: LinkController): void {
    if (this.#options.authorize !== undefined && !this.#options.authorize(operation, link)) {
      throw new BridgeError('PERMISSION_DENIED', `This link may not ${operation} shared state "${this.name}"`)
    }
  }

  #check(value: unknown): T {
    const schema = this.#definition.schema
    return schema === undefined ? (value as T) : runSchema(schema, value, 'INVALID_PARAMS', `Shared state "${this.name}"`)
  }

  #commit(value: T, change: StateChange): number {
    assertCloneable(value, this.name)
    this.#value = value
    this.#revision += 1
    const snapshot = this.get()
    this.#node.emit({
      type: 'state',
      name: this.name,
      revision: snapshot.revision,
      source: change.source,
      ...(change.link === undefined ? {} : { sessionId: change.link.sessionId }),
    })
    for (const link of [...this.#subscribers]) {
      try {
        link.notify(STATE_CHANGED_METHOD, { name: this.name, revision: snapshot.revision, value })
      } catch (error) {
        this.#subscribers.delete(link)
        this.#options.onError?.(error)
      }
    }
    for (const listener of [...this.#listeners]) {
      try {
        listener(snapshot, change)
      } catch (error) {
        this.#options.onError?.(error)
      }
    }
    return snapshot.revision
  }
}

/** What the wire handlers need of an owned state, whatever its value type. */
interface WireOwnedState {
  subscribe(link: LinkController): StateSnapshot<unknown>
  unsubscribe(link: LinkController): void
  detached(link: LinkController): void
  propose(link: LinkController, value: unknown, baseRevision: number | undefined): StateSnapshot<unknown>
}

export class SharedStateRegistry implements SharedStates {
  readonly #owned = new Map<string, WireOwnedState>()
  readonly #node: NodeCore

  constructor(node: NodeCore) {
    this.#node = node
    node.extend(STATE_SUBSCRIBE_METHOD, (link, params) => this.#find(nameOf(params)).subscribe(link))
    node.extend(STATE_UNSUBSCRIBE_METHOD, (link, params) => {
      this.#owned.get(nameOf(params))?.unsubscribe(link)
      return {}
    })
    node.extend(STATE_SET_METHOD, (link, params) => {
      const state = this.#find(nameOf(params))
      const record = params as Record<string, unknown>
      const baseRevision = record.baseRevision === undefined ? undefined : revisionOf(record.baseRevision, 'baseRevision')
      return state.propose(link, record.value, baseRevision)
    })
    node.onLinkDetached(link => {
      for (const state of this.#owned.values()) state.detached(link)
    })
  }

  own<T>(definition: SharedStateDefinition<T>, options: OwnedStateOptions<T> = {}): OwnedState<T> {
    if (this.#owned.has(definition.name)) throw new TypeError(`Shared state "${definition.name}" is already owned by this node`)
    const owned = new OwnedStateImpl<T>(definition, this.#node, options, () => {
      this.#owned.delete(definition.name)
    })
    this.#owned.set(definition.name, owned)
    return owned
  }

  #find(name: string): WireOwnedState {
    const owned = this.#owned.get(name)
    if (owned === undefined) throw new BridgeError('CAPABILITY_UNAVAILABLE', `"${name}" is not a shared state of this page`)
    return owned
  }
}

// ---- replica -----------------------------------------------------------------------------------

function readSnapshot(value: unknown): { revision: number; value: unknown } {
  if (!isRecord(value) || !Number.isInteger(value.revision) || (value.revision as number) < 0) {
    throw new BridgeError('INVALID_RESULT', 'The peer sent a malformed state snapshot')
  }
  return { revision: value.revision as number, value: value.value }
}

class ReplicaImpl<T> implements ReplicaState<T> {
  readonly name: string
  readonly ready: Promise<StateSnapshot<T>>
  readonly #definition: SharedStateDefinition<T>
  readonly #link: LinkController
  readonly #listeners = new Set<(snapshot: StateSnapshot<T>, change: StateChange) => void>()
  readonly #stops: (() => void)[] = []
  #snapshot: StateSnapshot<T> | undefined
  #status: ReplicaStatus = 'connecting'
  #resolveReady!: (snapshot: StateSnapshot<T>) => void
  #rejectReady!: (error: BridgeError) => void
  #settled = false
  #syncing = false

  constructor(link: LinkController, definition: SharedStateDefinition<T>) {
    this.name = definition.name
    this.#definition = definition
    this.#link = link
    this.ready = new Promise<StateSnapshot<T>>((resolve, reject) => {
      this.#resolveReady = resolve
      this.#rejectReady = reject
    })
    this.ready.catch(() => undefined)
    this.#stops.push(link.listen(STATE_CHANGED_METHOD, params => this.#onChanged(params)))
    this.#stops.push(
      link.onAttach(() => {
        void this.#sync()
      }),
    )
    this.#stops.push(
      link.onDetach(() => {
        if (this.#status === 'ready') this.#status = 'connecting'
      }),
    )
    if (link.connected) void this.#sync()
  }

  get status(): ReplicaStatus {
    return this.#status
  }

  get(): StateSnapshot<T> | undefined {
    return this.#snapshot
  }

  onChange(listener: (snapshot: StateSnapshot<T>, change: StateChange) => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  async set(value: T, options: { baseRevision?: number } = {}): Promise<StateSnapshot<T>> {
    if (!this.#definition.writable) throw new BridgeError('PERMISSION_DENIED', `Shared state "${this.name}" is read-only`)
    if (this.#definition.schema !== undefined) runSchema(this.#definition.schema, value, 'INVALID_PARAMS', `Shared state "${this.name}"`)
    const reply = readSnapshot(
      await this.#link.call(STATE_SET_METHOD, {
        name: this.name,
        value,
        ...(options.baseRevision === undefined ? {} : { baseRevision: options.baseRevision }),
      }),
    )
    const snapshot = { revision: reply.revision, value: this.#validate(reply.value) }
    this.#apply(snapshot, false)
    return this.#snapshot ?? snapshot
  }

  async update(change: (current: T) => T, options: { retries?: number } = {}): Promise<StateSnapshot<T>> {
    let attempts = (options.retries ?? 3) + 1
    let current = this.#snapshot ?? (await this.ready)
    for (;;) {
      try {
        return await this.set(change(current.value), { baseRevision: current.revision })
      } catch (error) {
        if (!isBridgeError(error) || error.code !== 'STATE_CONFLICT' || --attempts <= 0) throw error
        const newer = isRecord(error.data) ? readSnapshot(error.data) : undefined
        current = newer === undefined ? (this.#snapshot ?? current) : { revision: newer.revision, value: this.#validate(newer.value) }
      }
    }
  }

  dispose(): void {
    if (this.#status === 'closed') return
    this.#status = 'closed'
    for (const stop of this.#stops) stop()
    this.#listeners.clear()
    if (this.#link.connected) {
      this.#link.call(STATE_UNSUBSCRIBE_METHOD, { name: this.name }).catch(() => undefined)
    }
    if (!this.#settled) this.#rejectReady(new BridgeError('SESSION_CLOSED', `The replica of "${this.name}" was disposed`))
  }

  #validate(value: unknown): T {
    const schema = this.#definition.schema
    return schema === undefined ? (value as T) : runSchema(schema, value, 'INVALID_RESULT', `Shared state "${this.name}"`)
  }

  #isClosed(): boolean {
    return this.#status === 'closed'
  }

  async #sync(): Promise<void> {
    if (this.#isClosed() || this.#syncing) return
    this.#syncing = true
    try {
      const reply = readSnapshot(await this.#link.call(STATE_SUBSCRIBE_METHOD, { name: this.name }))
      // A fresh subscription is authoritative even when the revision went backwards: the owner reloaded.
      this.#apply({ revision: reply.revision, value: this.#validate(reply.value) }, true)
    } catch (error) {
      if (this.#isClosed()) return
      if (isBridgeError(error) && (error.code === 'CAPABILITY_UNAVAILABLE' || error.code === 'PERMISSION_DENIED' || error.code === 'METHOD_NOT_FOUND')) {
        this.#status = 'unavailable'
        if (!this.#settled) {
          this.#settled = true
          this.#rejectReady(error)
        }
      }
      // Any other failure (the link dropped mid-call) is retried when the link attaches again.
    } finally {
      this.#syncing = false
    }
  }

  #onChanged(params: unknown): void {
    if (!isRecord(params) || params.name !== this.name || this.#isClosed()) return
    let incoming: StateSnapshot<T>
    try {
      const reply = readSnapshot(params)
      incoming = { revision: reply.revision, value: this.#validate(reply.value) }
    } catch {
      return // a malformed push is dropped; the next one or a re-sync repairs it
    }
    this.#apply(incoming, false)
  }

  #apply(incoming: StateSnapshot<T>, adopt: boolean): void {
    const current = this.#snapshot
    if (!adopt && current !== undefined && incoming.revision <= current.revision) return // duplicate or older
    this.#snapshot = incoming
    this.#status = 'ready'
    this.#link.trace({ type: 'state', name: this.name, revision: incoming.revision, source: 'remote', sessionId: this.#link.sessionId })
    if (!this.#settled) {
      this.#settled = true
      this.#resolveReady(incoming)
    }
    for (const listener of [...this.#listeners]) {
      try {
        listener(incoming, { source: 'remote', link: this.#link })
      } catch {
        // A faulty listener must not stop the others.
      }
    }
  }
}

export function createReplica<T>(link: LinkController, definition: SharedStateDefinition<T>): ReplicaState<T> {
  return new ReplicaImpl(link, definition)
}
