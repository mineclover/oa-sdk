/**
 * Hono target router generator.
 * Supports contract mode (createRouter(handlers: ApiHandlers)) when contractImport is provided,
 * while maintaining 100% byte-for-byte backward compatible legacy stubs when omitted.
 */

import type { ParsedDocument } from '@oa-sdk/parser/browser'
import { getQuerystringParameter } from '@oa-sdk/parser/browser'
import {
  createOperationNamesMap,
  createOperationTypeNameMap,
  toColonPath,
  toOperationMethodName,
  formatGeneratedTs,
  pickDefaultStatus,
  collectTypeNames,
  renderHonoRouteRegistration,
  hasGeneratedResponseHeaders,
  hasGeneratedRequestBodyType,
  hasGeneratedResponseType,
  escapeKey,
} from '../common/route-utils.js'
import { formatJSDoc } from '../common/jsdoc.js'
import { buildBodyParseLine } from '../common/body-parser.js'
import {
  hasRawQuerystringParameter,
  renderRawQuerystringHelper,
} from '../common/querystring-helper.js'
import { renderResponseHeaderHelpers } from '../common/response-headers.js'

export interface HonoTargetOptions {
  mode?: 'stub' | 'contract' | undefined
  typesImport?: string | undefined
  contractImport?: string | undefined
  contractName?: string | undefined
  banner?: boolean | undefined
  contextInjection?: boolean | undefined
  context?: boolean | undefined
  contextImport?: string | undefined
  contextTypeName?: string | undefined
}

export function renderHonoRouter(
  doc: ParsedDocument,
  options: HonoTargetOptions = {},
): string {
  const {
    mode = options.contractImport ? 'contract' : 'stub',
    typesImport,
    banner = true,
  } = options

  const isContractMode = mode === 'contract' || !!options.contractImport

  if (!isContractMode) {
    return renderLegacyHonoStub(doc, { typesImport, banner })
  }

  return renderContractHono(doc, options)
}

/**
 * Emits legacy standalone Hono router stubs with TODO comments.
 * 100% byte-for-byte compatible with existing tests.
 */
function renderLegacyHonoStub(
  doc: ParsedDocument,
  options: { typesImport?: string | undefined; banner?: boolean | undefined },
): string {
  const { typesImport, banner = true } = options
  const lines: string[] = []
  const operationNames = createOperationTypeNameMap([...doc.operations, ...doc.webhooks])

  if (banner) {
    lines.push('// Auto-generated router stub from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/router')
    lines.push('')
  }

  lines.push("import { Hono } from 'hono'")

  if (typesImport) {
    const typeNames = collectTypeNames([...doc.operations, ...doc.webhooks], operationNames)
    if (typeNames.length > 0) {
      lines.push(`import type { ${typeNames.join(', ')} } from '${typesImport}'`)
    }
  }
  lines.push('')

  const needsResponseHeaderHelper = !!typesImport && doc.operations.some(op => hasGeneratedResponseHeaders(op.responses))
  if (needsResponseHeaderHelper) {
    lines.push(renderResponseHeaderHelpers())
    lines.push('')
  }

  const needsRawQuerystringHelper = hasRawQuerystringParameter([...doc.operations, ...doc.webhooks])
  if (needsRawQuerystringHelper) {
    lines.push(renderRawQuerystringHelper())
    lines.push('')
  }

  lines.push('const app = new Hono()')
  lines.push('')

  for (const op of doc.operations) {
    if (!op.operationId) continue
    const baseName = operationNames.get(op.operationId)!
    const method = op.method
    const path = toColonPath(op.openApiPath)

    if (op.security.length > 0) {
      const schemeNames = [...new Set(op.security.flatMap(req => Object.keys(req)))]
      lines.push(`// Requires: ${schemeNames.join(', ')}`)
    }

    if (op.summary || op.description) {
      lines.push(...formatJSDoc(op.summary ?? op.description).split('\n'))
    }

    lines.push(renderHonoRouteRegistration(method, path))
    lines.push(`  try {`)

    const pathParams = op.parameters.filter(p => p.in === 'path')
    if (pathParams.length > 0 && typesImport) {
      lines.push(`    const params = c.req.param() as unknown as ${baseName}PathParams`)
    }

    const queryParams = op.parameters.filter(p => p.in === 'query')
    if (queryParams.length > 0 && typesImport) {
      lines.push(`    const query = c.req.query() as unknown as ${baseName}QueryParams`)
    }

    const querystringParam = getQuerystringParameter(op.parameters)
    if (querystringParam) {
      const type = typesImport ? `${baseName}QueryString` : 'string'
      lines.push(`    const querystring = __readOaRawQuerystring(c.req.raw.url) as ${type} | undefined // raw serialized query string; no leading '?'`)
    }

    if (op.requestBody) {
      const contentTypes = op.requestBody.content ? Object.keys(op.requestBody.content) : []
      const bodyParseLine = buildBodyParseLine(
        'hono',
        contentTypes,
        baseName,
        !!typesImport && hasGeneratedRequestBodyType(op.requestBody),
        op.requestBody.required === true,
      )
      lines.push(`  ${bodyParseLine}`)
    }

    const status = pickDefaultStatus(op.responses)
    const hasTypedResponseHeaders = !!typesImport && hasGeneratedResponseHeaders(op.responses)
    const hasTypedResponseBody = !!typesImport && hasGeneratedResponseType(op.responses)
    lines.push(`    // TODO: implement ${op.operationId}`)
    if (hasTypedResponseHeaders) {
      lines.push(`    // Add documented response headers here.`)
      lines.push(`    const responseHeaders: Partial<${baseName}ResponseHeaders> = {}`)
      lines.push(`    __setOaResponseHeaders<${baseName}ResponseHeaders>((name, value) => c.header(name, value), responseHeaders)`)
    }
    if (status === 204) {
      lines.push(`    return c.body(null, 204)`)
    } else if (hasTypedResponseBody) {
      lines.push(`    return c.json({} as ${baseName}Response, ${status})`)
    } else {
      lines.push(`    return c.json({} as any, ${status}) // ${baseName}Response (headers: ${baseName}ResponseHeaders)`)
    }

    lines.push(`  } catch (err) {`)
    lines.push(`    const message = err instanceof Error ? err.message : String(err)`)
    lines.push(`    return c.json({ error: { code: 'INTERNAL_ERROR', message, details: [] } }, 500)`)
    lines.push(`  }`)

    lines.push('})')
    lines.push('')
  }

  if (doc.webhooks.length > 0) {
    lines.push('// ─── Webhooks ─────────────────────────────────────────────────')
    lines.push('')
    for (const op of doc.webhooks) {
      if (!op.operationId) continue
      const baseName = operationNames.get(op.operationId)!
      const method = op.method
      const path = toColonPath(op.openApiPath)

      lines.push(`// ${method.toUpperCase()} ${op.openApiPath} — incoming webhook`)

      if (op.summary || op.description) {
        lines.push(...formatJSDoc(op.summary ?? op.description).split('\n'))
      }

      lines.push(renderHonoRouteRegistration(method, path))
      lines.push(`  try {`)

      const querystringParam = getQuerystringParameter(op.parameters)
      if (querystringParam) {
        const type = typesImport ? `${baseName}QueryString` : 'string'
        lines.push(`    const querystring = __readOaRawQuerystring(c.req.raw.url) as ${type} | undefined // raw serialized query string; no leading '?'`)
      }

      if (op.requestBody) {
        const contentTypes = op.requestBody.content ? Object.keys(op.requestBody.content) : []
        const bodyParseLine = buildBodyParseLine('hono', contentTypes, baseName, !!typesImport, op.requestBody.required === true)
        lines.push(`  ${bodyParseLine}`)
      }

      lines.push(`    // TODO: implement ${op.operationId} webhook handler`)
      lines.push(`    return c.json({ received: true }, 200)`)

      lines.push(`  } catch (err) {`)
      lines.push(`    const message = err instanceof Error ? err.message : String(err)`)
      lines.push(`    return c.json({ error: { code: 'INTERNAL_ERROR', message, details: [] } }, 500)`)
      lines.push(`  }`)

      lines.push('})')
      lines.push('')
    }
  }

  lines.push('export default app')

  return formatGeneratedTs(lines.join('\n'))
}

/**
 * Emits contract-bound Hono router factory (createRouter(handlers: ApiHandlers)).
 */
function renderContractHono(
  doc: ParsedDocument,
  options: HonoTargetOptions,
): string {
  const {
    typesImport,
    contractImport,
    contractName = 'ApiHandlers',
    banner = true,
    contextInjection,
    context: contextOption,
    contextImport,
    contextTypeName,
  } = options

  const hasContextInjection = Boolean(
    contextInjection ||
    contextOption ||
    contextImport ||
    contextTypeName,
  )
  const lines: string[] = []
  const opNameMap = createOperationNamesMap([...doc.operations, ...doc.webhooks])
  const operationNames = createOperationTypeNameMap([...doc.operations, ...doc.webhooks])

  if (banner) {
    lines.push('// Auto-generated router from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/router')
    lines.push('')
  }

  if (hasContextInjection) {
    lines.push("import { Hono, type Context } from 'hono'")
  } else {
    lines.push("import { Hono } from 'hono'")
  }

  if (contractImport) {
    lines.push(`import type { ${contractName} } from '${contractImport}'`)
  }

  if (hasContextInjection && contextImport) {
    const typeName = contextTypeName || 'AppContext'
    lines.push(`import type { ${typeName} } from '${contextImport}'`)
  }

  if (typesImport) {
    const typeNames = collectTypeNames([...doc.operations, ...doc.webhooks], operationNames)
    if (typeNames.length > 0) {
      lines.push(`import type { ${typeNames.join(', ')} } from '${typesImport}'`)
    }
  }
  lines.push('')

  const needsRawQuerystringHelper = hasRawQuerystringParameter([...doc.operations, ...doc.webhooks])
  if (needsRawQuerystringHelper) {
    lines.push(renderRawQuerystringHelper())
    lines.push('')
  }

  if (hasContextInjection) {
    const contextTypeDefault = contextTypeName || (contextImport ? 'AppContext' : 'unknown')
    lines.push(`export interface HonoRouterOptions<TContext = ${contextTypeDefault}> {`)
    lines.push(`  getContext?: (c: Context) => Promise<TContext> | TContext`)
    lines.push(`  context?: TContext`)
    lines.push(`}`)
    lines.push('')
    lines.push(`export function createRouter<TContext = ${contextTypeDefault}>(`)
    lines.push(`  handlers: ${contractName}<TContext>,`)
    lines.push(`  options?: HonoRouterOptions<TContext>,`)
    lines.push(`): Hono {`)
    lines.push('  const { getContext, context: staticContext } = options ?? {}')
    lines.push('  const app = new Hono()')
    if (doc.operations.length === 0 && doc.webhooks.length === 0) {
      lines.push('  void handlers')
      lines.push('  void getContext')
      lines.push('  void staticContext')
    }
  } else {
    lines.push(`export function createRouter(handlers: ${contractName}): Hono {`)
    lines.push('  const app = new Hono()')
    if (doc.operations.length === 0 && doc.webhooks.length === 0) {
      lines.push('  void handlers')
    }
  }
  lines.push('')

  for (const op of doc.operations) {
    const { baseName, methodName } = opNameMap.get(op)!
    const method = op.method
    const path = toColonPath(op.openApiPath)

    if (op.security.length > 0) {
      const schemeNames = [...new Set(op.security.flatMap(req => Object.keys(req)))]
      lines.push(`  // Requires: ${schemeNames.join(', ')}`)
    }

    if (op.summary || op.description) {
      lines.push(formatJSDoc(op.summary ?? op.description, '  '))
    }

    lines.push(`  ${renderHonoRouteRegistration(method, path)}`)
    lines.push(`    try {`)

    const pathParams = op.parameters.filter(p => p.in === 'path')
    const queryParams = op.parameters.filter(p => p.in === 'query')
    const querystringParam = getQuerystringParameter(op.parameters)
    const headerParams = op.parameters.filter(p => p.in === 'header')

    if (querystringParam) {
      const type = typesImport ? `${baseName}QueryString` : 'string'
      lines.push(`      const querystring = __readOaRawQuerystring(c.req.raw.url) as ${type} | undefined`)
    }

    if (op.requestBody) {
      const contentTypes = op.requestBody.content ? Object.keys(op.requestBody.content) : []
      const primary = contentTypes[0] ?? 'application/json'
      if (primary === 'application/json') {
        lines.push(`      const body = c.req.raw.body === null ? undefined : await c.req.json()`)
      } else if (primary === 'multipart/form-data') {
        lines.push(`      const body = c.req.raw.body === null ? undefined : await c.req.formData()`)
      } else if (primary === 'application/x-www-form-urlencoded') {
        lines.push(`      const body = c.req.raw.body === null ? undefined : await c.req.parseBody()`)
      } else {
        lines.push(`      const body = c.req.raw.body === null ? undefined : await c.req.text()`)
      }
    }

    const status = pickDefaultStatus(op.responses)

    if (hasContextInjection) {
      lines.push(`      const context = getContext ? await getContext(c) : staticContext`)
      const contextArgs: string[] = []
      if (pathParams.length > 0) contextArgs.push('params: c.req.param() as any')
      if (queryParams.length > 0) contextArgs.push('query: c.req.query() as any')
      if (querystringParam) contextArgs.push('querystring')
      if (headerParams.length > 0) contextArgs.push('headers: c.req.header() as any')
      if (op.requestBody) contextArgs.push('body: body as any')
      contextArgs.push('...(context !== undefined ? { context } : {})')

      const argString = `{ ${contextArgs.join(', ')} }`
      lines.push(`      const result = await handlers.${methodName}(${argString})`)
    } else {
      const contextArgs: string[] = []
      if (pathParams.length > 0) contextArgs.push('params: c.req.param() as any')
      if (queryParams.length > 0) contextArgs.push('query: c.req.query() as any')
      if (querystringParam) contextArgs.push('querystring')
      if (headerParams.length > 0) contextArgs.push('headers: c.req.header() as any')
      if (op.requestBody) contextArgs.push('body: body as any')

      const argString = contextArgs.length === 0 ? '' : `{ ${contextArgs.join(', ')} }`
      lines.push(`      const result = await handlers.${methodName}(${argString})`)
    }
    lines.push(`      if (result !== undefined && result !== null && typeof result === 'object' && ('status' in result || 'headers' in result || 'body' in result)) {`)
    lines.push(`        const resp = result as { status?: number; headers?: Record<string, string>; body?: unknown }`)
    lines.push(`        if (resp.headers) {`)
    lines.push(`          for (const [name, value] of Object.entries(resp.headers)) {`)
    lines.push(`            c.header(name, value)`)
    lines.push(`          }`)
    lines.push(`        }`)
    lines.push(`        if (resp.status === 204) return c.body(null, 204)`)
    lines.push(`        return c.json(resp.body, (resp.status ?? ${status}) as any)`)
    lines.push(`      }`)
    if (status === 204) {
      lines.push(`      return c.body(null, 204)`)
    } else {
      lines.push(`      return c.json(result, ${status} as any)`)
    }

    lines.push(`    } catch (err) {`)
    lines.push(`      const message = err instanceof Error ? err.message : String(err)`)
    lines.push(`      return c.json({ error: { code: 'INTERNAL_ERROR', message, details: [] } }, 500)`)
    lines.push(`    }`)
    lines.push(`  })`)
    lines.push('')
  }

  // Webhooks
  if (doc.webhooks.length > 0) {
    lines.push('  // ─── Webhooks ─────────────────────────────────────────────────')
    lines.push('')

    for (const op of doc.webhooks) {
      const { baseName, methodName } = opNameMap.get(op)!
      const method = op.method
      const path = toColonPath(op.openApiPath)

      if (op.summary || op.description) {
        lines.push(formatJSDoc(op.summary ?? op.description, '  '))
      }

      lines.push(`  if (handlers.${methodName}) {`)
      lines.push(`    const handler = handlers.${methodName}`)
      lines.push(`    ${renderHonoRouteRegistration(method, path)}`)
      lines.push(`      try {`)

      const querystringParam = getQuerystringParameter(op.parameters)
      if (querystringParam) {
        lines.push(`        const querystring = __readOaRawQuerystring(c.req.raw.url)`)
      }

      if (op.requestBody) {
        lines.push(`        const body = c.req.raw.body === null ? undefined : await c.req.json()`)
      }

      const pathParams = op.parameters.filter(p => p.in === 'path')
      const queryParams = op.parameters.filter(p => p.in === 'query')
      const headerParams = op.parameters.filter(p => p.in === 'header')

      if (hasContextInjection) {
        lines.push(`        const context = getContext ? await getContext(c) : staticContext`)
        const webhookArgs: string[] = []
        if (pathParams.length > 0) webhookArgs.push(`params: c.req.param() as any`)
        if (queryParams.length > 0) webhookArgs.push(`query: c.req.query() as any`)
        if (querystringParam) webhookArgs.push(`querystring`)
        if (headerParams.length > 0) webhookArgs.push(`headers: c.req.header() as any`)
        if (op.requestBody) webhookArgs.push(`body: body as any`)
        webhookArgs.push(`...(context !== undefined ? { context } : {})`)
        const argString = `{ ${webhookArgs.join(', ')} }`

        lines.push(`        const result = await handler(${argString})`)
      } else {
        const webhookArgs: string[] = []
        if (pathParams.length > 0) webhookArgs.push(`params: c.req.param() as any`)
        if (queryParams.length > 0) webhookArgs.push(`query: c.req.query() as any`)
        if (querystringParam) webhookArgs.push(`querystring`)
        if (headerParams.length > 0) webhookArgs.push(`headers: c.req.header() as any`)
        if (op.requestBody) webhookArgs.push(`body: body as any`)
        const argString = webhookArgs.length === 0 ? '' : `{ ${webhookArgs.join(', ')} }`

        lines.push(`        const result = await handler(${argString})`)
      }
      lines.push(`        return c.json(result ?? { received: true }, 200)`)
      lines.push(`      } catch (err) {`)
      lines.push(`        const message = err instanceof Error ? err.message : String(err)`)
      lines.push(`        return c.json({ error: { code: 'INTERNAL_ERROR', message, details: [] } }, 500)`)
      lines.push(`      }`)
      lines.push(`    })`)
      lines.push(`  }`)
      lines.push('')
    }
  }

  lines.push('  return app')
  lines.push('}')
  lines.push('')
  lines.push('export default createRouter')

  return formatGeneratedTs(lines.join('\n'))
}
