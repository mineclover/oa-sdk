/**
 * Handler registry: binds implementations to the methods of a contract and turns them into the
 * `resolve` function the RPC endpoint dispatches with. Feature code never touches `postMessage`
 * or `MessagePort`; it only registers handlers.
 */
import type { Capability } from '../protocol/messages.js'
import type { RpcRegistration } from '../rpc/endpoint.js'
import type { AnyMethodSpec, Handlers, HandlerContext, MethodHandler, MethodMap, MethodName } from './define.js'
import { assertName } from './define.js'
import type { SchemaLike } from './schema.js'

/** A registration without a contract entry (the doc's `runtime.register({ name, version, ... })`). */
export type FeatureRegistration<I = unknown, O = unknown> = {
  name: string
  version: string
  input?: SchemaLike<I>
  output?: SchemaLike<O>
  permission?: string
  handler: (params: I, context: HandlerContext) => O | Promise<O>
}

export class HandlerRegistry<M extends MethodMap = MethodMap> {
  readonly #entries = new Map<string, { version: string; registration: RpcRegistration }>()
  readonly #contractMethods: M | undefined
  readonly #sessionId: () => string | undefined

  /**
   * @param methods contract methods this registry implements; omit for a free-form registry that
   *   only accepts `registerFeature`.
   * @param sessionId supplies the id surfaced to handlers.
   */
  constructor(methods?: M, sessionId: () => string | undefined = () => undefined) {
    this.#contractMethods = methods
    this.#sessionId = sessionId
  }

  /** Registers the handler of a contract method; the version and schemas come from the contract. */
  register<K extends MethodName<M>>(name: K, handler: MethodHandler<M[K]>): this {
    const spec = this.#contractMethods?.[name] as AnyMethodSpec | undefined
    if (spec === undefined) {
      throw new TypeError(`"${name}" is not a method of this contract; use registerFeature() for free-form methods`)
    }
    return this.#add(name, spec.version, {
      handler: (params, context) => handler(params, this.#context(context)),
      ...(spec.input === undefined ? {} : { input: spec.input }),
      ...(spec.output === undefined ? {} : { output: spec.output }),
      ...(spec.permission === undefined ? {} : { permission: spec.permission }),
    })
  }

  /** Registers every handler of a flat map at once. */
  implement(handlers: Partial<Handlers<M>>): this {
    for (const [name, handler] of Object.entries(handlers)) {
      this.register(name as MethodName<M>, handler as MethodHandler<M[MethodName<M>]>)
    }
    return this
  }

  registerFeature<I, O>(feature: FeatureRegistration<I, O>): this {
    if (this.#contractMethods !== undefined) {
      throw new TypeError('registerFeature() is only available on registries without a contract')
    }
    assertName(feature.name, 'method')
    return this.#add(feature.name, feature.version, {
      handler: (params, context) => feature.handler(params as I, this.#context(context)),
      ...(feature.input === undefined ? {} : { input: feature.input }),
      ...(feature.output === undefined ? {} : { output: feature.output }),
      ...(feature.permission === undefined ? {} : { permission: feature.permission }),
    })
  }

  #add(name: string, version: string, registration: RpcRegistration): this {
    if (this.#entries.has(name)) throw new TypeError(`"${name}" is already registered`)
    this.#entries.set(name, { version, registration })
    return this
  }

  #context(context: HandlerContext): HandlerContext {
    return { ...context, sessionId: this.#sessionId() }
  }

  has(name: string): boolean {
    return this.#entries.has(name)
  }

  resolve = (name: string): RpcRegistration | undefined => this.#entries.get(name)?.registration

  /** Contract methods that still have no handler. */
  missing(): string[] {
    return Object.keys(this.#contractMethods ?? {}).filter(name => !this.#entries.has(name))
  }

  /** What the popup honestly offers right now: only registered methods are advertised. */
  capabilities(): Capability[] {
    return [...this.#entries].map(([name, entry]) => ({ name, version: entry.version }))
  }
}
