import type {
  OasEncoding,
  OasMediaType,
  OasParameter,
  OasRequestBody,
  OasSchema,
  OasSecurityScheme,
  OasSecurityRequirement,
  RouteIndex,
} from '@oa-sdk/parser'
import {
  redactValidationDetail,
  redactValidationDetails,
  type MockErrorDetailInput,
} from '../errors/redaction.js'
import type { MockErrorDetail, MockValidationResult } from '../errors/types.js'
import { compileSchema, runSchemaValidation, schemaCompileError } from './request-validation/schema-compiler.js'
import { validateParameterValue } from './request-validation/parameters.js'
import { parseCookies, validateSecurity } from './request-validation/security.js'
import {
  collectUnsupportedXmlFeatures,
  isXmlMediaType,
  parseXmlBody,
  XML_SUPPORTED_SCOPE,
  type XmlUnsupportedFeature,
} from './xml.js'

const multipartPartsSymbol = Symbol.for('@oa-sdk/mock-server.multipart-parts')

export type RequestParts = {
  pathParams: Record<string, string>
  queryParams: Record<string, string | string[]>
  /** Raw serialized URL query string, without the leading `?`. */
  rawQueryString?: string
  headers: Record<string, string>
  body: unknown
  /** Adapter detected a malformed JSON request body. The raw input is never retained here. */
  bodyParseError?: 'invalid-json'
  contentType: string | undefined
  /** Absolute request URL, used by callback runtime expression evaluation. */
  url?: string
}

export type MultipartPartMetadata = {
  name: string
  value: unknown
  contentType?: string
  filename?: string
  headers?: Record<string, string>
}

type StoredMultipartPartMetadata = {
  name: string
  value: unknown
  headers: Record<string, string>
  contentType?: string
  filename?: string
}

type MultipartBody = Record<string, unknown> & {
  [multipartPartsSymbol]?: StoredMultipartPartMetadata[]
}

export function createMultipartBody(parts: MultipartPartMetadata[]): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  const metadata = parts.map(normalizeMultipartPart)

  for (const part of metadata) {
    appendMultipartFieldValue(body, part.name, part.value)
  }

  Object.defineProperty(body, multipartPartsSymbol, {
    value: metadata,
    enumerable: false,
    configurable: false,
    writable: false,
  })

  return body
}

/**
 * OpenAPI operation 정의에 따라 요청 전체를 검증.
 * Content-Type → path params → query params → body 순서로 검사.
 */
export function validateRequest(
  parts: RequestParts,
  params: OasParameter[],
  requestBody: OasRequestBody | undefined,
  security?: { requirements: OasSecurityRequirement[]; schemes: Record<string, OasSecurityScheme> },
): MockValidationResult {
  // Some parsers need the raw input only long enough to build a diagnostic.
  // Redact the complete accumulated list once before it becomes public.
  const errors: MockErrorDetailInput[] = []

  // 0. Security 검증 (헤더/쿼리/쿠키에 자격 증명 존재 확인)
  if (security && security.requirements.length > 0) {
    const secErrors = validateSecurity(parts, security.requirements, security.schemes)
    errors.push(...secErrors)
  }

  // 1. Content-Type 검증 (CT 헤더가 있는 요청만 — CT없이 body 없을 때 이중 에러 방지)
  if (requestBody && parts.contentType !== undefined) {
    const ctErrors = validateContentType(parts.contentType, requestBody)
    errors.push(...ctErrors)
  }

  // A syntactically malformed JSON payload is not equivalent to an omitted
  // optional body. Adapters retain only this error marker, never the raw input.
  if (requestBody && parts.bodyParseError === 'invalid-json') {
    errors.push({
      path: '/body',
      code: 'PROTOCOL_MISMATCH',
      message: 'JSON 요청 본문을 파싱할 수 없습니다',
      expected: 'valid JSON',
      stage: 'parse',
    })
  }

  // 2. 파라미터 검증 (path / query / header)
  for (const param of params) {
    if (param.in === 'querystring') {
      errors.push(...validateQuerystringParameter(param, parts.rawQueryString))
      continue
    }
    const raw = extractParamValue(param, parts)
    const paramErrors = validateParameterValue(param, raw)
    errors.push(...paramErrors)
  }

  // 3. 요청 바디 검증
  if (requestBody && parts.body !== undefined) {
    const bodyErrors = validateBody(parts.body, parts.contentType, requestBody)
    errors.push(...bodyErrors)
  } else if (requestBody?.required && parts.body === undefined) {
    errors.push({
      path: '/body',
      code: 'MISSING_REQUIRED_FIELD',
      message: '요청 바디가 필요합니다',
      stage: 'parse',
    })
  }

  if (errors.length === 0) return { valid: true }
  return { valid: false, errors: redactValidationDetails(errors) }
}

/**
 * RouteIndex에 포함된 요청 검증 스키마를 미리 컴파일합니다.
 *
 * Mock 서버 생성 시점에 호출하면 깨진 request body/parameter 스키마가
 * 첫 요청까지 숨어 있지 않고 즉시 드러납니다.
 */
export function validateRequestSchemas(index: RouteIndex): MockValidationResult {
  const errors: MockErrorDetail[] = []

  for (const [openApiPath, methodMap] of index) {
    for (const [method, entry] of methodMap) {
      const operationPath = `/routes/${escapePointer(openApiPath)}/${method}`

      entry.parameters.forEach((param, index) => {
        if (param.in === 'querystring') {
          for (const [contentType, rawMediaType] of Object.entries(param.content ?? {})) {
            const contentPath = `${operationPath}/parameters/${index}/content/${escapePointer(contentType)}`
            if ('$ref' in rawMediaType) {
              errors.push(schemaCompileError(contentPath, `미해결 Media Type $ref: ${rawMediaType.$ref}`))
              continue
            }
            const mediaType = rawMediaType as { schema?: OasSchema }
            if (!mediaType.schema) continue
            const compiled = compileSchema(mediaType.schema, `${contentPath}/schema`)
            if (!compiled.ok) errors.push(compiled.error)
          }
          return
        }
        const schema = param.schema as OasSchema | undefined
        if (!schema) return
        const compiled = compileSchema(schema, `${operationPath}/parameters/${index}/schema`)
        if (!compiled.ok) errors.push(compiled.error)
      })

      if (!entry.requestBody) continue
      for (const [contentType, rawMediaType] of Object.entries(entry.requestBody.content ?? {})) {
        if ('$ref' in rawMediaType) {
          errors.push(schemaCompileError(
            `${operationPath}/requestBody/content/${escapePointer(contentType)}`,
            `미해결 Media Type $ref: ${rawMediaType.$ref}`,
          ))
          continue
        }

        const mediaType = rawMediaType as { schema?: OasSchema }
        if (!mediaType.schema) continue
        if (isXmlMediaType(contentType)) {
          errors.push(...xmlScopeErrors(mediaType.schema, `${operationPath}/requestBody/content/${escapePointer(contentType)}/schema`))
        }
        const compiled = compileSchema(
          mediaType.schema,
          `${operationPath}/requestBody/content/${escapePointer(contentType)}/schema`,
        )
        if (!compiled.ok) errors.push(compiled.error)
      }
    }
  }

  if (errors.length === 0) return { valid: true }
  return { valid: false, errors }
}

export function assertValidRequestSchemas(index: RouteIndex): void {
  const result = validateRequestSchemas(index)
  if (result.valid) return

  const lines = result.errors.slice(0, 10).map(error =>
    `  - ${error.path}: ${error.expected ?? error.message}`,
  )
  const suffix = result.errors.length > 10 ? `\n  ...and ${result.errors.length - 10} more` : ''
  throw new Error(`Mock request schema preflight failed (${result.errors.length} errors)\n${lines.join('\n')}${suffix}`)
}

// ─── Content-Type ───────────────────────────────────────────────────────────

function validateContentType(
  received: string | undefined,
  requestBody: OasRequestBody,
): MockErrorDetailInput[] {
  const allowed = Object.keys(requestBody.content ?? {})
  if (allowed.length === 0) return []

  const normalized = received?.split(';')[0]?.trim()
  if (!normalized || !allowed.includes(normalized)) {
    return [
      {
        path: '/headers/content-type',
        code: 'PROTOCOL_MISMATCH',
        message: 'Content-Type 불일치',
        received: received ?? '(없음)',
        expected: allowed.join(' | '),
        stage: 'parse' as const,
      },
    ]
  }
  return []
}

// ─── Parameter ──────────────────────────────────────────────────────────────

function extractParamValue(
  param: OasParameter,
  parts: RequestParts,
): unknown {
  let raw: unknown
  switch (param.in) {
    case 'path': raw = parts.pathParams[param.name]; break
    case 'query': {
      const deepObject = extractDeepObjectQueryValue(parts.queryParams, param)
      raw = deepObject ?? parts.queryParams[param.name]
      break
    }
    case 'header': raw = parts.headers[param.name.toLowerCase()]; break
    case 'cookie': raw = parseCookies(parts.headers['cookie'] ?? '')[param.name]; break
    case 'querystring': raw = parts.rawQueryString; break
    default: return undefined
  }

  // style/explode 역직렬화 (OAS 3.2 §4.8.12)
  if (typeof raw === 'string' && param.schema) {
    return deserializeParam(raw, param)
  }
  return raw
}

/**
 * Querystring parameters serialize the entire query component using their
 * declared Media Type. We decode only representations with an unambiguous
 * decoder; other content types remain opaque instead of being guessed.
 */
function validateQuerystringParameter(
  param: OasParameter,
  raw: string | undefined,
): MockErrorDetailInput[] {
  const path = `/querystring/${escapePointer(param.name)}`
  if (raw === undefined) {
    return param.required
      ? [{ path, code: 'MISSING_REQUIRED_FIELD', message: `필수 querystring 파라미터 누락: '${param.name}'`, stage: 'validate' }]
      : []
  }

  const contentEntries = Object.entries(param.content ?? {})
  if (contentEntries.length !== 1) {
    return [{
      path,
      code: 'PROTOCOL_MISMATCH',
      message: 'querystring 파라미터는 검증 가능한 단일 content media type이 필요합니다',
      expected: 'exactly one content media type',
      stage: 'parse',
    }]
  }

  const [contentType, rawMediaType] = contentEntries[0]!
  if ('$ref' in rawMediaType) {
    return [{
      path,
      code: 'SCHEMA_COMPILE_ERROR',
      message: 'querystring Media Type $ref를 해소할 수 없습니다',
      expected: rawMediaType.$ref,
      stage: 'validate',
    }]
  }

  const mediaType = rawMediaType as { schema?: OasSchema }
  const normalizedContentType = contentType.split(';', 1)[0]?.trim().toLowerCase()
  const decoded = decodeQuerystringValue(raw, normalizedContentType, path)
  if (!decoded.ok) return [decoded.error]
  if (!mediaType.schema) return []
  if (!hasRegisteredQuerystringDecoder(normalizedContentType) && !acceptsRawQuerystring(mediaType.schema)) return []
  return runSchemaValidation(decoded.value, mediaType.schema, path)
}

type DecodedQuerystringValue =
  | { ok: true; value: unknown }
  | { ok: false; error: MockErrorDetailInput }

function decodeQuerystringValue(
  raw: string,
  contentType: string | undefined,
  path: string,
): DecodedQuerystringValue {
  if (contentType === 'application/x-www-form-urlencoded') {
    const value: Record<string, string | string[]> = Object.create(null)
    for (const [name, item] of new URLSearchParams(raw).entries()) {
      const existing = value[name]
      value[name] = existing === undefined ? item : Array.isArray(existing) ? [...existing, item] : [existing, item]
    }
    return { ok: true, value }
  }

  if (contentType === 'application/json' || contentType?.endsWith('+json')) {
    try {
      return { ok: true, value: JSON.parse(decodeURIComponent(raw)) }
    } catch {
      return {
        ok: false,
        error: {
          path,
          code: 'PROTOCOL_MISMATCH',
          message: 'querystring JSON 값을 파싱할 수 없습니다',
          expected: 'valid URI-encoded JSON',
          stage: 'parse',
        },
      }
    }
  }

  return { ok: true, value: raw }
}

function hasRegisteredQuerystringDecoder(contentType: string | undefined): boolean {
  return contentType === 'application/x-www-form-urlencoded'
    || contentType === 'application/json'
    || contentType?.endsWith('+json') === true
}

/** A string schema can validate the opaque wire representation without decoding it. */
function acceptsRawQuerystring(schema: OasSchema): boolean {
  if (schema.type === 'string') return true
  if (Array.isArray(schema.type) && schema.type.includes('string')) return true
  if (typeof schema.const === 'string') return true
  return Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every(value => typeof value === 'string')
}

/**
 * Reassemble the standard deepObject query form (`filter[name]=alice`) from
 * the flat URLSearchParams representation exposed by both adapters.
 *
 * Repeated keys deliberately retain their existing string[] representation so
 * an array-valued property can validate normally, while unrelated query keys
 * never become part of this parameter value.
 */
function extractDeepObjectQueryValue(
  queryParams: Record<string, string | string[]>,
  param: OasParameter,
): Record<string, string | string[]> | undefined {
  if (param.style !== 'deepObject') return undefined

  const prefix = `${param.name}[`
  const value: Record<string, string | string[]> = Object.create(null)
  let found = false

  for (const [key, raw] of Object.entries(queryParams)) {
    if (!key.startsWith(prefix) || !key.endsWith(']')) continue
    const property = key.slice(prefix.length, -1)
    // Nested bracket parsing is intentionally not inferred here: OpenAPI
    // defines deepObject for a parameter object's direct properties, and a
    // malformed/empty property should not be silently accepted.
    if (!property || property.includes('[') || property.includes(']')) continue
    value[property] = raw
    found = true
  }

  return found ? value : undefined
}

/**
 * style/explode 기반 파라미터 역직렬화.
 *
 * 기본값:
 *   path   → style: simple,  explode: false
 *   query  → style: form,    explode: true
 *   header → style: simple,  explode: false
 *   cookie → style: form,    explode: false
 */
function deserializeParam(raw: string, param: OasParameter): unknown {
  const schema = param.schema as OasSchema
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
  if (type !== 'array' && type !== 'object') return raw

  const style = param.style ?? defaultStyle(param.in)
  const explode = param.explode ?? (style === 'form')

  if (type === 'array') {
    switch (style) {
      case 'form': return raw.split(',')
      case 'simple': return raw.split(',')
      case 'spaceDelimited': return raw.split(' ')
      case 'pipeDelimited': return raw.split('|')
      case 'label': return raw.startsWith('.') ? raw.slice(1).split('.') : raw.split('.')
      case 'matrix': {
        const match = raw.match(/;[^=]+=(.*)/)
        return match ? match[1]!.split(',') : [raw]
      }
      default: return raw.split(',')
    }
  }

  // type === 'object' (key=value 쌍)
  if (style === 'deepObject') {
    // deepObject: param[key]=value 형태 — 쿼리에서 이미 파싱됨
    return raw
  }

  // simple/form: key,value,key,value → { key: value }
  const parts = raw.split(',')
  const result: Record<string, string> = {}
  for (let i = 0; i < parts.length - 1; i += 2) {
    result[parts[i]!] = parts[i + 1] ?? ''
  }
  return result
}

function defaultStyle(location: string): string {
  switch (location) {
    case 'query': return 'form'
    case 'cookie': return 'form'
    default: return 'simple'
  }
}

// ─── Body ───────────────────────────────────────────────────────────────────

function validateBody(
  body: unknown,
  contentType: string | undefined,
  requestBody: OasRequestBody,
): MockErrorDetailInput[] {
  const normalized = contentType?.split(';')[0]?.trim() ?? 'application/json'

  if (normalized === 'multipart/form-data') {
    const raw = requestBody.content?.['multipart/form-data']
    if (!raw || '$ref' in raw) return []
    const mediaType = raw as OasMediaType
    if (!mediaType.schema) return []
    const prepared = prepareMultipartBody(body, mediaType)
    return [
      ...prepared.errors,
      ...runSchemaValidation(prepared.body, mediaType.schema, '/body'),
    ]
  }

  if (isXmlMediaType(normalized)) {
    const raw = requestBody.content?.[normalized]
    if (!raw || '$ref' in raw) return []
    const mediaType = raw as { schema?: OasSchema }
    if (!mediaType.schema) return []
    const prepared = prepareXmlBody(body, mediaType.schema)
    if (prepared.errors.length > 0) return prepared.errors
    return runSchemaValidation(prepared.body, mediaType.schema, '/body')
  }

  const raw = requestBody.content?.[normalized]
  if (!raw || '$ref' in raw) return []
  const mediaType = raw as { schema?: OasSchema }
  if (!mediaType.schema) return []

  return runSchemaValidation(body, mediaType.schema, '/body')
}

// ─── XML body support ───────────────────────────────────────────────────────

function prepareXmlBody(
  body: unknown,
  schema: OasSchema,
): { body: unknown; errors: MockErrorDetailInput[] } {
  const scopeErrors = xmlScopeErrors(schema, '/body')
  if (scopeErrors.length > 0) return { body, errors: scopeErrors }
  if (typeof body !== 'string') return { body, errors: [] }

  const parsed = parseXmlBody(body, schema)
  if (parsed.ok) return { body: parsed.value, errors: [] }

  return {
    body,
    errors: [{
      path: '/body',
      code: 'PROTOCOL_MISMATCH',
      message: 'XML 요청 바디를 파싱할 수 없습니다',
      expected: parsed.expected ?? XML_SUPPORTED_SCOPE,
      received: parsed.received ?? parsed.message,
      stage: 'parse',
    }],
  }
}

function xmlScopeErrors(schema: OasSchema, basePath: string): MockErrorDetail[] {
  return collectUnsupportedXmlFeatures(schema, basePath).map(xmlUnsupportedFeatureError)
}

function xmlUnsupportedFeatureError(feature: XmlUnsupportedFeature): MockErrorDetail {
  return redactValidationDetail({
    path: feature.path,
    code: 'PROTOCOL_MISMATCH',
    message: `지원하지 않는 XML Object 기능: ${feature.message}`,
    expected: XML_SUPPORTED_SCOPE,
    received: feature.feature,
    stage: 'parse',
  })
}

// ─── Multipart encoding ────────────────────────────────────────────────────

function prepareMultipartBody(
  body: unknown,
  mediaType: OasMediaType,
): { body: unknown; errors: MockErrorDetailInput[] } {
  if (!isRecord(body)) return { body, errors: [] }

  const schema = mediaType.schema
  const properties = schema?.properties ?? {}
  const errors: MockErrorDetailInput[] = []
  const prepared: Record<string, unknown> = { ...body }
  const partsByName = groupMultipartParts(body)

  for (const [fieldName, fieldSchema] of Object.entries(properties)) {
    const encoding = mediaType.encoding?.[fieldName]
    applyMultipartFieldEncoding(prepared, partsByName, fieldName, fieldSchema, encoding, errors)
  }

  return { body: prepared, errors }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function applyMultipartFieldEncoding(
  body: Record<string, unknown>,
  partsByName: Map<string, StoredMultipartPartMetadata[]>,
  fieldName: string,
  fieldSchema: OasSchema,
  encoding: OasEncoding | undefined,
  errors: MockErrorDetailInput[],
): void {
  const parts = partsByName.get(fieldName)
  if (!parts || parts.length === 0) return

  const path = `/body/${escapePointer(fieldName)}`
  if (hasExplicitStyleEncoding(encoding)) {
    const styled = deserializeMultipartStyle(fieldName, fieldSchema, encoding, parts, path, errors)
    if (styled.ok) body[fieldName] = styled.value
    return
  }

  const valueSchema = getMultipartValueSchema(fieldSchema)
  if (encoding?.contentType) {
    validateMultipartPartContentTypes(parts, valueSchema, encoding.contentType, path, errors)
  }

  const decoded = parts.map(part => {
    const contentType = part.contentType ?? defaultMultipartContentType(valueSchema)
    return decodeMultipartPartValue(part.value, contentType, path, errors)
  })

  body[fieldName] = isArraySchema(fieldSchema) ? decoded : decoded.length === 1 ? decoded[0] : decoded
}

type MultipartStyleResult =
  | { ok: true; value: unknown }
  | { ok: false }

function deserializeMultipartStyle(
  fieldName: string,
  schema: OasSchema,
  encoding: OasEncoding | undefined,
  parts: StoredMultipartPartMetadata[],
  path: string,
  errors: MockErrorDetailInput[],
): MultipartStyleResult {
  const style = encoding?.style ?? 'form'
  const explode = encoding?.explode ?? (style === 'form')
  const schemaKind = getSchemaKind(schema)

  if (schemaKind === 'array') {
    if (explode) {
      if (style !== 'form') {
        errors.push(multipartEncodingError(
          path,
          `지원하지 않는 multipart 배열 인코딩: style=${style}, explode=true`,
          'style=form with explode=true, or a non-exploded array style',
          `style=${style}, explode=true`,
        ))
        return { ok: false }
      }
      return { ok: true, value: parts.map(part => part.value) }
    }

    if (parts.length !== 1) {
      errors.push(multipartEncodingError(
        path,
        `multipart 필드 '${fieldName}'는 explode=false일 때 단일 part여야 합니다`,
        'single multipart part',
        `${parts.length} parts`,
      ))
      return { ok: false }
    }

    const delimiter = styleDelimiter(style)
    if (!delimiter) {
      errors.push(multipartEncodingError(
        path,
        `지원하지 않는 multipart 배열 인코딩: style=${style}`,
        'style=form, simple, spaceDelimited, or pipeDelimited',
        style,
      ))
      return { ok: false }
    }

    return { ok: true, value: String(parts[0]?.value ?? '').split(delimiter) }
  }

  if (schemaKind === 'object') {
    if (style === 'form' && !explode) {
      if (parts.length !== 1) {
        errors.push(multipartEncodingError(
          path,
          `multipart 객체 필드 '${fieldName}'는 explode=false일 때 단일 part여야 합니다`,
          'single multipart part',
          `${parts.length} parts`,
        ))
        return { ok: false }
      }
      return { ok: true, value: deserializeDelimitedObject(String(parts[0]?.value ?? ''), ',') }
    }

    errors.push(multipartEncodingError(
      path,
      `지원하지 않는 multipart 객체 인코딩: style=${style}, explode=${String(explode)}`,
      'style=form with explode=false',
      `style=${style}, explode=${String(explode)}`,
    ))
    return { ok: false }
  }

  return { ok: true, value: parts.length === 1 ? parts[0]?.value : parts.map(part => part.value) }
}

function validateMultipartPartContentTypes(
  parts: StoredMultipartPartMetadata[],
  valueSchema: OasSchema,
  expected: string,
  path: string,
  errors: MockErrorDetailInput[],
): void {
  for (const part of parts) {
    const actual = part.contentType ?? defaultMultipartContentType(valueSchema)
    if (mediaTypeListMatches(expected, actual)) continue
    errors.push(multipartEncodingError(
      path,
      'multipart 필드 Content-Type 불일치',
      expected,
      actual,
    ))
  }
}

function decodeMultipartPartValue(
  value: unknown,
  contentType: string,
  path: string,
  errors: MockErrorDetailInput[],
): unknown {
  if (!isJsonMediaType(contentType) || typeof value !== 'string') return value

  try {
    return JSON.parse(value)
  } catch {
    errors.push(multipartEncodingError(
      path,
      'multipart JSON part를 파싱할 수 없습니다',
      contentType,
      value,
    ))
    return value
  }
}

function groupMultipartParts(body: Record<string, unknown>): Map<string, StoredMultipartPartMetadata[]> {
  const metadata = (body as MultipartBody)[multipartPartsSymbol]
  const parts = Array.isArray(metadata) ? metadata : synthesizeMultipartParts(body)
  const grouped = new Map<string, StoredMultipartPartMetadata[]>()

  for (const part of parts) {
    const current = grouped.get(part.name)
    if (current) current.push(part)
    else grouped.set(part.name, [part])
  }

  return grouped
}

function synthesizeMultipartParts(body: Record<string, unknown>): StoredMultipartPartMetadata[] {
  const parts: StoredMultipartPartMetadata[] = []
  for (const [name, value] of Object.entries(body)) {
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) parts.push({ name, value: item, headers: {} })
  }
  return parts
}

function normalizeMultipartPart(part: MultipartPartMetadata): StoredMultipartPartMetadata {
  const headers = normalizeHeaders(part.headers ?? {})
  const contentType = part.contentType ?? headers['content-type']
  const normalized: StoredMultipartPartMetadata = {
    name: part.name,
    value: part.value,
    headers,
  }

  if (contentType !== undefined) normalized.contentType = contentType
  if (part.filename !== undefined) normalized.filename = part.filename
  return normalized
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    normalized[name.toLowerCase()] = value
  }
  return normalized
}

function appendMultipartFieldValue(body: Record<string, unknown>, name: string, value: unknown): void {
  const existing = body[name]
  if (existing === undefined) {
    body[name] = value
  } else {
    body[name] = Array.isArray(existing) ? [...existing, value] : [existing, value]
  }
}

function hasExplicitStyleEncoding(encoding: OasEncoding | undefined): boolean {
  return encoding?.style !== undefined || encoding?.explode !== undefined || encoding?.allowReserved !== undefined
}

function getMultipartValueSchema(schema: OasSchema): OasSchema {
  return isArraySchema(schema) ? schema.items ?? {} : schema
}

function defaultMultipartContentType(schema: OasSchema): string {
  const type = firstSchemaType(schema)
  if (type === undefined) return 'application/octet-stream'
  if (type === 'string') return schema.contentEncoding === undefined ? 'text/plain' : 'application/octet-stream'
  if (type === 'number' || type === 'integer' || type === 'boolean') return 'text/plain'
  if (type === 'object' || type === 'array') return 'application/json'
  return 'application/octet-stream'
}

function getSchemaKind(schema: OasSchema): 'array' | 'object' | 'primitive' {
  const type = firstSchemaType(schema)
  if (type === 'array' || schema.items !== undefined || schema.prefixItems !== undefined) return 'array'
  if (
    type === 'object' ||
    schema.properties !== undefined ||
    schema.additionalProperties !== undefined ||
    schema.patternProperties !== undefined
  ) {
    return 'object'
  }
  return 'primitive'
}

function firstSchemaType(schema: OasSchema): string | undefined {
  return Array.isArray(schema.type) ? schema.type[0] : schema.type
}

function isArraySchema(schema: OasSchema): boolean {
  return getSchemaKind(schema) === 'array'
}

function styleDelimiter(style: string): string | undefined {
  switch (style) {
    case 'form':
    case 'simple':
      return ','
    case 'spaceDelimited':
      return ' '
    case 'pipeDelimited':
      return '|'
    default:
      return undefined
  }
}

function deserializeDelimitedObject(raw: string, delimiter: string): Record<string, string> {
  const values = raw.split(delimiter)
  const result: Record<string, string> = {}
  for (let index = 0; index < values.length - 1; index += 2) {
    const key = values[index]
    if (key !== undefined && key !== '') result[key] = values[index + 1] ?? ''
  }
  return result
}

type ParsedMediaType = {
  type: string
  subtype: string
  params: Record<string, string>
}

function mediaTypeListMatches(expectedList: string, actual: string): boolean {
  const actualMediaType = parseMediaType(actual)
  if (!actualMediaType) return false
  return splitMediaTypeList(expectedList).some(expected => {
    const expectedMediaType = parseMediaType(expected)
    return expectedMediaType ? mediaTypeMatches(expectedMediaType, actualMediaType) : false
  })
}

function mediaTypeMatches(expected: ParsedMediaType, actual: ParsedMediaType): boolean {
  const typeMatches = expected.type === '*' || expected.type === actual.type
  const subtypeMatches = expected.subtype === '*' || expected.subtype === actual.subtype
  if (!typeMatches || !subtypeMatches) return false

  for (const [name, value] of Object.entries(expected.params)) {
    if (actual.params[name] !== value) return false
  }
  return true
}

function isJsonMediaType(contentType: string): boolean {
  const parsed = parseMediaType(contentType)
  if (!parsed) return false
  return parsed.subtype === 'json' || parsed.subtype.endsWith('+json')
}

function parseMediaType(value: string): ParsedMediaType | undefined {
  const [typePart, ...paramParts] = value.split(';')
  const [type, subtype] = typePart?.trim().toLowerCase().split('/') ?? []
  if (!type || !subtype) return undefined

  const params: Record<string, string> = {}
  for (const rawParam of paramParts) {
    const separator = rawParam.indexOf('=')
    if (separator === -1) continue
    const name = rawParam.slice(0, separator).trim().toLowerCase()
    const rawValue = rawParam.slice(separator + 1).trim()
    if (name) params[name] = rawValue.replace(/^"|"$/g, '').toLowerCase()
  }

  return { type, subtype, params }
}

function splitMediaTypeList(value: string): string[] {
  const items: string[] = []
  let current = ''
  let quoted = false

  for (const char of value) {
    if (char === '"') quoted = !quoted
    if (char === ',' && !quoted) {
      if (current.trim()) items.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  if (current.trim()) items.push(current.trim())
  return items
}

function multipartEncodingError(
  path: string,
  message: string,
  expected: string,
  received: unknown,
): MockErrorDetailInput {
  return {
    path,
    code: 'PROTOCOL_MISMATCH',
    message,
    expected,
    received,
    stage: 'parse',
  }
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}
