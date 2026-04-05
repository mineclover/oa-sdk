/**
 * OAS ParsedDocument → 서버 라우터 스텁 코드 생성
 *
 * 지원 프레임워크: Hono (기본), Express 호환 가능.
 * typegen 타입을 import하여 타입 안전 라우터를 생성합니다.
 */

import type { OasDocument, ParsedDocument } from '@oa-sdk/parser'
import { parseDocument } from '@oa-sdk/parser'
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
  const doc: ParsedDocument = 'openapi' in spec ? parseDocument(spec as OasDocument, []) : spec
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
    const typeNames = collectTypeNames(doc.operations)
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

    // JSDoc
    if (op.summary || op.description) {
      lines.push(`/** ${op.summary ?? op.description} */`)
    }

    if (target === 'hono') {
      lines.push(`app.${method}('${path}', async (c) => {`)
    } else {
      lines.push(`router.${method}('${path}', async (req, res) => {`)
    }

    // path params
    const pathParams = op.parameters.filter(p => p.in === 'path')
    if (pathParams.length > 0 && typesImport) {
      if (target === 'hono') {
        lines.push(`  const params = c.req.param() // ${baseName}PathParams`)
      } else {
        lines.push(`  const params = req.params // ${baseName}PathParams`)
      }
    }

    // query params
    const queryParams = op.parameters.filter(p => p.in === 'query')
    if (queryParams.length > 0 && typesImport) {
      if (target === 'hono') {
        lines.push(`  const query = c.req.query() // ${baseName}QueryParams`)
      } else {
        lines.push(`  const query = req.query // ${baseName}QueryParams`)
      }
    }

    // request body
    if (op.requestBody) {
      if (target === 'hono') {
        lines.push(`  const body = await c.req.json() // ${baseName}Body`)
      } else {
        lines.push(`  const body = req.body // ${baseName}Body`)
      }
    }

    // response stub
    const status = pickDefaultStatus(op.responses)
    lines.push(`  // TODO: implement ${op.operationId}`)
    if (target === 'hono') {
      if (status === 204) {
        lines.push(`  return c.body(null, 204)`)
      } else {
        lines.push(`  return c.json({} as any, ${status}) // ${baseName}Response (headers: ${baseName}ResponseHeaders)`)
      }
    } else {
      if (status === 204) {
        lines.push(`  return res.status(204).end()`)
      } else {
        lines.push(`  return res.status(${status}).json({}) // ${baseName}Response`)
      }
    }

    lines.push('})')
    lines.push('')
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

