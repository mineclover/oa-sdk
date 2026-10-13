/**
 * @oa-sdk/rpc — call and serve the operations of a TypeSpec/OpenAPI contract as RPC procedures.
 *
 * The contract comes from `buildRpcContract()` of `@oa-sdk/surface-ir` (or the RPC generator of
 * `@oa-sdk/codegen`). One set of handlers can answer JSON-RPC 2.0 and the original REST routes;
 * one client can call either.
 */

export type {
  RpcCallOptions,
  RpcClient,
  RpcContract,
  RpcHandler,
  RpcHandlerContext,
  RpcHandlers,
  RpcHeadersInit,
  RpcProcedure,
  RpcProcedureCaller,
  RpcProcedureShape,
  RpcProcedureTypes,
  RpcSchemaCheck,
  RpcTransport,
  RpcTransportRequest,
  RpcValidationIssue,
  RpcValidator,
  UntypedProcedures,
} from './types.js'

export {
  RpcError,
  codeForStatus,
  isRpcError,
  statusForCode,
  toRpcError,
} from './errors.js'
export type { RpcErrorCode, RpcErrorOptions } from './errors.js'

export { createRpcServer } from './server.js'
export type {
  RpcServer,
  RpcServerCallArgs,
  RpcServerCallOptions,
  RpcServerOptions,
} from './server.js'

export { createLocalTransport, createRpcCaller, createRpcClient } from './client.js'
export type { RpcCaller, RpcClientOptions } from './client.js'

export { createHttpTransport, createRestFetchHandler, errorFromHttpResponse } from './http.js'
export type { HttpTransportOptions, RestFetchHandlerOptions, RpcFetchHandler } from './http.js'

export {
  createJsonRpcFetchHandler,
  createJsonRpcTransport,
  fromJsonRpcError,
  handleJsonRpc,
  toJsonRpcError,
} from './json-rpc.js'
export type {
  JsonRpcErrorObject,
  JsonRpcFetchHandlerOptions,
  JsonRpcHandleOptions,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcTransportOptions,
} from './json-rpc.js'
