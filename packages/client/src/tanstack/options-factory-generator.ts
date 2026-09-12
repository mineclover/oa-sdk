/**
 * Tier 2: Pure Query & Mutation Options Factory Generator
 *
 * Generates pure TanStack Query v5 queryOptions() and mutationOptions() factory functions.
 * Zero UI framework lock-in: directly reusable across React, Vue, Svelte,
 * and Next.js App Router Server Components / prefetchQuery().
 *
 * Wires operation parameters: path params, query params, headers, and request body.
 * Enforces wire typing with JsonPrimitive<TResponse> and Resolved<TBody>.
 */

import type { OasRequestBody, OasResponse, OperationEntry, ParsedDocument } from '@oa-sdk/parser'
import {
  createOperationTypeNameMap,
  formatGeneratedTs,
  toOperationMethodName,
} from '@oa-sdk/core/browser'
import { getOperationTag, groupOperationsByTag, isQueryOperation, toKeyFactoryName } from './key-factory-generator.js'

export interface OptionsFactoryOptions {
  /** Target query package (default: '@tanstack/react-query') */
  queryPackage?: string | undefined
  /** Path to import generated API types from (e.g. './types.js') */
  typesImport?: string | undefined
  /** Path to import client SDK from (e.g. './client.js'). Default: './client.js' */
  clientImport?: string | undefined
  /** Type name of the client class/interface. Default: 'ApiClient' */
  clientName?: string | undefined
  /** Path to import keys factory from (e.g. './keys.js'). If omitted, assumes keys are in scope */
  keysImport?: string | undefined
  /** Whether to add auto-generated comment banner */
  banner?: boolean | undefined
  /** In combined mode, omit redundant imports */
  isCombined?: boolean | undefined
}

function hasGeneratedRequestBodyType(requestBody?: OasRequestBody): boolean {
  if (!requestBody || typeof requestBody !== 'object') return false
  const jsonContent = requestBody.content?.['application/json']
  return !!jsonContent && !('$ref' in jsonContent) && jsonContent.schema !== undefined
}

function hasGeneratedResponseType(responses: Record<string, OasResponse>): boolean {
  const codes = Object.keys(responses).filter(k => /^2\d{2}$/.test(k) || k === 'default').sort()
  const key = codes[0]
  if (!key) return false
  const response = responses[key]
  if (!response || typeof response !== 'object') return false
  const jsonContent = response.content?.['application/json']
  return !!jsonContent && !('$ref' in jsonContent) && jsonContent.schema !== undefined
}

function hasDocumentedSuccessResponseBody(responses: Record<string, OasResponse>): boolean {
  return Object.entries(responses).some(([status, response]) => {
    if (!(/^[2]\d{2}$/.test(status) || /^2XX$/i.test(status) || status === 'default')) return false
    if (status === '204' || status === '205') return false
    return response?.content !== undefined && Object.keys(response.content).length > 0
  })
}

function hasGeneratedErrorType(responses: Record<string, OasResponse>): boolean {
  const errorCodes = Object.keys(responses).filter(k => /^[45]\d{2}$/.test(k) || k === 'default').sort()
  for (const key of errorCodes) {
    const response = responses[key]
    const media = response?.content?.['application/json']
    if (media && !('$ref' in media) && media.schema !== undefined) return true
  }
  return false
}


/**
 * Generates Tier 2 Query & Mutation Options Factory source code.
 */
export function generateOptionsFactory(doc: ParsedDocument, options: OptionsFactoryOptions = {}): string {
  const lines: string[] = []
  const {
    queryPackage = '@tanstack/react-query',
    typesImport,
    clientImport = './client.js',
    clientName = 'ApiClient',
    keysImport,
    banner = true,
    isCombined = false,
  } = options

  if (banner && !isCombined) {
    lines.push('// Auto-generated Query & Mutation Options from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/client (Tier 2: Pure Options Factory)')
    lines.push('')
  }

  const operationNames = createOperationTypeNameMap(doc.operations)
  const groups = groupOperationsByTag(doc)

  // Imports
  if (!isCombined) {
    lines.push(`import { queryOptions, mutationOptions } from '${queryPackage}'`)
    lines.push(`import type { UndefinedInitialDataOptions, UseMutationOptions } from '${queryPackage}'`)
    lines.push(`import type { JsonPrimitive, Resolved } from '@oa-sdk/client'`)
    lines.push('')

    if (typesImport) {
      const typeImports = new Set<string>()
      for (const op of doc.operations) {
        if (!op.operationId) continue
        const baseName = operationNames.get(op.operationId)!
        const pathParams = op.parameters.filter(p => p.in === 'path')
        const queryParams = op.parameters.filter(p => p.in === 'query')
        const querystringParam = op.parameters.find(p => p.in === 'querystring')
        const headerParams = op.parameters.filter(p => p.in === 'header')

        if (pathParams.length > 0) typeImports.add(`${baseName}PathParams`)
        if (queryParams.length > 0) typeImports.add(`${baseName}QueryParams`)
        if (querystringParam) typeImports.add(`${baseName}QueryString`)
        if (headerParams.length > 0) typeImports.add(`${baseName}HeaderParams`)
        if (hasGeneratedRequestBodyType(op.requestBody)) typeImports.add(`${baseName}Body`)
        if (hasGeneratedResponseType(op.responses)) typeImports.add(`${baseName}Response`)
        if (hasGeneratedErrorType(op.responses)) typeImports.add(`${baseName}ClientError`)
      }

      if (typeImports.size > 0) {
        const sorted = [...typeImports].sort().join(', ')
        lines.push(`import type { ${sorted} } from '${typesImport}'`)
        lines.push('')
      }
    }

    lines.push(`import type { ${clientName} } from '${clientImport}'`)

    if (keysImport) {
      const factoryNames = groups.map(g => g.factoryName)
      lines.push(`import { ${factoryNames.join(', ')} } from '${keysImport}'`)
    }
    lines.push('')
  }

  // 1. Mutation Variables Types
  for (const op of doc.operations) {
    if (!op.operationId || isQueryOperation(op)) continue
    const baseName = operationNames.get(op.operationId)!
    const pathParams = op.parameters.filter(p => p.in === 'path')
    const queryParams = op.parameters.filter(p => p.in === 'query')
    const querystringParam = op.parameters.find(p => p.in === 'querystring')
    const headerParams = op.parameters.filter(p => p.in === 'header')
    const hasBody = !!op.requestBody
    const bodyRequired = op.requestBody?.required === true
    const hasTypedBody = hasGeneratedRequestBodyType(op.requestBody)

    const hasVariables = pathParams.length > 0 || hasBody || queryParams.length > 0 || !!querystringParam || headerParams.length > 0

    if (!hasVariables) {
      lines.push(`export type ${baseName}Variables = void`)
      lines.push('')
      continue
    }

    lines.push(`export type ${baseName}Variables = {`)
    if (pathParams.length > 0) {
      lines.push(`  params: ${typesImport ? `${baseName}PathParams` : 'Record<string, string>'}`)
    }
    if (hasBody) {
      const bType = typesImport && hasTypedBody ? `Resolved<${baseName}Body>` : 'unknown'
      lines.push(`  body${bodyRequired ? '' : '?'}: ${bType}`)
    }
    if (queryParams.length > 0) {
      lines.push(`  query?: ${typesImport ? `${baseName}QueryParams` : 'Record<string, unknown>'}`)
    }
    if (querystringParam) {
      const qType = typesImport ? `${baseName}QueryString` : 'string'
      lines.push(`  querystring${querystringParam.required ? '' : '?'}: ${qType}`)
    }
    if (headerParams.length > 0) {
      lines.push(`  headers?: ${typesImport ? `${baseName}HeaderParams` : 'Record<string, unknown>'}`)
    }
    lines.push('}')
    lines.push('')
  }

  // 2. Query & Mutation Options Factories
  for (const op of doc.operations) {
    if (!op.operationId) continue
    const baseName = operationNames.get(op.operationId)!
    const methodName = toOperationMethodName(baseName)
    const tag = getOperationTag(op)
    const factoryName = toKeyFactoryName(tag)
    const isQuery = isQueryOperation(op)

    const pathParams = op.parameters.filter(p => p.in === 'path')
    const queryParams = op.parameters.filter(p => p.in === 'query')
    const querystringParam = op.parameters.find(p => p.in === 'querystring')
    const headerParams = op.parameters.filter(p => p.in === 'header')
    const hasBody = !!op.requestBody
    const bodyRequired = op.requestBody?.required === true
    const hasTypedBody = hasGeneratedRequestBodyType(op.requestBody)
    const hasTypedResponse = hasGeneratedResponseType(op.responses)
    const hasResponse = hasDocumentedSuccessResponseBody(op.responses)

    const responseType = typesImport && hasTypedResponse ? `${baseName}Response` : 'unknown'
    const returnDataType = hasResponse ? `JsonPrimitive<${responseType}>` : 'void'
    const errorType = typesImport && hasGeneratedErrorType(op.responses) ? `${baseName}ClientError` : 'Error'

    if (isQuery) {
      // Query Options
      const funcParams: string[] = [`client: ${clientName}`]
      const clientCallArgs: string[] = []

      if (pathParams.length > 0) {
        funcParams.push(`params: ${typesImport ? `${baseName}PathParams` : 'Record<string, string>'}`)
        clientCallArgs.push('params')
      }
      if (hasBody && bodyRequired) {
        funcParams.push(`body: ${typesImport && hasTypedBody ? `Resolved<${baseName}Body>` : 'unknown'}`)
        clientCallArgs.push('body')
      }
      if (querystringParam?.required === true) {
        funcParams.push(`querystring: ${typesImport ? `${baseName}QueryString` : 'string'}`)
        clientCallArgs.push('querystring')
      }
      if (queryParams.length > 0) {
        funcParams.push(`query?: ${typesImport ? `${baseName}QueryParams` : 'Record<string, unknown>'}`)
        clientCallArgs.push('query')
      }
      if (querystringParam && !querystringParam.required) {
        funcParams.push(`querystring?: ${typesImport ? `${baseName}QueryString` : 'string'}`)
        clientCallArgs.push('querystring')
      }
      if (hasBody && !bodyRequired) {
        funcParams.push(`body?: ${typesImport && hasTypedBody ? `Resolved<${baseName}Body>` : 'unknown'}`)
        clientCallArgs.push('body')
      }
      if (headerParams.length > 0) {
        funcParams.push(`headers?: ${typesImport ? `${baseName}HeaderParams` : 'Record<string, unknown>'}`)
        clientCallArgs.push('headers')
      }

      // Compute query key invocation
      const keyArgs: string[] = []
      if (pathParams.length > 0) keyArgs.push('params')
      if (queryParams.length > 0) keyArgs.push('query')
      const keyCall = `${factoryName}.${methodName}(${keyArgs.join(', ')})`

      const optionsParam = `options?: Omit<UndefinedInitialDataOptions<${returnDataType}, ${errorType}, TData, ReturnType<typeof ${factoryName}.${methodName}>>, 'queryKey' | 'queryFn'>`
      funcParams.push(optionsParam)

      lines.push(`/**`)
      lines.push(` * Pure query options for ${methodName} (${op.method.toUpperCase()} ${op.openApiPath})`)
      lines.push(` * Reusable across React, Vue, Svelte, and Next.js SSR / prefetchQuery().`)
      lines.push(` */`)
      lines.push(`export function ${methodName}QueryOptions<TData = ${returnDataType}>(`)
      lines.push(`  ${funcParams.join(',\n  ')},`)
      lines.push(`) {`)
      lines.push(`  return queryOptions({`)
      lines.push(`    queryKey: ${keyCall},`)
      lines.push(`    queryFn: async ({ signal }): Promise<${returnDataType}> => {`)
      lines.push(`      return client.${methodName}(${clientCallArgs.join(', ')})`)
      lines.push(`    },`)
      lines.push(`    ...options,`)
      lines.push(`  })`)
      lines.push(`}`)
      lines.push('')
    } else {
      // Mutation Options
      const hasVariables = pathParams.length > 0 || hasBody || queryParams.length > 0 || !!querystringParam || headerParams.length > 0
      const clientCallArgs: string[] = []

      if (pathParams.length > 0) clientCallArgs.push('variables.params')
      if (hasBody && bodyRequired) clientCallArgs.push('variables.body')
      if (querystringParam?.required === true) clientCallArgs.push('variables.querystring')
      if (queryParams.length > 0) clientCallArgs.push('variables.query')
      if (querystringParam && !querystringParam.required) clientCallArgs.push('variables.querystring')
      if (hasBody && !bodyRequired) clientCallArgs.push('variables.body')
      if (headerParams.length > 0) clientCallArgs.push('variables.headers')

      const varsType = `${baseName}Variables`
      const optionsParam = `options?: Omit<UseMutationOptions<${returnDataType}, ${errorType}, ${varsType}, TContext>, 'mutationKey' | 'mutationFn'>`

      lines.push(`/**`)
      lines.push(` * Pure mutation options for ${methodName} (${op.method.toUpperCase()} ${op.openApiPath})`)
      lines.push(` */`)
      lines.push(`export function ${methodName}MutationOptions<TContext = unknown>(`)
      lines.push(`  client: ${clientName},`)
      lines.push(`  ${optionsParam},`)
      lines.push(`) {`)
      lines.push(`  return mutationOptions({`)
      lines.push(`    mutationKey: ${factoryName}.${methodName}(),`)
      if (hasVariables) {
        lines.push(`    mutationFn: async (variables: ${varsType}): Promise<${returnDataType}> => {`)
        lines.push(`      return client.${methodName}(${clientCallArgs.join(', ')})`)
        lines.push(`    },`)
      } else {
        lines.push(`    mutationFn: async (): Promise<${returnDataType}> => {`)
        lines.push(`      return client.${methodName}()`)
        lines.push(`    },`)
      }
      lines.push(`    ...options,`)
      lines.push(`  })`)
      lines.push(`}`)
      lines.push('')
    }
  }

  return formatGeneratedTs(lines.join('\n'))
}
