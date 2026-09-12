import type { OasRequestBody, OasResponse, OperationEntry } from '@oa-sdk/parser/browser'
import {
  quoteTypeScriptString,
  toTypeScriptIdentifier,
  toOperationMethodName,
  escapeKey,
} from '@oa-sdk/core/browser'

export {
  toColonPath,
  toOperationMethodName,
  escapeKey,
  quoteTypeScriptString,
  toTypeScriptIdentifier,
  formatGeneratedTs,
  pickDefaultStatus,
  createOperationTypeNameMap,
  collectTypeNames,
} from '@oa-sdk/core/browser'

export interface OperationNameEntry {
  baseName: string
  methodName: string
}

/**
 * Creates a unique baseName (PascalCase) and methodName (camelCase) for every operation.
 * Guarantees:
 * 1. Normalized TypeScript identifiers from operationId.
 * 2. Fallback naming when operationId is missing: `${method}${toPascalCase(path)}`.
 * 3. Disambiguation of duplicate operationIds via numeric suffix (${base}2, ${base}3, ...).
 */
export function createOperationNamesMap(
  operations: ReadonlyArray<OperationEntry>,
): Map<OperationEntry, OperationNameEntry> {
  const map = new Map<OperationEntry, OperationNameEntry>()
  const usedBaseNames = new Set<string>()

  for (const op of operations) {
    const rawName = op.operationId || `${op.method.toLowerCase()}${toTypeScriptIdentifier(op.openApiPath)}`
    const base = toTypeScriptIdentifier(rawName)
    let name = base
    let suffix = 2
    while (usedBaseNames.has(name)) {
      name = `${base}${suffix++}`
    }
    usedBaseNames.add(name)
    map.set(op, {
      baseName: name,
      methodName: escapeKey(toOperationMethodName(name)),
    })
  }

  return map
}

export const HONO_CONVENIENCE_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options'])
export const EXPRESS_CONVENIENCE_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head'])
export const FASTIFY_CONVENIENCE_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options'])
export const ELYSIA_CONVENIENCE_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head'])

/**
 * Hono has convenience methods for common verbs only. OAS 3.2 also permits
 * HEAD, TRACE, and QUERY, so use the generic registration API for every verb
 * outside the known convenience surface.
 */
export function renderHonoRouteRegistration(method: string, path: string): string {
  const normalized = method.toLowerCase()
  const quotedPath = quoteTypeScriptString(path)
  if (HONO_CONVENIENCE_METHODS.has(normalized)) {
    return `app.${normalized}(${quotedPath}, async (c) => {`
  }
  return `app.on(${quoteTypeScriptString(normalized.toUpperCase())}, ${quotedPath}, async (c) => {`
}

export function renderExpressRouteRegistration(
  method: string,
  path: string,
): { source: string; requiresMethodGuard: boolean } {
  const normalized = method.toLowerCase()
  const quotedPath = quoteTypeScriptString(path)
  if (EXPRESS_CONVENIENCE_METHODS.has(normalized)) {
    return { source: `router.${normalized}(${quotedPath}, async (req, res) => {`, requiresMethodGuard: false }
  }
  // Express does not expose a method-specific API for every OAS 3.2 verb.
  // Register a valid all-method route but pass unrelated methods through so a
  // generated QUERY or TRACE stub does not accidentally handle GET/POST.
  return { source: `router.all(${quotedPath}, async (req, res, next) => {`, requiresMethodGuard: true }
}

export function hasGeneratedResponseHeaders(responses: Record<string, OasResponse>): boolean {
  const codes = Object.keys(responses).filter(k => /^2\d{2}$/.test(k)).sort()
  const key = codes[0] ?? 'default'
  const response = responses[key]
  if (!response?.headers) return false
  return Object.values(response.headers).some(header => !('$ref' in header))
}

export function hasGeneratedRequestBodyType(requestBody: OasRequestBody): boolean {
  const jsonContent = requestBody.content?.['application/json']
  return !!jsonContent && !('$ref' in jsonContent) && jsonContent.schema !== undefined
}

export function hasGeneratedResponseType(responses: Record<string, OasResponse>): boolean {
  const codes = Object.keys(responses)
    .filter(k => /^2\d{2}$/.test(k))
    .sort()
  const key = codes[0] ?? 'default'
  const response = responses[key]
  if (!response?.content) return false
  const jsonContent = response.content['application/json']
  return !!jsonContent && !('$ref' in jsonContent) && jsonContent.schema !== undefined
}
