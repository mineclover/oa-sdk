import type { OasCallback, OasParameter, OasRequestBody, OasResponse, OasSecurityRequirement, OasSecurityScheme } from '@oa-sdk/parser'
import type { RequestParts } from './request-validator.js'
import type { PickedResponse } from './response-picker.js'

export interface MockPluginContext {
  parts: RequestParts
  entry: {
    operationId?: string
    method: string
    openApiPath: string
    parameters: OasParameter[]
    requestBody?: OasRequestBody
    responses: Record<string, OasResponse>
    security: OasSecurityRequirement[]
    callbacks?: Record<string, OasCallback>
  }
  securitySchemes: Record<string, OasSecurityScheme>
}

export type MockPluginResponse = {
  status: number
  contentType?: string
  body?: unknown
  headers?: Record<string, string | number>
}

export interface MockPlugin {
  name: string
  /**
   * Called when a request arrives and passes validation.
   * Return a MockPluginResponse or PickedResponse to short-circuit default response generation.
   * Return void/undefined to fall through to subsequent plugins or the default spec generator.
   */
  onMatch?: (context: MockPluginContext) => MockPluginResponse | PickedResponse | void
  /**
   * Called after response is picked or generated, allowing response transformation.
   */
  onResponse?: (res: PickedResponse, context: MockPluginContext) => PickedResponse
  /**
   * Reset internal plugin state (e.g. for test isolation).
   */
  reset?: () => void
}
