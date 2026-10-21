/**
 * Wire Schema Model (Intermediate Representation)
 *
 * Serves as the canonical intermediate representation extracted from TypeSpec (.tsp)
 * or OpenAPI 3.1/3.2 documents before transforming into target artifacts
 * (Protocol Buffers .proto, pure TS codecs, RPC service contracts, MessagePack).
 *
 * @oa-sdk/codegen
 */

/**
 * How a field travels on the wire:
 * - `scalar`: a Protobuf scalar (`type` is `string`, `int32`, `double`, `bool`, `bytes`, ...)
 * - `enum`: a component enum, sent as its member number (`type` is the enum name)
 * - `message`: a component object schema, sent as a nested message (`type` is the model name).
 *   `allOf` members are merged in, so a TypeSpec `extends` model carries its inherited fields.
 * - `map`: an object with only `additionalProperties` (inline or a referenced component), sent as
 *   `map<string, V>` (see `mapValue`)
 * - `json`: anything else (unions, anonymous objects, free-form objects, nested arrays), sent as a
 *   JSON string
 */
export type WireFieldKind = 'scalar' | 'enum' | 'message' | 'map' | 'json'

export interface WireMapValue {
  readonly kind: Exclude<WireFieldKind, 'map' | 'json'>
  readonly type: string
}

export interface WireField {
  readonly name: string
  readonly index: number
  readonly type: string
  /** Defaults to `scalar` for models built before field kinds existed. */
  readonly kind?: WireFieldKind | undefined
  readonly mapValue?: WireMapValue | undefined
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

/**
 * What a component object is on the wire:
 * - `message`: a Protobuf message: declared properties, the fields of `allOf` members included
 * - `object`: an object Protobuf cannot carry as a message: map-only (`Record<string, V>`),
 *   free-form (`Record<unknown>`), or composed with `oneOf`/`anyOf`/`not`. It has no fields, no
 *   `.proto` message, and no Protobuf codec; it keeps its TypeScript type and MessagePack codec,
 *   and fields that reference it are `map` or `json`.
 */
export type WireModelKind = 'message' | 'object'

export interface WireModel {
  /** Component schema name: the key of codec records and of RPC `requestType`/`responseType`. */
  readonly name: string
  /** Defaults to `message` for models built before model kinds existed. */
  readonly kind?: WireModelKind | undefined
  /**
   * TypeScript declaration name, the one `types.ts` declares for the same component
   * (`Inventory.Widget` becomes `InventoryWidget`). Adapters derive it from `name` when absent.
   */
  readonly tsTypeName?: string | undefined
  readonly messageName?: string | undefined
  readonly protobufMessageName?: string | undefined
  readonly package?: string | undefined
  readonly doc?: string | undefined
  readonly fields: readonly WireField[]
  readonly wireFormat?: 'protobuf' | 'msgpack' | 'json' | 'raw-binary' | string | undefined
  readonly isRpcMessage?: boolean | undefined
}

/** Whether a model is a Protobuf message: it has a `.proto` message and a Protobuf codec. */
export function isProtobufMessage(model: WireModel): boolean {
  return (model.kind ?? 'message') === 'message'
}

export interface WireEnumMember {
  readonly name: string
  readonly number: number
  readonly doc?: string | undefined
}

export interface WireEnum {
  readonly name: string
  /** TypeScript declaration name; see `WireModel.tsTypeName`. */
  readonly tsTypeName?: string | undefined
  readonly doc?: string | undefined
  readonly members: readonly WireEnumMember[]
  readonly values?: readonly string[] | undefined
  /** The enum's JSON values, in member-number order. */
  readonly literals?: readonly (string | number | boolean | null)[] | undefined
}

export type WireParameterLocation = 'path' | 'query' | 'header' | 'cookie'

/** A non-body operation parameter, sent next to the wire message. */
export interface WireParameter {
  readonly name: string
  readonly in: WireParameterLocation
  readonly required: boolean
  /** Scalar wire type (`string`, `int32`, `bool`, ...) or the referenced model/enum name. */
  readonly type: string
  readonly repeated: boolean
  readonly isEnum?: boolean | undefined
  readonly doc?: string | undefined
}

/** Declared request body or success response payload of a method. */
export interface WirePayload {
  readonly mediaType: string
  /** Referenced component schema; absent for an inline schema. */
  readonly typeName?: string | undefined
  readonly required?: boolean | undefined
}

export interface WireMethod {
  readonly name: string
  readonly methodName?: string | undefined
  readonly doc?: string | undefined
  /**
   * Message model of the request body. The empty message, named by `emptyMessageName(model)`
   * (`Empty` unless a model, enum, or service already uses that name), when there is no body or
   * the body is not a message model (an inline schema, an enum, a map, a scalar);
   * `requestBody.typeName` still names it.
   */
  readonly inputType: string
  /** Message model of the success response, or the empty message like `inputType`. */
  readonly outputType: string
  readonly route?: string | undefined
  readonly httpMethod?: string | undefined
  readonly streaming?: 'none' | 'client' | 'server' | 'bidirectional' | undefined
  readonly clientStreaming?: boolean | undefined
  readonly serverStreaming?: boolean | undefined
  readonly wireFormat?: 'protobuf' | 'msgpack' | 'json' | 'raw-binary' | string | undefined
  /** Path, query, header, and cookie parameters, path-level ones merged in. */
  readonly parameters?: readonly WireParameter[] | undefined
  readonly requestBody?: WirePayload | undefined
  /** Lowest declared 2xx response; `mediaType` is empty when it has no content. */
  readonly response?: (WirePayload & { readonly status: number }) | undefined
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
