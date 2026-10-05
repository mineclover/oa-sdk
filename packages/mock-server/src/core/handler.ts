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
import { serializeResponseBody } from './body-serialization.js'
import { generateStreamChunks } from './stream.js'
import type { MockErrorDetail, MockErrorResponse } from '../errors/types.js'
import type { MockPlugin, MockPluginContext, MockPluginResponse } from './plugin.js'

export type HandlerResult =
  | { type: 'validation-error'; status: 422; body: MockErrorResponse }
  | { type: 'schema-error'; status: 500; body: MockErrorResponse }
  | { type: 'no-response'; status: 500; body: MockErrorResponse }
  | { type: 'success'; picked: PickedResponse; callbacks: CallbackPostAttempt[] }

export type HandlerOptions = {
  plugins?: MockPlugin[]
}

type HandlerEntry = {
  operationId?: string
  method: string
  openApiPath: string
  parameters: OasParameter[]
  requestBody?: OasRequestBody
  responses: Record<string, OasResponse>
  security: OasSecurityRequirement[]
  callbacks?: Record<string, OasCallback>
}

/** A response together with the errors its response schema reported (undefined when it conforms). */
type CheckedResponse = {
  picked: PickedResponse
  errors: MockErrorDetail[] | undefined
}

/**
 * A response picked once (undefined when the spec documents none) and, once
 * its schema check is final (see `isFinalCheck`), that check's errors.
 */
type PickedOnce = {
  picked: PickedResponse | undefined
  checked?: { errors: MockErrorDetail[] | undefined }
}

/**
 * The parts of one operation's mock response that do not depend on the request.
 *
 * `pickResponse` is a pure function of the operation's response objects: the
 * status, media type, header values and body all come from the spec, and
 * generated values come from the stateless built-in generator, so every
 * request to the operation gets the same response. Serializing that response
 * and generating its stream events are pure functions of it as well, and so is
 * validating it against its schema once the schema has compiled. An instance
 * computes each of these on first use and returns the same value afterwards,
 * except a schema check whose schema failed to compile: that check is repeated
 * on every use until the schema compiles (see `isFinalCheck`), so a route
 * reports the compile error to exactly the requests an uncached mock would.
 *
 * Adapters keep one instance per compiled route, so a route's response is
 * generated, validated and serialized once instead of on every request, and
 * the number of instances is the number of routes. Recompiling routes (a spec
 * hot swap, or new MSW handlers) creates new instances.
 *
 * The values are shared by every request to the route and must be treated as
 * read-only. Responses produced by plugins are never stored here.
 */
export class RouteResponses {
  private defaultResponse: PickedOnce | undefined
  private unauthorized: (PickedOnce & { picked: PickedResponse }) | undefined
  private documentedValidation: PickedOnce | undefined
  private readonly serializedBodies = new Map<PickedResponse, string>()
  private readonly streamChunkLists = new Map<PickedResponse, readonly string[]>()

  /**
   * @param precomputedDefault `pickResponse(responses)` when the caller has already computed it.
   */
  constructor(
    private readonly responses: Record<string, OasResponse>,
    precomputedDefault?: PickedResponse | null,
  ) {
    if (precomputedDefault !== undefined) this.defaultResponse = { picked: precomputedDefault ?? undefined }
  }

  /** The operation's own response (`pickResponse`), or undefined when it documents none. */
  defaultPicked(): PickedResponse | undefined {
    this.defaultResponse ??= { picked: pickResponse(this.responses) ?? undefined }
    return this.defaultResponse.picked
  }

  /**
   * The operation's own response with its schema validation, or undefined when
   * it documents none. A response without a media type schema is not validated.
   */
  defaultChecked(): CheckedResponse | undefined {
    const picked = this.defaultPicked()
    if (!picked) return undefined
    return recordedCheck(this.defaultResponse!, picked, picked.schema !== undefined)
  }

  /** The documented 401 response, or the standard Error-shaped 401, with its schema validation. */
  unauthorizedChecked(): CheckedResponse {
    this.unauthorized ??= { picked: pickUnauthorizedResponse(this.responses) }
    return recordedCheck(this.unauthorized, this.unauthorized.picked, true)
  }

  /** The documented 422 response, or undefined when the operation documents none. */
  documentedValidationPicked(): PickedResponse | undefined {
    this.documentedValidation ??= { picked: pickDocumentedResponse(this.responses, 422) }
    return this.documentedValidation.picked
  }

  /** The documented 422 response as documented (without request details), with its schema validation. */
  documentedValidationChecked(): CheckedResponse | undefined {
    const picked = this.documentedValidationPicked()
    if (!picked) return undefined
    return recordedCheck(this.documentedValidation!, picked, true)
  }

  /**
   * The wire body of `picked`. Only responses this instance produced are
   * serialized once and reused; any other response is serialized on each call.
   */
  serializedBody(picked: PickedResponse): string {
    if (!this.owns(picked)) return serializeResponseBody(picked.contentType, picked.body, picked.schema)
    let body = this.serializedBodies.get(picked)
    if (body === undefined) {
      body = serializeResponseBody(picked.contentType, picked.body, picked.schema)
      this.serializedBodies.set(picked, body)
    }
    return body
  }

  /**
   * The stream chunks of a streaming `picked`. Only responses this instance
   * produced are generated once and reused; any other response is generated
   * on each call.
   */
  async *streamChunks(picked: PickedResponse): AsyncGenerator<string> {
    if (!this.owns(picked)) {
      yield* generateStreamChunks(picked)
      return
    }
    let chunks = this.streamChunkLists.get(picked)
    if (chunks === undefined) {
      const generated: string[] = []
      for await (const chunk of generateStreamChunks(picked)) generated.push(chunk)
      chunks = generated
      this.streamChunkLists.set(picked, chunks)
    }
    yield* chunks
  }

  private owns(picked: PickedResponse): boolean {
    return picked === this.defaultResponse?.picked
      || picked === this.unauthorized?.picked
      || picked === this.documentedValidation?.picked
  }
}

/**
 * 요청 검증 + 응답 선택 공통 로직
 *
 * Every call computes the operation's response anew, so the returned response
 * belongs to the caller.
 */
export function handleRequest(
  parts: RequestParts,
  entry: HandlerEntry,
  securitySchemes: Record<string, OasSecurityScheme>,
  options?: HandlerOptions,
): HandlerResult {
  return handleRouteRequest(parts, entry, securitySchemes, options?.plugins ?? [], new RouteResponses(entry.responses))
}

/**
 * `handleRequest` for adapters that keep a `RouteResponses` per route: the
 * request-independent parts of the response come from `route`, so a returned
 * response may be shared with other requests to the route and must not be
 * modified.
 */
export function handleRouteRequest(
  parts: RequestParts,
  entry: HandlerEntry,
  securitySchemes: Record<string, OasSecurityScheme>,
  plugins: readonly MockPlugin[],
  route: RouteResponses,
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
            _meta: operationMeta(entry),
          },
        },
      }
    }

    if (result.errors.some(error => error.path === '/security' && error.code === 'MISSING_REQUIRED_FIELD')) {
      // A selected response is intentionally reused here so both adapters preserve
      // the operation's documented content type, headers, and Error body.
      return rejectedRequestResult(route.unauthorizedChecked(), entry)
    }

    const documentedValidation = documentedValidationResponse(route, result.errors)
    if (documentedValidation) {
      // A documented 422 owns both its wire representation and public error
      // schema. Keep validation diagnostics only when that selected schema accepts
      // their content-free form.
      return rejectedRequestResult(documentedValidation, entry)
    }

    return {
      type: 'validation-error',
      status: 422,
      body: {
        error: {
          code: 'CONSTRAINT_VIOLATION',
          message: '요청 검증 실패',
          details: result.errors,
          _meta: operationMeta(entry),
        },
      },
    }
  }

  if (plugins.length === 0) return finalizeChecked(route.defaultChecked(), entry, parts)

  const context: MockPluginContext = { parts, entry, securitySchemes }
  const matched = matchPlugins(plugins, context)
  if (matched) return finalizeResult(transformResponse(plugins, toPickedResponse(matched), context), entry, parts)

  // Response hooks may change the response they are given, so they get a
  // freshly picked one. Without hooks the operation's own response is served
  // unchanged, exactly as when no plugin is configured.
  if (!plugins.some(plugin => plugin.onResponse)) return finalizeChecked(route.defaultChecked(), entry, parts)
  const picked = pickResponse(entry.responses) ?? undefined
  return finalizeResult(picked && transformResponse(plugins, picked, context), entry, parts)
}

/** Validate a per-request response, then finish it like a precomputed one. */
function finalizeResult(
  picked: PickedResponse | undefined,
  entry: HandlerEntry,
  parts: RequestParts,
): HandlerResult {
  if (!picked) return finalizeChecked(undefined, entry, parts)
  return finalizeChecked({ picked, errors: picked.schema ? validationErrors(picked) : undefined }, entry, parts)
}

function finalizeChecked(
  checked: CheckedResponse | undefined,
  entry: HandlerEntry,
  parts: RequestParts,
): HandlerResult {
  if (!checked) {
    return {
      type: 'no-response',
      status: 500,
      body: { error: { code: 'NOT_FOUND', message: '응답 스키마가 정의되지 않았습니다', details: [] } },
    }
  }

  if (checked.errors) return responseSchemaError(checked.errors, entry)
  return { type: 'success', picked: checked.picked, callbacks: simulateCallbackPosts(entry, parts, checked.picked) }
}

/** A documented response to a rejected request: served as is (it triggers no callbacks) unless its schema rejects it. */
function rejectedRequestResult(checked: CheckedResponse, entry: HandlerEntry): HandlerResult {
  if (checked.errors) return responseSchemaError(checked.errors, entry)
  return { type: 'success', picked: checked.picked, callbacks: [] }
}

function responseSchemaError(errors: MockErrorDetail[], entry: HandlerEntry): HandlerResult {
  const compileError = errors.some(error => error.code === 'SCHEMA_COMPILE_ERROR')
  return {
    type: 'schema-error',
    status: 500,
    body: {
      error: {
        code: compileError ? 'SCHEMA_COMPILE_ERROR' : 'CONSTRAINT_VIOLATION',
        message: compileError ? '응답 검증 스키마 컴파일 실패' : '생성된 응답이 응답 스키마를 만족하지 않습니다',
        details: errors,
        _meta: operationMeta(entry),
      },
    },
  }
}

function operationMeta(entry: HandlerEntry): { operationId?: string; method: string; path: string } {
  return {
    ...(entry.operationId !== undefined && { operationId: entry.operationId }),
    method: entry.method,
    path: entry.openApiPath,
  }
}

function validationErrors(picked: PickedResponse): MockErrorDetail[] | undefined {
  const validation = validatePickedResponse(picked)
  return validation.valid ? undefined : validation.errors
}

/**
 * `picked`, the response `response` holds, with its schema check: the check
 * `response` recorded, or else a new one, which is recorded when it is final.
 * With `validate` false the response is not validated and has no errors.
 */
function recordedCheck(response: PickedOnce, picked: PickedResponse, validate: boolean): CheckedResponse {
  if (response.checked) return { picked, errors: response.checked.errors }
  const errors = validate ? validationErrors(picked) : undefined
  if (isFinalCheck(errors)) response.checked = { errors }
  return { picked, errors }
}

/**
 * Whether a response schema check gives the same result on every later
 * request. A check whose schema compiled does: the compiled validator is kept
 * per schema object and depends only on the response it checks. A check whose
 * schema failed to compile may not: the shared validator keeps a schema that
 * fails its meta-schema check, so compiling the same schema object again skips
 * that check and can succeed. Such a check is repeated on the next request,
 * exactly as an uncached mock repeats it.
 */
function isFinalCheck(errors: readonly MockErrorDetail[] | undefined): boolean {
  return errors === undefined || !errors.some(error => error.code === 'SCHEMA_COMPILE_ERROR')
}

function toPickedResponse(result: MockPluginResponse | PickedResponse): PickedResponse {
  const schema = (result as PickedResponse).schema
  return {
    status: result.status,
    contentType: result.contentType ?? 'application/json',
    body: result.body,
    headers: (result as PickedResponse).headers ?? {},
    links: (result as PickedResponse).links ?? {},
    ...(schema !== undefined ? { schema } : {}),
  }
}

/** The first plugin `onMatch` response, asking plugins in order. */
function matchPlugins(
  plugins: readonly MockPlugin[],
  context: MockPluginContext,
): MockPluginResponse | PickedResponse | undefined {
  for (const plugin of plugins) {
    if (!plugin.onMatch) continue
    const response = plugin.onMatch(context)
    if (response) return response
  }
  return undefined
}

/** Pass a response through every plugin `onResponse` hook in order. */
function transformResponse(
  plugins: readonly MockPlugin[],
  picked: PickedResponse,
  context: MockPluginContext,
): PickedResponse {
  let current = picked
  for (const plugin of plugins) {
    if (plugin.onResponse) current = plugin.onResponse(current, context)
  }
  return current
}

/**
 * The documented 422 response for a request that failed validation: with the
 * request's validation details when its schema accepts them, otherwise as
 * documented. Undefined when the operation documents no 422.
 */
function documentedValidationResponse(
  route: RouteResponses,
  errors: readonly MockErrorDetail[],
): CheckedResponse | undefined {
  const documented = route.documentedValidationPicked()
  if (!documented) return undefined

  const candidate = withContractSafeValidationDetails(documented, errors)
  if (candidate) return { picked: candidate, errors: undefined }
  return route.documentedValidationChecked()
}

/** `picked` with the request's validation details, when its schema accepts them; otherwise undefined. */
function withContractSafeValidationDetails(
  picked: PickedResponse,
  errors: readonly MockErrorDetail[],
): PickedResponse | undefined {
  if (!picked.schema || !isJsonMediaType(picked.contentType) || !isRecord(picked.body)) return undefined

  const candidate: PickedResponse = {
    ...picked,
    body: {
      ...picked.body,
      details: errors.map(toContractValidationDetail),
    },
  }

  return validatePickedResponse(candidate).valid ? candidate : undefined
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
