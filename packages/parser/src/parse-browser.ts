import type { OasDocument } from './oas32-types.js'
import { derefInternalSpecWithDiagnostics, type InternalDerefOptions } from './deref-internal.js'
import { parseResolvedDocument } from './parse-core.js'
import { createParsedDocumentRefResolution } from './parsed-document.js'
import type { ParsedDocument } from './types.js'

export type BrowserParseDocumentOptions = InternalDerefOptions

/**
 * Browser-safe synchronous parser.
 *
 * Internal references are resolved in memory. External references are retained
 * and reported as incomplete because this entrypoint intentionally has no I/O
 * loader.
 */
export function parseDocument(
  doc: OasDocument,
  options?: BrowserParseDocumentOptions,
): ParsedDocument
/** @deprecated Pass parser options as the second argument; raw-document input is retained for compatibility. */
export function parseDocument(
  doc: OasDocument,
  raw: OasDocument,
): ParsedDocument
export function parseDocument(
  doc: OasDocument,
  optionsOrRaw: BrowserParseDocumentOptions | OasDocument = {},
): ParsedDocument {
  if (isOasDocument(optionsOrRaw)) {
    const resolution = createParsedDocumentRefResolution({
      document: optionsOrRaw,
      scope: 'custom',
    })
    return parseResolvedDocument(doc, optionsOrRaw, resolution)
  }

  const { document, diagnostics, recursiveRefs } = derefInternalSpecWithDiagnostics(doc, optionsOrRaw)
  const resolution = createParsedDocumentRefResolution({
    document,
    scope: 'internal',
    diagnostics,
    recursiveRefs,
  })
  return parseResolvedDocument(document, doc, resolution)
}

function isOasDocument(value: BrowserParseDocumentOptions | OasDocument): value is OasDocument {
  return 'openapi' in value && typeof value.openapi === 'string'
}
