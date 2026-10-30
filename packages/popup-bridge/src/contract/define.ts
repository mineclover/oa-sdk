/**
 * Type declaration convention.
 *
 * A contract is a plain value that carries both the static types and the optional runtime schemas
 * of one popup feature. Types flow from `method<Input, Output>()` / `event<Payload>()` (or are
 * inferred from the schemas), so `defineContract` is the single place a feature is declared and
 * both sides derive their typed API from it.
 */
import { assertCoalescePolicy, type CoalescePolicy, type ErasedCoalescePolicy } from '../events/coalesce.js'
import { assertReplayCapacity } from '../events/replay.js'
import { assertVersionRange, parseVersion } from '../protocol/version.js'
import type { Transferred } from '../rpc/transfer.js'
import type { SchemaLike } from './schema.js'

/** `namespace.verb` or deeper, lowerCamelCase segments: `asset.select`, `host.document.getSelection`. */
const NAME = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/
/** Names under this prefix belong to the protocol itself. */
export const RESERVED_PREFIX = 'bridge.'

/** Named-parameter object, or nothing. Positional params are not part of the convention. */
export type ParamsShape = object | void

export type CallOptions = {
  signal?: AbortSignal
  /** Overrides the method's `timeoutMs` and the session default. */
  timeoutMs?: number
  /** Retries with the same key are executed at most once by the responder. */
  idempotencyKey?: string
  /** Objects in the params to transfer instead of clone (`ArrayBuffer`, `MessagePort`, ...). They are detached here afterwards. */
  transfer?: Transferable[]
}

export type MethodOptions<I, O> = {
  /** `major.minor.patch`; part of the capability the popup advertises. Default `1.0.0`. */
  version?: string
  input?: SchemaLike<I>
  output?: SchemaLike<O>
  timeoutMs?: number
  /** Permission label checked by the responder's `authorize` hook. */
  permission?: string
  description?: string
}

export type MethodSpec<I extends ParamsShape = ParamsShape, O = unknown> = {
  readonly kind: 'method'
  readonly version: string
  readonly input?: SchemaLike<I>
  readonly output?: SchemaLike<O>
  readonly timeoutMs?: number
  readonly permission?: string
  readonly description?: string
  /** Phantom member: never set at runtime, only carries `I` and `O` for inference. */
  readonly types?: { input: I; output: O }
}

export type EventOptions<P> = {
  version?: string
  payload?: SchemaLike<P>
  description?: string
  /**
   * Keeps the last `capacity` (1 to 1000) payloads in the popup so a host that missed some can
   * fetch them again, when both sides agreed on `events.replay`. Each emit is copied into the
   * buffer, so size it for the payloads you send. Absent: no history.
   */
  replay?: { capacity: number }
  /**
   * Merges emits that come faster than `windowMs` into one event, when both sides agreed on
   * `events.coalesce`. A merged event carries `meta.coalesced` (how many emits it stands for) and
   * consumes one revision, so merging is never reported as a gap. Absent: every emit is sent.
   * Combine with `replay` to let a host recover merged events too. An event with a coalesce policy
   * cannot be emitted with a `transfer` list.
   */
  coalesce?: CoalescePolicy<P>
}

export type EventSpec<P = unknown> = {
  readonly kind: 'event'
  readonly version: string
  readonly payload?: SchemaLike<P>
  readonly description?: string
  readonly replay?: { readonly capacity: number }
  readonly coalesce?: ErasedCoalescePolicy
  readonly types?: { payload: P }
}

// Every position of the specs is covariant, so these are true supertypes of every concrete spec.
export type AnyMethodSpec = MethodSpec<ParamsShape, unknown>
export type AnyEventSpec = EventSpec<unknown>
export type MethodMap = Record<string, AnyMethodSpec>
export type EventMap = Record<string, AnyEventSpec>

export function method<I extends ParamsShape = void, O = void>(options: MethodOptions<I, O> = {}): MethodSpec<I, O> {
  const version = options.version ?? '1.0.0'
  parseVersion(version)
  return { kind: 'method', version, ...omitUndefined(options, ['input', 'output', 'timeoutMs', 'permission', 'description']) }
}

export function event<P = void>(options: EventOptions<P> = {}): EventSpec<P> {
  const version = options.version ?? '1.0.0'
  parseVersion(version)
  let spec: EventSpec<P> = { kind: 'event', version, ...omitUndefined(options, ['payload', 'description']) }
  if (options.replay !== undefined) {
    assertReplayCapacity(options.replay.capacity, 'event replay.capacity')
    spec = { ...spec, replay: { capacity: options.replay.capacity } }
  }
  if (options.coalesce !== undefined) {
    assertCoalescePolicy(options.coalesce)
    const { windowMs, strategy, leading } = options.coalesce
    spec = { ...spec, coalesce: { windowMs, strategy, ...(leading === true ? { leading } : {}) } }
  }
  return spec
}

function omitUndefined<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const out: Partial<Pick<T, K>> = {}
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key]
  return out as Pick<T, K>
}

export type ContractInput<TInit, TMethods extends MethodMap, TEvents extends EventMap, THost extends MethodMap> = {
  /** Stable feature id, e.g. `asset-selector`. */
  id: string
  /** Validates the `init` the host sends with `bridge.connect`. */
  init?: SchemaLike<TInit>
  /** Methods the popup implements and the host calls. */
  methods?: TMethods
  /** Events the popup emits and the host subscribes to. */
  events?: TEvents
  /** Methods the host exposes and the popup calls (reverse RPC). */
  host?: THost
}

export type BridgeContract<
  TInit = unknown,
  TMethods extends MethodMap = MethodMap,
  TEvents extends EventMap = EventMap,
  THost extends MethodMap = MethodMap,
> = {
  readonly id: string
  readonly init?: SchemaLike<TInit>
  readonly methods: TMethods
  readonly events: TEvents
  readonly host: THost
}

export type AnyContract = BridgeContract<unknown, MethodMap, EventMap, MethodMap>

/** Checks one method or event name against the naming convention. */
export function assertName(name: string, subject: 'method' | 'event' | 'state'): void {
  if (!NAME.test(name)) {
    throw new TypeError(`Invalid ${subject} name "${name}": expected dotted lowerCamelCase such as "asset.select"`)
  }
  if (name.startsWith(RESERVED_PREFIX)) {
    throw new TypeError(`Invalid ${subject} name "${name}": the "${RESERVED_PREFIX}" prefix is reserved for the protocol`)
  }
}

/**
 * A dotted name is a path in the generated nested API, so no name may be both a function and the
 * prefix of another (`asset` and `asset.select`).
 */
function assertNoPathConflicts(names: readonly string[], subject: string): void {
  const all = new Set(names)
  for (const name of names) {
    const parts = name.split('.')
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join('.')
      if (all.has(prefix)) {
        throw new TypeError(`Conflicting ${subject} names "${prefix}" and "${name}": a name cannot also be a namespace`)
      }
    }
  }
}

export function defineContract<
  TInit = void,
  TMethods extends MethodMap = {},
  TEvents extends EventMap = {},
  THost extends MethodMap = {},
>(
  input: ContractInput<TInit, TMethods, TEvents, THost>,
): BridgeContract<TInit, TMethods, TEvents, THost> {
  if (input.id.trim() === '') throw new TypeError('Contract id must not be empty')
  const methods = (input.methods ?? {}) as TMethods
  const events = (input.events ?? {}) as TEvents
  const host = (input.host ?? {}) as THost
  for (const name of Object.keys(methods)) assertName(name, 'method')
  for (const name of Object.keys(host)) assertName(name, 'method')
  for (const name of Object.keys(events)) assertName(name, 'event')
  assertNoPathConflicts(Object.keys(methods), 'method')
  assertNoPathConflicts(Object.keys(host), 'host method')
  assertNoPathConflicts(Object.keys(events), 'event')
  return Object.freeze({
    id: input.id,
    ...(input.init === undefined ? {} : { init: input.init }),
    methods,
    events,
    host,
  })
}

// ---- type derivation -------------------------------------------------------------------------

export type InitOf<C> = C extends BridgeContract<infer I, MethodMap, EventMap, MethodMap> ? I : unknown
export type InputOf<S> = S extends MethodSpec<infer I, unknown> ? I : never
export type OutputOf<S> = S extends MethodSpec<ParamsShape, infer O> ? O : never
export type PayloadOf<S> = S extends EventSpec<infer P> ? P : never

/** `(params?, options?)` when the input is void or all-optional, else `(params, options?)`. */
export type CallArgs<I> = [I] extends [void]
  ? [params?: undefined, options?: CallOptions]
  : {} extends I
    ? [params?: I, options?: CallOptions]
    : [params: I, options?: CallOptions]

export type MethodCaller<S extends AnyMethodSpec> = (...args: CallArgs<InputOf<S>>) => Promise<OutputOf<S>>

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I : never

type NestPath<Name extends string, Leaf> = Name extends `${infer Head}.${infer Rest}`
  ? { [K in Head]: NestPath<Rest, Leaf> }
  : { [K in Name]: Leaf }

/** Nested client object whose shape follows the dotted method names. */
export type RpcApi<M extends MethodMap> = string extends keyof M
  ? { readonly [segment: string]: unknown }
  : UnionToIntersection<{ [K in keyof M & string]: NestPath<K, MethodCaller<M[K]>> }[keyof M & string]>

export type HandlerContext = {
  method: string
  /** Aborted when the caller cancels or times out. */
  signal: AbortSignal
  sessionId: string | undefined
  /** Free-form metadata the caller attached. */
  meta: Readonly<Record<string, unknown>>
}

export type MethodHandler<S extends AnyMethodSpec> = (
  params: InputOf<S>,
  context: HandlerContext,
) => HandlerResult<OutputOf<S>> | Promise<HandlerResult<OutputOf<S>>>

/** A handler returns its result directly, or through `withTransfer` to move buffers without copying. */
export type HandlerResult<O> = O | Transferred<O>

/** Flat handler map keyed by the full method name; this is the canonical way to implement a contract. */
export type Handlers<M extends MethodMap> = { [K in keyof M & string]: MethodHandler<M[K]> }

export type MethodName<M extends MethodMap> = keyof M & string
export type EventName<E extends EventMap> = keyof E & string

/** Validates the range grammar of required capabilities early. */
export function assertRange(range: string): void {
  assertVersionRange(range)
}
