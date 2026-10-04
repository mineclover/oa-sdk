/**
 * Route index builder shared by `parseDocument` (parse-core) and `loadSchema`.
 *
 * Both entry points run their SpecPass pipeline first and then index the
 * resulting document here, so `loadSchema(spec, passes)` and
 * `parseDocument(spec, passes).routes` cannot drift apart.
 *
 * Indexing contract (OAS 3.2):
 * - Routes come from `paths` only. Webhooks describe requests the API provider
 *   sends to the consumer, so they are not routes of the described server;
 *   `extractWebhookOperations` returns them separately under the pseudo path
 *   `/webhooks/{name}` and callers decide whether to serve them.
 * - Fixed-field operations are indexed under their field name in
 *   `HTTP_METHODS` order, followed by `additionalOperations` entries under their
 *   verbatim key (the method token with the capitalization sent on the wire).
 *   An `additionalOperations` entry naming a method the Path Item already
 *   defines through a fixed field (compared case-insensitively) is ignored:
 *   OAS 3.2 forbids that duplication and the fixed field is authoritative.
 * - Path Item parameters are merged with Operation parameters keyed by
 *   `in` + `name`; the Operation definition overrides.
 * - `security` is operation ?? document ?? []; `servers` is
 *   operation ?? path item ?? document ?? [].
 * - Operation-level `x-*` extensions are copied onto the entry.
 * - `OperationEntry` exposes resolved objects. A Reference Object the pipeline
 *   left at an indexed position (Path Item, parameter, requestBody, response,
 *   callback) is resolved against the same document by local JSON pointer,
 *   following reference chains, with sibling fields overlaying the target the
 *   way the deref pass merges them. A reference that cannot be resolved locally
 *   (external without a loader, missing target, cycle) is omitted instead of
 *   leaking a Reference Object into the IR; completeness is reported by
 *   `ParsedDocument.resolution`. An unresolved Path Item `$ref` still
 *   contributes the operations declared beside it.
 * - The input document is never mutated; entries share sub-objects with it.
 */

import type {
  OasCallback,
  OasDocument,
  OasOperation,
  OasParameter,
  OasPathItem,
  OasRequestBody,
  OasResponse,
} from './oas32-types.js'
import type { HttpMethod, OperationEntry, RouteIndex } from './types.js'
import { HTTP_METHODS } from './route-match.js'
import { resolveJsonPointer } from './json-pointer.js'
import { createSafeRecord } from './safe-record.js'

type JsonRecord = Record<string, unknown>

export type PathOperationIndex = {
  /** Path operations in document order: paths, fixed-field methods, then additionalOperations. */
  operations: OperationEntry[]
  /** The same operations keyed by `openApiPath` and method. */
  routes: RouteIndex
}

/** Index every operation under `paths` of a pipeline-resolved document. */
export function indexPathOperations(doc: OasDocument): PathOperationIndex {
  const operations: OperationEntry[] = []
  const routes: RouteIndex = new Map()

  for (const [path, rawItem] of entriesOf(doc.paths)) {
    const item = resolvePathItem(doc, rawItem)
    if (!item) continue

    const methodMap = new Map<HttpMethod, OperationEntry>()
    for (const entry of extractPathItemOperations(path, item, doc)) {
      methodMap.set(entry.method, entry)
      operations.push(entry)
    }
    if (methodMap.size > 0) routes.set(path, methodMap)
  }

  return { operations, routes }
}

/** Build the request-routing index (`paths` only) of a pipeline-resolved document. */
export function buildRouteIndex(doc: OasDocument): RouteIndex {
  return indexPathOperations(doc).routes
}

/** Extract webhook operations under the pseudo path `/webhooks/{name}`. */
export function extractWebhookOperations(doc: OasDocument): OperationEntry[] {
  const webhooks: OperationEntry[] = []
  for (const [name, rawItem] of entriesOf(doc.webhooks)) {
    const item = resolvePathItem(doc, rawItem)
    if (!item) continue
    webhooks.push(...extractPathItemOperations(`/webhooks/${name}`, item, doc))
  }
  return webhooks
}

function extractPathItemOperations(
  path: string,
  item: OasPathItem,
  doc: OasDocument,
): OperationEntry[] {
  const pathParams = resolveParameters(doc, item.parameters)
  const entries: OperationEntry[] = []
  const fixedMethods = new Set<string>()

  for (const method of HTTP_METHODS) {
    const operation = item[method]
    if (!isRecord(operation)) continue
    fixedMethods.add(method)
    entries.push(buildEntry(path, method, operation, pathParams, item, doc))
  }

  for (const [method, operation] of entriesOf(item.additionalOperations)) {
    if (!isRecord(operation) || fixedMethods.has(method.toLowerCase())) continue
    // additionalOperations keys are arbitrary method tokens outside the
    // HttpMethod union; the RouteIndex keeps them verbatim.
    entries.push(buildEntry(path, method as HttpMethod, operation as OasOperation, pathParams, item, doc))
  }

  return entries
}

function buildEntry(
  path: string,
  method: HttpMethod,
  op: OasOperation,
  pathParams: OasParameter[],
  item: OasPathItem,
  doc: OasDocument,
): OperationEntry {
  const entry: OperationEntry = {
    openApiPath: path,
    method,
    tags: op.tags ?? [],
    deprecated: op.deprecated ?? false,
    parameters: mergeParameters(pathParams, resolveParameters(doc, op.parameters)),
    responses: resolveReferenceMap<OasResponse>(doc, op.responses),
    security: op.security ?? doc.security ?? [],
    servers: op.servers ?? item.servers ?? doc.servers ?? [],
    callbacks: resolveReferenceMap<OasCallback>(doc, op.callbacks),
  }

  if (op.operationId !== undefined) entry.operationId = op.operationId
  if (op.summary !== undefined) entry.summary = op.summary
  if (op.description !== undefined) entry.description = op.description
  const requestBody = resolveReference<OasRequestBody>(doc, op.requestBody)
  if (requestBody) entry.requestBody = requestBody
  if (op.externalDocs !== undefined) entry.externalDocs = op.externalDocs
  for (const [key, value] of Object.entries(op)) {
    if (key.startsWith('x-')) entry[key as `x-${string}`] = value
  }

  return entry
}

function resolveParameters(doc: OasDocument, parameters: unknown): OasParameter[] {
  if (!Array.isArray(parameters)) return []
  const resolved: OasParameter[] = []
  for (const parameter of parameters) {
    const value = resolveReference<OasParameter>(doc, parameter)
    if (value) resolved.push(value)
  }
  return resolved
}

/** A unique parameter is identified by its location and name (OAS 3.2 §4.8.12). */
function mergeParameters(path: OasParameter[], op: OasParameter[]): OasParameter[] {
  const map = new Map<string, OasParameter>()
  for (const p of path) map.set(`${p.in}:${p.name}`, p)
  for (const p of op) map.set(`${p.in}:${p.name}`, p)
  return [...map.values()]
}

function resolveReferenceMap<T>(doc: OasDocument, map: unknown): Record<string, T> {
  const resolved = createSafeRecord<T>()
  for (const [key, value] of entriesOf(map)) {
    const target = resolveReference<T>(doc, value)
    if (target) resolved[key] = target
  }
  return resolved
}

function resolvePathItem(doc: OasDocument, value: unknown): OasPathItem | undefined {
  const resolved = resolveReference<OasPathItem>(doc, value)
  if (resolved) return resolved
  if (!isRecord(value)) return undefined
  // Unlike a Reference Object, a Path Item may declare operations beside its
  // `$ref`; those stay defined when the reference itself cannot be followed.
  const siblings = siblingFields(value)
  return Object.keys(siblings).length > 0 ? siblings as OasPathItem : undefined
}

/**
 * Resolve a Reference Object left in place by the pipeline. Objects without
 * `$ref` are returned as-is so the result keeps sharing them with the document.
 */
function resolveReference<T>(doc: OasDocument, value: unknown): T | undefined {
  if (!isRecord(value)) return undefined
  if (!hasOwn(value, '$ref')) return value as T

  const overlays: JsonRecord[] = []
  const visited = new Set<JsonRecord>()
  let current: unknown = value
  while (isRecord(current) && hasOwn(current, '$ref')) {
    if (visited.has(current)) return undefined
    visited.add(current)
    const ref = current.$ref
    if (typeof ref !== 'string') return undefined
    overlays.push(siblingFields(current))
    current = resolveJsonPointer(doc, ref)
  }
  if (!isRecord(current)) return undefined

  // The outermost reference's siblings win, as in the deref pass.
  let merged: JsonRecord = current
  for (let index = overlays.length - 1; index >= 0; index -= 1) {
    const layer = overlays[index]!
    if (Object.keys(layer).length > 0) merged = { ...merged, ...layer }
  }
  return merged as T
}

function siblingFields(record: JsonRecord): JsonRecord {
  const siblings = createSafeRecord<unknown>()
  for (const [key, value] of Object.entries(record)) {
    if (key !== '$ref') siblings[key] = value
  }
  return siblings
}

function entriesOf(value: unknown): Array<[string, unknown]> {
  return isRecord(value) ? Object.entries(value) : []
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}
