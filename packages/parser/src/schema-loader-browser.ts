import type { OasDocument } from './oas32-types.js'
import type { RouteIndex } from './types.js'
import { parseDocument } from './parse-browser.js'
import { assertParsedDocumentComplete } from './parsed-document.js'

export function loadSchema(spec: unknown): RouteIndex {
  const document = parseDocument(spec as OasDocument)
  assertParsedDocumentComplete(document, '@oa-sdk/parser/browser loadSchema')
  return document.routes
}
