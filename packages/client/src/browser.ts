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

export {
  ClientError,
  isClientError,
} from './error-contract.js'

export {
  bearerAuth,
  basicAuth,
  apiKeyAuth,
} from './client-types.js'

export type {
  ClientConfig,
  ClientMiddleware,
  ClientMethodOptions,
  ClientResponse,
} from './client-types.js'

export {
  generateCrdtClient,
  generateCrdtClientFromParsed,
  generateCrdtHooks,
  generateCrdtHooksFromParsed,
  extractCrdtEntitiesFromDoc,
  LwwJsonAdapter,
} from './crdt/index.js'

export type {
  CrdtWireMessageType,
  CrdtWireMessage,
  CrdtConnectionStatus,
  CrdtEngineAdapter,
  CrdtClientRenderOptions,
  CrdtHooksRenderOptions,
  CrdtEntityMeta,
  CrdtFieldMeta,
  LwwEntry,
  LwwStateVector,
  LwwUpdatePayload,
} from './crdt/index.js'

export type { JsonPrimitive, Resolved } from '@oa-sdk/core/browser'

export {
  retryAfterMs,
  synthesizeEmptyChunk,
  createResilientChunkReader,
  createResilientNdjsonReader,
  createChunkStreamStore,
  generateChunkStreamReactHooks,
} from './chunk-stream/index.js'

export type {
  ChunkStreamStore,
  FallbackChunkState,
  RuntimeChunkEnvelopeDescriptor,
  ChunkFetchDescriptor,
  ChunkStreamReaderOptions,
  ChunkStreamState,
} from './chunk-stream/index.js'

