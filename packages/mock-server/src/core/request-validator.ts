import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import type { OasParameter, OasRequestBody, OasSchema, OasSecurityScheme, OasSecurityRequirement } from '@oa-sdk/parser'
import { classifyAjvErrors } from '../errors/classifier.js'
import type { MockErrorDetail, MockValidationResult } from '../errors/types.js'

const ajv = new Ajv({ allErrors: true, strict: false, verbose: true, discriminator: true })
addFormats(ajv)

// 스키마 객체 참조 → 컴파일된 validate 함수 캐시 (매 요청마다 재컴파일 방지)
const validatorCache = new WeakMap<object, ReturnType<typeof ajv.compile>>()

export type RequestParts = {
  pathParams: Record<string, string>
  queryParams: Record<string, string | string[]>
  headers: Record<string, string>
  body: unknown
  contentType: string | undefined
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
    })
  }

  if (errors.length === 0) return { valid: true }
  return { valid: false, errors }
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
      return [{ path, code: 'MISSING_REQUIRED_FIELD', message: `필수 파라미터 누락: '${param.name}'` }]
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
  const raw = requestBody.content?.[normalized]
  if (!raw || '$ref' in raw) return []
  const mediaType = raw as { schema?: OasSchema }
  if (!mediaType.schema) return []

  return runAjv(body, mediaType.schema, '/body')
}

// ─── AJV runner ─────────────────────────────────────────────────────────────

function runAjv(data: unknown, schema: OasSchema, basePath: string): MockErrorDetail[] {
  let validate = validatorCache.get(schema)
  if (!validate) {
    try {
      validate = ajv.compile(schema)
    } catch {
      // loadSchema를 거치면 $ref는 이미 인라인 전개됨
      // 직접 호출 등 미해석 $ref가 남아있는 경우 → 검증 건너뜀
      return []
    }
    validatorCache.set(schema, validate)
  }
  const valid = validate(data)
  if (valid) return []

  return classifyAjvErrors(validate.errors ?? []).map(e => ({
    ...e,
    path: e.path === '/' ? basePath : `${basePath}${e.path}`,
  }))
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
