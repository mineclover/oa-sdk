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
  CompleteParsedDocument,
  ParsedDocumentRefDiagnosticCode,
  ParsedDocumentRefDiagnostic,
  ParsedDocumentRefResolutionScope,
  ParsedDocumentRefResolution,
} from './types.js'
export {
  IncompleteParsedDocumentError,
  assertParsedDocumentComplete,
  createParsedDocumentRefResolution,
  isParsedDocument,
  isParsedDocumentComplete,
} from './parsed-document.js'
export type { CreateParsedDocumentRefResolutionOptions } from './parsed-document.js'

export { parseDocument } from './parse-browser.js'
export type { BrowserParseDocumentOptions } from './parse-browser.js'
export { loadSchema } from './schema-loader-browser.js'
export { matchRoute, HTTP_METHODS } from './route-match.js'

export { foldSchema } from './fold.js'
export type { SchemaAlgebra } from './fold.js'

export { SchemaFolder } from './folder.js'
export { derefInternalSpec, derefInternalSpecWithDiagnostics } from './deref-internal.js'
export type { InternalDerefCycleStrategy, InternalDerefOptions } from './deref-internal.js'

export { findOperation, findByTag, findByPath, getSchema, getTag, groupByTag, describeApi, resolveServerUrl } from './query.js'
