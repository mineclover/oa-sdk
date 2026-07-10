/**
 * OAS ParsedDocument → 서버 라우터 스텁 코드 생성
 *
 * 지원 프레임워크: Hono (기본), Express 호환 가능.
 * typegen 타입을 import하여 타입 안전 라우터를 생성합니다.
 */

import type { OasDocument, OasRequestBody, OasResponse, ParsedDocument } from '@oa-sdk/parser'
import { assertParsedDocumentComplete, isParsedDocument, parseDocument } from '@oa-sdk/parser'
import { toColonPath, pascalCase, collectTypeNames, formatGeneratedTs, pickDefaultStatus } from '@oa-sdk/core'

export type RouterTarget = 'hono' | 'express'

export type RouterOptions = {
  /** 라우터 프레임워크 (기본: hono) */
  target?: RouterTarget
  /** typegen 타입 import 경로 (예: './types') */
  typesImport?: string
  /** OAS 파일 경로. 상대 외부 $ref 해소에 사용 */
  basePath?: string
  /** 헤더 주석 */
  banner?: boolean
}

/**
 * OAS 원본 문서 또는 ParsedDocument IR에서 서버 라우터 스텁을 생성합니다.
 */
export function generateRouter(spec: OasDocument | ParsedDocument, options: RouterOptions = {}): string {
  const doc = isParsedDocument(spec)
    ? spec
    : options.basePath !== undefined
      ? parseDocument(spec, { basePath: options.basePath })
      : parseDocument(spec)
  assertParsedDocumentComplete(doc, '@oa-sdk/router generateRouter')
  const { target = 'hono', typesImport, banner = true } = options
  const lines: string[] = []

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
    const typeNames = collectTypeNames([...doc.operations, ...doc.webhooks])
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
    const baseName = pascalCase(op.operationId)
    const method = op.method
    const path = target === 'hono' ? toColonPath(op.openApiPath) : toColonPath(op.openApiPath)

    // security hint
    if (op.security.length > 0) {
      const schemeNames = [...new Set(op.security.flatMap(req => Object.keys(req)))]
      lines.push(`// Requires: ${schemeNames.join(', ')}`)
    }

    // JSDoc
    if (op.summary || op.description) {
      lines.push(`/** ${op.summary ?? op.description} */`)
    }

    if (target === 'hono') {
      lines.push(`app.${method}('${path}', async (c) => {`)
      lines.push(`  try {`)
    } else {
      lines.push(`router.${method}('${path}', async (req, res) => {`)
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

    // request body
    if (op.requestBody) {
      const contentTypes = op.requestBody.content ? Object.keys(op.requestBody.content) : []
      const bodyParseLine = buildBodyParseLine(target, contentTypes, baseName, !!typesImport && hasGeneratedRequestBodyType(op.requestBody))
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
      const baseName = pascalCase(op.operationId)
      const method = op.method
      const path = target === 'hono' ? toColonPath(op.openApiPath) : toColonPath(op.openApiPath)

      lines.push(`// ${method.toUpperCase()} ${op.openApiPath} — incoming webhook`)

      // JSDoc
      if (op.summary || op.description) {
        lines.push(`/** ${op.summary ?? op.description} */`)
      }

      if (target === 'hono') {
        lines.push(`app.${method}('${path}', async (c) => {`)
        lines.push(`  try {`)
      } else {
        lines.push(`router.${method}('${path}', async (req, res) => {`)
        lines.push(`  try {`)
      }

      // request body
      if (op.requestBody) {
        const contentTypes = op.requestBody.content ? Object.keys(op.requestBody.content) : []
        const bodyParseLine = buildBodyParseLine(target, contentTypes, baseName, !!typesImport)
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
function buildBodyParseLine(target: RouterTarget, contentTypes: string[], typeName: string, typed: boolean): string {
  const primary = contentTypes[0] ?? 'application/json'

  if (target === 'hono') {
    if (primary === 'application/json') {
      return typed
        ? `  const body = await c.req.json<${typeName}Body>()`
        : `  const body = await c.req.json() // ${typeName}Body`
    }
    if (primary === 'multipart/form-data') {
      return `  const body = await c.req.formData() // ${typeName}Body`
    }
    if (primary === 'application/x-www-form-urlencoded') {
      return `  const body = await c.req.parseBody() // ${typeName}Body`
    }
    return `  const body = await c.req.text() // ${typeName}Body`
  }

  // express — body is already parsed by middleware
  if (primary === 'multipart/form-data') {
    return `  const body = req.body // ${typeName}Body (use multer middleware)`
  }
  if (primary === 'application/x-www-form-urlencoded') {
    return `  const body = req.body // ${typeName}Body (use express.urlencoded() middleware)`
  }
  if (typed) {
    return `  const body = req.body as ${typeName}Body`
  }
  return `  const body = req.body // ${typeName}Body`
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
