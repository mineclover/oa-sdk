import type { OasSchema } from '@oa-sdk/parser'
import { RpcError, toRpcError } from './errors.js'
import type {
  RpcContract,
  RpcHandler,
  RpcHandlers,
  RpcProcedure,
  RpcProcedureShape,
  RpcSchemaCheck,
  RpcValidationIssue,
  RpcValidator,
  UntypedProcedures,
} from './types.js'

export type RpcServerOptions = {
  /** Validates call input (and output with `validateOutput`) against the contract schemas. */
  validator?: RpcValidator
  /** Also validate handler results; a mismatch fails the call with `INVALID_OUTPUT`. Default: false. */
  validateOutput?: boolean
  /** Allow procedures without handlers; calling one fails with `NOT_IMPLEMENTED`. Default: false. */
  allowPartial?: boolean
  /** Observes errors that are not `RpcError`s (reported to callers as `INTERNAL`) and output mismatches. */
  onError?: (error: unknown, procedure: RpcProcedure) => void
}

export type RpcServerCallOptions<TContext> = {
  request?: Request
  signal?: AbortSignal
} & (undefined extends TContext ? { context?: TContext } : { context: TContext })

/** The call options are optional when the server context type accepts `undefined`. */
export type RpcServerCallArgs<TContext> = undefined extends TContext
  ? [options?: RpcServerCallOptions<TContext>]
  : [options: RpcServerCallOptions<TContext>]

export type RpcServer<TContext = undefined> = {
  readonly contract: RpcContract
  /** Validates the input, runs the handler, and resolves with its result or rejects with an `RpcError`. */
  call(procedureName: string, input: unknown, ...args: RpcServerCallArgs<TContext>): Promise<unknown>
}

type CompiledProcedure = {
  procedure: RpcProcedure
  handler: RpcHandler<{ input: any; output: any }, any> | undefined
  checkInput: RpcSchemaCheck | undefined
  checkOutput: RpcSchemaCheck | undefined
}

/**
 * Binds handlers to the procedures of a contract. Handlers are nested like the dotted procedure
 * names: `users.getUserById` is `handlers.users.getUserById(input, ctx)`.
 */
export function createRpcServer<P extends RpcProcedureShape<P> = UntypedProcedures, TContext = undefined>(
  contract: RpcContract,
  handlers: RpcHandlers<P, TContext>,
  options: RpcServerOptions = {},
): RpcServer<TContext> {
  const compiled = new Map<string, CompiledProcedure>()
  const missing: string[] = []

  for (const procedure of Object.values(contract.procedures)) {
    const handler = lookupHandler(handlers, procedure.path)
    if (handler === undefined) missing.push(procedure.name)
    compiled.set(procedure.name, {
      procedure,
      handler,
      checkInput: compileCheck(options.validator, procedure.input, contract),
      checkOutput: options.validateOutput === true && procedure.output !== null
        ? compileCheck(options.validator, procedure.output, contract)
        : undefined,
    })
  }

  if (missing.length > 0 && options.allowPartial !== true) {
    throw new Error(`Missing RPC handlers: ${missing.join(', ')}. Pass allowPartial: true to serve the contract partially.`)
  }

  return {
    contract,
    async call(procedureName, input, ...args) {
      const callOptions: { context?: TContext; request?: Request; signal?: AbortSignal } = args[0] ?? {}
      const entry = Object.hasOwn(contract.procedures, procedureName) ? compiled.get(procedureName) : undefined
      if (!entry) {
        throw new RpcError('PROCEDURE_NOT_FOUND', `Unknown procedure: ${procedureName}`)
      }
      const { procedure, handler } = entry
      if (!handler) {
        throw new RpcError('NOT_IMPLEMENTED', `Procedure ${procedure.name} has no handler.`)
      }

      const normalizedInput = input === undefined || input === null ? {} : input
      if (typeof normalizedInput !== 'object' || Array.isArray(normalizedInput)) {
        throw invalidInputError(procedure.name, [{ path: '/', message: 'input must be an object' }])
      }
      const inputIssues = entry.checkInput?.(normalizedInput) ?? []
      if (inputIssues.length > 0) {
        throw invalidInputError(procedure.name, inputIssues)
      }

      let output: unknown
      try {
        output = await handler(normalizedInput, {
          procedure,
          context: callOptions.context as TContext,
          ...(callOptions.request === undefined ? {} : { request: callOptions.request }),
          ...(callOptions.signal === undefined ? {} : { signal: callOptions.signal }),
        })
      } catch (error) {
        if (!(error instanceof RpcError)) options.onError?.(error, procedure)
        throw toRpcError(error)
      }

      const outputIssues = entry.checkOutput?.(output) ?? []
      if (outputIssues.length > 0) {
        const error = new RpcError('INVALID_OUTPUT', `Procedure ${procedure.name} returned an invalid result.`, {
          cause: outputIssues,
        })
        options.onError?.(error, procedure)
        throw error
      }
      return output
    },
  }
}

function lookupHandler(
  handlers: unknown,
  path: readonly string[],
): RpcHandler<{ input: any; output: any }, any> | undefined {
  let current: unknown = handlers
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return typeof current === 'function' ? current as RpcHandler<{ input: any; output: any }, any> : undefined
}

function compileCheck(
  validator: RpcValidator | undefined,
  schema: OasSchema,
  contract: RpcContract,
): RpcSchemaCheck | undefined {
  return validator === undefined ? undefined : validator(schema, contract)
}

/** Calls a server with options whose context may be absent; transports use it for every server. */
export function invokeServer<TContext>(
  server: RpcServer<TContext>,
  procedureName: string,
  input: unknown,
  options: { context?: TContext | undefined; request?: Request; signal?: AbortSignal },
): Promise<unknown> {
  const call = server.call as (name: string, input: unknown, options: object) => Promise<unknown>
  return call(procedureName, input, options)
}

export function invalidInputError(procedureName: string, issues: readonly RpcValidationIssue[]): RpcError {
  const message = `Invalid input for ${procedureName}.`
  return new RpcError('INVALID_INPUT', message, { data: { code: 'INVALID_INPUT', message, issues } })
}
