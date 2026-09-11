/** Browser-safe entrypoint for fetch client generation. */

import type { OasDocument, ParsedDocument } from '@oa-sdk/parser/browser'
import { assertParsedDocumentComplete, isParsedDocument, parseDocument } from '@oa-sdk/parser/browser'
import { generateClientFromParsed, type ClientRenderOptions } from './generate-client-renderer.js'

/** Browser generation only accepts an in-memory document or already-parsed IR. */
export type BrowserClientOptions = ClientRenderOptions

/** @deprecated Use BrowserClientOptions from @oa-sdk/client/browser. */
export type ClientOptions = BrowserClientOptions

export function generateClient(spec: OasDocument | ParsedDocument, options: BrowserClientOptions = {}): string {
  const doc = isParsedDocument(spec) ? spec : parseDocument(spec)
  assertParsedDocumentComplete(doc, '@oa-sdk/client/browser generateClient')
  return generateClientFromParsed(doc, options)
}

export type { JsonPrimitive, Resolved } from '@oa-sdk/core/browser'
