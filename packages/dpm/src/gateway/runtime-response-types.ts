import type { DpmGatewayRuntimeOperationId } from './runtime-operation-ids.js'

export type DpmGatewayRuntimeStatusCode = 200 | 400
export type DpmGatewayRuntimeCommand =
  | 'inspect-profile'
  | 'analyze-profile'
  | 'review-profile-proposal'
  | 'validate'
  | 'compile'
  | 'dry-run'

export type DpmGatewayRuntimeBody<TResult> = {
  command: DpmGatewayRuntimeCommand
  result: TResult
}

export type DpmGatewayRuntimeResponse<TResult> = {
  operationId: DpmGatewayRuntimeOperationId
  statusCode: DpmGatewayRuntimeStatusCode
  body: DpmGatewayRuntimeBody<TResult>
}
