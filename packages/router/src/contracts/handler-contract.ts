/**
 * Pure TypeScript handler contract generator decoupled from server framework runtime APIs.
 * Generates context interfaces, handler types, and aggregate ApiHandlers interface.
 */

import type { OasDocument, ParsedDocument } from '@oa-sdk/parser/browser'
import {
  assertParsedDocumentComplete,
  isParsedDocument,
  parseDocument,
  getQuerystringParameter,
} from '@oa-sdk/parser/browser'
import {
  createOperationNamesMap,
  formatGeneratedTs,
  pickDefaultStatus,
  hasGeneratedResponseHeaders,
  hasGeneratedRequestBodyType,
  hasGeneratedResponseType,
} from '../common/route-utils.js'
import { formatJSDoc } from '../common/jsdoc.js'

export interface HandlerContractOptions {
  /** Path to import generated API types from (e.g. './types') */
  typesImport?: string | undefined
  /** Header banner comment (default: true) */
  banner?: boolean | undefined
  /** Name of the handlers aggregate interface (default: 'ApiHandlers') */
  contractName?: string | undefined
  /** Path to import custom context type from (e.g. './context') */
  contextImport?: string | undefined
  /** Name of the context type to import (e.g. 'AppContext') */
  contextTypeName?: string | undefined
  /** Base path for resolving relative external $refs */
  basePath?: string | undefined
}

/**
 * Polymorphic response envelope for operation handlers.
 * Supports raw success bodies, status 200 envelopes, and typed error envelopes.
 */
export type HandlerResponse<TSuccess = unknown, TErrorMap = Record<number, unknown>, THeaders = Record<string, string>> =
  | TSuccess
  | { status: 200; body: TSuccess; headers?: THeaders }
  | { [K in keyof TErrorMap]: { status: K; body: TErrorMap[K]; headers?: Record<string, string> } }[keyof TErrorMap]


/**
 * OAS 원본 문서 또는 ParsedDocument IR에서 프레임워크 독립적인 순수 TypeScript 핸들러 계약을 생성합니다.
 */
export function generateHandlerContract(
  spec: OasDocument | ParsedDocument,
  options: HandlerContractOptions = {},
): string {
  const doc = isParsedDocument(spec) ? spec : parseDocument(spec)
  assertParsedDocumentComplete(doc, '@oa-sdk/router generateHandlerContract')
  return generateHandlerContractFromParsed(doc, options)
}

/**
 * ParsedDocument IR에서 프레임워크 독립적인 순수 TypeScript 핸들러 계약을 생성합니다.
 */
export function generateHandlerContractFromParsed(
  doc: ParsedDocument,
  options: HandlerContractOptions = {},
): string {
  const {
    typesImport,
    banner = true,
    contractName = 'ApiHandlers',
    contextImport,
    contextTypeName,
  } = options

  const lines: string[] = []
  const opNameMap = createOperationNamesMap([...doc.operations, ...doc.webhooks])

  if (banner) {
    lines.push('// Auto-generated handler contracts from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/router')
    lines.push('')
  }

  // Collect imported types from typesImport if provided
  if (typesImport) {
    const importedTypes = new Set<string>()

    for (const op of [...doc.operations, ...doc.webhooks]) {
      const { baseName } = opNameMap.get(op)!

      if (op.parameters.some(p => p.in === 'path')) {
        importedTypes.add(`${baseName}PathParams`)
      }
      if (op.parameters.some(p => p.in === 'query')) {
        importedTypes.add(`${baseName}QueryParams`)
      }
      if (getQuerystringParameter(op.parameters)) {
        importedTypes.add(`${baseName}QueryString`)
      }
      if (op.parameters.some(p => p.in === 'header')) {
        importedTypes.add(`${baseName}HeaderParams`)
      }
      if (op.requestBody && hasGeneratedRequestBodyType(op.requestBody)) {
        importedTypes.add(`${baseName}Body`)
      }
      if (hasGeneratedResponseType(op.responses)) {
        importedTypes.add(`${baseName}Response`)
      }
      if (hasGeneratedResponseHeaders(op.responses)) {
        importedTypes.add(`${baseName}ResponseHeaders`)
      }
    }

    const sortedTypes = [...importedTypes].sort()
    if (sortedTypes.length > 0) {
      lines.push(`import type { ${sortedTypes.join(', ')} } from '${typesImport}'`)
      lines.push('')
    }
  }

  if (contextImport) {
    const typeName = contextTypeName || 'AppContext'
    lines.push(`import type { ${typeName} } from '${contextImport}'`)
    lines.push('')
  }

  // Common response wrapper type
  lines.push(`export type HandlerResponse<TSuccess = unknown, TErrorMap = Record<number, unknown>, THeaders = Record<string, string>> =`)
  lines.push(`  | TSuccess`)
  lines.push(`  | { status: 200; body: TSuccess; headers?: THeaders }`)
  lines.push(`  | { [K in keyof TErrorMap]: { status: K; body: TErrorMap[K]; headers?: Record<string, string> } }[keyof TErrorMap]`)
  lines.push('')

  const defaultContextGeneric = contextTypeName
    ? contextTypeName
    : contextImport
      ? 'AppContext'
      : 'unknown'

  // Generate context and handler types for each standard operation
  for (const op of doc.operations) {
    const { baseName } = opNameMap.get(op)!
    const methodUpper = op.method.toUpperCase()

    const pathParams = op.parameters.filter(p => p.in === 'path')
    const queryParams = op.parameters.filter(p => p.in === 'query')
    const querystringParam = getQuerystringParameter(op.parameters)
    const headerParams = op.parameters.filter(p => p.in === 'header')
    const hasBody = !!op.requestBody
    const isBodyRequired = op.requestBody?.required === true

    // Context interface
    const contextLines: string[] = []
    if (pathParams.length > 0) {
      const typeStr = typesImport ? `${baseName}PathParams` : 'Record<string, string>'
      contextLines.push(`  params: ${typeStr}`)
    }
    if (queryParams.length > 0) {
      const typeStr = typesImport ? `${baseName}QueryParams` : 'Record<string, unknown>'
      contextLines.push(`  query?: ${typeStr}`)
    }
    if (querystringParam) {
      const typeStr = typesImport ? `${baseName}QueryString` : 'string'
      contextLines.push(`  querystring?: ${typeStr}`)
    }
    if (headerParams.length > 0) {
      const typeStr = typesImport ? `${baseName}HeaderParams` : 'Record<string, string>'
      contextLines.push(`  headers?: ${typeStr}`)
    }
    if (hasBody) {
      const isTyped = typesImport && hasGeneratedRequestBodyType(op.requestBody!)
      const typeStr = isTyped ? `${baseName}Body` : 'unknown'
      contextLines.push(`  body${isBodyRequired ? '' : '?'}: ${typeStr}`)
    }
    contextLines.push(`  context?: TContext`)

    if (op.summary || op.description) {
      lines.push(formatJSDoc(op.summary ?? op.description))
    } else {
      lines.push(`/** Context for ${methodUpper} ${op.openApiPath} */`)
    }

    lines.push(`export interface ${baseName}Context<TContext = ${defaultContextGeneric}> {`)
    lines.push(...contextLines)
    lines.push(`}`)
    lines.push('')

    // Handler type
    const status = pickDefaultStatus(op.responses)
    let bodyType = 'unknown'
    if (status === 204) {
      bodyType = 'void'
    } else if (typesImport && hasGeneratedResponseType(op.responses)) {
      bodyType = `${baseName}Response`
    }

    const hasTypedHeaders = !!typesImport && hasGeneratedResponseHeaders(op.responses)
    const genericArg = hasTypedHeaders
      ? `<${bodyType}, Record<number, unknown>, Partial<${baseName}ResponseHeaders>>`
      : `<${bodyType}>`

    const isCtxRequired = pathParams.length > 0 || isBodyRequired
    const ctxParam = isCtxRequired
      ? `ctx: ${baseName}Context<TContext>`
      : `ctx?: ${baseName}Context<TContext>`

    lines.push(`/** Handler signature for ${methodUpper} ${op.openApiPath} */`)
    lines.push(`export type ${baseName}Handler<TContext = ${defaultContextGeneric}> = (`)
    lines.push(`  ${ctxParam}`)
    lines.push(`) => HandlerResponse${genericArg} | Promise<HandlerResponse${genericArg}>`)
    lines.push('')
  }

  // Generate context and handler types for webhooks
  if (doc.webhooks.length > 0) {
    lines.push('// ─── Webhooks ─────────────────────────────────────────────────')
    lines.push('')

    for (const op of doc.webhooks) {
      const { baseName } = opNameMap.get(op)!
      const methodUpper = op.method.toUpperCase()

      const pathParams = op.parameters.filter(p => p.in === 'path')
      const queryParams = op.parameters.filter(p => p.in === 'query')
      const querystringParam = getQuerystringParameter(op.parameters)
      const headerParams = op.parameters.filter(p => p.in === 'header')
      const hasBody = !!op.requestBody
      const isBodyRequired = op.requestBody?.required === true

      const contextLines: string[] = []
      if (pathParams.length > 0) {
        const typeStr = typesImport ? `${baseName}PathParams` : 'Record<string, string>'
        contextLines.push(`  params: ${typeStr}`)
      }
      if (queryParams.length > 0) {
        const typeStr = typesImport ? `${baseName}QueryParams` : 'Record<string, unknown>'
        contextLines.push(`  query?: ${typeStr}`)
      }
      if (querystringParam) {
        const typeStr = typesImport ? `${baseName}QueryString` : 'string'
        contextLines.push(`  querystring?: ${typeStr}`)
      }
      if (headerParams.length > 0) {
        const typeStr = typesImport ? `${baseName}HeaderParams` : 'Record<string, string>'
        contextLines.push(`  headers?: ${typeStr}`)
      }
      if (hasBody) {
        const isTyped = typesImport && hasGeneratedRequestBodyType(op.requestBody!)
        const typeStr = isTyped ? `${baseName}Body` : 'unknown'
        contextLines.push(`  body${isBodyRequired ? '' : '?'}: ${typeStr}`)
      }
      contextLines.push(`  context?: TContext`)

      if (op.summary || op.description) {
        lines.push(formatJSDoc(op.summary ?? op.description))
      } else {
        lines.push(`/** Context for webhook ${methodUpper} ${op.openApiPath} */`)
      }

      lines.push(`export interface ${baseName}WebhookContext<TContext = ${defaultContextGeneric}> {`)
      lines.push(...contextLines)
      lines.push(`}`)
      lines.push('')

      const isCtxRequired = pathParams.length > 0 || isBodyRequired
      const ctxParam = isCtxRequired
        ? `ctx: ${baseName}WebhookContext<TContext>`
        : `ctx?: ${baseName}WebhookContext<TContext>`

      lines.push(`/** Handler signature for webhook ${methodUpper} ${op.openApiPath} */`)
      lines.push(`export type ${baseName}WebhookHandler<TContext = ${defaultContextGeneric}> = (`)
      lines.push(`  ${ctxParam}`)
      lines.push(`) => HandlerResponse<unknown> | Promise<HandlerResponse<unknown>>`)
      lines.push('')
    }
  }

  // Aggregate ApiHandlers interface
  lines.push(`/**`)
  lines.push(` * Aggregate interface of all API operation handlers.`)
  lines.push(` * Decoupled from server routing frameworks.`)
  lines.push(` */`)
  const hasOperations = doc.operations.length > 0 || doc.webhooks.length > 0
  lines.push(
    hasOperations
      ? `export interface ${contractName}<TContext = ${defaultContextGeneric}> {`
      : `export interface ${contractName} {`,
  )

  for (const op of doc.operations) {
    const { baseName, methodName } = opNameMap.get(op)!

    if (op.summary || op.description) {
      lines.push(formatJSDoc(op.summary ?? op.description, '  '))
    }
    lines.push(`  ${methodName}: ${baseName}Handler<TContext>`)
  }

  if (doc.webhooks.length > 0) {
    for (const op of doc.webhooks) {
      const { baseName, methodName } = opNameMap.get(op)!

      if (op.summary || op.description) {
        lines.push(formatJSDoc(op.summary ?? op.description, '  '))
      }
      lines.push(`  ${methodName}?: ${baseName}WebhookHandler<TContext>`)
    }
  }

  lines.push(`}`)
  lines.push('')

  return formatGeneratedTs(lines.join('\n'))
}
