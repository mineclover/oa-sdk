/**
 * Tier 1: Hierarchical Query Key Factory Generator
 *
 * Generates structured, type-safe query key trees:
 * - all: [tag] as const
 * - lists: () => [tag, 'list'] as const
 * - list: (filters) => [tag, 'list', filters] as const
 * - details: () => [tag, 'detail'] as const
 * - detail: (id) => [tag, 'detail', id] as const
 * - subresource: (id, subresource, query) => [tag, 'detail', id, subresource, query]
 * - mutation: (operationId) => [tag, 'mutation', operationId]
 *
 * Emitted code uses pure TypeScript tuples (as const) with ZERO external dependencies.
 */

import type { OperationEntry, ParsedDocument } from '@oa-sdk/parser'
import {
  createOperationTypeNameMap,
  formatGeneratedTs,
  toOperationMethodName,
  toTypeScriptIdentifier,
} from '@oa-sdk/core/browser'

export interface KeyFactoryOptions {
  /** Path to import generated API types from (e.g. './types.js') */
  typesImport?: string | undefined
  /** Whether to add auto-generated comment banner */
  banner?: boolean | undefined
  /** In combined mode, omit redundant imports and banner */
  isCombined?: boolean | undefined
}

export interface TagGroup {
  tag: string
  factoryName: string
  aliasName?: string | undefined
  operations: OperationEntry[]
}

/**
 * Determines if an operation is classified as a query (GET, HEAD, QUERY, or x-oa-sdk-query: true).
 */
export function isQueryOperation(op: OperationEntry): boolean {
  if (op['x-oa-sdk-query'] === true) return true
  if (op['x-oa-sdk-mutation'] === true) return false
  const m = op.method.toLowerCase()
  return m === 'get' || m === 'head' || m === 'query'
}

/**
 * Extracts primary tag from an operation, falling back to first path segment or 'api'.
 */
export function getOperationTag(op: OperationEntry): string {
  const firstTag = op.tags?.[0]
  if (firstTag && firstTag.trim()) {
    return firstTag.trim()
  }
  const segments = op.openApiPath.split('/').filter(Boolean)
  const firstSeg = segments[0]
  if (firstSeg && !firstSeg.startsWith('{')) {
    return firstSeg
  }
  return 'api'
}


/**
 * Normalizes tag into a camelCase factory name ending in 'Keys' (e.g. 'users' -> 'usersKeys', 'user' -> 'userKeys', 'API' -> 'apiKeys').
 */
export function toKeyFactoryName(tag: string): string {
  const normalizedTag = tag === tag.toUpperCase() ? tag.toLowerCase() : tag
  const ident = toTypeScriptIdentifier(normalizedTag)
  const base = toOperationMethodName(ident)
  return `${base}Keys`
}


/**
 * Computes alternative alias name (e.g. 'usersKeys' <-> 'userKeys').
 */
function getAliasFactoryName(tag: string, currentFactoryName: string): string | undefined {
  const lower = tag.toLowerCase()
  if (lower.endsWith('s') && lower.length > 1) {
    const singular = tag.slice(0, -1)
    const alias = toKeyFactoryName(singular)
    if (alias !== currentFactoryName) return alias
  } else {
    const plural = `${tag}s`
    const alias = toKeyFactoryName(plural)
    if (alias !== currentFactoryName) return alias
  }
  return undefined
}

/**
 * Groups operations in a ParsedDocument by their primary tag.
 */
export function groupOperationsByTag(doc: ParsedDocument): TagGroup[] {
  const map = new Map<string, OperationEntry[]>()

  for (const op of doc.operations) {
    if (!op.operationId) continue
    const tag = getOperationTag(op)
    const list = map.get(tag) ?? []
    list.push(op)
    map.set(tag, list)
  }

  // Pass 1: Establish primary factory names across all groups
  const groups: TagGroup[] = []
  const primaryFactoryNames = new Set<string>()

  for (const [tag, operations] of map.entries()) {
    const factoryName = toKeyFactoryName(tag)
    primaryFactoryNames.add(factoryName)
    groups.push({ tag, factoryName, operations })
  }

  // Pass 2: Safely assign non-colliding aliases
  const assignedAliases = new Set<string>()
  for (const group of groups) {
    const candidateAlias = getAliasFactoryName(group.tag, group.factoryName)
    if (
      candidateAlias &&
      !primaryFactoryNames.has(candidateAlias) &&
      !assignedAliases.has(candidateAlias)
    ) {
      group.aliasName = candidateAlias
      assignedAliases.add(candidateAlias)
    }
  }

  return groups.sort((a, b) => a.tag.localeCompare(b.tag))
}

/**
 * Parses path segments relative to the tag prefix to find subresources and parameters.
 */
function parseSubresourceInfo(path: string, _tag: string): {
  idParam?: string | undefined
  subresource?: string | undefined
  subIdParam?: string | undefined
} {
  const parts = path.split('/').filter(Boolean)
  let idParam: string | undefined
  let subresource: string | undefined
  let subIdParam: string | undefined

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) continue
    if (part.startsWith('{') && part.endsWith('}')) {
      const pName = part.slice(1, -1)
      if (!idParam) {
        idParam = pName
      } else if (!subIdParam && subresource) {
        subIdParam = pName
      }
    } else if (idParam && !subresource) {
      subresource = part
    }
  }

  return { idParam, subresource, subIdParam }
}


/**
 * Generates Tier 1 Query Key Factory source code.
 */
export function generateKeyFactory(doc: ParsedDocument, options: KeyFactoryOptions = {}): string {
  const lines: string[] = []
  const { typesImport, banner = true, isCombined = false } = options

  if (banner && !isCombined) {
    lines.push('// Auto-generated Query Keys from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/client (Tier 1: Query Key Factory)')
    lines.push('')
  }

  const operationNames = createOperationTypeNameMap(doc.operations)
  const groups = groupOperationsByTag(doc)

  // Collect type imports if needed (suppressed in combined mode)
  if (typesImport && !isCombined) {
    const neededTypes = new Set<string>()
    for (const op of doc.operations) {
      if (!op.operationId || !isQueryOperation(op)) continue
      const baseName = operationNames.get(op.operationId)!
      const pathParams = op.parameters.filter(p => p.in === 'path')
      const queryParams = op.parameters.filter(p => p.in === 'query')
      if (pathParams.length > 0) neededTypes.add(`${baseName}PathParams`)
      if (queryParams.length > 0) neededTypes.add(`${baseName}QueryParams`)
    }

    if (neededTypes.size > 0) {
      const sortedTypes = [...neededTypes].sort().join(', ')
      lines.push(`import type { ${sortedTypes} } from '${typesImport}'`)
      lines.push('')
    }
  }

  const exportedFactories: string[] = []

  for (const group of groups) {
    const { tag, factoryName, aliasName, operations } = group
    exportedFactories.push(factoryName)

    lines.push(`export const ${factoryName} = {`)
    lines.push(`  all: ['${tag}'] as const,`)
    lines.push(`  lists: () => [...${factoryName}.all, 'list'] as const,`)
    lines.push(`  list: <TFilter extends Record<string, unknown> = Record<string, unknown>>(filters?: TFilter) =>`)
    lines.push(`    filters !== undefined`)
    lines.push(`      ? ([...${factoryName}.lists(), filters] as const)`)
    lines.push(`      : ([...${factoryName}.lists()] as const),`)
    lines.push(`  details: () => [...${factoryName}.all, 'detail'] as const,`)
    lines.push(`  detail: (id: string | number) => [...${factoryName}.details(), String(id)] as const,`)
    lines.push(`  subresource: <TQuery extends Record<string, unknown> = Record<string, unknown>>(`)
    lines.push(`    id: string | number,`)
    lines.push(`    subresource: string,`)
    lines.push(`    query?: TQuery,`)
    lines.push(`  ) =>`)
    lines.push(`    query !== undefined`)
    lines.push(`      ? ([...${factoryName}.detail(id), subresource, query] as const)`)
    lines.push(`      : ([...${factoryName}.detail(id), subresource] as const),`)
    lines.push(`  mutation: (operationId: string) => [...${factoryName}.all, 'mutation', operationId] as const,`)
    lines.push('')

    // Operation-specific query and mutation keys
    for (const op of operations) {
      if (!op.operationId) continue
      const baseName = operationNames.get(op.operationId)!
      const methodName = toOperationMethodName(baseName)
      const pathParams = op.parameters.filter(p => p.in === 'path')
      const queryParams = op.parameters.filter(p => p.in === 'query')
      const isQuery = isQueryOperation(op)

      const pathType = typesImport && pathParams.length > 0
        ? `${baseName}PathParams`
        : 'Record<string, string | number>'
      const queryType = typesImport && queryParams.length > 0
        ? `${baseName}QueryParams`
        : 'Record<string, unknown>'

      if (isQuery) {
        const { idParam, subresource, subIdParam } = parseSubresourceInfo(op.openApiPath, tag)

        if (pathParams.length === 0) {
          // List / collection query key
          if (queryParams.length > 0) {
            lines.push(`  ${methodName}: (query?: ${queryType}) => ${factoryName}.list(query),`)
          } else {
            lines.push(`  ${methodName}: () => ${factoryName}.lists(),`)
          }
        } else if (pathParams.length === 1 && !subresource) {
          // Detail query key: [tag, 'detail', id, (query)]
          const firstPathParam = pathParams[0]
          const pName = idParam ?? firstPathParam?.name ?? 'id'
          if (queryParams.length > 0) {
            lines.push(`  ${methodName}: (params: ${pathType}, query?: ${queryType}) =>`)
            lines.push(`    query !== undefined`)
            lines.push(`      ? ([...${factoryName}.detail(params.${pName}), query] as const)`)
            lines.push(`      : ([...${factoryName}.detail(params.${pName})] as const),`)
          } else {
            lines.push(`  ${methodName}: (params: ${pathType}) => ${factoryName}.detail(params.${pName}),`)
          }
        } else if (subresource) {
          // Subresource query key: [tag, 'detail', id, subresource, (subId), (query)]
          const firstPathParam = pathParams[0]
          const pName = idParam ?? firstPathParam?.name ?? 'id'
          if (subIdParam) {
            const secondPathParam = pathParams[1]
            const subParamName = secondPathParam?.name ?? subIdParam
            if (queryParams.length > 0) {
              lines.push(`  ${methodName}: (params: ${pathType}, query?: ${queryType}) =>`)
              lines.push(`    query !== undefined`)
              lines.push(`      ? ([...${factoryName}.detail(params.${pName}), '${subresource}', String(params.${subParamName}), query] as const)`)
              lines.push(`      : ([...${factoryName}.detail(params.${pName}), '${subresource}', String(params.${subParamName})] as const),`)
            } else {
              lines.push(`  ${methodName}: (params: ${pathType}) =>`)
              lines.push(`    [...${factoryName}.detail(params.${pName}), '${subresource}', String(params.${subParamName})] as const,`)
            }
          } else {
            if (queryParams.length > 0) {
              lines.push(`  ${methodName}: (params: ${pathType}, query?: ${queryType}) =>`)
              lines.push(`    ${factoryName}.subresource(params.${pName}, '${subresource}', query),`)
            } else {
              lines.push(`  ${methodName}: (params: ${pathType}) =>`)
              lines.push(`    ${factoryName}.subresource(params.${pName}, '${subresource}'),`)
            }
          }
        } else {
          // General path param query
          const firstPathParam = pathParams[0]
          const pName = firstPathParam?.name ?? 'id'
          if (queryParams.length > 0) {
            lines.push(`  ${methodName}: (params: ${pathType}, query?: ${queryType}) =>`)
            lines.push(`    query !== undefined`)
            lines.push(`      ? ([...${factoryName}.detail(params.${pName}), query] as const)`)
            lines.push(`      : ([...${factoryName}.detail(params.${pName})] as const),`)
          } else {
            lines.push(`  ${methodName}: (params: ${pathType}) => ${factoryName}.detail(params.${pName}),`)
          }
        }
      } else {
        // Mutation key: [tag, 'mutation', operationId]
        if (pathParams.length > 0) {
          const firstPathParam = pathParams[0]
          const pName = firstPathParam?.name ?? 'id'
          lines.push(`  ${methodName}: (id?: string | number) =>`)
          lines.push(`    id !== undefined`)
          lines.push(`      ? ([...${factoryName}.detail(id), 'mutation', '${op.operationId}'] as const)`)
          lines.push(`      : ${factoryName}.mutation('${op.operationId}'),`)
        } else {

          lines.push(`  ${methodName}: () => ${factoryName}.mutation('${op.operationId}'),`)
        }
      }
    }

    lines.push('} as const')
    lines.push('')

    if (aliasName && !groups.some(g => g.factoryName === aliasName)) {
      lines.push(`export const ${aliasName} = ${factoryName}`)
      lines.push('')
    }
  }

  // Aggregate queryKeys
  lines.push('export const queryKeys = {')
  for (const group of groups) {
    const keyProp = toOperationMethodName(toTypeScriptIdentifier(group.tag))
    lines.push(`  ${keyProp}: ${group.factoryName},`)
  }
  lines.push('} as const')
  lines.push('')
  lines.push('export type QueryKeys = typeof queryKeys')
  lines.push('')

  return formatGeneratedTs(lines.join('\n'))
}
