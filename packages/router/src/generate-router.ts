/**
 * OAS ParsedDocument → 서버 라우터 스텁 코드 생성
 *
 * 지원 프레임워크: Hono (기본), Express 호환 가능.
 * typegen 타입을 import하여 타입 안전 라우터를 생성합니다.
 */

import type { OasDocument, ParsedDocument } from '@oa-sdk/parser'
import { parseDocument, DEFAULT_PASSES } from '@oa-sdk/parser'
import { toColonPath, pascalCase, collectTypeNames, formatGeneratedTs, pickDefaultStatus } from '@oa-sdk/core'

export type RouterTarget = 'hono' | 'express'

export type RouterOptions = {
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
export function generateRouter(spec: OasDocument | ParsedDocument, options: RouterOptions = {}): string {
  const doc: ParsedDocument = 'openapi' in spec ? parseDocument(spec as OasDocument, DEFAULT_PASSES) : spec
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
      const bodyParseLine = buildBodyParseLine(target, contentTypes, baseName, !!typesImport)
      lines.push(`  ${bodyParseLine}`)
    }

    // response stub
    const status = pickDefaultStatus(op.responses)
    lines.push(`    // TODO: implement ${op.operationId}`)
    if (target === 'hono') {
      if (status === 204) {
        lines.push(`    return c.body(null, 204)`)
      } else if (typesImport) {
        lines.push(`    return c.json({} as ${baseName}Response, ${status})`)
      } else {
        lines.push(`    return c.json({} as any, ${status}) // ${baseName}Response (headers: ${baseName}ResponseHeaders)`)
      }
    } else {
      if (status === 204) {
        lines.push(`    return res.status(204).end()`)
      } else if (typesImport) {
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

