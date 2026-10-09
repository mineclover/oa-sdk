/** Browser-safe entrypoint for router stub and handler contract generation. */

import type { OasDocument, ParsedDocument } from '@oa-sdk/parser/browser'
import { assertParsedDocumentComplete, isParsedDocument, parseDocument } from '@oa-sdk/parser/browser'
import {
  generateRouterFromParsed,
  type RouterRenderOptions,
  type RouterTarget,
  type RouterMode,
} from './generate-router-renderer.js'
import {
  generateHandlerContractFromParsed,
  type HandlerContractOptions,
} from './contracts/handler-contract.js'
import {
  generateCrdtHandlerContractFromParsed,
  extractCrdtEntities,
  type CrdtContractOptions,
  type CrdtFieldMeta,
  type CrdtEntityMeta,
} from './contracts/crdt-contract.js'
import {
  generateCrdtRouterFromParsed,
  type CrdtRouterOptions,
  type CrdtRouterTarget,
} from './targets/crdt-router.js'

export type {
  RouterTarget,
  RouterMode,
  RouterRenderOptions,
  HandlerContractOptions,
  CrdtContractOptions,
  CrdtFieldMeta,
  CrdtEntityMeta,
  CrdtRouterOptions,
  CrdtRouterTarget,
}

export { extractCrdtEntities }

/** Browser generation only accepts an in-memory document or already-parsed IR. */
export type BrowserRouterOptions = RouterRenderOptions

/** @deprecated Use BrowserRouterOptions from @oa-sdk/router/browser. */
export type RouterOptions = BrowserRouterOptions

export function generateRouter(spec: OasDocument | ParsedDocument, options: BrowserRouterOptions = {}): string {
  const doc = isParsedDocument(spec) ? spec : parseDocument(spec)
  assertParsedDocumentComplete(doc, '@oa-sdk/router/browser generateRouter')
  return generateRouterFromParsed(doc, options)
}

export function generateHandlerContract(
  spec: OasDocument | ParsedDocument,
  options: HandlerContractOptions = {},
): string {
  const doc = isParsedDocument(spec) ? spec : parseDocument(spec)
  assertParsedDocumentComplete(doc, '@oa-sdk/router/browser generateHandlerContract')
  return generateHandlerContractFromParsed(doc, options)
}

export function generateCrdtHandlerContract(
  spec: OasDocument | ParsedDocument,
  options: CrdtContractOptions = {},
): string {
  const doc = isParsedDocument(spec) ? spec : parseDocument(spec)
  assertParsedDocumentComplete(doc, '@oa-sdk/router/browser generateCrdtHandlerContract')
  return generateCrdtHandlerContractFromParsed(doc, options)
}

export function generateCrdtRouter(
  spec: OasDocument | ParsedDocument,
  options: CrdtRouterOptions = {},
): string {
  const doc = isParsedDocument(spec) ? spec : parseDocument(spec)
  assertParsedDocumentComplete(doc, '@oa-sdk/router/browser generateCrdtRouter')
  return generateCrdtRouterFromParsed(doc, options)
}

export {
  demuxChunkStream,
} from './chunk-stream/demuxer.js'

export type {
  DemuxChunkStreamOptions,
  SyntheticEmptyChunk,
} from './chunk-stream/demuxer.js'

export {
  RouterCodecRegistry,
  negotiateResponseMediaType,
} from './codec/router-codec.js'

export type {
  RouterCodecAdapter,
} from './codec/router-codec.js'

