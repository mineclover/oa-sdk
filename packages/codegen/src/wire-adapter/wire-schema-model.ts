/**
 * Wire Schema Model (Intermediate Representation)
 *
 * Serves as the canonical intermediate representation extracted from TypeSpec (.tsp)
 * or OpenAPI 3.1/3.2 documents before transforming into target artifacts
 * (Protocol Buffers .proto, pure TS codecs, RPC service contracts, MessagePack).
 *
 * @oa-sdk/codegen
 */

export interface WireField {
  readonly name: string
  readonly index: number
  readonly type: string
  readonly protoType?: string | undefined
  readonly isEnum?: boolean | undefined
  readonly enumRef?: string | undefined
  readonly optional: boolean
  readonly required?: boolean | undefined
  readonly repeated: boolean
  readonly packed?: boolean | undefined
  readonly doc?: string | undefined
  readonly format?: string | undefined
  readonly defaultValue?: unknown | undefined
}

export interface WireModel {
  readonly name: string
  readonly messageName?: string | undefined
  readonly protobufMessageName?: string | undefined
  readonly package?: string | undefined
  readonly doc?: string | undefined
  readonly fields: readonly WireField[]
  readonly wireFormat?: 'protobuf' | 'msgpack' | 'json' | 'raw-binary' | string | undefined
  readonly isRpcMessage?: boolean | undefined
}

export interface WireEnumMember {
  readonly name: string
  readonly number: number
  readonly doc?: string | undefined
}

export interface WireEnum {
  readonly name: string
  readonly doc?: string | undefined
  readonly members: readonly WireEnumMember[]
  readonly values?: readonly string[] | undefined
}

export interface WireMethod {
  readonly name: string
  readonly methodName?: string | undefined
  readonly doc?: string | undefined
  readonly inputType: string
  readonly outputType: string
  readonly route?: string | undefined
  readonly httpMethod?: string | undefined
  readonly streaming?: 'none' | 'client' | 'server' | 'bidirectional' | undefined
  readonly clientStreaming?: boolean | undefined
  readonly serverStreaming?: boolean | undefined
  readonly wireFormat?: 'protobuf' | 'msgpack' | 'json' | 'raw-binary' | string | undefined
}

export interface WireService {
  readonly name: string
  readonly serviceName?: string | undefined
  readonly doc?: string | undefined
  readonly methods: readonly WireMethod[]
}

export interface WireSchemaModel {
  readonly name: string
  readonly title?: string | undefined
  readonly version?: string | undefined
  readonly package?: string | undefined
  readonly doc?: string | undefined
  readonly models: readonly WireModel[]
  readonly enums: readonly WireEnum[]
  readonly services: readonly WireService[]
}
