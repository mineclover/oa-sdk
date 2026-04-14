/**
 * Node HTTP mock server for typia LLM function validation.
 *
 * Routes:
 *   GET  /functions              — 사용 가능한 함수 목록 + 스키마
 *   POST /validate/:functionName — raw JSON string 전체 파이프라인 (parse → coerce → validate)
 *   POST /call/:functionName     — pre-parsed JSON 검증 (coerce → validate)
 */

import { createHttpServer, writeJson, readRaw, readJsonBody } from '@oa-sdk/core'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  ILlmApplication,
  TypiaMockServer,
  TypiaMockServerOptions,
  TypiaErrorCode,
  TypiaErrorResponse,
  TypiaSuccessResponse,
  ValidationStage,
} from '../types.js'
import { validateRawArgs, validateParsedArgs } from '../core/validator.js'
import { listFunctions, getFunction } from '../core/function-registry.js'

export function createTypiaMockServer(
  app: ILlmApplication,
  options: TypiaMockServerOptions = {},
): TypiaMockServer {
  const { port = 4020, host = '127.0.0.1' } = options

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = (req.method ?? 'GET').toUpperCase()
    const urlPath = (req.url ?? '/').split('?')[0] ?? '/'

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      res.end()
      return
    }

    // GET /functions
    if (method === 'GET' && urlPath === '/functions') {
      writeJson(res, 200, { functions: listFunctions(app) })
      return
    }

    // POST /validate/:functionName — raw JSON string → parse → coerce → validate
    const validateMatch = urlPath.match(/^\/validate\/(.+)$/)
    if (method === 'POST' && validateMatch) {
      const functionName = decodeURIComponent(validateMatch[1]!)

      if (!getFunction(app, functionName)) {
        writeJson(res, 404, errorResponse('FUNCTION_NOT_FOUND', `Function "${functionName}" not found`, [], { functionName }))
        return
      }

      const rawBody = await readRaw(req)
      if (!rawBody) {
        writeJson(res, 400, errorResponse('INVALID_REQUEST', 'Request body is required (raw JSON string)', []))
        return
      }

      const result = validateRawArgs(app, functionName, rawBody)
      if (result.success) {
        writeJson(res, 200, successResponse(functionName, result.data, result.mock))
      } else {
        writeJson(res, 422, errorResponse(stageToCode(result.stage), `Validation failed at "${result.stage}" stage`, result.errors, { functionName, stage: result.stage }))
      }
      return
    }

    // POST /call/:functionName — pre-parsed JSON → coerce → validate
    const callMatch = urlPath.match(/^\/call\/(.+)$/)
    if (method === 'POST' && callMatch) {
      const functionName = decodeURIComponent(callMatch[1]!)

      if (!getFunction(app, functionName)) {
        writeJson(res, 404, errorResponse('FUNCTION_NOT_FOUND', `Function "${functionName}" not found`, [], { functionName }))
        return
      }

      const body = await readJsonBody(req)
      if (body === undefined) {
        writeJson(res, 400, errorResponse('INVALID_REQUEST', 'Request body must be valid JSON', []))
        return
      }

      const result = validateParsedArgs(app, functionName, body)
      if (result.success) {
        writeJson(res, 200, successResponse(functionName, result.data, result.mock))
      } else {
        writeJson(res, 422, errorResponse(stageToCode(result.stage), `Validation failed at "${result.stage}" stage`, result.errors, { functionName, stage: result.stage }))
      }
      return
    }

    // Fallback: 404
    writeJson(res, 404, errorResponse('FUNCTION_NOT_FOUND', `${method} ${urlPath} not found`, []))
  }

  const server = createHttpServer(handler, { port, host })
  return server
}

// ─── helpers ────────────────────────────────────────────────────────────────

function stageToCode(stage: ValidationStage): TypiaErrorCode {
  switch (stage) {
    case 'parse':
      return 'PARSE_ERROR'
    case 'coerce':
      return 'COERCE_ERROR'
    case 'validate':
      return 'VALIDATION_ERROR'
  }
}

function errorResponse(
  code: TypiaErrorCode,
  message: string,
  details: TypiaErrorResponse['error']['details'],
  meta?: { functionName: string; stage?: ValidationStage },
): TypiaErrorResponse {
  return {
    error: {
      code,
      message,
      details,
      ...(meta ? { _meta: meta } : {}),
    },
  }
}

function successResponse(functionName: string, data: unknown, mock: unknown): TypiaSuccessResponse {
  return { success: true, functionName, data, mock }
}
