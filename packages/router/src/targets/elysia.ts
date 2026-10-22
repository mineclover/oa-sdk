/**
 * Bun Elysia target router generator.
 * Emits fluent builder chaining `new Elysia().get().post()` with
 * selective zero-copy context destructuring ({ params, query, body, set })
 * to ensure zero unused variable compiler warnings.
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
  ELYSIA_CONVENIENCE_METHODS,
  hasGeneratedResponseType,
  escapeKey,
} from '../common/route-utils.js'
import { formatJSDoc } from '../common/jsdoc.js'
import {
  hasRawQuerystringParameter,
  renderRawQuerystringHelper,
} from '../common/querystring-helper.js'

export interface ElysiaTargetOptions {
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

export function renderElysiaRouter(
  doc: ParsedDocument,
  options: ElysiaTargetOptions = {},
): string {
  const {
    mode = options.contractImport ? 'contract' : 'stub',
    typesImport,
    contractImport,
    contractName = 'ApiHandlers',
    banner = true,
    contextInjection,
    context: contextOption,
    contextImport,
    contextTypeName,
  } = options

  const isContractMode = mode === 'contract' || !!contractImport
  const hasContextInjection = isContractMode && Boolean(
    contextInjection ||
    contextOption ||
    contextImport ||
    contextTypeName,
  )
  const lines: string[] = []
  const opNameMap = createOperationNamesMap([...doc.operations, ...doc.webhooks])
  const operationNames = createOperationTypeNameMap([...doc.operations, ...doc.webhooks])

  if (banner) {
    lines.push('// Auto-generated Elysia router from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/router')
    lines.push('')
  }

  // Framework imports
  lines.push("import { Elysia } from 'elysia'")

  if (isContractMode && contractImport) {
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

  // Raw querystring helper if needed
  const needsRawQuerystring = hasRawQuerystringParameter([...doc.operations, ...doc.webhooks])
  if (needsRawQuerystring) {
    lines.push(renderRawQuerystringHelper())
    lines.push('')
  }

  // Router builder start
  if (isContractMode) {
    if (hasContextInjection) {
      const contextTypeDefault = contextTypeName || (contextImport ? 'AppContext' : 'unknown')
      lines.push(`export interface ElysiaRouterOptions<TContext = ${contextTypeDefault}> {`)
      lines.push(`  getContext?: (ctx: any) => Promise<TContext> | TContext`)
      lines.push(`  context?: TContext`)
      lines.push(`}`)
      lines.push('')
      lines.push(`export function createRouter<TContext = ${contextTypeDefault}>(`)
      lines.push(`  handlers: ${contractName}<TContext>,`)
      lines.push(`  options?: ElysiaRouterOptions<TContext>,`)
      lines.push(`) {`)
      lines.push(`  const { getContext, context: staticContext } = options ?? {}`)
      if (doc.operations.length === 0 && doc.webhooks.length === 0) {
        lines.push(`  void handlers`)
        lines.push(`  void getContext`)
        lines.push(`  void staticContext`)
      }
      lines.push(`  return new Elysia()`)
    } else {
      lines.push(`export function createRouter(handlers: ${contractName}) {`)
      if (doc.operations.length === 0 && doc.webhooks.length === 0) {
        lines.push(`  void handlers`)
      }
      lines.push(`  return new Elysia()`)
    }
  } else {
    lines.push(`export const app = new Elysia()`)
  }

  // Routes
  for (const op of doc.operations) {
    const { baseName, methodName } = opNameMap.get(op)!
    const rawMethod = op.method.toLowerCase()
    const path = toColonPath(op.openApiPath)
    const quotedPath = quoteTypeScriptString(path)

    const pathParams = op.parameters.filter(p => p.in === 'path')
    const queryParams = op.parameters.filter(p => p.in === 'query')
    const querystringParam = getQuerystringParameter(op.parameters)
    const headerParams = op.parameters.filter(p => p.in === 'header')
    const hasBody = !!op.requestBody

    const status = pickDefaultStatus(op.responses)
    const hasTypedResponse = !!typesImport && hasGeneratedResponseType(op.responses)

    // Selective zero-copy destructuring:
    // Only extract the exact variables needed so noUnusedLocals / noUnusedParameters never fire.
    const destructureFields: string[] = []
    if (pathParams.length > 0 || hasContextInjection) destructureFields.push('params')
    if (queryParams.length > 0 || hasContextInjection) destructureFields.push('query')
    if (headerParams.length > 0 || hasContextInjection) destructureFields.push('headers')
    if (hasBody || hasContextInjection) destructureFields.push('body')
    if (querystringParam || hasContextInjection) destructureFields.push('request')
    destructureFields.push('set')

    const contextParam = `{ ${destructureFields.join(', ')} }`
    const isConvenience = ELYSIA_CONVENIENCE_METHODS.has(rawMethod)
    const methodCall = isConvenience
      ? `.${rawMethod}(${quotedPath}`
      : `.route(${quoteTypeScriptString(rawMethod.toUpperCase())}, ${quotedPath}`

    const indent = isContractMode ? '    ' : '  '

    // Security hint as comment
    if (op.security.length > 0) {
      const schemeNames = [...new Set(op.security.flatMap(req => Object.keys(req)))]
      lines.push(`${indent}// Requires: ${schemeNames.join(', ')}`)
    }

    // JSDoc
    if (op.summary || op.description) {
      lines.push(formatJSDoc(op.summary ?? op.description, indent))
    }

    lines.push(`${indent}${methodCall}, async (${contextParam}) => {`)
    lines.push(`${indent}  try {`)

    if (querystringParam) {
      const type = typesImport ? `${baseName}QueryString` : 'string'
      lines.push(`${indent}    const querystring = __readOaRawQuerystring(request.url) as ${type} | undefined`)
    }

    if (isContractMode) {
      if (hasContextInjection) {
        lines.push(`${indent}    const context = getContext ? await getContext({ params, query, headers, body, request, set }) : staticContext`)
        const contextArgs: string[] = []
        if (pathParams.length > 0) contextArgs.push(`params: params as any`)
        if (queryParams.length > 0) contextArgs.push(`query: query as any`)
        if (querystringParam) contextArgs.push(`querystring`)
        if (headerParams.length > 0) contextArgs.push(`headers: headers as any`)
        if (hasBody) contextArgs.push(`body: body as any`)
        contextArgs.push(`...(context !== undefined ? { context } : {})`)

        const argString = `{ ${contextArgs.join(', ')} }`
        lines.push(`${indent}    const result = await handlers.${methodName}(${argString})`)
      } else {
        const contextArgs: string[] = []
        if (pathParams.length > 0) contextArgs.push(`params: params as any`)
        if (queryParams.length > 0) contextArgs.push(`query: query as any`)
        if (querystringParam) contextArgs.push(`querystring`)
        if (headerParams.length > 0) contextArgs.push(`headers: headers as any`)
        if (hasBody) contextArgs.push(`body: body as any`)

        const argString = contextArgs.length === 0 ? '' : `{ ${contextArgs.join(', ')} }`
        lines.push(`${indent}    const result = await handlers.${methodName}(${argString})`)
      }
      lines.push(`${indent}    if (result !== undefined && result !== null && typeof result === 'object' && 'body' in result && ((result as any).status === undefined || typeof (result as any).status === 'number') && ((result as any).headers === undefined || typeof (result as any).headers === 'object')) {`)
      lines.push(`${indent}      const resp = result as { status?: number; headers?: Record<string, string>; body?: unknown }`)
      lines.push(`${indent}      if (resp.headers) {`)
      lines.push(`${indent}        for (const [k, v] of Object.entries(resp.headers)) {`)
      lines.push(`${indent}          const lowerKey = k.toLowerCase()`)
      lines.push(`${indent}          for (const existing of Object.keys(set.headers)) {`)
      lines.push(`${indent}            if (existing.toLowerCase() === lowerKey && existing !== lowerKey) delete set.headers[existing]`)
      lines.push(`${indent}          }`)
      lines.push(`${indent}          set.headers[lowerKey] = v`)
      lines.push(`${indent}        }`)
      lines.push(`${indent}      }`)
      lines.push(`${indent}      if (resp.status) set.status = resp.status`)
      lines.push(`${indent}      if (resp.status === 204) return`)
      lines.push(`${indent}      const bodyValue = resp.body`)
      lines.push(`${indent}      if (bodyValue !== null && bodyValue !== undefined && typeof bodyValue === 'object' && !(bodyValue instanceof Uint8Array) && !(typeof ReadableStream !== 'undefined' && bodyValue instanceof ReadableStream) && typeof (bodyValue as any).pipe !== 'function' && Symbol.asyncIterator in (bodyValue as any)) {`)
      lines.push(`${indent}        const it = (bodyValue as any)[Symbol.asyncIterator]()`)
      lines.push(`${indent}        return new ReadableStream({`)
      lines.push(`${indent}          async pull(controller) {`)
      lines.push(`${indent}            const { value, done } = await it.next()`)
      lines.push(`${indent}            if (done) { controller.close() } else { controller.enqueue(typeof value === 'string' ? new TextEncoder().encode(value) : value) }`)
      lines.push(`${indent}          },`)
      lines.push(`${indent}          async cancel(reason) {`)
      lines.push(`${indent}            await it.return?.(reason)`)
      lines.push(`${indent}          }`)
      lines.push(`${indent}        })`)
      lines.push(`${indent}      }`)
      lines.push(`${indent}      return bodyValue`)
      lines.push(`${indent}    }`)
      if (status !== 200 && status !== 204) {
        lines.push(`${indent}    set.status = ${status}`)
      }
      if (status === 204) {
        lines.push(`${indent}    set.status = 204`)
        lines.push(`${indent}    return`)
      } else {
        lines.push(`${indent}    if (result !== null && result !== undefined && typeof result === 'object' && !(result instanceof Uint8Array) && !(typeof ReadableStream !== 'undefined' && result instanceof ReadableStream) && typeof (result as any).pipe !== 'function' && Symbol.asyncIterator in (result as any)) {`)
        lines.push(`${indent}      const it = (result as any)[Symbol.asyncIterator]()`)
        lines.push(`${indent}      return new ReadableStream({`)
        lines.push(`${indent}        async pull(controller) {`)
        lines.push(`${indent}          const { value, done } = await it.next()`)
        lines.push(`${indent}          if (done) { controller.close() } else { controller.enqueue(typeof value === 'string' ? new TextEncoder().encode(value) : value) }`)
        lines.push(`${indent}        },`)
        lines.push(`${indent}        async cancel(reason) {`)
        lines.push(`${indent}          await it.return?.(reason)`)
        lines.push(`${indent}        }`)
        lines.push(`${indent}      })`)
        lines.push(`${indent}    }`)
        lines.push(`${indent}    return result`)
      }
    } else {
      lines.push(`${indent}    // TODO: implement ${op.operationId ?? baseName}`)
      if (status !== 200 && status !== 204) {
        lines.push(`${indent}    set.status = ${status}`)
      }
      if (status === 204) {
        lines.push(`${indent}    set.status = 204`)
        lines.push(`${indent}    return`)
      } else if (hasTypedResponse) {
        lines.push(`${indent}    return {} as ${baseName}Response`)
      } else {
        lines.push(`${indent}    return {} as any`)
      }
    }

    lines.push(`${indent}  } catch (err) {`)
    lines.push(`${indent}    set.status = 500`)
    lines.push(`${indent}    const message = err instanceof Error ? err.message : String(err)`)
    lines.push(`${indent}    return { error: { code: 'INTERNAL_ERROR', message, details: [] } }`)
    lines.push(`${indent}  }`)
    lines.push(`${indent}})`)
  }

  // Webhooks
  if (doc.webhooks.length > 0) {
    const indent = isContractMode ? '    ' : '  '
    lines.push(`${indent}// ─── Webhooks ─────────────────────────────────────────────────`)

    for (const op of doc.webhooks) {
      const { baseName, methodName } = opNameMap.get(op)!
      const rawMethod = op.method.toLowerCase()
      const path = toColonPath(op.openApiPath)
      const quotedPath = quoteTypeScriptString(path)

      const pathParams = op.parameters.filter(p => p.in === 'path')
      const queryParams = op.parameters.filter(p => p.in === 'query')
      const querystringParam = getQuerystringParameter(op.parameters)
      const headerParams = op.parameters.filter(p => p.in === 'header')
      const hasBody = !!op.requestBody

      const destructureFields: string[] = []
      if (pathParams.length > 0 || hasContextInjection) destructureFields.push('params')
      if (queryParams.length > 0 || hasContextInjection) destructureFields.push('query')
      if (headerParams.length > 0 || hasContextInjection) destructureFields.push('headers')
      if (hasBody || hasContextInjection) destructureFields.push('body')
      if (querystringParam || hasContextInjection) destructureFields.push('request')
      destructureFields.push('set')

      const contextParam = `{ ${destructureFields.join(', ')} }`
      const isConvenience = ELYSIA_CONVENIENCE_METHODS.has(rawMethod)
      const methodCall = isConvenience
        ? `.${rawMethod}(${quotedPath}`
        : `.route(${quoteTypeScriptString(rawMethod.toUpperCase())}, ${quotedPath}`

      if (op.summary || op.description) {
        lines.push(formatJSDoc(op.summary ?? op.description, indent))
      }

      lines.push(`${indent}${methodCall}, async (${contextParam}) => {`)
      lines.push(`${indent}  try {`)

      if (querystringParam) {
        lines.push(`${indent}    const querystring = __readOaRawQuerystring(request.url)`)
      }

      if (isContractMode) {
        lines.push(`${indent}    if (handlers.${methodName}) {`)
        if (hasContextInjection) {
          lines.push(`${indent}      const context = getContext ? await getContext({ params, query, headers, body, request, set }) : staticContext`)
          const webhookArgs: string[] = []
          if (pathParams.length > 0) webhookArgs.push(`params: params as any`)
          if (queryParams.length > 0) webhookArgs.push(`query: query as any`)
          if (querystringParam) webhookArgs.push(`querystring`)
          if (headerParams.length > 0) webhookArgs.push(`headers: headers as any`)
          if (hasBody) webhookArgs.push(`body: body as any`)
          webhookArgs.push(`...(context !== undefined ? { context } : {})`)
          const argString = `{ ${webhookArgs.join(', ')} }`
          lines.push(`${indent}      const result = await handlers.${methodName}(${argString})`)
        } else {
          const webhookArgs: string[] = []
          if (pathParams.length > 0) webhookArgs.push(`params: params as any`)
          if (queryParams.length > 0) webhookArgs.push(`query: query as any`)
          if (querystringParam) webhookArgs.push(`querystring`)
          if (headerParams.length > 0) webhookArgs.push(`headers: headers as any`)
          if (hasBody) webhookArgs.push(`body: body as any`)
          const argString = webhookArgs.length === 0 ? '' : `{ ${webhookArgs.join(', ')} }`
          lines.push(`${indent}      const result = await handlers.${methodName}(${argString})`)
        }
        lines.push(`${indent}      return result ?? { received: true }`)
        lines.push(`${indent}    }`)
        lines.push(`${indent}    return { received: true }`)
      } else {
        lines.push(`${indent}    // TODO: implement ${op.operationId ?? baseName} webhook handler`)
        lines.push(`${indent}    return { received: true }`)
      }

      lines.push(`${indent}  } catch (err) {`)
      lines.push(`${indent}    set.status = 500`)
      lines.push(`${indent}    const message = err instanceof Error ? err.message : String(err)`)
      lines.push(`${indent}    return { error: { code: 'INTERNAL_ERROR', message, details: [] } }`)
      lines.push(`${indent}  }`)
      lines.push(`${indent}})`)
    }
  }

  if (isContractMode) {
    lines.push('}')
    lines.push('')
    lines.push('export default createRouter')
  } else {
    lines.push('')
    lines.push('export default app')
  }
  lines.push('')

  return formatGeneratedTs(lines.join('\n'))
}
