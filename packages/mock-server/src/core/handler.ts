/**
 * 공통 요청 핸들러 로직
 *
 * MSW/Node HTTP 어댑터에서 공유하는 핵심 파이프라인:
 *   validateRequest → 에러 응답 또는 pickResponse → HandlerResult
 *
 * 어댑터는 HandlerResult를 받아 자신의 응답 포맷(HttpResponse, ServerResponse)으로 변환.
 */

import type { OasCallback, OasParameter, OasRequestBody, OasResponse, OasSecurityScheme, OasSecurityRequirement } from '@oa-sdk/parser'
import { validateRequest, type RequestParts } from './request-validator.js'
import { pickResponse, validatePickedResponse, type PickedResponse } from './response-picker.js'
import { simulateCallbackPosts, type CallbackPostAttempt } from './callbacks.js'
import type { MockErrorDetail, MockErrorResponse } from '../errors/types.js'

export type HandlerResult =
  | { type: 'validation-error'; status: 422; body: MockErrorResponse }
  | { type: 'schema-error'; status: 500; body: MockErrorResponse }
  | { type: 'no-response'; status: 500; body: MockErrorResponse }
  | { type: 'success'; picked: PickedResponse; callbacks: CallbackPostAttempt[] }

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
    callbacks?: Record<string, OasCallback>
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

    if (result.errors.some(error => error.path === '/security' && error.code === 'MISSING_REQUIRED_FIELD')) {
      const picked = pickUnauthorizedResponse(entry.responses)
      const responseValidation = validatePickedResponse(picked)
      if (!responseValidation.valid) {
        const compileError = responseValidation.errors.some(error => error.code === 'SCHEMA_COMPILE_ERROR')
        return {
          type: 'schema-error',
          status: 500,
          body: {
            error: {
              code: compileError ? 'SCHEMA_COMPILE_ERROR' : 'CONSTRAINT_VIOLATION',
              message: compileError ? '응답 검증 스키마 컴파일 실패' : '생성된 응답이 응답 스키마를 만족하지 않습니다',
              details: responseValidation.errors,
              _meta: {
                ...(entry.operationId !== undefined && { operationId: entry.operationId }),
                method: entry.method,
                path: entry.openApiPath,
              },
            },
          },
        }
      }

      // A selected response is intentionally reused here so both adapters preserve
      // the operation's documented content type, headers, and Error body.
      return { type: 'success', picked, callbacks: [] }
    }

    const documentedValidation = pickDocumentedResponse(entry.responses, 422)
    if (documentedValidation) {
      const picked = withContractSafeValidationDetails(documentedValidation, result.errors)
      const responseValidation = validatePickedResponse(picked)
      if (!responseValidation.valid) {
        const compileError = responseValidation.errors.some(error => error.code === 'SCHEMA_COMPILE_ERROR')
        return {
          type: 'schema-error',
          status: 500,
          body: {
            error: {
              code: compileError ? 'SCHEMA_COMPILE_ERROR' : 'CONSTRAINT_VIOLATION',
              message: compileError ? '응답 검증 스키마 컴파일 실패' : '생성된 응답이 응답 스키마를 만족하지 않습니다',
              details: responseValidation.errors,
              _meta: {
                ...(entry.operationId !== undefined && { operationId: entry.operationId }),
                method: entry.method,
                path: entry.openApiPath,
              },
            },
          },
        }
      }

      // A documented 422 owns both its wire representation and public error
      // schema. Keep validation diagnostics only when that selected schema accepts
      // their content-free form.
      return { type: 'success', picked, callbacks: [] }
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

  const responseValidation = validatePickedResponse(picked)
  if (!responseValidation.valid) {
    const compileError = responseValidation.errors.some(error => error.code === 'SCHEMA_COMPILE_ERROR')
    return {
      type: 'schema-error',
      status: 500,
      body: {
        error: {
          code: compileError ? 'SCHEMA_COMPILE_ERROR' : 'CONSTRAINT_VIOLATION',
          message: compileError ? '응답 검증 스키마 컴파일 실패' : '생성된 응답이 응답 스키마를 만족하지 않습니다',
          details: responseValidation.errors,
          _meta: {
            ...(entry.operationId !== undefined && { operationId: entry.operationId }),
            method: entry.method,
            path: entry.openApiPath,
          },
        },
      },
    }
  }

  return { type: 'success', picked, callbacks: simulateCallbackPosts(entry, parts, picked) }
}

function pickUnauthorizedResponse(responses: Record<string, OasResponse>): PickedResponse {
  const documented = pickDocumentedResponse(responses, 401)
  if (documented) return documented

  // Security requirements are HTTP authentication boundaries even when a
  // third-party source document omitted a 401 response. Prefer the standard
  // OpenAPI Error-shaped response to misclassifying authentication as a 422.
  return {
    status: 401,
    contentType: 'application/json',
    body: { code: 'UNAUTHORIZED', message: '인증이 필요합니다' },
    headers: {},
    links: {},
  }
}

function pickDocumentedResponse(
  responses: Record<string, OasResponse>,
  status: number,
): PickedResponse | undefined {
  const key = String(status)
  const response = responses[key]
  if (!response) return undefined
  return pickResponse({ [key]: response }) ?? undefined
}

function withContractSafeValidationDetails(
  picked: PickedResponse,
  errors: readonly MockErrorDetail[],
): PickedResponse {
  if (!picked.schema || !isJsonMediaType(picked.contentType) || !isRecord(picked.body)) return picked

  const candidate: PickedResponse = {
    ...picked,
    body: {
      ...picked.body,
      details: errors.map(toContractValidationDetail),
    },
  }

  return validatePickedResponse(candidate).valid ? candidate : picked
}

function toContractValidationDetail(error: MockErrorDetail): Record<string, unknown> {
  const received = error.received ?? error.value
  return {
    path: error.path,
    message: error.message,
    ...(received !== undefined && { received }),
    ...(error.expected !== undefined && { expected: error.expected }),
  }
}

function isJsonMediaType(contentType: string): boolean {
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
