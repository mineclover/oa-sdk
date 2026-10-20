/**
 * TypeSpec Wire Adapter Pattern & Transformation Pipeline
 *
 * Provides decoupled adapters between TypeSpec (.tsp SSOT) and
 * target wire formats (Protocol Buffers .proto, pure TS codecs, RPC contracts, MessagePack).
 *
 * @oa-sdk/codegen
 */

export type {
  WireSchemaModel,
  WireModel,
  WireField,
  WireEnum,
  WireEnumMember,
  WireService,
  WireMethod,
  WireFieldKind,
  WireModelKind,
  WireMapValue,
  WireParameter,
  WireParameterLocation,
  WirePayload,
} from './wire-schema-model.js'

export {
  isProtobufMessage,
} from './wire-schema-model.js'

export {
  emptyMessageName,
} from './proto-identifiers.js'
export type {
  WireNameScope,
} from './proto-identifiers.js'

export type {
  TypeSpecWireTargetAdapter,
  WireTransformationResult,
} from './wire-adapter-types.js'

export {
  extractWireSchemaFromOas,
} from './wire-schema-extractor.js'
export type {
  ExtractorOptions,
} from './wire-schema-extractor.js'

export {
  Proto3TargetAdapter,
} from './adapters/proto3-target-adapter.js'
export type {
  Proto3AdapterOptions,
} from './adapters/proto3-target-adapter.js'

export {
  ProtobufCodecTargetAdapter,
} from './adapters/protobuf-codec-target-adapter.js'
export type {
  ProtobufCodecAdapterOptions,
} from './adapters/protobuf-codec-target-adapter.js'

export {
  RpcContractTargetAdapter,
} from './adapters/rpc-contract-target-adapter.js'
export type {
  RpcContractAdapterOptions,
} from './adapters/rpc-contract-target-adapter.js'

export {
  MessagePackTargetAdapter,
} from './adapters/messagepack-target-adapter.js'
export type {
  MessagePackAdapterOptions,
} from './adapters/messagepack-target-adapter.js'

export {
  TypeSpecWirePipeline,
  typeSpecWirePipeline,
} from './typespec-wire-pipeline.js'
export type {
  TransformationBundle,
} from './typespec-wire-pipeline.js'
