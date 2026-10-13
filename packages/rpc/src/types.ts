import type { RpcContract, RpcProcedure } from '@oa-sdk/surface-ir'
import type { OasSchema } from '@oa-sdk/parser'

export type { RpcContract, RpcProcedure }

/** Input and output types of one procedure, as emitted by the codegen RPC generator. */
export type RpcProcedureTypes = { input: unknown; output: unknown }

/** Procedure types keyed by dotted procedure name, e.g. `{ 'users.getUserById': { input; output } }`. */
export type RpcProcedureShape<P> = { [K in keyof P]: RpcProcedureTypes }

/** Procedure map used when no generated procedure types are given. */
export type UntypedProcedures = Record<string, { input: any; output: any }>

export type RpcCallOptions = {
  signal?: AbortSignal
  /** Extra transport headers for this call only. */
  headers?: Record<string, string>
}

export type RpcProcedureCaller<T extends RpcProcedureTypes> = {} extends T['input']
  ? (input?: T['input'], options?: RpcCallOptions) => Promise<T['output']>
  : (input: T['input'], options?: RpcCallOptions) => Promise<T['output']>

export type RpcHandlerContext<TContext> = {
  procedure: RpcProcedure
  context: TContext
  /** The HTTP request the call arrived in, when it came over HTTP. */
  request?: Request
  signal?: AbortSignal
}

export type RpcHandler<T extends RpcProcedureTypes, TContext> = (
  input: T['input'],
  context: RpcHandlerContext<TContext>,
) => T['output'] | Promise<T['output']>

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void
  ? I
  : never

type NestPath<Name extends string, Leaf> = Name extends `${infer Head}.${infer Rest}`
  ? { [K in Head]: NestPath<Rest, Leaf> }
  : { [K in Name]: Leaf }

type Nested<P, Leaf extends Record<keyof P & string, unknown>> = UnionToIntersection<
  { [K in keyof P & string]: NestPath<K, Leaf[K]> }[keyof P & string]
>

/** Client object whose nesting follows the dotted procedure names. */
export type RpcClient<P extends RpcProcedureShape<P>> = string extends keyof P
  ? any
  : Nested<P, { [K in keyof P & string]: RpcProcedureCaller<P[K]> }>

/** Handler object whose nesting follows the dotted procedure names. */
export type RpcHandlers<P extends RpcProcedureShape<P>, TContext = undefined> = string extends keyof P
  ? any
  : Nested<P, { [K in keyof P & string]: RpcHandler<P[K], TContext> }>

export type RpcValidationIssue = {
  /** JSON Pointer of the invalid value inside the checked input or output. */
  path: string
  message: string
}

/** Validates one value against the schema the validator was compiled for. */
export type RpcSchemaCheck = (value: unknown) => readonly RpcValidationIssue[]

/**
 * Compiles a contract schema into a check. Schemas may hold `#/components/schemas/*` references,
 * which resolve against `contract.schemas`.
 */
export type RpcValidator = (schema: OasSchema, contract: RpcContract) => RpcSchemaCheck

/** One procedure call handed to a transport. */
export type RpcTransportRequest = {
  procedure: RpcProcedure
  input: Record<string, unknown>
  signal?: AbortSignal
  headers?: Record<string, string>
}

/** Delivers a call and resolves with the procedure output, or rejects with an `RpcError`. */
export type RpcTransport = (request: RpcTransportRequest) => Promise<unknown>

export type RpcHeadersInit = HeadersInit | (() => HeadersInit | Promise<HeadersInit>)
