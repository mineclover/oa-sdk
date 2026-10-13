import { RpcError } from './errors.js'
import { invalidInputError, invokeServer, type RpcServer, type RpcServerCallArgs } from './server.js'
import type {
  RpcCallOptions,
  RpcClient,
  RpcContract,
  RpcProcedureShape,
  RpcSchemaCheck,
  RpcTransport,
  RpcValidator,
  UntypedProcedures,
} from './types.js'

export type RpcClientOptions = {
  /** Validates call input before it reaches the transport; a mismatch rejects with `INVALID_INPUT`. */
  validator?: RpcValidator
}

export type RpcCaller<P extends RpcProcedureShape<P> = UntypedProcedures> = {
  readonly contract: RpcContract
  call<K extends keyof P & string>(
    procedureName: K,
    input?: P[K]['input'],
    options?: RpcCallOptions,
  ): Promise<P[K]['output']>
}

/** Calls procedures by their dotted name through a transport. */
export function createRpcCaller<P extends RpcProcedureShape<P> = UntypedProcedures>(
  contract: RpcContract,
  transport: RpcTransport,
  options: RpcClientOptions = {},
): RpcCaller<P> {
  const checks = new Map<string, RpcSchemaCheck>()
  const checkFor = (name: string): RpcSchemaCheck | undefined => {
    if (!options.validator) return undefined
    let check = checks.get(name)
    if (!check) {
      check = options.validator(contract.procedures[name]!.input, contract)
      checks.set(name, check)
    }
    return check
  }

  return {
    contract,
    async call(procedureName, input, callOptions = {}) {
      if (!Object.hasOwn(contract.procedures, procedureName)) {
        throw new RpcError('PROCEDURE_NOT_FOUND', `Unknown procedure: ${procedureName}`)
      }
      const procedure = contract.procedures[procedureName]!
      const normalizedInput = input === undefined || input === null ? {} : input
      if (typeof normalizedInput !== 'object' || Array.isArray(normalizedInput)) {
        throw new RpcError('INVALID_INPUT', `Input for ${procedureName} must be an object.`)
      }
      const issues = checkFor(procedureName)?.(normalizedInput) ?? []
      if (issues.length > 0) {
        throw invalidInputError(procedureName, issues)
      }
      return await transport({
        procedure,
        input: normalizedInput as Record<string, unknown>,
        ...(callOptions.signal === undefined ? {} : { signal: callOptions.signal }),
        ...(callOptions.headers === undefined ? {} : { headers: callOptions.headers }),
      }) as P[typeof procedureName]['output']
    },
  }
}

/**
 * Creates a client whose methods follow the dotted procedure names:
 * `users.getUserById` is `client.users.getUserById(input)`.
 */
export function createRpcClient<P extends RpcProcedureShape<P> = UntypedProcedures>(
  contract: RpcContract,
  transport: RpcTransport,
  options: RpcClientOptions = {},
): RpcClient<P> {
  const caller = createRpcCaller<UntypedProcedures>(contract, transport, options)
  const root: Record<string, unknown> = {}

  for (const procedure of Object.values(contract.procedures)) {
    let node = root
    for (const segment of procedure.path.slice(0, -1)) {
      const next = Object.hasOwn(node, segment) ? node[segment] : undefined
      if (typeof next === 'function') {
        throw new Error(`Procedure ${procedure.name} is nested under the procedure ${segment}.`)
      }
      node = (next as Record<string, unknown> | undefined) ?? (node[segment] = {}) as Record<string, unknown>
    }
    const leaf = procedure.path[procedure.path.length - 1]!
    if (Object.hasOwn(node, leaf)) {
      throw new Error(`Procedure ${procedure.name} collides with a procedure group of the same name.`)
    }
    node[leaf] = (input?: unknown, callOptions?: RpcCallOptions) => caller.call(procedure.name, input, callOptions)
  }
  return root as RpcClient<P>
}

/**
 * Calls a server in the same process; useful for tests and for colocated callers. Input and output
 * are structured-cloned so neither side shares objects with the other, as over a real wire.
 */
export function createLocalTransport<TContext = undefined>(
  server: RpcServer<TContext>,
  ...args: RpcServerCallArgs<TContext>
): RpcTransport {
  const options = args[0]
  return async ({ procedure, input, signal }) => {
    const output = await invokeServer(server, procedure.name, structuredClone(input), {
      ...options,
      ...(signal === undefined ? {} : { signal }),
    })
    return structuredClone(output)
  }
}
