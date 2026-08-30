/**
 * OAS ParsedDocument → 서버 라우터 스텁 코드 생성
 *
 * 지원 프레임워크: Hono (기본), Express 호환 가능.
 * typegen 타입을 import하여 타입 안전 라우터를 생성합니다.
 */

import type { OasRequestBody, OasResponse, ParsedDocument } from '@oa-sdk/parser/browser'
import { toColonPath, createOperationTypeNameMap, collectTypeNames, formatGeneratedTs, pickDefaultStatus, quoteTypeScriptString } from '@oa-sdk/core/browser'
import { getQuerystringParameter } from '@oa-sdk/parser/browser'
import { formatJSDoc } from './jsdoc.js'

export type RouterTarget = 'hono' | 'express'

/** Platform-neutral router rendering options. */
export type RouterRenderOptions = {
  /** 라우터 프레임워크 (기본: hono) */
  target?: RouterTarget
  /** typegen 타입 import 경로 (예: './types') */
  typesImport?: string
  /** 헤더 주석 */
  banner?: boolean
}

/**
 * OAS 원본 문서 또는 ParsedDocument IR에서 서버 라우터 스텁을 생성합니다.
 */
export function generateRouterFromParsed(doc: ParsedDocument, options: RouterRenderOptions = {}): string {
  const { target = 'hono', typesImport, banner = true } = options
  const lines: string[] = []
  const operationNames = createOperationTypeNameMap([...doc.operations, ...doc.webhooks])

  if (banner) {
    lines.push('// Auto-generated router stub from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/router')
    lines.push('')
  }

  // imports
  if (target === 'hono') {
    lines.push("import { Hono } from 'hono'")
  } else {
    lines.push("import { Router } from 'express'")
  }

  if (typesImport) {
    const typeNames = collectTypeNames([...doc.operations, ...doc.webhooks], operationNames)
    if (typeNames.length > 0) {
      lines.push(`import type { ${typeNames.join(', ')} } from '${typesImport}'`)
    }
  }
  lines.push('')

  const needsResponseHeaderHelper = !!typesImport && doc.operations.some(op => hasGeneratedResponseHeaders(op.responses))
  if (needsResponseHeaderHelper) {
    lines.push(`function __setOaResponseHeaders<THeaders extends object>(setHeader: (name: string, value: string) => void, headers: Partial<THeaders>): void {`)
    lines.push(`  for (const [name, value] of Object.entries(headers)) {`)
    lines.push(`    const serialized = __serializeOaResponseHeader(value)`)
    lines.push(`    if (serialized !== undefined) setHeader(name, serialized)`)
    lines.push(`  }`)
    lines.push(`}`)
    lines.push('')
    lines.push(`function __serializeOaResponseHeader(value: unknown): string | undefined {`)
    lines.push(`  if (value === undefined || value === null) return undefined`)
    lines.push(`  if (Array.isArray(value)) return value.map(String).join(', ')`)
    lines.push(`  return String(value)`)
    lines.push(`}`)
    lines.push('')
  }

  const needsRawQuerystringHelper = [...doc.operations, ...doc.webhooks]
    .some(op => op.parameters.some(parameter => parameter.in === 'querystring'))
  if (needsRawQuerystringHelper) {
    lines.push(`function __readOaRawQuerystring(url: string): string | undefined {`)
    lines.push(`  const question = url.indexOf('?')`)
    lines.push(`  if (question === -1) return undefined`)
    lines.push(`  const hash = url.indexOf('#', question + 1)`)
    lines.push(`  return url.slice(question + 1, hash === -1 ? undefined : hash)`)
    lines.push(`}`)
    lines.push('')
  }

  // router instance
  if (target === 'hono') {
    lines.push('const app = new Hono()')
    lines.push('')
  } else {
    lines.push('const router = Router()')
    lines.push('')
  }

  // routes
  for (const op of doc.operations) {
    if (!op.operationId) continue
    const baseName = operationNames.get(op.operationId)!
    const method = op.method
    const path = target === 'hono' ? toColonPath(op.openApiPath) : toColonPath(op.openApiPath)

    // security hint
    if (op.security.length > 0) {
      const schemeNames = [...new Set(op.security.flatMap(req => Object.keys(req)))]
      lines.push(`// Requires: ${schemeNames.join(', ')}`)
    }

    // JSDoc
    if (op.summary || op.description) {
      lines.push(...formatJSDoc(op.summary ?? op.description).split('\n'))
    }

    if (target === 'hono') {
      lines.push(renderHonoRouteRegistration(method, path))
      lines.push(`  try {`)
    } else {
      const registration = renderExpressRouteRegistration(method, path)
      lines.push(registration.source)
      if (registration.requiresMethodGuard) lines.push(`  if (req.method !== ${quoteTypeScriptString(method.toUpperCase())}) return next()`)
      lines.push(`  try {`)
    }

    // path params
    const pathParams = op.parameters.filter(p => p.in === 'path')
    if (pathParams.length > 0 && typesImport) {
      if (target === 'hono') {
        lines.push(`    const params = c.req.param() as unknown as ${baseName}PathParams`)
      } else {
        lines.push(`    const params = req.params as unknown as ${baseName}PathParams`)
      }
    }

    // query params
    const queryParams = op.parameters.filter(p => p.in === 'query')
    if (queryParams.length > 0 && typesImport) {
      if (target === 'hono') {
        lines.push(`    const query = c.req.query() as unknown as ${baseName}QueryParams`)
      } else {
        lines.push(`    const query = req.query as unknown as ${baseName}QueryParams`)
      }
    }

    const querystringParam = getQuerystringParameter(op.parameters)
    if (querystringParam) {
      const type = typesImport ? `${baseName}QueryString` : 'string'
      if (target === 'hono') {
        lines.push(`    const querystring = __readOaRawQuerystring(c.req.raw.url) as ${type} | undefined // raw serialized query string; no leading '?'`)
      } else {
        lines.push(`    const querystring = __readOaRawQuerystring(req.originalUrl ?? req.url) as ${type} | undefined // raw serialized query string; no leading '?'`)
      }
    }

    // request body
    if (op.requestBody) {
      const contentTypes = op.requestBody.content ? Object.keys(op.requestBody.content) : []
      const bodyParseLine = buildBodyParseLine(
        target,
        contentTypes,
        baseName,
        !!typesImport && hasGeneratedRequestBodyType(op.requestBody),
        op.requestBody.required === true,
      )
      lines.push(`  ${bodyParseLine}`)
    }

    // response stub
    const status = pickDefaultStatus(op.responses)
    const hasTypedResponseHeaders = !!typesImport && hasGeneratedResponseHeaders(op.responses)
    const hasTypedResponseBody = !!typesImport && hasGeneratedResponseType(op.responses)
    lines.push(`    // TODO: implement ${op.operationId}`)
    if (hasTypedResponseHeaders) {
      lines.push(`    // Add documented response headers here.`)
      lines.push(`    const responseHeaders: Partial<${baseName}ResponseHeaders> = {}`)
      if (target === 'hono') {
        lines.push(`    __setOaResponseHeaders<${baseName}ResponseHeaders>((name, value) => c.header(name, value), responseHeaders)`)
      } else {
        lines.push(`    __setOaResponseHeaders<${baseName}ResponseHeaders>((name, value) => res.setHeader(name, value), responseHeaders)`)
      }
    }
    if (target === 'hono') {
      if (status === 204) {
        lines.push(`    return c.body(null, 204)`)
      } else if (hasTypedResponseBody) {
        lines.push(`    return c.json({} as ${baseName}Response, ${status})`)
      } else {
        lines.push(`    return c.json({} as any, ${status}) // ${baseName}Response (headers: ${baseName}ResponseHeaders)`)
      }
    } else {
      if (status === 204) {
        lines.push(`    return res.status(204).end()`)
      } else if (hasTypedResponseBody) {
        lines.push(`    return res.status(${status}).json({} as ${baseName}Response)`)
      } else {
        lines.push(`    return res.status(${status}).json({}) // ${baseName}Response`)
      }
    }

    // catch block
    lines.push(`  } catch (err) {`)
    lines.push(`    const message = err instanceof Error ? err.message : String(err)`)
    if (target === 'hono') {
      lines.push(`    return c.json({ error: { code: 'INTERNAL_ERROR', message, details: [] } }, 500)`)
    } else {
      lines.push(`    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, details: [] } })`)
    }
    lines.push(`  }`)

    lines.push('})')
    lines.push('')
  }

  // ─── Webhooks ─────────────────────────────────────────────────
  if (doc.webhooks.length > 0) {
    lines.push('// ─── Webhooks ─────────────────────────────────────────────────')
    lines.push('')
    for (const op of doc.webhooks) {
      if (!op.operationId) continue
      const baseName = operationNames.get(op.operationId)!
      const method = op.method
      const path = target === 'hono' ? toColonPath(op.openApiPath) : toColonPath(op.openApiPath)

      lines.push(`// ${method.toUpperCase()} ${op.openApiPath} — incoming webhook`)

      // JSDoc
      if (op.summary || op.description) {
        lines.push(...formatJSDoc(op.summary ?? op.description).split('\n'))
      }

      if (target === 'hono') {
        lines.push(renderHonoRouteRegistration(method, path))
        lines.push(`  try {`)
      } else {
        const registration = renderExpressRouteRegistration(method, path)
        lines.push(registration.source)
        if (registration.requiresMethodGuard) lines.push(`  if (req.method !== ${quoteTypeScriptString(method.toUpperCase())}) return next()`)
        lines.push(`  try {`)
      }

      const querystringParam = getQuerystringParameter(op.parameters)
      if (querystringParam) {
        const type = typesImport ? `${baseName}QueryString` : 'string'
        if (target === 'hono') {
          lines.push(`    const querystring = __readOaRawQuerystring(c.req.raw.url) as ${type} | undefined // raw serialized query string; no leading '?'`)
        } else {
          lines.push(`    const querystring = __readOaRawQuerystring(req.originalUrl ?? req.url) as ${type} | undefined // raw serialized query string; no leading '?'`)
        }
      }

      // request body
      if (op.requestBody) {
        const contentTypes = op.requestBody.content ? Object.keys(op.requestBody.content) : []
        const bodyParseLine = buildBodyParseLine(target, contentTypes, baseName, !!typesImport, op.requestBody.required === true)
        lines.push(`  ${bodyParseLine}`)
      }

      // response stub
      lines.push(`    // TODO: implement ${op.operationId} webhook handler`)
      if (target === 'hono') {
        lines.push(`    return c.json({ received: true }, 200)`)
      } else {
        lines.push(`    return res.status(200).json({ received: true })`)
      }

      // catch block
      lines.push(`  } catch (err) {`)
      lines.push(`    const message = err instanceof Error ? err.message : String(err)`)
      if (target === 'hono') {
        lines.push(`    return c.json({ error: { code: 'INTERNAL_ERROR', message, details: [] } }, 500)`)
      } else {
        lines.push(`    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, details: [] } })`)
      }
      lines.push(`  }`)

      lines.push('})')
      lines.push('')
    }
  }

  // export
  if (target === 'hono') {
    lines.push('export default app')
  } else {
    lines.push('export default router')
  }

  return formatGeneratedTs(lines.join('\n'))
}


// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

/**
 * Determine the body-parsing expression based on the request content type(s).
 */
function buildBodyParseLine(
  target: RouterTarget,
  contentTypes: string[],
  typeName: string,
  typed: boolean,
  required: boolean,
): string {
  const primary = contentTypes[0] ?? 'application/json'

  if (target === 'hono') {
    if (primary === 'application/json') {
      if (!required) {
        return typed
          ? `  const body = c.req.raw.body === null ? undefined : await c.req.json<${typeName}Body>()`
          : `  const body = c.req.raw.body === null ? undefined : await c.req.json() // ${typeName}Body`
      }
      return typed
        ? `  const body = await c.req.json<${typeName}Body>()`
        : `  const body = await c.req.json() // ${typeName}Body`
    }
    if (primary === 'multipart/form-data') {
      if (!required) return `  const body = c.req.raw.body === null ? undefined : await c.req.formData() // ${typeName}Body`
      return `  const body = await c.req.formData() // ${typeName}Body`
    }
    if (primary === 'application/x-www-form-urlencoded') {
      if (!required) return `  const body = c.req.raw.body === null ? undefined : await c.req.parseBody() // ${typeName}Body`
      return `  const body = await c.req.parseBody() // ${typeName}Body`
    }
    if (!required) return `  const body = c.req.raw.body === null ? undefined : await c.req.text() // ${typeName}Body`
    return `  const body = await c.req.text() // ${typeName}Body`
  }

  // express — body is already parsed by middleware
  if (primary === 'multipart/form-data') {
    return `  const body = req.body${typed ? ` as ${typeName}Body${required ? '' : ' | undefined'}` : ''} // ${typeName}Body (use multer middleware)`
  }
  if (primary === 'application/x-www-form-urlencoded') {
    return `  const body = req.body${typed ? ` as ${typeName}Body${required ? '' : ' | undefined'}` : ''} // ${typeName}Body (use express.urlencoded() middleware)`
  }
  if (typed) {
    return `  const body = req.body as ${typeName}Body${required ? '' : ' | undefined'}`
  }
  return `  const body = req.body // ${typeName}Body`
}

const HONO_CONVENIENCE_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options'])
const EXPRESS_CONVENIENCE_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head'])

/**
 * Hono has convenience methods for common verbs only. OAS 3.2 also permits
 * HEAD, TRACE, and QUERY, so use the generic registration API for every verb
 * outside the known convenience surface.
 */
function renderHonoRouteRegistration(method: string, path: string): string {
  const normalized = method.toLowerCase()
  const quotedPath = quoteTypeScriptString(path)
  if (HONO_CONVENIENCE_METHODS.has(normalized)) {
    return `app.${normalized}(${quotedPath}, async (c) => {`
  }
  return `app.on(${quoteTypeScriptString(normalized.toUpperCase())}, ${quotedPath}, async (c) => {`
}

function renderExpressRouteRegistration(
  method: string,
  path: string,
): { source: string; requiresMethodGuard: boolean } {
  const normalized = method.toLowerCase()
  const quotedPath = quoteTypeScriptString(path)
  if (EXPRESS_CONVENIENCE_METHODS.has(normalized)) {
    return { source: `router.${normalized}(${quotedPath}, async (req, res) => {`, requiresMethodGuard: false }
  }
  // Express does not expose a method-specific API for every OAS 3.2 verb.
  // Register a valid all-method route but pass unrelated methods through so a
  // generated QUERY or TRACE stub does not accidentally handle GET/POST.
  return { source: `router.all(${quotedPath}, async (req, res, next) => {`, requiresMethodGuard: true }
}

function hasGeneratedResponseHeaders(responses: Record<string, OasResponse>): boolean {
  const codes = Object.keys(responses).filter(k => /^2\d{2}$/.test(k)).sort()
  const key = codes[0] ?? 'default'
  const response = responses[key]
  if (!response?.headers) return false
  return Object.values(response.headers).some(header => !('$ref' in header))
}

function hasGeneratedRequestBodyType(requestBody: OasRequestBody): boolean {
  const jsonContent = requestBody.content?.['application/json']
  return !!jsonContent && !('$ref' in jsonContent) && jsonContent.schema !== undefined
}

function hasGeneratedResponseType(responses: Record<string, OasResponse>): boolean {
  const codes = Object.keys(responses)
    .filter(k => /^2\d{2}$/.test(k))
    .sort()
  const key = codes[0] ?? 'default'
  const response = responses[key]
  if (!response?.content) return false
  const jsonContent = response.content['application/json']
  return !!jsonContent && !('$ref' in jsonContent) && jsonContent.schema !== undefined
}
