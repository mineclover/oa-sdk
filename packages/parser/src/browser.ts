/**
 * @oa-sdk/parser/browser — browser-safe parser surface.
 *
 * This entrypoint parses an already-loaded OpenAPI document without filesystem
 * dereferencing. Use the package root when Node-side external $ref resolution,
 * definition projection, or full pipeline APIs are required.
 */

export type * from './types/index.js'
export type * from './oas32-types.js'

export type {
  HttpMethod,
  OperationEntry,
  RouteIndex,
  MatchResult,
  ParsedDocument,
} from './types.js'

export { parseResolvedDocument as parseDocument } from './parse-core.js'
export { loadSchema } from './schema-loader-browser.js'
export { matchRoute, HTTP_METHODS } from './route-match.js'

export { foldSchema } from './fold.js'
export type { SchemaAlgebra } from './fold.js'

export { SchemaFolder } from './folder.js'
export { derefInternalSpec } from './deref-internal.js'
export type { InternalDerefCycleStrategy, InternalDerefOptions } from './deref-internal.js'

export { findOperation, findByTag, findByPath, getSchema, getTag, groupByTag, describeApi, resolveServerUrl } from './query.js'
