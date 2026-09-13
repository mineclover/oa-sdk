/**
 * Fastify target router generator.
 * Emits FastifyPluginAsync with inlined OAS 3.2 schemas for fast-json-stringify JIT acceleration,
 * supporting standard verbs plus QUERY, HEAD, and TRACE.
 */

import type { ParsedDocument } from '@oa-sdk/parser/browser'
import { getQuerystringParameter } from '@oa-sdk/parser/browser'
import {
  createOperationNamesMap,
  createOperationTypeNameMap,
  toColonPath,
  formatGeneratedTs,
  pickDefaultStatus,
  quoteTypeScriptString,
  collectTypeNames,
  FASTIFY_CONVENIENCE_METHODS,
  hasGeneratedResponseType,
} from '../common/route-utils.js'
import { formatJSDoc } from '../common/jsdoc.js'
import {
  hasRawQuerystringParameter,
  renderRawQuerystringHelper,
} from '../common/querystring-helper.js'

export interface FastifyTargetOptions {
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

export function renderFastifyRouter(
  doc: ParsedDocument,
  options: FastifyTargetOptions = {},
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
    lines.push('// Auto-generated Fastify router from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/router')
    lines.push('')
  }

  // Framework imports
  if (hasContextInjection) {
    lines.push("import type { FastifyPluginAsync, FastifyRequest } from 'fastify'")
  } else {
    lines.push("import type { FastifyPluginAsync } from 'fastify'")
  }

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

  // Fastify plugin options interface
  if (isContractMode) {
    if (hasContextInjection) {
      const contextTypeDefault = contextTypeName || (contextImport ? 'AppContext' : 'unknown')
      lines.push(`export interface ApiRouterOptions<TContext = ${contextTypeDefault}> {`)
      lines.push(`  handlers: ${contractName}<TContext>`)
      lines.push(`  getContext?: (req: FastifyRequest) => Promise<TContext> | TContext`)
      lines.push(`  context?: TContext`)
      lines.push(`}`)
      lines.push('')
      lines.push(`export const apiRouter: FastifyPluginAsync<ApiRouterOptions<any>> = async (fastify, options) => {`)
      lines.push(`  const { handlers, getContext, context: staticContext } = options`)
      if (doc.operations.length === 0 && doc.webhooks.length === 0) {
        lines.push(`  void fastify`)
        lines.push(`  void handlers`)
        lines.push(`  void getContext`)
        lines.push(`  void staticContext`)
      }
    } else {
      lines.push(`export interface ApiRouterOptions {`)
      lines.push(`  handlers: ${contractName}`)
      lines.push(`}`)
      lines.push('')
      lines.push(`export const apiRouter: FastifyPluginAsync<ApiRouterOptions> = async (fastify, options) => {`)
      lines.push(`  const { handlers } = options`)
      if (doc.operations.length === 0 && doc.webhooks.length === 0) {
        lines.push(`  void fastify`)
        lines.push(`  void handlers`)
      }
    }
  } else {
    lines.push(`export const apiRouter: FastifyPluginAsync = async (fastify) => {`)
    if (doc.operations.length === 0 && doc.webhooks.length === 0) {
      lines.push(`  void fastify`)
    }
  }
  lines.push('')

  // Routes
  for (const op of doc.operations) {
    const { baseName, methodName } = opNameMap.get(op)!
    const rawMethod = op.method.toLowerCase()
    const path = toColonPath(op.openApiPath)
    const quotedPath = quoteTypeScriptString(path)

    // Security hint
    if (op.security.length > 0) {
      const schemeNames = [...new Set(op.security.flatMap(req => Object.keys(req)))]
      lines.push(`  // Requires: ${schemeNames.join(', ')}`)
    }

    // JSDoc
    if (op.summary || op.description) {
      lines.push(formatJSDoc(op.summary ?? op.description, '  '))
    }

    // Build Fastify route schema for JIT serialization
    const schemaObj = buildFastifyRouteSchema(op)
    const hasSchema = Object.keys(schemaObj).length > 0

    const pathParams = op.parameters.filter(p => p.in === 'path')
    const queryParams = op.parameters.filter(p => p.in === 'query')
    const querystringParam = getQuerystringParameter(op.parameters)
    const headerParams = op.parameters.filter(p => p.in === 'header')
    const hasBody = !!op.requestBody

    const status = pickDefaultStatus(op.responses)
    const hasTypedResponse = !!typesImport && hasGeneratedResponseType(op.responses)

    const needsRequest = hasContextInjection || pathParams.length > 0 || queryParams.length > 0 || !!querystringParam || headerParams.length > 0 || hasBody
    const reqParam = needsRequest ? 'request' : '_request'

    const isConvenience = FASTIFY_CONVENIENCE_METHODS.has(rawMethod)
    const indent = '  '

    if (isConvenience) {
      if (hasSchema) {
        const schemaFormatted = formatJsonSchemaBlock(schemaObj, `${indent}  `)
        lines.push(`${indent}fastify.${rawMethod}(${quotedPath}, {`)
        lines.push(`${indent}  schema: ${schemaFormatted}`)
        lines.push(`${indent}}, async (${reqParam}, reply) => {`)
      } else {
        lines.push(`${indent}fastify.${rawMethod}(${quotedPath}, async (${reqParam}, reply) => {`)
      }
    } else {
      // Custom OAS 3.2 verb (e.g. QUERY, TRACE)
      lines.push(`${indent}fastify.route({`)
      lines.push(`${indent}  method: ${quoteTypeScriptString(rawMethod.toUpperCase())},`)
      lines.push(`${indent}  url: ${quotedPath},`)
      if (hasSchema) {
        const schemaFormatted = formatJsonSchemaBlock(schemaObj, `${indent}  `)
        lines.push(`${indent}  schema: ${schemaFormatted},`)
      }
      lines.push(`${indent}  handler: async (${reqParam}, reply) => {`)
    }

    // Route implementation
    lines.push(`${indent}  try {`)

    if (querystringParam) {
      const type = typesImport ? `${baseName}QueryString` : 'string'
      lines.push(`${indent}    const querystring = __readOaRawQuerystring(${reqParam}.raw.url ?? ${reqParam}.url) as ${type} | undefined`)
    }

    if (isContractMode) {
      if (hasContextInjection) {
        lines.push(`${indent}    const context = getContext ? await getContext(${reqParam}) : staticContext`)
        const contextArgs: string[] = []
        if (pathParams.length > 0) contextArgs.push(`params: ${reqParam}.params as any`)
        if (queryParams.length > 0) contextArgs.push(`query: ${reqParam}.query as any`)
        if (querystringParam) contextArgs.push(`querystring`)
        if (headerParams.length > 0) contextArgs.push(`headers: ${reqParam}.headers as any`)
        if (hasBody) contextArgs.push(`body: ${reqParam}.body as any`)
        contextArgs.push(`...(context !== undefined ? { context } : {})`)

        const argString = `{ ${contextArgs.join(', ')} }`
        lines.push(`${indent}    const result = await handlers.${methodName}(${argString})`)
      } else {
        const contextArgs: string[] = []
        if (pathParams.length > 0) contextArgs.push(`params: ${reqParam}.params as any`)
        if (queryParams.length > 0) contextArgs.push(`query: ${reqParam}.query as any`)
        if (querystringParam) contextArgs.push(`querystring`)
        if (headerParams.length > 0) contextArgs.push(`headers: ${reqParam}.headers as any`)
        if (hasBody) contextArgs.push(`body: ${reqParam}.body as any`)

        const argString = contextArgs.length === 0 ? '' : `{ ${contextArgs.join(', ')} }`
        lines.push(`${indent}    const result = await handlers.${methodName}(${argString})`)
      }
      lines.push(`${indent}    if (result !== undefined && result !== null && typeof result === 'object' && 'body' in result && ((result as any).status === undefined || typeof (result as any).status === 'number') && ((result as any).headers === undefined || typeof (result as any).headers === 'object')) {`)
      lines.push(`${indent}      const resp = result as { status?: number; headers?: Record<string, string>; body?: unknown }`)
      lines.push(`${indent}      if (resp.headers) {`)
      lines.push(`${indent}        for (const [name, value] of Object.entries(resp.headers)) {`)
      lines.push(`${indent}          reply.header(name, value)`)
      lines.push(`${indent}        }`)
      lines.push(`${indent}      }`)
      lines.push(`${indent}      if (resp.status) reply.status(resp.status)`)
      lines.push(`${indent}      if (resp.status === 204) return reply.status(204).send()`)
      lines.push(`${indent}      return resp.body`)
      lines.push(`${indent}    }`)
      if (status === 204) {
        lines.push(`${indent}    return reply.status(204).send()`)
      } else if (status !== 200) {
        lines.push(`${indent}    reply.status(${status})`)
        lines.push(`${indent}    return result`)
      } else {
        lines.push(`${indent}    return result`)
      }
    } else {
      lines.push(`${indent}    // TODO: implement ${op.operationId ?? baseName}`)
      if (status === 204) {
        lines.push(`${indent}    return reply.status(204).send()`)
      } else if (hasTypedResponse) {
        lines.push(`${indent}    return reply.status(${status}).send({} as ${baseName}Response)`)
      } else {
        lines.push(`${indent}    return reply.status(${status}).send({} as any)`)
      }
    }

    lines.push(`${indent}  } catch (err) {`)
    lines.push(`${indent}    const message = err instanceof Error ? err.message : String(err)`)
    lines.push(`${indent}    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message, details: [] } })`)
    lines.push(`${indent}  }`)

    if (isConvenience) {
      lines.push(`${indent}})`)
    } else {
      lines.push(`${indent}  }`)
      lines.push(`${indent}})`)
    }
    lines.push('')
  }

  // Webhooks
  if (doc.webhooks.length > 0) {
    lines.push('  // ─── Webhooks ─────────────────────────────────────────────────')
    lines.push('')

    for (const op of doc.webhooks) {
      const { baseName, methodName } = opNameMap.get(op)!
      const rawMethod = op.method.toLowerCase()
      const path = toColonPath(op.openApiPath)
      const quotedPath = quoteTypeScriptString(path)
      const schemaObj = buildFastifyRouteSchema(op)
      const hasSchema = Object.keys(schemaObj).length > 0
      const querystringParam = getQuerystringParameter(op.parameters)
      const pathParams = op.parameters.filter(p => p.in === 'path')
      const queryParams = op.parameters.filter(p => p.in === 'query')
      const headerParams = op.parameters.filter(p => p.in === 'header')
      const hasBody = !!op.requestBody

      const needsRequest = hasContextInjection || pathParams.length > 0 || queryParams.length > 0 || !!querystringParam || headerParams.length > 0 || hasBody
      const reqParam = needsRequest ? 'request' : '_request'

      const isConvenience = FASTIFY_CONVENIENCE_METHODS.has(rawMethod)
      const indent = '  '

      if (op.summary || op.description) {
        lines.push(formatJSDoc(op.summary ?? op.description, indent))
      }

      if (isConvenience) {
        if (hasSchema) {
          const schemaFormatted = formatJsonSchemaBlock(schemaObj, `${indent}  `)
          lines.push(`${indent}fastify.${rawMethod}(${quotedPath}, {`)
          lines.push(`${indent}  schema: ${schemaFormatted}`)
          lines.push(`${indent}}, async (${reqParam}, reply) => {`)
        } else {
          lines.push(`${indent}fastify.${rawMethod}(${quotedPath}, async (${reqParam}, reply) => {`)
        }
      } else {
        lines.push(`${indent}fastify.route({`)
        lines.push(`${indent}  method: ${quoteTypeScriptString(rawMethod.toUpperCase())},`)
        lines.push(`${indent}  url: ${quotedPath},`)
        if (hasSchema) {
          const schemaFormatted = formatJsonSchemaBlock(schemaObj, `${indent}  `)
          lines.push(`${indent}  schema: ${schemaFormatted},`)
        }
        lines.push(`${indent}  handler: async (${reqParam}, reply) => {`)
      }

      lines.push(`${indent}  try {`)
      if (querystringParam) {
        lines.push(`${indent}    const querystring = __readOaRawQuerystring(${reqParam}.raw.url ?? ${reqParam}.url)`)
      }

      if (isContractMode) {
        lines.push(`${indent}    if (handlers.${methodName}) {`)
        if (hasContextInjection) {
          lines.push(`${indent}      const context = getContext ? await getContext(${reqParam}) : staticContext`)
          const webhookArgs: string[] = []
          if (pathParams.length > 0) webhookArgs.push(`params: ${reqParam}.params as any`)
          if (queryParams.length > 0) webhookArgs.push(`query: ${reqParam}.query as any`)
          if (querystringParam) webhookArgs.push(`querystring`)
          if (headerParams.length > 0) webhookArgs.push(`headers: ${reqParam}.headers as any`)
          if (hasBody) webhookArgs.push(`body: ${reqParam}.body as any`)
          webhookArgs.push(`...(context !== undefined ? { context } : {})`)
          const argString = `{ ${webhookArgs.join(', ')} }`
          lines.push(`${indent}      const result = await handlers.${methodName}(${argString})`)
        } else {
          const webhookArgs: string[] = []
          if (pathParams.length > 0) webhookArgs.push(`params: ${reqParam}.params as any`)
          if (queryParams.length > 0) webhookArgs.push(`query: ${reqParam}.query as any`)
          if (querystringParam) webhookArgs.push(`querystring`)
          if (headerParams.length > 0) webhookArgs.push(`headers: ${reqParam}.headers as any`)
          if (hasBody) webhookArgs.push(`body: ${reqParam}.body as any`)
          const argString = webhookArgs.length === 0 ? '' : `{ ${webhookArgs.join(', ')} }`
          lines.push(`${indent}      const result = await handlers.${methodName}(${argString})`)
        }
        lines.push(`${indent}      return result ?? { received: true }`)
        lines.push(`${indent}    }`)
        lines.push(`${indent}    return { received: true }`)
      } else {
        lines.push(`${indent}    // TODO: implement ${op.operationId ?? baseName} webhook handler`)
        lines.push(`${indent}    return reply.status(200).send({ received: true })`)
      }

      lines.push(`${indent}  } catch (err) {`)
      lines.push(`${indent}    const message = err instanceof Error ? err.message : String(err)`)
      lines.push(`${indent}    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message, details: [] } })`)
      lines.push(`${indent}  }`)

      if (isConvenience) {
        lines.push(`${indent}})`)
      } else {
        lines.push(`${indent}  }`)
        lines.push(`${indent}})`)
      }
      lines.push('')
    }
  }

  lines.push('}')
  lines.push('')
  lines.push('export default apiRouter')
  lines.push('')

  return formatGeneratedTs(lines.join('\n'))
}

/**
 * Builds the Fastify route options `schema: { params, querystring, body, response }`
 * from the OpenAPI operation definition.
 */
function buildFastifyRouteSchema(op: ParsedDocument['operations'][number]): Record<string, unknown> {
  const schema: Record<string, unknown> = {}

  // 1. Path params
  const pathParams = op.parameters.filter(p => p.in === 'path')
  if (pathParams.length > 0) {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const p of pathParams) {
      properties[p.name] = p.schema ?? { type: 'string' }
      if (p.required !== false) required.push(p.name)
    }
    schema.params = {
      type: 'object',
      required,
      properties,
    }
  }

  // 2. Query params
  const queryParams = op.parameters.filter(p => p.in === 'query')
  if (queryParams.length > 0) {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const p of queryParams) {
      properties[p.name] = p.schema ?? { type: 'string' }
      if (p.required === true) required.push(p.name)
    }
    const querystringSchema: Record<string, unknown> = {
      type: 'object',
      properties,
    }
    if (required.length > 0) {
      querystringSchema.required = required
    }
    schema.querystring = querystringSchema
  }

  // 3. Request body (application/json)
  const reqJson = op.requestBody?.content?.['application/json']
  if (reqJson && !('$ref' in reqJson) && reqJson.schema) {
    schema.body = reqJson.schema
  }

  // 4. Responses
  const responseMap: Record<string, unknown> = {}
  for (const [statusCode, res] of Object.entries(op.responses)) {
    const resJson = res.content?.['application/json']
    if (resJson && !('$ref' in resJson) && resJson.schema) {
      responseMap[statusCode] = resJson.schema
    }
  }
  if (Object.keys(responseMap).length > 0) {
    schema.response = responseMap
  }

  return schema
}

function formatJsonSchemaBlock(schema: Record<string, unknown>, indent: string): string {
  const jsonStr = JSON.stringify(schema, null, 2)
  const lines = jsonStr.split('\n')
  return lines.map((line, idx) => (idx === 0 ? line : `${indent}${line}`)).join('\n')
}
