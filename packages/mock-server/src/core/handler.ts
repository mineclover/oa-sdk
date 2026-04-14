/**
 * 공통 요청 핸들러 로직
 *
 * MSW/Node HTTP 어댑터에서 공유하는 핵심 파이프라인:
 *   validateRequest → 에러 응답 또는 pickResponse → HandlerResult
 *
 * 어댑터는 HandlerResult를 받아 자신의 응답 포맷(HttpResponse, ServerResponse)으로 변환.
 */

import type { OasParameter, OasRequestBody, OasResponse, OasSecurityScheme, OasSecurityRequirement } from '@oa-sdk/parser'
import { validateRequest, type RequestParts } from './request-validator.js'
import { pickResponse, type PickedResponse } from './response-picker.js'
import type { MockErrorResponse } from '../errors/types.js'

export type HandlerResult =
  | { type: 'validation-error'; status: 422; body: MockErrorResponse }
  | { type: 'schema-error'; status: 500; body: MockErrorResponse }
  | { type: 'no-response'; status: 500; body: MockErrorResponse }
  | { type: 'success'; picked: PickedResponse }

/**
 * 요청 검증 + 응답 선택 공통 로직
 */
export function handleRequest(
  parts: RequestParts,
  entry: {
    operationId?: string
    method: string
    openApiPath: string
    parameters: OasParameter[]
    requestBody?: OasRequestBody
    responses: Record<string, OasResponse>
    security: OasSecurityRequirement[]
  },
  securitySchemes: Record<string, OasSecurityScheme>,
): HandlerResult {
  const result = validateRequest(
    parts,
    entry.parameters,
    entry.requestBody,
    { requirements: entry.security, schemes: securitySchemes },
  )

  if (!result.valid) {
    const schemaCompileError = result.errors.find(e => e.code === 'SCHEMA_COMPILE_ERROR')
    if (schemaCompileError) {
      return {
        type: 'schema-error',
        status: 500,
        body: {
          error: {
            code: 'SCHEMA_COMPILE_ERROR',
            message: '요청 검증 스키마 컴파일 실패',
            details: result.errors,
            _meta: {
              ...(entry.operationId !== undefined && { operationId: entry.operationId }),
              method: entry.method,
              path: entry.openApiPath,
            },
          },
        },
      }
    }

    return {
      type: 'validation-error',
      status: 422,
      body: {
        error: {
          code: 'CONSTRAINT_VIOLATION',
          message: '요청 검증 실패',
          details: result.errors,
          _meta: {
            ...(entry.operationId !== undefined && { operationId: entry.operationId }),
            method: entry.method,
            path: entry.openApiPath,
          },
        },
      },
    }
  }

  const picked = pickResponse(entry.responses)
  if (!picked) {
    return {
      type: 'no-response',
      status: 500,
      body: { error: { code: 'NOT_FOUND', message: '응답 스키마가 정의되지 않았습니다', details: [] } },
    }
  }

  return { type: 'success', picked }
}
