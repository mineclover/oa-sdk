import Ajv from 'ajv'
import addFormats from 'ajv-formats'
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
import { classifyAjvErrors } from '../errors/classifier.js'
import type { MockErrorDetail, MockValidationResult } from '../errors/types.js'

const ajv = new Ajv({ allErrors: true, strict: false, verbose: true, discriminator: true })
addFormats(ajv)

// 스키마 객체 참조 → 컴파일된 validate 함수 캐시 (매 요청마다 재컴파일 방지)
const validatorCache = new WeakMap<object, ReturnType<typeof ajv.compile>>()
const multipartPartsSymbol = Symbol.for('@oa-sdk/mock-server.multipart-parts')

export type RequestParts = {
  pathParams: Record<string, string>
  queryParams: Record<string, string | string[]>
  headers: Record<string, string>
  body: unknown
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
  const errors: MockErrorDetail[] = []

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

  // 2. 파라미터 검증 (path / query / header)
  for (const param of params) {
    const raw = extractParamValue(param, parts)
    const paramErrors = validateParameter(param, raw)
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
  return { valid: false, errors }
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
): MockErrorDetail[] {
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
    case 'query': raw = parts.queryParams[param.name]; break
    case 'header': raw = parts.headers[param.name.toLowerCase()]; break
    case 'cookie': raw = parseCookies(parts.headers['cookie'] ?? '')[param.name]; break
    default: return undefined
  }

  // style/explode 역직렬화 (OAS 3.2 §4.8.12)
  if (typeof raw === 'string' && param.schema) {
    return deserializeParam(raw, param)
  }
  return raw
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

function validateParameter(param: OasParameter, value: unknown): MockErrorDetail[] {
  const path = `/${param.in}/${param.name}`

  if (value === undefined || value === null) {
    if (param.required) {
      return [{ path, code: 'MISSING_REQUIRED_FIELD', message: `필수 파라미터 누락: '${param.name}'`, stage: 'validate' }]
    }
    return []
  }

  const schema = param.schema as OasSchema | undefined
  if (!schema) return []

  // query/path params는 문자열로 들어오므로 타입에 맞게 강제 변환
  const coerced = coerce(value, schema)
  return runAjv(coerced, schema, path)
}

// ─── Body ───────────────────────────────────────────────────────────────────

function validateBody(
  body: unknown,
  contentType: string | undefined,
  requestBody: OasRequestBody,
): MockErrorDetail[] {
  const normalized = contentType?.split(';')[0]?.trim() ?? 'application/json'

  if (normalized === 'multipart/form-data') {
    const raw = requestBody.content?.['multipart/form-data']
    if (!raw || '$ref' in raw) return []
    const mediaType = raw as OasMediaType
    if (!mediaType.schema) return []
    const prepared = prepareMultipartBody(body, mediaType)
    return [
      ...prepared.errors,
      ...runAjv(prepared.body, mediaType.schema, '/body'),
    ]
  }

  const raw = requestBody.content?.[normalized]
  if (!raw || '$ref' in raw) return []
  const mediaType = raw as { schema?: OasSchema }
  if (!mediaType.schema) return []

  return runAjv(body, mediaType.schema, '/body')
}

// ─── Multipart encoding ────────────────────────────────────────────────────

function prepareMultipartBody(
  body: unknown,
  mediaType: OasMediaType,
): { body: unknown; errors: MockErrorDetail[] } {
  if (!isRecord(body)) return { body, errors: [] }

  const schema = mediaType.schema
  const properties = schema?.properties ?? {}
  const errors: MockErrorDetail[] = []
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
  errors: MockErrorDetail[],
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
  errors: MockErrorDetail[],
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
  errors: MockErrorDetail[],
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
  errors: MockErrorDetail[],
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
): MockErrorDetail {
  return {
    path,
    code: 'PROTOCOL_MISMATCH',
    message,
    expected,
    received,
    stage: 'parse',
  }
}

// ─── AJV runner ─────────────────────────────────────────────────────────────

function runAjv(data: unknown, schema: OasSchema, basePath: string): MockErrorDetail[] {
  const compiled = compileSchema(schema, basePath)
  if (!compiled.ok) return [compiled.error]

  const validate = compiled.validator
  const valid = validate(data)
  if (valid) return []

  return classifyAjvErrors(validate.errors ?? []).map(e => ({
    ...e,
    path: e.path === '/' ? basePath : `${basePath}${e.path}`,
  }))
}

type CompileResult =
  | { ok: true; validator: ReturnType<typeof ajv.compile> }
  | { ok: false; error: MockErrorDetail }

function compileSchema(schema: OasSchema, basePath: string): CompileResult {
  const cached = validatorCache.get(schema)
  if (cached) return { ok: true, validator: cached }

  try {
    const validate = ajv.compile(schema)
    validatorCache.set(schema, validate)
    return { ok: true, validator: validate }
  } catch (err) {
    return {
      ok: false,
      error: schemaCompileError(basePath, err instanceof Error ? err.message : String(err)),
    }
  }
}

function schemaCompileError(path: string, expected: string): MockErrorDetail {
  return {
    path,
    code: 'SCHEMA_COMPILE_ERROR',
    message: '요청 검증 스키마를 컴파일할 수 없습니다',
    expected,
    stage: 'validate',
  }
}

// ─── Type coercion ──────────────────────────────────────────────────────────

function parseCookies(cookieHeader: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const pair of cookieHeader.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    const key = pair.slice(0, eq).trim()
    if (key) result[key] = pair.slice(eq + 1).trim()
  }
  return result
}

// ─── Security ───────────────────────────────────────────────────────────────

/**
 * OAS security 요구사항 검증.
 * 토큰 유효성은 검증하지 않음 — 자격 증명이 존재하는지만 확인.
 * OR 의미론: requirements 배열 중 하나만 만족하면 통과.
 */
function validateSecurity(
  parts: RequestParts,
  requirements: OasSecurityRequirement[],
  schemes: Record<string, OasSecurityScheme>,
): MockErrorDetail[] {
  // 빈 requirements = 인증 불필요
  if (requirements.length === 0) return []

  // OR 의미론: requirements 중 하나라도 만족하면 통과
  for (const req of requirements) {
    // 빈 객체 = 인증 불필요 (OAS spec)
    const schemeNames = Object.keys(req)
    if (schemeNames.length === 0) return []

    const allSatisfied = schemeNames.every(name => {
      const scheme = schemes[name]
      if (!scheme) return false
      return checkSchemePresence(parts, scheme)
    })

    if (allSatisfied) return []
  }

  return [{
    path: '/security',
    code: 'MISSING_REQUIRED_FIELD',
    message: '인증 자격 증명이 필요합니다',
    expected: requirements.map(r => Object.keys(r).join(' + ')).join(' 또는 '),
    stage: 'validate' as const,
  }]
}

function checkSchemePresence(parts: RequestParts, scheme: OasSecurityScheme): boolean {
  switch (scheme.type) {
    case 'http': {
      const auth = parts.headers['authorization'] ?? ''
      if (scheme.scheme === 'bearer') return auth.toLowerCase().startsWith('bearer ')
      if (scheme.scheme === 'basic') return auth.toLowerCase().startsWith('basic ')
      return auth.length > 0
    }
    case 'apiKey': {
      const location = scheme.in ?? 'header'
      const name = scheme.name ?? ''
      if (location === 'header') return (parts.headers[name.toLowerCase()] ?? '').length > 0
      if (location === 'query') return parts.queryParams[name] !== undefined
      if (location === 'cookie') return parseCookies(parts.headers['cookie'] ?? '')[name] !== undefined
      return false
    }
    case 'openIdConnect':
    case 'oauth2':
      // OAuth2/OIDC는 bearer 토큰 존재만 확인
      return (parts.headers['authorization'] ?? '').toLowerCase().startsWith('bearer ')
    case 'mutualTLS':
      // mTLS는 mock에서 검증 불가 — 항상 통과
      return true
    default:
      return true
  }
}

/** URL params는 항상 string — 스키마 타입에 따라 변환 후 검증 */
function coerce(value: unknown, schema: OasSchema): unknown {
  if (typeof value !== 'string') return value
  switch (schema.type) {
    case 'integer': {
      const n = Number(value)
      return Number.isNaN(n) ? value : Number.isInteger(n) ? n : value
    }
    case 'number': return Number.isNaN(Number(value)) ? value : parseFloat(value)
    case 'boolean': return value === 'true' ? true : value === 'false' ? false : value
    default: return value
  }
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}
