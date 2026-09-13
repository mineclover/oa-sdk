/**
 * Express target router generator.
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
  quoteTypeScriptString,
  collectTypeNames,
  renderExpressRouteRegistration,
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

export interface ExpressTargetOptions {
  mode?: 'stub' | 'contract' | undefined
  typesImport?: string | undefined
  contractImport?: string | undefined
  contractName?: string | undefined
  contextInjection?: boolean | undefined
  context?: boolean | undefined
  contextImport?: string | undefined
  contextTypeName?: string | undefined
  banner?: boolean | undefined
}

export function renderExpressRouter(
  doc: ParsedDocument,
  options: ExpressTargetOptions = {},
): string {
  const {
    mode = options.contractImport ? 'contract' : 'stub',
    typesImport,
    contractImport,
    contractName = 'ApiHandlers',
    contextInjection,
    context,
    contextImport: ctxImport,
    contextTypeName,
    banner = true,
  } = options

  const isContractMode = mode === 'contract' || !!contractImport

  if (!isContractMode) {
    return renderLegacyExpressStub(doc, { typesImport, banner })
  }

  return renderContractExpress(doc, {
    typesImport,
    contractImport,
    contractName,
    contextInjection,
    context,
    contextImport: ctxImport,
    contextTypeName,
    banner,
  })
}

/**
 * Emits legacy standalone Express router stubs with TODO comments.
 * 100% byte-for-byte compatible with existing tests.
 */
function renderLegacyExpressStub(
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

  lines.push("import { Router } from 'express'")

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

  lines.push('const router = Router()')
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

    const registration = renderExpressRouteRegistration(method, path)
    lines.push(registration.source)
    if (registration.requiresMethodGuard) {
      lines.push(`  if (req.method !== ${quoteTypeScriptString(method.toUpperCase())}) return next()`)
    }
    lines.push(`  try {`)

    const pathParams = op.parameters.filter(p => p.in === 'path')
    if (pathParams.length > 0 && typesImport) {
      lines.push(`    const params = req.params as unknown as ${baseName}PathParams`)
    }

    const queryParams = op.parameters.filter(p => p.in === 'query')
    if (queryParams.length > 0 && typesImport) {
      lines.push(`    const query = req.query as unknown as ${baseName}QueryParams`)
    }

    const querystringParam = getQuerystringParameter(op.parameters)
    if (querystringParam) {
      const type = typesImport ? `${baseName}QueryString` : 'string'
      lines.push(`    const querystring = __readOaRawQuerystring(req.originalUrl ?? req.url) as ${type} | undefined // raw serialized query string; no leading '?'`)
    }

    if (op.requestBody) {
      const contentTypes = op.requestBody.content ? Object.keys(op.requestBody.content) : []
      const bodyParseLine = buildBodyParseLine(
        'express',
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
      lines.push(`    __setOaResponseHeaders<${baseName}ResponseHeaders>((name, value) => res.setHeader(name, value), responseHeaders)`)
    }
    if (status === 204) {
      lines.push(`    return res.status(204).end()`)
    } else if (hasTypedResponseBody) {
      lines.push(`    return res.status(${status}).json({} as ${baseName}Response)`)
    } else {
      lines.push(`    return res.status(${status}).json({}) // ${baseName}Response`)
    }

    lines.push(`  } catch (err) {`)
    lines.push(`    const message = err instanceof Error ? err.message : String(err)`)
    lines.push(`    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, details: [] } })`)
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

      const registration = renderExpressRouteRegistration(method, path)
      lines.push(registration.source)
      if (registration.requiresMethodGuard) {
        lines.push(`  if (req.method !== ${quoteTypeScriptString(method.toUpperCase())}) return next()`)
      }
      lines.push(`  try {`)

      const querystringParam = getQuerystringParameter(op.parameters)
      if (querystringParam) {
        const type = typesImport ? `${baseName}QueryString` : 'string'
        lines.push(`    const querystring = __readOaRawQuerystring(req.originalUrl ?? req.url) as ${type} | undefined // raw serialized query string; no leading '?'`)
      }

      if (op.requestBody) {
        const contentTypes = op.requestBody.content ? Object.keys(op.requestBody.content) : []
        const bodyParseLine = buildBodyParseLine('express', contentTypes, baseName, !!typesImport, op.requestBody.required === true)
        lines.push(`  ${bodyParseLine}`)
      }

      lines.push(`    // TODO: implement ${op.operationId} webhook handler`)
      lines.push(`    return res.status(200).json({ received: true })`)

      lines.push(`  } catch (err) {`)
      lines.push(`    const message = err instanceof Error ? err.message : String(err)`)
      lines.push(`    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, details: [] } })`)
      lines.push(`  }`)

      lines.push('})')
      lines.push('')
    }
  }

  lines.push('export default router')

  return formatGeneratedTs(lines.join('\n'))
}

/**
 * Emits contract-bound Express router factory (createRouter(handlers: ApiHandlers)).
 */
function renderContractExpress(
  doc: ParsedDocument,
  options: {
    typesImport?: string | undefined
    contractImport?: string | undefined
    contractName?: string | undefined
    contextInjection?: boolean | undefined
    context?: boolean | undefined
    contextImport?: string | undefined
    contextTypeName?: string | undefined
    banner?: boolean | undefined
  },
): string {
  const {
    typesImport,
    contractImport,
    contractName = 'ApiHandlers',
    contextInjection,
    context,
    contextImport: ctxImport,
    contextTypeName,
    banner = true,
  } = options
  const lines: string[] = []
  const opNameMap = createOperationNamesMap([...doc.operations, ...doc.webhooks])
  const operationNames = createOperationTypeNameMap([...doc.operations, ...doc.webhooks])
  const hasContextInjection = Boolean(
    contextInjection ||
    context ||
    ctxImport ||
    contextTypeName,
  )

  if (banner) {
    lines.push('// Auto-generated router from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/router')
    lines.push('')
  }

  lines.push("import { Router } from 'express'")
  if (hasContextInjection) {
    lines.push("import type { Request } from 'express'")
  }
  if (contractImport) {
    lines.push(`import type { ${contractName} } from '${contractImport}'`)
  }
  if (hasContextInjection && ctxImport) {
    const typeName = contextTypeName || 'AppContext'
    lines.push(`import type { ${typeName} } from '${ctxImport}'`)
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
    const contextTypeDefault = contextTypeName || (ctxImport ? 'AppContext' : 'unknown')
    lines.push(`export interface ExpressRouterOptions<TContext = ${contextTypeDefault}> {`)
    lines.push(`  getContext?: (req: Request) => Promise<TContext> | TContext`)
    lines.push(`  context?: TContext`)
    lines.push(`}`)
    lines.push('')
    lines.push(`export function createRouter<TContext = ${contextTypeDefault}>(`)
    lines.push(`  handlers: ${contractName}<TContext>,`)
    lines.push(`  options?: ExpressRouterOptions<TContext>,`)
    lines.push(`): Router {`)
    lines.push('  const { getContext, context: staticContext } = options ?? {}')
    lines.push('  const router = Router()')
    if (doc.operations.length === 0 && doc.webhooks.length === 0) {
      lines.push('  void handlers')
      lines.push('  void getContext')
      lines.push('  void staticContext')
    }
  } else {
    lines.push(`export function createRouter(handlers: ${contractName}): Router {`)
    lines.push('  const router = Router()')
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

    const registration = renderExpressRouteRegistration(method, path)
    lines.push(`  ${registration.source}`)
    if (registration.requiresMethodGuard) {
      lines.push(`    if (req.method !== ${quoteTypeScriptString(method.toUpperCase())}) return next()`)
    }
    lines.push(`    try {`)

    const pathParams = op.parameters.filter(p => p.in === 'path')
    const queryParams = op.parameters.filter(p => p.in === 'query')
    const querystringParam = getQuerystringParameter(op.parameters)
    const headerParams = op.parameters.filter(p => p.in === 'header')

    const needsReq = hasContextInjection || registration.requiresMethodGuard || pathParams.length > 0 || queryParams.length > 0 || !!querystringParam || headerParams.length > 0 || !!op.requestBody
    if (!needsReq) {
      lines.push(`      void req`)
    }

    if (querystringParam) {
      const type = typesImport ? `${baseName}QueryString` : 'string'
      lines.push(`      const querystring = __readOaRawQuerystring(req.originalUrl ?? req.url) as ${type} | undefined`)
    }

    if (hasContextInjection) {
      lines.push(`      const context = getContext ? await getContext(req) : staticContext`)
      const contextArgs: string[] = []
      if (pathParams.length > 0) contextArgs.push('params: req.params as any')
      if (queryParams.length > 0) contextArgs.push('query: req.query as any')
      if (querystringParam) contextArgs.push('querystring')
      if (headerParams.length > 0) contextArgs.push('headers: req.headers as any')
      if (op.requestBody) contextArgs.push('body: req.body as any')
      contextArgs.push('...(context !== undefined ? { context } : {})')

      const argString = `{ ${contextArgs.join(', ')} }`
      const status = pickDefaultStatus(op.responses)

      lines.push(`      const result = await handlers.${methodName}(${argString})`)
      lines.push(`      if (result !== undefined && result !== null && typeof result === 'object' && 'body' in result && ((result as any).status === undefined || typeof (result as any).status === 'number') && ((result as any).headers === undefined || typeof (result as any).headers === 'object')) {`)
      lines.push(`        const resp = result as { status?: number; headers?: Record<string, string>; body?: unknown }`)
      lines.push(`        if (resp.headers) {`)
      lines.push(`          for (const [name, value] of Object.entries(resp.headers)) {`)
      lines.push(`            res.setHeader(name, value)`)
      lines.push(`          }`)
      lines.push(`        }`)
      lines.push(`        if (resp.status === 204) return res.status(204).end()`)
      lines.push(`        return res.status(resp.status ?? ${status}).json(resp.body)`)
      lines.push(`      }`)
      if (status === 204) {
        lines.push(`      return res.status(204).end()`)
      } else {
        lines.push(`      return res.status(${status}).json(result)`)
      }
    } else {
      const contextArgs: string[] = []
      if (pathParams.length > 0) contextArgs.push('params: req.params as any')
      if (queryParams.length > 0) contextArgs.push('query: req.query as any')
      if (querystringParam) contextArgs.push('querystring')
      if (headerParams.length > 0) contextArgs.push('headers: req.headers as any')
      if (op.requestBody) contextArgs.push('body: req.body as any')

      const argString = contextArgs.length === 0 ? '' : `{ ${contextArgs.join(', ')} }`
      const status = pickDefaultStatus(op.responses)

      lines.push(`      const result = await handlers.${methodName}(${argString})`)
      lines.push(`      if (result !== undefined && result !== null && typeof result === 'object' && 'body' in result && ((result as any).status === undefined || typeof (result as any).status === 'number') && ((result as any).headers === undefined || typeof (result as any).headers === 'object')) {`)
      lines.push(`        const resp = result as { status?: number; headers?: Record<string, string>; body?: unknown }`)
      lines.push(`        if (resp.headers) {`)
      lines.push(`          for (const [name, value] of Object.entries(resp.headers)) {`)
      lines.push(`            res.setHeader(name, value)`)
      lines.push(`          }`)
      lines.push(`        }`)
      lines.push(`        if (resp.status === 204) return res.status(204).end()`)
      lines.push(`        return res.status(resp.status ?? ${status}).json(resp.body)`)
      lines.push(`      }`)
      if (status === 204) {
        lines.push(`      return res.status(204).end()`)
      } else {
        lines.push(`      return res.status(${status}).json(result)`)
      }
    }

    lines.push(`    } catch (err) {`)
    lines.push(`      const message = err instanceof Error ? err.message : String(err)`)
    lines.push(`      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, details: [] } })`)
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
      const registration = renderExpressRouteRegistration(method, path)
      lines.push(`    ${registration.source}`)
      if (registration.requiresMethodGuard) {
        lines.push(`      if (req.method !== ${quoteTypeScriptString(method.toUpperCase())}) return next()`)
      }
      lines.push(`      try {`)

      if (hasContextInjection) {
        lines.push(`        const context = getContext ? await getContext(req) : staticContext`)
        const querystringParam = getQuerystringParameter(op.parameters)
        if (querystringParam) {
          lines.push(`        const querystring = __readOaRawQuerystring(req.originalUrl ?? req.url)`)
        }

        const pathParams = op.parameters.filter(p => p.in === 'path')
        const queryParams = op.parameters.filter(p => p.in === 'query')
        const headerParams = op.parameters.filter(p => p.in === 'header')

        const webhookArgs: string[] = []
        if (pathParams.length > 0) webhookArgs.push(`params: req.params as any`)
        if (queryParams.length > 0) webhookArgs.push(`query: req.query as any`)
        if (querystringParam) webhookArgs.push(`querystring`)
        if (headerParams.length > 0) webhookArgs.push(`headers: req.headers as any`)
        if (op.requestBody) webhookArgs.push(`body: req.body as any`)
        webhookArgs.push(`...(context !== undefined ? { context } : {})`)
        const argString = `{ ${webhookArgs.join(', ')} }`

        lines.push(`        const result = await handler(${argString})`)
        lines.push(`        return res.status(200).json(result ?? { received: true })`)
      } else {
        const querystringParam = getQuerystringParameter(op.parameters)
        if (querystringParam) {
          lines.push(`        const querystring = __readOaRawQuerystring(req.originalUrl ?? req.url)`)
        }

        const pathParams = op.parameters.filter(p => p.in === 'path')
        const queryParams = op.parameters.filter(p => p.in === 'query')
        const headerParams = op.parameters.filter(p => p.in === 'header')

        const webhookArgs: string[] = []
        if (pathParams.length > 0) webhookArgs.push(`params: req.params as any`)
        if (queryParams.length > 0) webhookArgs.push(`query: req.query as any`)
        if (querystringParam) webhookArgs.push(`querystring`)
        if (headerParams.length > 0) webhookArgs.push(`headers: req.headers as any`)
        if (op.requestBody) webhookArgs.push(`body: req.body as any`)
        const argString = webhookArgs.length === 0 ? '' : `{ ${webhookArgs.join(', ')} }`

        const needsWebhookReq = registration.requiresMethodGuard || webhookArgs.length > 0 || !!querystringParam
        if (!needsWebhookReq) {
          lines.push(`        void req`)
        }

        lines.push(`        const result = await handler(${argString})`)
        lines.push(`        return res.status(200).json(result ?? { received: true })`)
      }

      lines.push(`      } catch (err) {`)
      lines.push(`        const message = err instanceof Error ? err.message : String(err)`)
      lines.push(`        return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, details: [] } })`)
      lines.push(`      }`)
      lines.push(`    })`)
      lines.push(`  }`)
      lines.push('')
    }
  }

  lines.push('  return router')
  lines.push('}')
  lines.push('')
  lines.push('export default createRouter')

  return formatGeneratedTs(lines.join('\n'))
}
