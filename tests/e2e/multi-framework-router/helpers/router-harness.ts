import type { OasDocument, ParsedDocument } from '@oa-sdk/parser'
import { parseDocument } from '@oa-sdk/parser'
import { toColonPath, createOperationTypeNameMap } from '@oa-sdk/core'
import {
  generateRouter as generateRouterReal,
  generateHandlerContract as generateHandlerContractReal,
} from '@oa-sdk/router'
import ts from 'typescript'
import * as fs from 'node:fs'
import * as path from 'node:path'

export interface HandlerContractOptions {
  typesImport?: string
  banner?: boolean
  contractName?: string
  basePath?: string
}

export type RouterTarget = 'hono' | 'express' | 'fastify' | 'elysia'
export type RouterMode = 'stub' | 'contract'

export interface RouterRenderOptions {
  target?: RouterTarget
  mode?: RouterMode
  typesImport?: string
  contractImport?: string
  contractName?: string
  banner?: boolean
  basePath?: string
}

function toCamelCase(str: string): string {
  if (!str) return 'operation'
  const cleaned = str.replace(/[-_]+(.)?/g, (_, c) => c ? c.toUpperCase() : '')
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1)
}

/**
 * Authoritative reference generator for Handler Contracts (PROJECT.md & Survey 1)
 */
export function generateHandlerContractReference(
  spec: OasDocument | ParsedDocument,
  options: HandlerContractOptions = {},
): string {
  const doc = 'operations' in spec ? spec : parseDocument(spec)
  const { typesImport, banner = true, contractName = 'ApiHandlers' } = options
  const lines: string[] = []

  if (banner) {
    lines.push('// Auto-generated handler contract from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/router')
    lines.push('')
  }

  if (typesImport) {
    lines.push(`import type * as Types from '${typesImport}'`)
    lines.push('')
  }

  lines.push('export type HandlerResponse<TBody, THeaders = Record<string, string>> =')
  lines.push('  | TBody')
  lines.push('  | { status?: number; body: TBody; headers?: THeaders }')
  lines.push('')

  const opNameMap = createOperationTypeNameMap([...doc.operations, ...doc.webhooks])
  const handlerEntries: Array<{ methodName: string; handlerType: string }> = []

  for (const op of doc.operations) {
    if (!op.operationId) continue
    const baseName = opNameMap.get(op.operationId) || op.operationId
    const methodName = toCamelCase(baseName)
    const contextName = `${baseName}Context`
    const handlerName = `${baseName}Handler`

    lines.push(`export interface ${contextName} {`)
    const pathParams = op.parameters.filter(p => p.in === 'path')
    if (pathParams.length > 0) {
      lines.push(`  params: { ${pathParams.map(p => `${p.name}: string`).join('; ')} }`)
    } else {
      lines.push('  params?: Record<string, string>')
    }

    const queryParams = op.parameters.filter(p => p.in === 'query')
    if (queryParams.length > 0) {
      lines.push(`  query?: { ${queryParams.map(p => `${p.name}?: string | number | boolean`).join('; ')} }`)
    } else {
      lines.push('  query?: Record<string, unknown>')
    }

    if (op.requestBody) {
      lines.push('  body?: unknown')
    }
    lines.push('  headers?: Record<string, string | undefined>')
    lines.push('}')
    lines.push('')

    lines.push(`export type ${handlerName} = (`)
    lines.push(`  ctx: ${contextName}`)
    lines.push(') => HandlerResponse<unknown> | Promise<HandlerResponse<unknown>>')
    lines.push('')

    handlerEntries.push({ methodName, handlerType: handlerName })
  }

  lines.push(`export interface ${contractName} {`)
  for (const entry of handlerEntries) {
    lines.push(`  ${entry.methodName}: ${entry.handlerType}`)
  }
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

/**
 * Authoritative reference generator for Fastify target with JIT schema inlining (PROJECT.md & Survey 1)
 */
export function generateFastifyTargetReference(
  doc: ParsedDocument,
  options: RouterRenderOptions = {},
): string {
  const { banner = true, contractImport, contractName = 'ApiHandlers', typesImport } = options
  const isContractMode = Boolean(contractImport) || options.mode === 'contract'
  const lines: string[] = []

  if (banner) {
    lines.push('// Auto-generated Fastify router from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/router')
    lines.push('')
  }

  lines.push("import type { FastifyPluginAsync } from 'fastify'")
  if (isContractMode && contractImport) {
    lines.push(`import type { ${contractName} } from '${contractImport}'`)
  }
  if (typesImport) {
    lines.push(`import type * as ApiTypes from '${typesImport}'`)
  }
  lines.push('')

  if (isContractMode) {
    lines.push(`export interface ApiRouterOptions {`)
    lines.push(`  handlers: ${contractName}`)
    lines.push(`}`)
    lines.push('')
    lines.push(`export const apiRouter: FastifyPluginAsync<ApiRouterOptions> = async (fastify, options) => {`)
    lines.push(`  const { handlers } = options`)
  } else {
    lines.push(`export const apiRouter: FastifyPluginAsync = async (fastify) => {`)
  }

  const opNameMap = createOperationTypeNameMap([...doc.operations, ...doc.webhooks])
  const standardVerbs = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options'])

  for (const op of doc.operations) {
    if (!op.operationId) continue
    const baseName = opNameMap.get(op.operationId) || op.operationId
    const methodName = toCamelCase(baseName)
    const url = toColonPath(op.openApiPath)
    const verb = op.method.toLowerCase()

    // Build inlined JIT schema
    const schemaObj: Record<string, unknown> = {}
    const pathParams = op.parameters.filter(p => p.in === 'path')
    if (pathParams.length > 0) {
      schemaObj.params = {
        type: 'object',
        required: pathParams.map(p => p.name),
        properties: Object.fromEntries(pathParams.map(p => [p.name, p.schema ?? { type: 'string' }])),
      }
    }

    const queryParams = op.parameters.filter(p => p.in === 'query')
    if (queryParams.length > 0) {
      schemaObj.querystring = {
        type: 'object',
        properties: Object.fromEntries(queryParams.map(p => [p.name, p.schema ?? { type: 'string' }])),
      }
    }

    const jsonBody = op.requestBody?.content['application/json']
    if (jsonBody?.schema) {
      schemaObj.body = jsonBody.schema
    }

    const responsesMap: Record<string, unknown> = {}
    for (const [code, resp] of Object.entries(op.responses)) {
      const respSchema = resp.content?.['application/json']?.schema
      if (respSchema) {
        responsesMap[code] = respSchema
      }
    }
    if (Object.keys(responsesMap).length > 0) {
      schemaObj.response = responsesMap
    }

    const schemaStr = Object.keys(schemaObj).length > 0
      ? JSON.stringify(schemaObj, null, 4).replace(/\n/g, '\n    ')
      : '{}'

    lines.push('')
    lines.push(`  // Operation: ${op.operationId}`)
    if (standardVerbs.has(verb)) {
      lines.push(`  fastify.${verb}('${url}', {`)
      lines.push(`    schema: ${schemaStr},`)
      lines.push(`  }, async (request, reply) => {`)
    } else {
      // Extended OAS 3.2 verbs like QUERY, TRACE
      lines.push(`  fastify.route({`)
      lines.push(`    method: '${verb.toUpperCase()}',`)
      lines.push(`    url: '${url}',`)
      lines.push(`    schema: ${schemaStr},`)
      lines.push(`    handler: async (request, reply) => {`)
    }

    if (isContractMode) {
      lines.push(`      const result = await handlers.${methodName}({`)
      lines.push(`        params: request.params as any,`)
      lines.push(`        query: request.query as any,`)
      if (op.requestBody) {
        lines.push(`        body: request.body as any,`)
      }
      lines.push(`        headers: request.headers as any,`)
      lines.push(`      })`)
      lines.push(`      if (result && typeof result === 'object' && 'body' in result) {`)
      lines.push(`        if (result.status) reply.status(result.status)`)
      lines.push(`        return result.body`)
      lines.push(`      }`)
      lines.push(`      return result`)
    } else {
      lines.push(`      // TODO: implement ${op.operationId}`)
      lines.push(`      return reply.status(200).send({ message: 'Stub for ${op.operationId}' })`)
    }

    if (standardVerbs.has(verb)) {
      lines.push(`  })`)
    } else {
      lines.push(`    },`)
      lines.push(`  })`)
    }
  }

  lines.push(`}`)
  lines.push(`export default apiRouter`)
  lines.push('')

  return lines.join('\n')
}

/**
 * Authoritative reference generator for Bun Elysia target with zero-copy context destructuring (PROJECT.md & Survey 1)
 */
export function generateElysiaTargetReference(
  doc: ParsedDocument,
  options: RouterRenderOptions = {},
): string {
  const { banner = true, contractImport, contractName = 'ApiHandlers' } = options
  const isContractMode = Boolean(contractImport) || options.mode === 'contract'
  const lines: string[] = []

  if (banner) {
    lines.push('// Auto-generated Bun Elysia router from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/router')
    lines.push('')
  }

  lines.push("import { Elysia } from 'elysia'")
  if (isContractMode && contractImport) {
    lines.push(`import type { ${contractName} } from '${contractImport}'`)
  }
  lines.push('')

  if (isContractMode) {
    lines.push(`export function createRouter(handlers: ${contractName}) {`)
    lines.push(`  return new Elysia()`)
  } else {
    lines.push(`export const app = new Elysia()`)
  }

  const opNameMap = createOperationTypeNameMap([...doc.operations, ...doc.webhooks])
  const standardVerbs = new Set(['get', 'post', 'put', 'delete', 'patch', 'head'])

  for (const op of doc.operations) {
    if (!op.operationId) continue
    const baseName = opNameMap.get(op.operationId) || op.operationId
    const methodName = toCamelCase(baseName)
    const url = toColonPath(op.openApiPath)
    const verb = op.method.toLowerCase()

    // Determine selective zero-copy destructuring parameters
    const hasPath = op.parameters.some(p => p.in === 'path')
    const hasQuery = op.parameters.some(p => p.in === 'query')
    const hasBody = Boolean(op.requestBody)
    const needsSet = !isContractMode || op.responses['201'] || op.responses['204']

    const destructureFields: string[] = []
    if (hasPath) destructureFields.push('params')
    if (hasQuery) destructureFields.push('query')
    if (hasBody) destructureFields.push('body')
    if (needsSet) destructureFields.push('set')

    const argPattern = destructureFields.length > 0 ? `{ ${destructureFields.join(', ')} }` : ''

    const indent = isContractMode ? '    ' : '  '
    if (standardVerbs.has(verb)) {
      lines.push(`${indent}.${verb}('${url}', async (${argPattern}) => {`)
    } else {
      lines.push(`${indent}.route('${verb.toUpperCase()}', '${url}', async (${argPattern}) => {`)
    }

    if (isContractMode) {
      lines.push(`${indent}  const result = await handlers.${methodName}({`)
      if (hasPath) lines.push(`${indent}    params,`)
      if (hasQuery) lines.push(`${indent}    query,`)
      if (hasBody) lines.push(`${indent}    body,`)
      lines.push(`${indent}  })`)
      lines.push(`${indent}  if (result && typeof result === 'object' && 'body' in result) {`)
      if (needsSet) {
        lines.push(`${indent}    if (result.status) set.status = result.status`)
      }
      lines.push(`${indent}    return result.body`)
      lines.push(`${indent}  }`)
      lines.push(`${indent}  return result`)
    } else {
      lines.push(`${indent}  // TODO: implement ${op.operationId}`)
      if (needsSet) {
        lines.push(`${indent}  set.status = 200`)
      }
      lines.push(`${indent}  return { message: 'Stub for ${op.operationId}' }`)
    }

    lines.push(`${indent}})`)
  }

  if (isContractMode) {
    lines.push(`}`)
    lines.push(`export default createRouter`)
  } else {
    lines.push(`export default app`)
  }
  lines.push('')

  return lines.join('\n')
}

/**
 * Authoritative reference generator for Modernized Hono target (PROJECT.md & Survey 1)
 */
export function generateHonoTargetReference(
  doc: ParsedDocument,
  options: RouterRenderOptions = {},
): string {
  const { banner = true, contractImport, contractName = 'ApiHandlers', typesImport } = options
  const isContractMode = Boolean(contractImport) || options.mode === 'contract'

  const lines: string[] = []
  if (banner) {
    lines.push('// Auto-generated router stub from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/router')
    lines.push('')
  }
  lines.push("import { Hono } from 'hono'")
  if (isContractMode && contractImport) {
    lines.push(`import type { ${contractName} } from '${contractImport}'`)
  }
  lines.push('')

  const needsRawQuerystringHelper = [...doc.operations, ...doc.webhooks]
    .some(op => op.parameters.some(p => p.in === 'querystring'))
  if (needsRawQuerystringHelper) {
    lines.push(`function __readOaRawQuerystring(url: string): string | undefined {`)
    lines.push(`  const question = url.indexOf('?')`)
    lines.push(`  if (question === -1) return undefined`)
    lines.push(`  const hash = url.indexOf('#', question + 1)`)
    lines.push(`  return url.slice(question + 1, hash === -1 ? undefined : hash)`)
    lines.push(`}`)
    lines.push('')
  }

  const needsResponseHeaderHelper = Boolean(typesImport) && doc.operations.some(op =>
    Object.values(op.responses).some(r => r.headers && Object.keys(r.headers).length > 0)
  )
  if (needsResponseHeaderHelper) {
    lines.push(`function __setOaResponseHeaders(setHeader: any, headers: any): void {}`)
    lines.push('')
  }

  if (isContractMode) {
    lines.push(`export function createRouter(handlers: ${contractName}): Hono {`)
    lines.push('  const app = new Hono()')
    lines.push('')
  } else {
    lines.push('const app = new Hono()')
    lines.push('')
  }

  const opNameMap = createOperationTypeNameMap([...doc.operations, ...doc.webhooks])
  for (const op of doc.operations) {
    if (!op.operationId) continue
    const baseName = opNameMap.get(op.operationId) || op.operationId
    const methodName = toCamelCase(baseName)
    const url = toColonPath(op.openApiPath)
    const verb = op.method.toLowerCase()

    if (isContractMode) {
      lines.push(`  app.${verb}('${url}', async (c) => {`)
      lines.push(`    const result = await handlers.${methodName}({`)
      lines.push(`      params: c.req.param() as any,`)
      lines.push(`      query: c.req.query() as any,`)
      if (op.requestBody) {
        lines.push(`      body: await c.req.json().catch(() => undefined),`)
      }
      lines.push(`    })`)
      lines.push(`    if (result && typeof result === 'object' && 'body' in result) {`)
      lines.push(`      return c.json(result.body, (result.status ?? 200) as any)`)
      lines.push(`    }`)
      lines.push(`    return c.json(result)`)
      lines.push(`  })`)
    } else {
      lines.push(`app.${verb}('${url}', async (c) => {`)
      lines.push(`  // TODO: implement ${op.operationId}`)
      lines.push(`  return c.text('TODO: implement ${op.operationId}')`)
      lines.push(`})`)
    }
  }

  if (isContractMode) {
    lines.push('  return app')
    lines.push('}')
    lines.push('export default createRouter')
  } else {
    lines.push('')
    lines.push('export default app')
  }
  lines.push('')

  return lines.join('\n')
}

/**
 * Authoritative reference generator for Modernized Express target (PROJECT.md & Survey 1)
 */
export function generateExpressTargetReference(
  doc: ParsedDocument,
  options: RouterRenderOptions = {},
): string {
  const { banner = true, contractImport, contractName = 'ApiHandlers' } = options
  const isContractMode = Boolean(contractImport) || options.mode === 'contract'

  const lines: string[] = []
  if (banner) {
    lines.push('// Auto-generated router stub from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/router')
    lines.push('')
  }
  lines.push("import { Router } from 'express'")
  if (isContractMode && contractImport) {
    lines.push(`import type { ${contractName} } from '${contractImport}'`)
  }
  lines.push('')

  if (isContractMode) {
    lines.push(`export function createRouter(handlers: ${contractName}): Router {`)
    lines.push('  const router = Router()')
    lines.push('')
  } else {
    lines.push('const router = Router()')
    lines.push('')
  }

  const opNameMap = createOperationTypeNameMap([...doc.operations, ...doc.webhooks])
  for (const op of doc.operations) {
    if (!op.operationId) continue
    const baseName = opNameMap.get(op.operationId) || op.operationId
    const methodName = toCamelCase(baseName)
    const url = toColonPath(op.openApiPath)
    const verb = op.method.toLowerCase()

    if (isContractMode) {
      lines.push(`  router.${verb}('${url}', async (req, res, next) => {`)
      lines.push('    try {')
      lines.push(`      const result = await handlers.${methodName}({`)
      lines.push(`        params: req.params as any,`)
      lines.push(`        query: req.query as any,`)
      if (op.requestBody) {
        lines.push(`        body: req.body,`)
      }
      lines.push(`      })`)
      lines.push(`      if (result && typeof result === 'object' && 'body' in result) {`)
      lines.push(`        if (result.status) res.status(result.status)`)
      lines.push(`        return res.json(result.body)`)
      lines.push(`      }`)
      lines.push(`      return res.json(result)`)
      lines.push('    } catch (err) {')
      lines.push('      return next(err)')
      lines.push('    }')
      lines.push(`  })`)
    } else {
      lines.push(`router.${verb}('${url}', (req, res) => {`)
      lines.push(`  // TODO: implement ${op.operationId}`)
      lines.push(`  res.send('TODO: implement ${op.operationId}')`)
      lines.push(`})`)
    }
  }

  if (isContractMode) {
    lines.push('  return router')
    lines.push('}')
    lines.push('export default createRouter')
  } else {
    lines.push('')
    lines.push('export default router')
  }
  lines.push('')

  return lines.join('\n')
}

/**
 * Dispatches router generation to official or reference implementation
 */
export function generateRouter(
  spec: OasDocument | ParsedDocument,
  options: RouterRenderOptions = {},
): string {
  return generateRouterReal(spec, options as any)
}

export function generateHandlerContract(
  spec: OasDocument | ParsedDocument,
  options: HandlerContractOptions = {},
): string {
  return generateHandlerContractReal(spec, options as any)
}

/**
 * Validates TypeScript code syntax using TypeScript compiler API
 */
export function validateTsSyntax(sourceText: string): { valid: boolean; errors: string[] } {
  const sf = ts.createSourceFile('test.ts', sourceText, ts.ScriptTarget.Latest, true)
  const diagnostics = (sf as any).parseDiagnostics || []
  const errors = diagnostics.map((d: any) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
  return {
    valid: errors.length === 0,
    errors,
  }
}
