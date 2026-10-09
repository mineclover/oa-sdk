/**
 * Binary Codec and Wire Compression Adapter Pattern module.
 *
 * @oa-sdk/client
 */

export type {
  BinaryCodecAdapter,
  BinaryBodyInit,
} from './codec-types.js'

export {
  BinaryCodecRegistry,
} from './codec-types.js'

export {
  MessagePackAdapter,
  messagePackAdapter,
  encodeMessagePack,
  decodeMessagePack,
} from './adapters/messagepack-adapter.js'

export {
  ProtobufAdapter,
  createProtobufAdapter,
} from './adapters/protobuf-adapter.js'
export type {
  ProtobufAdapterOptions,
} from './adapters/protobuf-adapter.js'

export {
  RawBinaryAdapter,
  createRawBinaryAdapter,
} from './adapters/raw-binary-adapter.js'
