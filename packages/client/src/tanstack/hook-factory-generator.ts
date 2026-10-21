/**
 * Tier 3: Client Composition Hook Helpers Generator
 *
 * Generates ergonomic React hook wrappers (use*Query, use*Mutation) wrapping
 * the pure options factories while exposing open generics (TData, TContext)
 * and options overrides (select, enabled, staleTime, retry, etc.).
 * Also emits createApiHooks(useClient) context binding helper.
 */

import type { OasRequestBody, OasResponse, OperationEntry, ParsedDocument } from '@oa-sdk/parser'
import {
  createOperationTypeNameMap,
  formatGeneratedTs,
  toOperationMethodName,
} from '@oa-sdk/core/browser'
import { getOperationTag, groupOperationsByTag, isQueryOperation, isStreamingOperation, toKeyFactoryName } from './key-factory-generator.js'
import { detectPagination } from './options-factory-generator.js'

export interface HookFactoryOptions {
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
  /** Path to import query options from (e.g. './queries.js'). If omitted, assumes options are in scope */
  queriesImport?: string | undefined
  /** Whether to add auto-generated comment banner */
  banner?: boolean | undefined
  /** In combined mode, omit redundant imports */
  isCombined?: boolean | undefined
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

function hasGeneratedRequestBodyType(requestBody?: OasRequestBody): boolean {
  if (!requestBody || typeof requestBody !== 'object') return false
  const jsonContent = requestBody.content?.['application/json']
  return !!jsonContent && !('$ref' in jsonContent) && jsonContent.schema !== undefined
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
 * Generates Tier 3 Client Composition Hook Helpers source code.
 */
export function generateHookFactory(doc: ParsedDocument, options: HookFactoryOptions = {}): string {
  const lines: string[] = []
  const {
    queryPackage = '@tanstack/react-query',
    typesImport,
    clientImport = './client.js',
    clientName = 'ApiClient',
    keysImport,
    queriesImport,
    banner = true,
    isCombined = false,
  } = options

  if (banner && !isCombined) {
    lines.push('// Auto-generated React Hooks from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/client (Tier 3: Client Composition Hook Helpers)')
    lines.push("'use client'")
    lines.push('')
  }

  const operationNames = createOperationTypeNameMap(doc.operations)
  const groups = groupOperationsByTag(doc)

  const hasPagination = doc.operations.some(op => !isStreamingOperation(op) && detectPagination(op) !== null)
  const hasQueryWithTypedBody = Boolean(typesImport) && doc.operations.some(
    op => Boolean(op.operationId) && !isStreamingOperation(op) && isQueryOperation(op) && hasGeneratedRequestBodyType(op.requestBody),
  )

  if (!isCombined) {
    const fnImports = ['useQuery', 'useMutation']
    if (hasPagination) fnImports.push('useInfiniteQuery')
    lines.push(`import { ${fnImports.join(', ')} } from '${queryPackage}'`)

    const typeImports = [
      'UseQueryOptions',
      'UseQueryResult',
      'UseMutationOptions',
      'UseMutationResult',
      'QueryClient',
    ]
    if (hasPagination) {
      typeImports.push('UseInfiniteQueryOptions', 'UseInfiniteQueryResult', 'InfiniteData')
    }
    lines.push(`import type { ${typeImports.join(', ')} } from '${queryPackage}'`)
    lines.push(`import type { ${hasQueryWithTypedBody ? 'JsonPrimitive, Resolved' : 'JsonPrimitive'} } from '@oa-sdk/client'`)
    lines.push('')

    if (typesImport) {
      const typeImports = new Set<string>()
      for (const op of doc.operations) {
        if (!op.operationId) continue
        if (isStreamingOperation(op)) continue
        const baseName = operationNames.get(op.operationId)!
        const isQuery = isQueryOperation(op)
        const pathParams = op.parameters.filter(p => p.in === 'path')
        const queryParams = op.parameters.filter(p => p.in === 'query')
        const querystringParam = op.parameters.find(p => p.in === 'querystring')
        const headerParams = op.parameters.filter(p => p.in === 'header')

        if (isQuery) {
          if (pathParams.length > 0) typeImports.add(`${baseName}PathParams`)
          if (queryParams.length > 0) typeImports.add(`${baseName}QueryParams`)
          if (querystringParam) typeImports.add(`${baseName}QueryString`)
          if (headerParams.length > 0) typeImports.add(`${baseName}HeaderParams`)
          if (hasGeneratedRequestBodyType(op.requestBody)) typeImports.add(`${baseName}Body`)
        }
        if (hasGeneratedResponseType(op.responses)) typeImports.add(`${baseName}Response`)
        if (hasGeneratedErrorType(op.responses)) typeImports.add(`${baseName}Error`)
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

    if (queriesImport) {
      const optionFunctions: string[] = []
      const varTypes: string[] = []
      for (const op of doc.operations) {
        if (!op.operationId) continue
        if (isStreamingOperation(op)) continue
        const baseName = operationNames.get(op.operationId)!
        const methodName = toOperationMethodName(baseName)
        if (isQueryOperation(op)) {
          optionFunctions.push(`${methodName}QueryOptions`)
          if (detectPagination(op)) {
            optionFunctions.push(`${methodName}InfiniteQueryOptions`)
          }
        } else {
          optionFunctions.push(`${methodName}MutationOptions`)
          varTypes.push(`${baseName}Variables`)
        }
      }
      const importsList = [...optionFunctions, ...varTypes.map(v => `type ${v}`)].join(', ')
      lines.push(`import { ${importsList} } from '${queriesImport}'`)
    }

    lines.push('')
  }

  // Generate Individual Hooks
  for (const op of doc.operations) {
    if (!op.operationId) continue
    // Streaming operations are consumed through the streaming client, not cached hooks.
    if (isStreamingOperation(op)) continue
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
    // HTTP error bodies plus transport failures (network errors, aborts, ApiClientResponseError).
    const errorType = typesImport && hasGeneratedErrorType(op.responses) ? `${baseName}Error | Error` : 'Error'

    if (isQuery) {
      const funcParams: string[] = [`client: ${clientName}`]
      const forwardArgs: string[] = []

      if (pathParams.length > 0) {
        funcParams.push(`params: ${typesImport ? `${baseName}PathParams` : 'Record<string, string>'}`)
        forwardArgs.push('params')
      }
      if (hasBody && bodyRequired) {
        funcParams.push(`body: ${typesImport && hasTypedBody ? `Resolved<${baseName}Body>` : 'unknown'}`)
        forwardArgs.push('body')
      }
      if (querystringParam?.required === true) {
        funcParams.push(`querystring: ${typesImport ? `${baseName}QueryString` : 'string'}`)
        forwardArgs.push('querystring')
      }
      if (queryParams.length > 0) {
        funcParams.push(`query?: ${typesImport ? `${baseName}QueryParams` : 'Record<string, unknown>'}`)
        forwardArgs.push('query')
      }
      if (querystringParam && !querystringParam.required) {
        funcParams.push(`querystring?: ${typesImport ? `${baseName}QueryString` : 'string'}`)
        forwardArgs.push('querystring')
      }
      if (hasBody && !bodyRequired) {
        funcParams.push(`body?: ${typesImport && hasTypedBody ? `Resolved<${baseName}Body>` : 'unknown'}`)
        forwardArgs.push('body')
      }
      if (headerParams.length > 0) {
        funcParams.push(`headers?: ${typesImport ? `${baseName}HeaderParams` : 'Record<string, unknown>'}`)
        forwardArgs.push('headers')
      }

      const optionsParam = `options?: Omit<UseQueryOptions<${returnDataType}, ${errorType}, TData, ReturnType<typeof ${factoryName}.${methodName}>>, 'queryKey' | 'queryFn'>`
      funcParams.push(optionsParam)
      funcParams.push('queryClient?: QueryClient')

      const callArgs = forwardArgs.length > 0 ? `${forwardArgs.join(', ')}, options` : 'options'

      lines.push(`export function use${baseName}Query<TData = ${returnDataType}>(`)
      lines.push(`  ${funcParams.join(',\n  ')},`)
      lines.push(`): UseQueryResult<TData, ${errorType}> {`)
      lines.push(`  return useQuery(${methodName}QueryOptions(client, ${callArgs}), queryClient)`)
      lines.push(`}`)
      lines.push('')

      const pagination = detectPagination(op)
      if (pagination) {
        const defaultPageParamType = pagination.type === 'cursor' ? 'string | null' : 'number'
        const infiniteFuncParams: string[] = [`client: ${clientName}`]
        const infiniteForwardArgs: string[] = []

        if (pathParams.length > 0) {
          infiniteFuncParams.push(`params: ${typesImport ? `${baseName}PathParams` : 'Record<string, string>'}`)
          infiniteForwardArgs.push('params')
        }
        if (hasBody && bodyRequired) {
          infiniteFuncParams.push(`body: ${typesImport && hasTypedBody ? `Resolved<${baseName}Body>` : 'unknown'}`)
          infiniteForwardArgs.push('body')
        }
        if (querystringParam?.required === true) {
          infiniteFuncParams.push(`querystring: ${typesImport ? `${baseName}QueryString` : 'string'}`)
          infiniteForwardArgs.push('querystring')
        }
        if (queryParams.length > 0) {
          infiniteFuncParams.push(`query?: ${typesImport ? `${baseName}QueryParams` : 'Record<string, unknown>'}`)
          infiniteForwardArgs.push('query')
        }
        if (querystringParam && !querystringParam.required) {
          infiniteFuncParams.push(`querystring?: ${typesImport ? `${baseName}QueryString` : 'string'}`)
          infiniteForwardArgs.push('querystring')
        }
        if (hasBody && !bodyRequired) {
          infiniteFuncParams.push(`body?: ${typesImport && hasTypedBody ? `Resolved<${baseName}Body>` : 'unknown'}`)
          infiniteForwardArgs.push('body')
        }
        if (headerParams.length > 0) {
          infiniteFuncParams.push(`headers?: ${typesImport ? `${baseName}HeaderParams` : 'Record<string, unknown>'}`)
          infiniteForwardArgs.push('headers')
        }

        const infiniteKeyType = `readonly [...ReturnType<typeof ${factoryName}.${methodName}>, 'infinite']`
        const infiniteOptionsParam = `options?: Omit<UseInfiniteQueryOptions<${returnDataType}, ${errorType}, TData, ${infiniteKeyType}, TPageParam>, 'queryKey' | 'queryFn'>`
        infiniteFuncParams.push(infiniteOptionsParam)
        infiniteFuncParams.push('queryClient?: QueryClient')

        const infiniteCallArgs = infiniteForwardArgs.length > 0 ? `${infiniteForwardArgs.join(', ')}, options` : 'options'

        lines.push(`export function use${baseName}InfiniteQuery<`)
        lines.push(`  TData = InfiniteData<${returnDataType}>,`)
        lines.push(`  TPageParam = ${defaultPageParamType},`)
        lines.push(`>(`)
        lines.push(`  ${infiniteFuncParams.join(',\n  ')},`)
        lines.push(`): UseInfiniteQueryResult<TData, ${errorType}> {`)
        lines.push(`  return useInfiniteQuery(${methodName}InfiniteQueryOptions(client, ${infiniteCallArgs}), queryClient)`)
        lines.push(`}`)
        lines.push('')
      }
    } else {
      const varsType = `${baseName}Variables`
      const optionsParam = `options?: Omit<UseMutationOptions<${returnDataType}, ${errorType}, ${varsType}, TContext>, 'mutationKey' | 'mutationFn'>`

      lines.push(`export function use${baseName}Mutation<TContext = unknown>(`)
      lines.push(`  client: ${clientName},`)
      lines.push(`  ${optionsParam},`)
      lines.push(`  queryClient?: QueryClient,`)
      lines.push(`): UseMutationResult<${returnDataType}, ${errorType}, ${varsType}, TContext> {`)
      lines.push(`  return useMutation(${methodName}MutationOptions(client, options), queryClient)`)
      lines.push(`}`)
      lines.push('')
    }
  }

  // Generate createApiHooks Context Binding Helper
  lines.push('/**')
  lines.push(' * Context binding helper: binds a React Context client hook (e.g. useApiClient)')
  lines.push(" * to create zero-client hooks that don't require passing the client instance on every call.")
  lines.push(' */')
  lines.push(`export function createApiHooks(useClient: () => ${clientName}) {`)
  lines.push('  return {')

  for (const op of doc.operations) {
    if (!op.operationId) continue
    if (isStreamingOperation(op)) continue
    const baseName = operationNames.get(op.operationId)!
    const methodName = toOperationMethodName(baseName)
    const tag = getOperationTag(op)
    const factoryName = toKeyFactoryName(tag)
    const isQuery = isQueryOperation(op)
    const pagination = isQuery ? detectPagination(op) : null

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
    // HTTP error bodies plus transport failures (network errors, aborts, ApiClientResponseError).
    const errorType = typesImport && hasGeneratedErrorType(op.responses) ? `${baseName}Error | Error` : 'Error'

    if (isQuery) {
      const boundParams: string[] = []
      const forwardArgs: string[] = []

      if (pathParams.length > 0) {
        boundParams.push(`params: ${typesImport ? `${baseName}PathParams` : 'Record<string, string>'}`)
        forwardArgs.push('params')
      }
      if (hasBody && bodyRequired) {
        boundParams.push(`body: ${typesImport && hasTypedBody ? `Resolved<${baseName}Body>` : 'unknown'}`)
        forwardArgs.push('body')
      }
      if (querystringParam?.required === true) {
        boundParams.push(`querystring: ${typesImport ? `${baseName}QueryString` : 'string'}`)
        forwardArgs.push('querystring')
      }
      if (queryParams.length > 0) {
        boundParams.push(`query?: ${typesImport ? `${baseName}QueryParams` : 'Record<string, unknown>'}`)
        forwardArgs.push('query')
      }
      if (querystringParam && !querystringParam.required) {
        boundParams.push(`querystring?: ${typesImport ? `${baseName}QueryString` : 'string'}`)
        forwardArgs.push('querystring')
      }
      if (hasBody && !bodyRequired) {
        boundParams.push(`body?: ${typesImport && hasTypedBody ? `Resolved<${baseName}Body>` : 'unknown'}`)
        forwardArgs.push('body')
      }
      if (headerParams.length > 0) {
        boundParams.push(`headers?: ${typesImport ? `${baseName}HeaderParams` : 'Record<string, unknown>'}`)
        forwardArgs.push('headers')
      }

      const optionsParam = `options?: Omit<UseQueryOptions<${returnDataType}, ${errorType}, TData, ReturnType<typeof ${factoryName}.${methodName}>>, 'queryKey' | 'queryFn'>`
      boundParams.push(optionsParam)
      boundParams.push('queryClient?: QueryClient')

      const callArgs = forwardArgs.length > 0 ? `${forwardArgs.join(', ')}, options, queryClient` : 'options, queryClient'

      lines.push(`    use${baseName}: <TData = ${returnDataType}>(`)
      lines.push(`      ${boundParams.join(',\n      ')}`)
      lines.push(`    ) => use${baseName}Query(useClient(), ${callArgs}),`)

      if (pagination) {
        const defaultPageParamType = pagination.type === 'cursor' ? 'string | null' : 'number'
        const boundInfiniteParams: string[] = []
        const forwardInfiniteArgs: string[] = []

        if (pathParams.length > 0) {
          boundInfiniteParams.push(`params: ${typesImport ? `${baseName}PathParams` : 'Record<string, string>'}`)
          forwardInfiniteArgs.push('params')
        }
        if (hasBody && bodyRequired) {
          boundInfiniteParams.push(`body: ${typesImport && hasTypedBody ? `Resolved<${baseName}Body>` : 'unknown'}`)
          forwardInfiniteArgs.push('body')
        }
        if (querystringParam?.required === true) {
          boundInfiniteParams.push(`querystring: ${typesImport ? `${baseName}QueryString` : 'string'}`)
          forwardInfiniteArgs.push('querystring')
        }
        if (queryParams.length > 0) {
          boundInfiniteParams.push(`query?: ${typesImport ? `${baseName}QueryParams` : 'Record<string, unknown>'}`)
          forwardInfiniteArgs.push('query')
        }
        if (querystringParam && !querystringParam.required) {
          boundInfiniteParams.push(`querystring?: ${typesImport ? `${baseName}QueryString` : 'string'}`)
          forwardInfiniteArgs.push('querystring')
        }
        if (hasBody && !bodyRequired) {
          boundInfiniteParams.push(`body?: ${typesImport && hasTypedBody ? `Resolved<${baseName}Body>` : 'unknown'}`)
          forwardInfiniteArgs.push('body')
        }
        if (headerParams.length > 0) {
          boundInfiniteParams.push(`headers?: ${typesImport ? `${baseName}HeaderParams` : 'Record<string, unknown>'}`)
          forwardInfiniteArgs.push('headers')
        }

        const infiniteKeyType = `readonly [...ReturnType<typeof ${factoryName}.${methodName}>, 'infinite']`
        const infiniteOptionsParam = `options?: Omit<UseInfiniteQueryOptions<${returnDataType}, ${errorType}, TData, ${infiniteKeyType}, TPageParam>, 'queryKey' | 'queryFn'>`
        boundInfiniteParams.push(infiniteOptionsParam)
        boundInfiniteParams.push('queryClient?: QueryClient')

        const boundCallArgs = forwardInfiniteArgs.length > 0 ? `${forwardInfiniteArgs.join(', ')}, options, queryClient` : 'options, queryClient'

        lines.push(`    use${baseName}Infinite: <`)
        lines.push(`      TData = InfiniteData<${returnDataType}>,`)
        lines.push(`      TPageParam = ${defaultPageParamType},`)
        lines.push(`    >(`)
        lines.push(`      ${boundInfiniteParams.join(',\n      ')}`)
        lines.push(`    ) => use${baseName}InfiniteQuery(useClient(), ${boundCallArgs}),`)
      }
    } else {
      const varsType = `${baseName}Variables`
      const optionsParam = `options?: Omit<UseMutationOptions<${returnDataType}, ${errorType}, ${varsType}, TContext>, 'mutationKey' | 'mutationFn'>`

      lines.push(`    use${baseName}: <TContext = unknown>(`)
      lines.push(`      ${optionsParam},`)
      lines.push(`      queryClient?: QueryClient,`)
      lines.push(`    ) => use${baseName}Mutation(useClient(), options, queryClient),`)
    }
  }

  lines.push('  }')
  lines.push('}')
  lines.push('')

  return formatGeneratedTs(lines.join('\n'))
}
