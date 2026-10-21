/**
 * @oa-sdk/client — OAS → fetch 기반 타입 안전 클라이언트 SDK
 *
 * 사용 예시:
 *   import { generateClient } from '@oa-sdk/client'
 *   const code = generateClient(spec, { typesImport: './types' })
 */
export { generateClient } from './generate-client.js'
export type { ClientOptions } from './generate-client.js'
export type { JsonPrimitive, Resolved } from '@oa-sdk/core'

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
  BinaryCodecRegistry,
  MessagePackAdapter,
  messagePackAdapter,
  encodeMessagePack,
  decodeMessagePack,
  ProtobufAdapter,
  createProtobufAdapter,
  RawBinaryAdapter,
  createRawBinaryAdapter,
} from './codec/index.js'

export type {
  BinaryCodecAdapter,
  BinaryBodyInit,
  ProtobufAdapterOptions,
} from './codec/index.js'

export {
  generateTanstackQuery,
  generateKeyFactory,
  generateOptionsFactory,
  generateHookFactory,
  isQueryOperation,
  isStreamingOperation,
  getOperationTag,
  toKeyFactoryName,
} from './tanstack/index.js'
export type {
  TanstackQueryOptions,
  TanstackQueryOutput,
  KeyFactoryOptions,
  OptionsFactoryOptions,
  HookFactoryOptions,
} from './tanstack/index.js'

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



