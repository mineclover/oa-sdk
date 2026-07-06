import {
  ref,
} from './openapi-schema.js'
import type { DpmGatewayOperationId } from './openapi-operation-ids.js'

export function gatewayOperation(input: {
  operationId: DpmGatewayOperationId
  tags: string[]
  summary: string
  requestBody?: unknown
  responseSchema: string
  parameters?: unknown[]
  statusCode?: '200' | '202'
}) {
  return {
    operationId: input.operationId,
    tags: input.tags,
    summary: input.summary,
    ...(input.parameters ? { parameters: input.parameters } : {}),
    ...(input.requestBody ? { requestBody: input.requestBody } : {}),
    responses: {
      [input.statusCode ?? '200']: {
        description: 'JSON response.',
        content: {
          'application/json': {
            schema: ref(input.responseSchema),
          },
        },
      },
    },
  }
}
