import type { OasDocument, ParsedDocument } from '@oa-sdk/parser'
import { parseDocument } from '@oa-sdk/parser'
import { createOperationTypeNameMap } from '@oa-sdk/core'
import type { JsonPrimitive, Resolved } from '@oa-sdk/core'

export interface TanstackGenerationOptions {
  typesImport?: string | undefined
  clientImport?: string | undefined
  keysImport?: string | undefined
  queryPackage?: string | undefined // defaults to '@tanstack/react-query'
  tier?: 'all' | 'keys' | 'options' | 'hooks' | undefined
  split?: boolean | undefined
  banner?: boolean | undefined
}

export interface TanstackGeneratedArtifacts {
  keysCode?: string | undefined
  queriesCode?: string | undefined
  hooksCode?: string | undefined
  combinedCode?: string | undefined
}

function toCamelCase(str: string): string {
  if (!str) return 'operation'
  const cleaned = str.replace(/[-_]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1)
}

function toPascalCase(str: string): string {
  const camel = toCamelCase(str)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

/**
 * Tier 1: Hierarchical Query Key Factory Generator
 */
export function generateKeyFactory(
  spec: OasDocument | ParsedDocument,
  options: TanstackGenerationOptions = {},
): string {
  const doc = 'operations' in spec ? spec : parseDocument(spec)
  const { typesImport, banner = true } = options
  const lines: string[] = []

  if (banner) {
    lines.push('// Auto-generated Query Keys from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/client (Tier 1: Query Key Factory)')
    lines.push('')
  }

  if (typesImport) {
    lines.push(`import type * as Types from '${typesImport}'`)
    lines.push('')
  }

  const opNameMap = createOperationTypeNameMap([...doc.operations, ...doc.webhooks])

  // Group operations by tag
  const tagMap = new Map<string, typeof doc.operations>()
  for (const op of doc.operations) {
    const primaryTag = op.tags?.[0] || 'default'
    if (!tagMap.has(primaryTag)) {
      tagMap.set(primaryTag, [])
    }
    tagMap.get(primaryTag)!.push(op)
  }

  for (const [tag, ops] of tagMap.entries()) {
    const factoryConst = `${toCamelCase(tag)}Keys`
    lines.push(`export const ${factoryConst} = {`)
    lines.push(`  all: ['${toKebab(tag)}'] as const,`)
    lines.push(`  lists: () => [...${factoryConst}.all, 'list'] as const,`)
    lines.push(
      `  list: (filters?: Record<string, unknown>) =>`,
      `    filters !== undefined ? ([...${factoryConst}.lists(), filters] as const) : ([...${factoryConst}.lists()] as const),`,
    )
    lines.push(`  details: () => [...${factoryConst}.all, 'detail'] as const,`)
    lines.push(
      `  detail: (id: string | number) => [...${factoryConst}.details(), String(id)] as const,`,
    )
    lines.push('')

    // Operation-specific query keys
    for (const op of ops) {
      if (!op.operationId) continue
      const baseName = opNameMap.get(op.operationId) || op.operationId
      const opMethod = toCamelCase(baseName)
      const isQuery = op.method.toLowerCase() === 'get' || op.method.toLowerCase() === 'head'

      if (isQuery) {
        const pathParams = op.parameters.filter(p => p.in === 'path')
        const queryParams = op.parameters.filter(p => p.in === 'query')

        if (pathParams.length > 0 && queryParams.length > 0) {
          lines.push(`  ${opMethod}: (params: Record<string, string>, query?: Record<string, unknown>) =>`)
          lines.push(`    query !== undefined`)
          lines.push(`      ? ([...${factoryConst}.detail(params.${pathParams[0].name}), query] as const)`)
          lines.push(`      : ([...${factoryConst}.detail(params.${pathParams[0].name})] as const),`)
        } else if (pathParams.length > 0) {
          lines.push(`  ${opMethod}: (params: Record<string, string>) =>`)
          lines.push(`    [...${factoryConst}.detail(params.${pathParams[0].name})] as const,`)
        } else if (queryParams.length > 0) {
          lines.push(`  ${opMethod}: (query?: Record<string, unknown>) => ${factoryConst}.list(query),`)
        } else {
          lines.push(`  ${opMethod}: () => [...${factoryConst}.all, '${opMethod}'] as const,`)
        }
      } else {
        // Mutation keys
        const pathParams = op.parameters.filter(p => p.in === 'path')
        if (pathParams.length > 0) {
          lines.push(
            `  ${opMethod}: (id: string | number) => [...${factoryConst}.detail(id), '${opMethod}'] as const,`,
          )
        } else {
          lines.push(`  ${opMethod}: () => [...${factoryConst}.all, '${opMethod}'] as const,`)
        }
      }
    }

    lines.push('} as const')
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Tier 2: Pure Query & Mutation Options Factory Generator
 */
export function generatePureOptionsFactory(
  spec: OasDocument | ParsedDocument,
  options: TanstackGenerationOptions = {},
): string {
  const doc = 'operations' in spec ? spec : parseDocument(spec)
  const {
    typesImport,
    keysImport,
    clientImport,
    queryPackage = '@tanstack/react-query',
    banner = true,
  } = options
  const lines: string[] = []

  if (banner) {
    lines.push('// Auto-generated Query & Mutation Options from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/client (Tier 2: Pure Options Factory)')
    lines.push('')
  }

  lines.push(`import { queryOptions, mutationOptions } from '${queryPackage}'`)
  lines.push(`import type { UndefinedInitialDataOptions, UseMutationOptions } from '${queryPackage}'`)
  lines.push(`import type { JsonPrimitive, Resolved } from '@oa-sdk/client'`)
  if (typesImport) lines.push(`import type * as Types from '${typesImport}'`)
  if (keysImport) lines.push(`import * as Keys from '${keysImport}'`)
  if (clientImport) lines.push(`import type { ApiClient } from '${clientImport}'`)
  lines.push('')

  const opNameMap = createOperationTypeNameMap([...doc.operations, ...doc.webhooks])

  for (const op of doc.operations) {
    if (!op.operationId) continue
    const baseName = opNameMap.get(op.operationId) || op.operationId
    const opMethod = toCamelCase(baseName)
    const primaryTag = op.tags?.[0] || 'default'
    const factoryConst = keysImport ? `Keys.${toCamelCase(primaryTag)}Keys` : `${toCamelCase(primaryTag)}Keys`
    const isQuery = op.method.toLowerCase() === 'get' || op.method.toLowerCase() === 'head'

    const pathParams = op.parameters.filter(p => p.in === 'path')
    const queryParams = op.parameters.filter(p => p.in === 'query')
    const hasBody = !!op.requestBody

    if (isQuery) {
      lines.push(`/**`)
      lines.push(` * Pure query options for ${op.operationId} (${op.method.toUpperCase()} ${op.path})`)
      lines.push(` * Reusable across React, Vue, Svelte, and Next.js SSR (prefetchQuery).`)
      lines.push(` */`)
      lines.push(`export function ${opMethod}QueryOptions<TData = JsonPrimitive<unknown>>(`)
      lines.push(`  client: any,`)
      if (pathParams.length > 0) lines.push(`  params: Record<string, string>,`)
      if (queryParams.length > 0) lines.push(`  query?: Record<string, unknown>,`)
      lines.push(`  options?: any,`)
      lines.push(`) {`)
      lines.push(`  return queryOptions({`)
      if (pathParams.length > 0 && queryParams.length > 0) {
        lines.push(`    queryKey: ${factoryConst}.${opMethod}(params, query),`)
        lines.push(`    queryFn: async ({ signal }: { signal?: AbortSignal }) => client.${opMethod}(params, query),`)
      } else if (pathParams.length > 0) {
        lines.push(`    queryKey: ${factoryConst}.${opMethod}(params),`)
        lines.push(`    queryFn: async ({ signal }: { signal?: AbortSignal }) => client.${opMethod}(params),`)
      } else if (queryParams.length > 0) {
        lines.push(`    queryKey: ${factoryConst}.${opMethod}(query),`)
        lines.push(`    queryFn: async ({ signal }: { signal?: AbortSignal }) => client.${opMethod}(query),`)
      } else {
        lines.push(`    queryKey: ${factoryConst}.${opMethod}(),`)
        lines.push(`    queryFn: async ({ signal }: { signal?: AbortSignal }) => client.${opMethod}(),`)
      }
      lines.push(`    ...options,`)
      lines.push(`  })`)
      lines.push(`}`)
      lines.push('')
    } else {
      // Mutation options
      const varType = `${toPascalCase(baseName)}Variables`
      lines.push(`export type ${varType} = {`)
      if (pathParams.length > 0) lines.push(`  params: Record<string, string>`)
      if (hasBody) lines.push(`  body: Resolved<unknown>`)
      lines.push(`}`)
      lines.push('')

      lines.push(`/**`)
      lines.push(` * Pure mutation options for ${op.operationId} (${op.method.toUpperCase()} ${op.path})`)
      lines.push(` */`)
      lines.push(`export function ${opMethod}MutationOptions<TContext = unknown>(`)
      lines.push(`  client: any,`)
      lines.push(`  options?: any,`)
      lines.push(`) {`)
      lines.push(`  return mutationOptions({`)
      if (pathParams.length > 0) {
        lines.push(`    mutationKey: ${factoryConst}.${opMethod}('default'),`)
      } else {
        lines.push(`    mutationKey: ${factoryConst}.${opMethod}(),`)
      }
      lines.push(`    mutationFn: async (variables: ${varType}) => {`)
      if (pathParams.length > 0 && hasBody) {
        lines.push(`      return client.${opMethod}(variables.params, variables.body)`)
      } else if (hasBody) {
        lines.push(`      return client.${opMethod}(variables.body)`)
      } else if (pathParams.length > 0) {
        lines.push(`      return client.${opMethod}(variables.params)`)
      } else {
        lines.push(`      return client.${opMethod}()`)
      }
      lines.push(`    },`)
      lines.push(`    ...options,`)
      lines.push(`  })`)
      lines.push(`}`)
      lines.push('')
    }
  }

  return lines.join('\n')
}

/**
 * Tier 3: Client Composition Hook Helpers Generator
 */
export function generateHookHelpers(
  spec: OasDocument | ParsedDocument,
  options: TanstackGenerationOptions = {},
): string {
  const doc = 'operations' in spec ? spec : parseDocument(spec)
  const { queryPackage = '@tanstack/react-query', banner = true } = options
  const lines: string[] = []

  if (banner) {
    lines.push("'use client'")
    lines.push('// Auto-generated React Hooks from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/client (Tier 3: Client Composition Hook Helpers)')
    lines.push('')
  }

  lines.push(`import { useQuery, useMutation } from '${queryPackage}'`)
  lines.push(`import type { UseQueryOptions, UseMutationOptions, QueryClient } from '${queryPackage}'`)
  lines.push(`import type { JsonPrimitive } from '@oa-sdk/client'`)
  lines.push('')

  const opNameMap = createOperationTypeNameMap([...doc.operations, ...doc.webhooks])
  const hookEntries: Array<{ name: string; hook: string }> = []

  for (const op of doc.operations) {
    if (!op.operationId) continue
    const baseName = opNameMap.get(op.operationId) || op.operationId
    const opMethod = toCamelCase(baseName)
    const isQuery = op.method.toLowerCase() === 'get' || op.method.toLowerCase() === 'head'

    const pathParams = op.parameters.filter(p => p.in === 'path')
    const queryParams = op.parameters.filter(p => p.in === 'query')

    if (isQuery) {
      const hookName = `use${toPascalCase(baseName)}Query`
      lines.push(`export function ${hookName}<TData = JsonPrimitive<unknown>>(`)
      lines.push(`  client: any,`)
      if (pathParams.length > 0) lines.push(`  params: Record<string, string>,`)
      if (queryParams.length > 0) lines.push(`  query?: Record<string, unknown>,`)
      lines.push(`  options?: any,`)
      lines.push(`  queryClient?: QueryClient,`)
      lines.push(`) {`)
      if (pathParams.length > 0 && queryParams.length > 0) {
        lines.push(`  return useQuery(${opMethod}QueryOptions(client, params, query, options), queryClient)`)
      } else if (pathParams.length > 0) {
        lines.push(`  return useQuery(${opMethod}QueryOptions(client, params, options), queryClient)`)
      } else if (queryParams.length > 0) {
        lines.push(`  return useQuery(${opMethod}QueryOptions(client, query, options), queryClient)`)
      } else {
        lines.push(`  return useQuery(${opMethod}QueryOptions(client, options), queryClient)`)
      }
      lines.push(`}`)
      lines.push('')
      hookEntries.push({ name: opMethod, hook: hookName })
    } else {
      const hookName = `use${toPascalCase(baseName)}Mutation`
      lines.push(`export function ${hookName}<TContext = unknown>(`)
      lines.push(`  client: any,`)
      lines.push(`  options?: any,`)
      lines.push(`  queryClient?: QueryClient,`)
      lines.push(`) {`)
      lines.push(`  return useMutation(${opMethod}MutationOptions(client, options), queryClient)`)
      lines.push(`}`)
      lines.push('')
      hookEntries.push({ name: opMethod, hook: hookName })
    }
  }

  // Create Context Hook Factory
  lines.push(`/**`)
  lines.push(` * Context binding helper: binds React Context client once to create zero-parameter hooks.`)
  lines.push(` */`)
  lines.push(`export function createApiHooks(useClient: () => any) {`)
  lines.push(`  return {`)
  for (const entry of hookEntries) {
    lines.push(`    ${entry.name}: (...args: any[]) => ${entry.hook}(useClient(), ...args),`)
  }
  lines.push(`  }`)
  lines.push(`}`)
  lines.push('')

  return lines.join('\n')
}

/**
 * Top-Level TanStack Query Generator
 */
export function generateTanstackQuery(
  spec: OasDocument | ParsedDocument,
  options: TanstackGenerationOptions = {},
): TanstackGeneratedArtifacts {
  const { split = false } = options

  if (split) {
    const keysCode = generateKeyFactory(spec, options)
    const queriesCode = generatePureOptionsFactory(spec, options)
    const hooksCode = generateHookHelpers(spec, options)
    return { keysCode, queriesCode, hooksCode }
  } else {
    const keysCode = generateKeyFactory(spec, { ...options, banner: false })
    const queriesCode = generatePureOptionsFactory(spec, { ...options, banner: false })
    const hooksCode = generateHookHelpers(spec, { ...options, banner: false })

    const combinedLines = [
      '// Auto-generated TanStack Query v5 3-Tier Client. Do not edit.',
      '// @oa-sdk/client (Tiers 1, 2, 3)',
      '',
      keysCode,
      '',
      queriesCode,
      '',
      hooksCode,
    ]

    return {
      combinedCode: combinedLines.join('\n'),
      keysCode,
      queriesCode,
      hooksCode,
    }
  }
}

function toKebab(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
}

/**
 * Runtime wire-format normalization helpers for testing.
 */
export function toWireJson<T>(value: T): JsonPrimitive<T> {
  if (value === null || value === undefined) {
    return value as any
  }
  if (typeof value === 'bigint') {
    throw new TypeError('Do not know how to serialize a BigInt')
  }
  return JSON.parse(JSON.stringify(value))
}

export function toResolved<T>(value: T): Resolved<T> {
  return toWireJson(value) as any
}
