/**
 * RPC generation utilities: derive a validated, typed caller and a nested client object from a
 * map of method specs. The `invoke` function is the only transport-facing seam, so the same code
 * serves the host calling the popup and the popup calling the host.
 */
import { describeCoalesce, type ErasedCoalescePolicy } from '../events/coalesce.js'
import { BridgeError } from '../protocol/errors.js'
import type { AnyMethodSpec, CallOptions, MethodMap, MethodName, RpcApi } from './define.js'
import { runSchema } from './schema.js'

/** Sends one call over the wire and resolves with the raw (untrusted) result. */
export type RpcInvoke = (method: string, params: unknown, options: CallOptions) => Promise<unknown>

export type MethodCallerOptions = {
  /** Validate params and result against the contract schemas. Default `true`. */
  validate?: boolean
  defaultTimeoutMs?: number
}

/**
 * Returns `call(name, params, options)` that validates params before sending and, since the peer
 * is a separate and less trusted origin, the result before returning it to the application.
 */
export function createMethodCaller<M extends MethodMap>(
  methods: M | undefined,
  invoke: RpcInvoke,
  options: MethodCallerOptions = {},
): (name: string, params?: unknown, callOptions?: CallOptions) => Promise<unknown> {
  const validate = options.validate !== false
  return async (name, params, callOptions = {}) => {
    const spec = methods?.[name as MethodName<M>] as AnyMethodSpec | undefined
    if (methods !== undefined && spec === undefined) {
      throw new BridgeError('METHOD_NOT_FOUND', `"${name}" is not a method of this contract`)
    }
    let input = params
    if (validate && spec?.input !== undefined) input = runSchema(spec.input, params, 'INVALID_PARAMS', `Params of ${name}`)
    const timeoutMs = callOptions.timeoutMs ?? spec?.timeoutMs ?? options.defaultTimeoutMs
    const result = await invoke(name, input, { ...callOptions, ...(timeoutMs === undefined ? {} : { timeoutMs }) })
    return validate && spec?.output !== undefined ? runSchema(spec.output, result, 'INVALID_RESULT', `Result of ${name}`) : result
  }
}

/**
 * Builds the nested client object: `asset.select` becomes `api.asset.select(params, options)`.
 * Plain objects of functions are used instead of a `Proxy`, so `await api` and `JSON.stringify`
 * behave and unknown names fail at the type level.
 */
export function createRpcApi<M extends MethodMap>(
  methods: M,
  call: (name: string, params?: unknown, options?: CallOptions) => Promise<unknown>,
): RpcApi<M> {
  const root: Record<string, unknown> = {}
  for (const name of Object.keys(methods)) {
    const parts = name.split('.')
    let node = root
    for (const part of parts.slice(0, -1)) {
      node = (node[part] ??= {}) as Record<string, unknown>
    }
    node[parts[parts.length - 1]!] = (params?: unknown, callOptions?: CallOptions) => call(name, params, callOptions)
  }
  return root as RpcApi<M>
}

/** Serializable description of a contract (no schemas or functions), e.g. to publish as a manifest. */
export type ContractManifest = {
  id: string
  methods: { name: string; version: string; permission?: string; timeoutMs?: number; description?: string }[]
  events: {
    name: string
    version: string
    description?: string
    replay?: { capacity: number }
    coalesce?: { windowMs: number; strategy: 'latest' | 'reduce'; leading?: boolean }
  }[]
  host: { name: string; version: string; permission?: string; timeoutMs?: number; description?: string }[]
}

export function describeContract(contract: {
  id: string
  methods: MethodMap
  events: Record<
    string,
    {
      version: string
      description?: string | undefined
      replay?: { readonly capacity: number } | undefined
      coalesce?: ErasedCoalescePolicy | undefined
    }
  >
  host: MethodMap
}): ContractManifest {
  const methodRows = (map: MethodMap) =>
    Object.entries(map).map(([name, spec]) => ({
      name,
      version: spec.version,
      ...(spec.permission === undefined ? {} : { permission: spec.permission }),
      ...(spec.timeoutMs === undefined ? {} : { timeoutMs: spec.timeoutMs }),
      ...(spec.description === undefined ? {} : { description: spec.description }),
    }))
  return {
    id: contract.id,
    methods: methodRows(contract.methods),
    events: Object.entries(contract.events).map(([name, spec]) => ({
      name,
      version: spec.version,
      ...(spec.description === undefined ? {} : { description: spec.description }),
      ...(spec.replay === undefined ? {} : { replay: { capacity: spec.replay.capacity } }),
      ...(spec.coalesce === undefined ? {} : { coalesce: describeCoalesce(spec.coalesce) }),
    })),
    host: methodRows(contract.host),
  }
}
