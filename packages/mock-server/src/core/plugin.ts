import type { OasCallback, OasParameter, OasRequestBody, OasResponse, OasSecurityRequirement, OasSecurityScheme } from '@oa-sdk/parser'
import type { RequestParts } from './request-validator.js'
import type { PickedResponse } from './response-picker.js'

export interface MockPluginContext {
  parts: RequestParts
  /**
   * The matched operation, as parsed from the spec. Treat it as read-only:
   * the adapters reuse each route's response, so changing its response
   * objects in place is not supported (see the README, "Response reuse per
   * route"). Return a response from `onMatch` instead.
   */
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
   *
   * The response object is picked anew for every request, but its body may
   * hold the spec's own objects (an example-backed body, or the `example`,
   * `default` and `const` values inside a generated one). Return a response
   * with a changed copy of the body instead of changing it in place.
   */
  onResponse?: (res: PickedResponse, context: MockPluginContext) => PickedResponse
  /**
   * Reset internal plugin state (e.g. for test isolation).
   */
  reset?: () => void
}
