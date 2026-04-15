import type {
  OasCallback,
  OasMediaType,
  OasPathItem,
  OasRequestBody,
  OasResponse,
  OasSecurityRequirement,
  OasServer,
  OasParameter,
  Referenceable,
} from '@oa-sdk/parser'
import type { RequestParts } from './request-validator.js'
import type { PickedResponse } from './response-picker.js'
import { pickFirstMediaType, resolveMediaTypeBody } from './media-body.js'

export type CallbackSimulationErrorCode =
  | 'CALLBACK_EXPRESSION_UNSUPPORTED'
  | 'CALLBACK_URL_UNRESOLVED'
  | 'CALLBACK_URL_INVALID'

export type CallbackSimulationError = {
  code: CallbackSimulationErrorCode
  message: string
}

export type CallbackPostAttempt = {
  callbackName: string
  expression: string
  method: 'post'
  resolved: boolean
  url: string | null
  contentType: string
  headers: Record<string, string>
  body: unknown
  sourceOperationId?: string
  callbackOperationId?: string
  error?: CallbackSimulationError
}

export type CallbackObserver = (attempt: CallbackPostAttempt) => void | Promise<void>

export type CallbackSourceOperation = {
  operationId?: string
  method: string
  openApiPath: string
  parameters: OasParameter[]
  requestBody?: OasRequestBody
  responses: Record<string, OasResponse>
  security: OasSecurityRequirement[]
  servers?: OasServer[]
  callbacks?: Record<string, OasCallback>
}

type CallbackEvaluationContext = {
  parts: RequestParts
  entry: CallbackSourceOperation
  picked: PickedResponse
}

type EvaluationResult =
  | { ok: true; value: string }
  | { ok: false; error: CallbackSimulationError }

/**
 * Build mock outbound callback POST attempts for an operation result.
 *
 * The simulator intentionally does not perform network I/O. Adapters expose
 * these attempts through hooks so tests can assert local webhook behavior.
 */
export function simulateCallbackPosts(
  entry: CallbackSourceOperation,
  parts: RequestParts,
  picked: PickedResponse,
): CallbackPostAttempt[] {
  const callbacks = entry.callbacks ?? {}
  const attempts: CallbackPostAttempt[] = []

  for (const [callbackName, callback] of Object.entries(callbacks)) {
    for (const [expression, rawPathItem] of Object.entries(callback)) {
      const pathItem = derefPathItem(rawPathItem)
      const postOperation = pathItem?.post
      if (!postOperation) continue

      const evaluated = evaluateCallbackUrl(expression, { parts, entry, picked })
      const { contentType, body } = generateCallbackPayload(postOperation.requestBody)
      const base = {
        callbackName,
        expression,
        method: 'post' as const,
        contentType,
        headers: { 'Content-Type': contentType },
        body,
        ...(entry.operationId !== undefined && { sourceOperationId: entry.operationId }),
        ...(postOperation.operationId !== undefined && { callbackOperationId: postOperation.operationId }),
      }

      if (evaluated.ok) {
        attempts.push({ ...base, resolved: true, url: evaluated.value })
      } else {
        attempts.push({ ...base, resolved: false, url: null, error: evaluated.error })
      }
    }
  }

  return attempts
}

function derefPathItem(raw: Referenceable<OasPathItem>): OasPathItem | undefined {
  if (raw && typeof raw === 'object' && '$ref' in raw) return undefined
  return raw as OasPathItem
}

function generateCallbackPayload(
  rawRequestBody: Referenceable<OasRequestBody> | undefined,
): { contentType: string; body: unknown } {
  if (!rawRequestBody || '$ref' in rawRequestBody) {
    return { contentType: 'application/json', body: null }
  }

  const { contentType, mediaType } = pickFirstMediaType(
    rawRequestBody.content as Record<string, Referenceable<OasMediaType>> | undefined,
  )
  return { contentType, body: resolveMediaTypeBody(mediaType) }
}

function evaluateCallbackUrl(
  expression: string,
  context: CallbackEvaluationContext,
): EvaluationResult {
  const evaluated = evaluateUrlTemplate(expression, context)
  if (!evaluated.ok) return evaluated

  try {
    return { ok: true, value: new URL(evaluated.value).toString() }
  } catch {
    return {
      ok: false,
      error: {
        code: 'CALLBACK_URL_INVALID',
        message: `Callback URL expression "${expression}" resolved to an invalid URL`,
      },
    }
  }
}

function evaluateUrlTemplate(
  expression: string,
  context: CallbackEvaluationContext,
): EvaluationResult {
  if (!expression.includes('{')) {
    if (expression.startsWith('$')) return evaluateRuntimeExpression(expression, context)
    return { ok: true, value: expression }
  }

  let hasMatch = false
  const parts: string[] = []
  let lastIndex = 0
  const pattern = /\{([^{}]+)\}/g
  for (const match of expression.matchAll(pattern)) {
    hasMatch = true
    parts.push(expression.slice(lastIndex, match.index))
    const runtimeExpression = match[1]
    if (!runtimeExpression) {
      return unsupported(expression)
    }

    const evaluated = evaluateRuntimeExpression(runtimeExpression, context)
    if (!evaluated.ok) return evaluated
    parts.push(evaluated.value)
    lastIndex = match.index + match[0].length
  }
  parts.push(expression.slice(lastIndex))

  if (!hasMatch || parts.join('').includes('{') || parts.join('').includes('}')) {
    return unsupported(expression)
  }

  return { ok: true, value: parts.join('') }
}

function evaluateRuntimeExpression(
  expression: string,
  context: CallbackEvaluationContext,
): EvaluationResult {
  if (expression === '$url') {
    return context.parts.url === undefined ? unresolved(expression) : { ok: true, value: context.parts.url }
  }
  if (expression === '$method') return { ok: true, value: context.entry.method.toUpperCase() }
  if (expression === '$statusCode') return { ok: true, value: String(context.picked.status) }

  if (expression.startsWith('$request.')) {
    return evaluateSource(expression, expression.slice('$request.'.length), 'request', context)
  }
  if (expression.startsWith('$response.')) {
    return evaluateSource(expression, expression.slice('$response.'.length), 'response', context)
  }

  return unsupported(expression)
}

function evaluateSource(
  expression: string,
  source: string,
  scope: 'request' | 'response',
  context: CallbackEvaluationContext,
): EvaluationResult {
  if (source.startsWith('path.')) {
    if (scope !== 'request') return unsupported(expression)
    return stringifyRuntimeValue(expression, context.parts.pathParams[source.slice('path.'.length)])
  }

  if (source.startsWith('query.')) {
    if (scope !== 'request') return unsupported(expression)
    const raw = context.parts.queryParams[source.slice('query.'.length)]
    return stringifyRuntimeValue(expression, Array.isArray(raw) ? raw[0] : raw)
  }

  if (source.startsWith('header.')) {
    const name = source.slice('header.'.length)
    const headers = scope === 'request' ? context.parts.headers : context.picked.headers
    return stringifyRuntimeValue(expression, lookupHeader(headers, name))
  }

  if (source === 'body') {
    const body = scope === 'request' ? context.parts.body : context.picked.body
    return stringifyRuntimeValue(expression, body)
  }

  if (source.startsWith('body#')) {
    const body = scope === 'request' ? context.parts.body : context.picked.body
    const pointer = source.slice('body#'.length)
    const pointed = readJsonPointer(body, pointer)
    if (!pointed.ok) return pointed.error === 'unsupported' ? unsupported(expression) : unresolved(expression)
    return stringifyRuntimeValue(expression, pointed.value)
  }

  return unsupported(expression)
}

function stringifyRuntimeValue(expression: string, value: unknown): EvaluationResult {
  if (value === undefined) return unresolved(expression)
  if (typeof value === 'string') return { ok: true, value }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return { ok: true, value: String(value) }
  }
  return unsupported(expression)
}

function lookupHeader(headers: Record<string, string>, name: string): string | undefined {
  const lowerName = name.toLowerCase()
  for (const [headerName, value] of Object.entries(headers)) {
    if (headerName.toLowerCase() === lowerName) return value
  }
  return undefined
}

function readJsonPointer(
  value: unknown,
  pointer: string,
): { ok: true; value: unknown } | { ok: false; error: 'unresolved' | 'unsupported' } {
  if (pointer === '') return { ok: true, value }
  if (!pointer.startsWith('/')) return { ok: false, error: 'unsupported' }

  let current = value
  for (const token of pointer.slice(1).split('/').map(unescapePointerToken)) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return { ok: false, error: 'unresolved' }
      current = current[Number(token)]
      continue
    }
    if (current && typeof current === 'object') {
      const record = current as Record<string, unknown>
      if (!Object.prototype.hasOwnProperty.call(record, token)) return { ok: false, error: 'unresolved' }
      current = record[token]
      continue
    }
    return { ok: false, error: 'unresolved' }
  }

  return { ok: true, value: current }
}

function unescapePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~')
}

function unsupported(expression: string): EvaluationResult {
  return {
    ok: false,
    error: {
      code: 'CALLBACK_EXPRESSION_UNSUPPORTED',
      message: `Callback URL expression "${expression}" is not supported`,
    },
  }
}

function unresolved(expression: string): EvaluationResult {
  return {
    ok: false,
    error: {
      code: 'CALLBACK_URL_UNRESOLVED',
      message: `Callback URL expression "${expression}" could not be resolved`,
    },
  }
}
