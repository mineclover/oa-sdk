/**
 * Master Orchestrator for TanStack Query v5 3-Tier Code Generation
 *
 * Coordinates Tier 1 (Keys), Tier 2 (Options), and Tier 3 (Hooks),
 * producing both modular split files and an all-in-one combined file.
 */

import type { OasDocument, OasRequestBody, OasResponse, ParsedDocument } from '@oa-sdk/parser'
import { assertParsedDocumentComplete, isParsedDocument, parseDocument } from '@oa-sdk/parser'
import { createOperationTypeNameMap, formatGeneratedTs } from '@oa-sdk/core/browser'
import { generateKeyFactory, type KeyFactoryOptions } from './key-factory-generator.js'
import { generateOptionsFactory, detectPagination, type OptionsFactoryOptions } from './options-factory-generator.js'
import { generateHookFactory, type HookFactoryOptions } from './hook-factory-generator.js'

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

function hasGeneratedErrorType(responses: Record<string, OasResponse>): boolean {
  const errorCodes = Object.keys(responses).filter(k => /^[45]\d{2}$/.test(k) || k === 'default').sort()
  for (const key of errorCodes) {
    const response = responses[key]
    const media = response?.content?.['application/json']
    if (media && !('$ref' in media) && media.schema !== undefined) return true
  }
  return false
}

export interface TanstackQueryOptions {
  /** Target query framework package. Defaults to '@tanstack/react-query' */
  queryPackage?: string | undefined
  /** Path to import generated API types from (e.g. './types.js') */
  typesImport?: string | undefined
  /** Path to import client SDK from (e.g. './client.js'). Defaults to './client.js' */
  clientImport?: string | undefined
  /** Client type name to use for client parameter. Defaults to 'ApiClient' */
  clientName?: string | undefined
  /** Import path for generated keys file (used by split queries and hooks). Defaults to './keys.js' */
  keysImport?: string | undefined
  /** Import path for generated queries file (used by split hooks). Defaults to './queries.js' */
  queriesImport?: string | undefined
  /** Base path for resolving relative external $refs if an unparsed OasDocument is passed */
  basePath?: string | undefined
  /** Which tiers to generate: 'all' | 'keys' | 'options' | 'hooks'. Defaults to 'all' */
  tier?: 'all' | 'keys' | 'options' | 'hooks' | undefined
  /** Whether to include Tier 3 React hooks. Defaults to true */
  includeHooks?: boolean | undefined
  /** Whether to add auto-generated comment banner. Defaults to true */
  banner?: boolean | undefined
}


export interface TanstackQueryOutput {
  /** Tier 1: Query Key Factories source code */
  keysCode: string
  /** Tier 2: Pure Query & Mutation Options source code */
  queriesCode: string
  /** Tier 3: Client Composition React Hooks source code */
  hooksCode: string
  /** Complete 3-tier combined single-file source code */
  combinedCode: string
}

/**
 * Generates a unified 3-tier combined file containing Keys, Options, and Hooks.
 */
function generateCombinedFile(doc: ParsedDocument, options: TanstackQueryOptions): string {
  const {
    queryPackage = '@tanstack/react-query',
    typesImport,
    clientImport = './client.js',
    clientName = 'ApiClient',
    banner = true,
    includeHooks = true,
    tier = 'all',
  } = options

  const lines: string[] = []

  if (banner) {
    lines.push('// Auto-generated TanStack Query v5 3-Tier Client from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/client (Tiers 1, 2, 3: Keys, Options, Hooks)')
    if (includeHooks && tier !== 'keys' && tier !== 'options') {
      lines.push("'use client'")
    }
    lines.push('')
  }

  // Unified Header Imports
  const shouldIncludeHooks = includeHooks && tier !== 'keys' && tier !== 'options'
  const shouldIncludeOptions = tier !== 'keys'
  const hasPagination = doc.operations.some(op => detectPagination(op) !== null)

  if (shouldIncludeHooks) {
    const imports = ['queryOptions', 'mutationOptions', 'useQuery', 'useMutation']
    if (hasPagination) {
      imports.push('infiniteQueryOptions', 'useInfiniteQuery')
    }
    lines.push(`import { ${imports.join(', ')} } from '${queryPackage}'`)
    lines.push(`import type {`)
    lines.push(`  UndefinedInitialDataOptions,`)
    if (hasPagination) {
      lines.push(`  UndefinedInitialDataInfiniteOptions,`)
      lines.push(`  InfiniteData,`)
    }
    lines.push(`  UseMutationOptions,`)
    lines.push(`  UseQueryOptions,`)
    lines.push(`  UseQueryResult,`)
    if (hasPagination) {
      lines.push(`  UseInfiniteQueryOptions,`)
      lines.push(`  UseInfiniteQueryResult,`)
    }
    lines.push(`  UseMutationResult,`)
    lines.push(`  QueryClient,`)
    lines.push(`} from '${queryPackage}'`)
  } else if (shouldIncludeOptions) {
    const imports = ['queryOptions', 'mutationOptions']
    if (hasPagination) {
      imports.push('infiniteQueryOptions')
    }
    lines.push(`import { ${imports.join(', ')} } from '${queryPackage}'`)
    if (hasPagination) {
      lines.push(`import type { UndefinedInitialDataOptions, UndefinedInitialDataInfiniteOptions, InfiniteData, UseMutationOptions } from '${queryPackage}'`)
    } else {
      lines.push(`import type { UndefinedInitialDataOptions, UseMutationOptions } from '${queryPackage}'`)
    }
  }

  if (shouldIncludeOptions) {
    lines.push(`import type { JsonPrimitive, Resolved } from '@oa-sdk/client'`)
  }

  if (typesImport) {
    const operationNames = createOperationTypeNameMap(doc.operations)
    const neededTypes = new Set<string>()
    for (const op of doc.operations) {
      if (!op.operationId) continue
      const baseName = operationNames.get(op.operationId) ?? (op.operationId.charAt(0).toUpperCase() + op.operationId.slice(1))
      if (op.parameters.some(p => p.in === 'path')) neededTypes.add(`${baseName}PathParams`)
      if (op.parameters.some(p => p.in === 'query')) neededTypes.add(`${baseName}QueryParams`)
      if (op.parameters.some(p => p.in === 'querystring')) neededTypes.add(`${baseName}QueryString`)
      if (op.parameters.some(p => p.in === 'header')) neededTypes.add(`${baseName}HeaderParams`)
      if (hasGeneratedRequestBodyType(op.requestBody) || op.requestBody) neededTypes.add(`${baseName}Body`)
      if (hasGeneratedResponseType(op.responses) || (op.responses && Object.keys(op.responses).length > 0)) neededTypes.add(`${baseName}Response`)
      neededTypes.add(`${baseName}ClientError`)
    }
    if (neededTypes.size > 0) {
      const sortedTypes = [...neededTypes].sort().join(', ')
      lines.push(`import type { ${sortedTypes} } from '${typesImport}'`)
    }
  }

  if (clientImport && (shouldIncludeOptions || shouldIncludeHooks)) {
    lines.push(`import type { ${clientName} } from '${clientImport}'`)
  }

  lines.push('')

  // Tier 1: Keys
  const keysCode = generateKeyFactory(doc, {
    typesImport: options.typesImport,
    banner: false,
    isCombined: true,
  })
  lines.push('// ─── Tier 1: Query Key Factories ──────────────────────────────────────────')
  lines.push('')
  lines.push(keysCode)
  lines.push('')

  // Tier 2: Options
  if (shouldIncludeOptions) {
    const optionsCode = generateOptionsFactory(doc, {
      ...options,
      banner: false,
      isCombined: true,
    })
    lines.push('// ─── Tier 2: Pure Query & Mutation Options ────────────────────────────────')
    lines.push('')
    lines.push(optionsCode)
    lines.push('')
  }

  // Tier 3: Hooks
  if (shouldIncludeHooks) {
    const hooksCode = generateHookFactory(doc, {
      ...options,
      banner: false,
      isCombined: true,
    })
    lines.push('// ─── Tier 3: Client Composition Hooks ─────────────────────────────────────')
    lines.push('')
    lines.push(hooksCode)
    lines.push('')
  }

  return formatGeneratedTs(lines.join('\n'))
}

/**
 * Generates TanStack Query v5 3-tier artifacts from an OpenAPI specification.
 *
 * @param spec Raw OasDocument or pre-parsed ParsedDocument IR
 * @param options Generator options for query package, imports, and tier selection
 * @returns TanstackQueryOutput with keysCode, queriesCode, hooksCode, and combinedCode
 */
export function generateTanstackQuery(
  spec: OasDocument | ParsedDocument,
  options: TanstackQueryOptions = {},
): TanstackQueryOutput {
  const doc = isParsedDocument(spec)
    ? spec
    : options.basePath !== undefined
      ? parseDocument(spec, { basePath: options.basePath })
      : parseDocument(spec)

  assertParsedDocumentComplete(doc, '@oa-sdk/client generateTanstackQuery')

  const keysImport = options.keysImport ?? './keys.js'
  const queriesImport = options.queriesImport ?? './queries.js'

  const keysCode = generateKeyFactory(doc, {
    typesImport: options.typesImport,
    banner: options.banner,
  })

  const queriesCode = generateOptionsFactory(doc, {
    queryPackage: options.queryPackage,
    typesImport: options.typesImport,
    clientImport: options.clientImport,
    clientName: options.clientName,
    keysImport,
    banner: options.banner,
  })

  const hooksCode = options.includeHooks !== false
    ? generateHookFactory(doc, {
        queryPackage: options.queryPackage,
        typesImport: options.typesImport,
        clientImport: options.clientImport,
        clientName: options.clientName,
        keysImport,
        queriesImport,
        banner: options.banner,
      })
    : ''

  const combinedCode = generateCombinedFile(doc, options)

  return {
    keysCode,
    queriesCode,
    hooksCode,
    combinedCode,
  }
}
