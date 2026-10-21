/**
 * Wire Schema Extractor
 *
 * Extracts canonical WireSchemaModel from OpenAPI 3.1/3.2 documents
 * (emitted from TypeSpec .tsp) or compiles TypeSpec source in-memory.
 *
 * Automatically resolves field indexes (1-based fallback when @field is omitted)
 * and normalizes scalar and complex wire types.
 *
 * @oa-sdk/codegen
 */

import { pascalCase } from '@oa-sdk/core/browser'
import type { OasDocument } from '@oa-sdk/parser'
import {
  PROTOBUF_EXTENSION,
  PROTOBUF_FIELD_EXTENSION,
  RPC_EXTENSION,
  WIRE_FORMAT_EXTENSION,
} from '@oa-sdk/typespec-decorators'
import { createComponentTypeNameMap } from '../typegen/type-names.js'
import { emptyMessageName } from './proto-identifiers.js'
import {
  isProtobufMessage,
  type WireSchemaModel,
  type WireModel,
  type WireField,
  type WireEnum,
  type WireEnumMember,
  type WireFieldKind,
  type WireMapValue,
  type WireService,
  type WireMethod,
  type WireParameter,
  type WireParameterLocation,
  type WirePayload,
} from './wire-schema-model.js'

export interface ExtractorOptions {
  readonly defaultPackage?: string | undefined
  readonly defaultServiceName?: string | undefined
}

/** A JSON object of the document: a schema, an operation, a media type, ... */
type JsonObject = Readonly<Record<string, unknown>>

type RpcStreaming = NonNullable<WireMethod['streaming']>

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'] as const

/** Highest field number Protobuf allows (2^29 - 1). */
const MAX_FIELD_NUMBER = 536_870_911

/**
 * Extracts a canonical WireSchemaModel from an OpenAPI document.
 *
 * Throws when a model declares an invalid or duplicate explicit Protobuf field number, because
 * the schema and codecs generated from it could not tell those fields apart.
 */
export function extractWireSchemaFromOas(
  doc: OasDocument,
  options: ExtractorOptions = {},
): WireSchemaModel {
  const packageName = options.defaultPackage ?? sanitizePackageName(doc.info?.title ?? 'service')
  const defaultServiceName = options.defaultServiceName ?? pascalCase(packageName) + 'Service'

  const schemas = new ComponentSchemas(asObject(doc.components?.schemas) ?? {})
  // The declaration names `types.ts` uses for the same components.
  const typeNames = createComponentTypeNameMap(schemas.names()).byComponentName
  const models: WireModel[] = []
  const enums: WireEnum[] = []

  for (const schemaName of schemas.names()) {
    const schema = schemas.get(schemaName)
    if (!schema) continue
    const tsTypeName = typeNames.get(schemaName) ?? schemaName

    if (Array.isArray(schema.enum)) {
      enums.push(extractEnum(schemaName, tsTypeName, schema, schema.enum))
      continue
    }

    const message = schemas.message(schemaName)
    if (message) {
      models.push(extractModel(schemaName, tsTypeName, schema, message, schemas, packageName))
    } else if (primaryType(schema) === 'object' || schema.properties !== undefined) {
      // Map-only, free-form, or composed: no Protobuf message, but still a type and a MessagePack value.
      models.push({
        name: schemaName,
        tsTypeName,
        kind: 'object',
        doc: stringOf(schema.description),
        fields: [],
        wireFormat: stringOf(schema[WIRE_FORMAT_EXTENSION]),
      })
    }
  }

  const messageNames = new Set(models.filter(isProtobufMessage).map(model => model.name))
  const enumNames = new Set(enums.map(enm => enm.name))
  // Methods by service; `inputType`/`outputType` are filled in once every name is known.
  const serviceMap = new Map<string, PendingMethod[]>()

  for (const [pathStr, rawPathItem] of Object.entries(asObject(doc.paths) ?? {})) {
    const pathItem = asObject(rawPathItem)
    if (!pathItem) continue

    for (const httpMethod of HTTP_METHODS) {
      const op = asObject(pathItem[httpMethod])
      if (!op) continue

      const rpcMeta = readRpcMeta(op[RPC_EXTENSION])
      const wireFormat = stringOf(op[WIRE_FORMAT_EXTENSION])
      const tag = firstTag(op.tags)

      const serviceName = rpcMeta.serviceName ?? rpcMeta.service ?? (tag ? pascalCase(tag) + 'Service' : defaultServiceName)
      const opId = stringOf(op.operationId) ?? `${httpMethod}_${pathStr.replace(/[^a-zA-Z0-9]/g, '_')}`
      const methodName = rpcMeta.methodName ?? rpcMeta.method ?? pascalCase(opId)

      const requestBody = resolveRequestBody(op)
      const response = resolveSuccessResponse(op)
      const parameters = resolveParameters(doc, pathStr, pathItem.parameters, op.parameters, enumNames, schemas)

      const clientStreaming = rpcMeta.clientStreaming ?? (rpcMeta.streaming === 'client' || rpcMeta.streaming === 'bidirectional')
      const serverStreaming = rpcMeta.serverStreaming ?? (rpcMeta.streaming === 'server' || rpcMeta.streaming === 'bidirectional')

      const wireMethod: PendingMethod = {
        name: methodName,
        methodName,
        doc: stringOf(op.description) ?? stringOf(op.summary),
        // Only a message component can be an RPC message; other payloads (inline schemas, maps,
        // enums, scalars) keep their `typeName` but travel as the empty message.
        inputType: messageTypeName(requestBody?.typeName, messageNames),
        outputType: messageTypeName(response?.typeName, messageNames),
        route: pathStr,
        httpMethod: httpMethod.toUpperCase(),
        streaming: rpcMeta.streaming ?? (clientStreaming && serverStreaming ? 'bidirectional' : clientStreaming ? 'client' : serverStreaming ? 'server' : 'none'),
        clientStreaming,
        serverStreaming,
        wireFormat: wireFormat ?? wireFormatOf(requestBody?.mediaType || response?.mediaType),
        parameters,
        requestBody,
        response,
      }

      const methods = serviceMap.get(serviceName)
      if (methods) methods.push(wireMethod)
      else serviceMap.set(serviceName, [wireMethod])
    }
  }

  const empty = emptyMessageName({ models, enums, services: [...serviceMap.keys()].map(name => ({ name })) })
  const services: WireService[] = Array.from(serviceMap.entries()).map(([serviceName, methods]) => ({
    name: serviceName,
    serviceName,
    methods: methods.map(method => ({ ...method, inputType: method.inputType ?? empty, outputType: method.outputType ?? empty })),
  }))

  return {
    name: packageName,
    title: doc.info?.title,
    version: doc.info?.version,
    package: packageName,
    doc: doc.info?.description,
    models,
    enums,
    services,
  }
}

function extractEnum(name: string, tsTypeName: string, schema: JsonObject, values: readonly unknown[]): WireEnum {
  const members: WireEnumMember[] = values.map((value, index) => ({
    name: String(value).toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
    number: index,
  }))
  return {
    name,
    tsTypeName,
    doc: stringOf(schema.description),
    members,
    values: values.map(String),
    literals: values.map(enumLiteral),
  }
}

/** Keeps JSON primitives; any other enum value (an object or array) is kept as its JSON text. */
function enumLiteral(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return JSON.stringify(value) ?? String(value)
}

function extractModel(
  name: string,
  tsTypeName: string,
  schema: JsonObject,
  message: FlatMessage,
  schemas: ComponentSchemas,
  packageName: string,
): WireModel {
  const protoMeta = readProtobufMeta(schema[PROTOBUF_EXTENSION])
  const wireFormat = stringOf(schema[WIRE_FORMAT_EXTENSION])
  const properties = [...message.properties].map(([propName, prop]) => ({ propName, prop, meta: readFieldMeta(prop) }))

  // Explicit field numbers win; the others take the lowest free numbers in declaration order,
  // inherited (`allOf`) fields first.
  const explicitOwners = new Map<number, string>()
  for (const { propName, meta } of properties) {
    if (meta.index === undefined) continue
    assertFieldNumber(meta.index, name, propName)
    const owner = explicitOwners.get(meta.index)
    if (owner !== undefined) {
      throw new Error(`Duplicate protobuf field number ${meta.index} in ${name}: "${owner}" and "${propName}" both use it.`)
    }
    explicitOwners.set(meta.index, propName)
  }
  const usedIndexes = new Set(explicitOwners.keys())
  let nextIndex = 1
  const allocateIndex = (): number => {
    while (usedIndexes.has(nextIndex) || (nextIndex >= 19000 && nextIndex <= 19999)) nextIndex++
    usedIndexes.add(nextIndex)
    return nextIndex
  }

  const fields: WireField[] = []
  for (const { propName, prop, meta } of properties) {
    const index = meta.index ?? allocateIndex()
    const isRequired = message.required.has(propName)
    const shape = classifyField(prop, schemas)
    const scalarOverride = shape.kind === 'scalar' ? meta.type ?? meta.protoType : undefined
    const type = scalarOverride ?? shape.type
    const isEnum = shape.kind === 'enum'

    fields.push({
      name: propName,
      index,
      type,
      kind: shape.kind,
      ...(shape.mapValue ? { mapValue: shape.mapValue } : {}),
      protoType: type,
      isEnum,
      enumRef: isEnum ? shape.type : undefined,
      optional: !isRequired,
      required: isRequired,
      repeated: shape.repeated,
      packed: meta.packed,
      doc: stringOf(prop.description),
      format: stringOf(prop.format),
      defaultValue: prop.default,
    })
  }

  // Sort fields by index for deterministic order
  fields.sort((a, b) => a.index - b.index)

  return {
    name,
    tsTypeName,
    kind: 'message',
    messageName: protoMeta.messageName ?? name,
    protobufMessageName: protoMeta.messageName ?? name,
    package: protoMeta.package ?? packageName,
    doc: stringOf(schema.description),
    fields,
    wireFormat: wireFormat ?? (protoMeta.declared ? 'protobuf' : undefined),
  }
}

function assertFieldNumber(index: number, model: string, property: string): void {
  if (!Number.isInteger(index) || index < 1 || index > MAX_FIELD_NUMBER) {
    throw new Error(`Invalid protobuf field number ${index} for "${property}" in ${model}: expected an integer between 1 and ${MAX_FIELD_NUMBER}.`)
  }
  if (index >= 19000 && index <= 19999) {
    throw new Error(`Invalid protobuf field number ${index} for "${property}" in ${model}: 19000-19999 are reserved by Protocol Buffers.`)
  }
}

// ─── Extension metadata ─────────────────────────────────────────────────────

interface ProtobufMeta {
  /** Whether the schema opts into Protobuf: `x-oa-sdk-protobuf` is an options object or `true`. */
  readonly declared: boolean
  readonly messageName?: string | undefined
  readonly package?: string | undefined
}

function readProtobufMeta(value: unknown): ProtobufMeta {
  const meta = asObject(value)
  return { declared: Boolean(value), messageName: stringOf(meta?.messageName), package: stringOf(meta?.package) }
}

interface ProtobufFieldMeta {
  readonly index?: number | undefined
  readonly type?: string | undefined
  readonly protoType?: string | undefined
  readonly packed?: boolean | undefined
}

function readFieldMeta(prop: JsonObject): ProtobufFieldMeta {
  const meta = asObject(prop[PROTOBUF_FIELD_EXTENSION])
  return {
    index: typeof meta?.index === 'number' ? meta.index : undefined,
    type: stringOf(meta?.type),
    protoType: stringOf(meta?.protoType),
    packed: typeof meta?.packed === 'boolean' ? meta.packed : undefined,
  }
}

interface RpcMeta {
  readonly methodName?: string | undefined
  readonly serviceName?: string | undefined
  readonly service?: string | undefined
  readonly method?: string | undefined
  readonly streaming?: RpcStreaming | undefined
  readonly clientStreaming?: boolean | undefined
  readonly serverStreaming?: boolean | undefined
}

function readRpcMeta(value: unknown): RpcMeta {
  const meta = asObject(value)
  if (!meta) return {}
  return {
    methodName: stringOf(meta.methodName),
    serviceName: stringOf(meta.serviceName),
    service: stringOf(meta.service),
    method: stringOf(meta.method),
    streaming: rpcStreaming(meta.streaming),
    clientStreaming: typeof meta.clientStreaming === 'boolean' ? meta.clientStreaming : undefined,
    serverStreaming: typeof meta.serverStreaming === 'boolean' ? meta.serverStreaming : undefined,
  }
}

function rpcStreaming(value: unknown): RpcStreaming | undefined {
  return value === 'none' || value === 'client' || value === 'server' || value === 'bidirectional' ? value : undefined
}

// ─── Component schemas ──────────────────────────────────────────────────────

/** Properties and required names of an object schema, with its `allOf` members merged in. */
interface FlatObject {
  /** In declaration order: inherited members first, an own property replacing an inherited one. */
  readonly properties: ReadonlyMap<string, JsonObject>
  readonly required: ReadonlySet<string>
  /** Declares properties, or is a closed `type: object`; otherwise a free-form or map-only object. */
  readonly message: boolean
}

/** A FlatObject that is a Protobuf message. */
type FlatMessage = FlatObject & { readonly message: true }

const NO_MEMBERS: FlatObject = { properties: new Map(), required: new Set(), message: false }

class ComponentSchemas {
  private readonly messages = new Map<string, FlatMessage | null>()

  constructor(private readonly schemas: JsonObject) {}

  names(): string[] {
    return Object.keys(this.schemas)
  }

  get(name: string): JsonObject | undefined {
    return Object.hasOwn(this.schemas, name) ? asObject(this.schemas[name]) : undefined
  }

  /**
   * The component as a Protobuf message, or undefined when it is not one: an enum, a scalar, a
   * union, a `$ref` alias, a free-form or map-only object, or an `allOf` of anything else.
   */
  message(name: string): FlatMessage | undefined {
    const cached = this.messages.get(name)
    if (cached !== undefined) return cached ?? undefined
    const schema = this.get(name)
    const flat = schema ? this.flatten(schema, new Set([name])) : undefined
    const message = flat && isFlatMessage(flat) ? flat : undefined
    this.messages.set(name, message ?? null)
    return message
  }

  private flatten(schema: JsonObject, seen: ReadonlySet<string>): FlatObject | undefined {
    if (schema.$ref !== undefined || Array.isArray(schema.enum)) return undefined
    if (schema.oneOf !== undefined || schema.anyOf !== undefined || schema.not !== undefined) return undefined
    const type = primaryType(schema)
    if (schema.type !== undefined && type !== 'object') return undefined

    const properties = new Map<string, JsonObject>()
    const required = new Set<string>()
    let message = type === 'object' && !hasOpenExtras(schema)

    if (schema.allOf !== undefined) {
      if (!Array.isArray(schema.allOf)) return undefined
      for (const rawMember of schema.allOf) {
        const member = asObject(rawMember)
        const flat = member ? this.flattenMember(member, seen) : undefined
        if (!flat) return undefined
        for (const [propName, prop] of flat.properties) properties.set(propName, prop)
        for (const propName of flat.required) required.add(propName)
        message ||= flat.message
      }
    }

    if (schema.properties !== undefined) {
      const own = asObject(schema.properties)
      if (!own) return undefined
      message = true
      for (const [propName, rawProp] of Object.entries(own)) {
        const prop = asObject(rawProp)
        if (prop) properties.set(propName, prop)
      }
    }
    for (const propName of stringsOf(schema.required)) required.add(propName)

    return { properties, required, message }
  }

  /** An `allOf` member: an inline object schema or a `$ref` to a component object. */
  private flattenMember(member: JsonObject, seen: ReadonlySet<string>): FlatObject | undefined {
    const ref = stringOf(member.$ref)
    if (ref === undefined) return this.flatten(member, seen)
    const name = extractRefName(ref)
    // A cyclic `allOf` adds nothing the cycle has not already added.
    if (seen.has(name)) return NO_MEMBERS
    const target = this.get(name)
    return target ? this.flatten(target, new Set([...seen, name])) : undefined
  }
}

function isFlatMessage(flat: FlatObject): flat is FlatMessage {
  return flat.message
}

/** Whether `additionalProperties` or `unevaluatedProperties` admits members besides `properties`. */
function hasOpenExtras(schema: JsonObject): boolean {
  return [schema.additionalProperties, schema.unevaluatedProperties].some(extra => extra !== undefined && extra !== false)
}

/** A method before the empty message is named: `inputType`/`outputType` absent when not a message. */
type PendingMethod = Omit<WireMethod, 'inputType' | 'outputType'> & {
  readonly inputType: string | undefined
  readonly outputType: string | undefined
}

/** The payload's component when it is a message model; undefined for the empty message. */
function messageTypeName(typeName: string | undefined, messageNames: ReadonlySet<string>): string | undefined {
  return typeName !== undefined && messageNames.has(typeName) ? typeName : undefined
}

// ─── Field classification ───────────────────────────────────────────────────

type FieldShape = {
  kind: WireFieldKind
  type: string
  repeated: boolean
  mapValue?: WireMapValue
}

type ValueShape = { kind: WireMapValue['kind']; type: string }

const JSON_SHAPE: FieldShape = { kind: 'json', type: 'string', repeated: false }

const SCALAR_SCHEMA_TYPES = new Set(['string', 'integer', 'number', 'boolean'])

/** Primary non-null JSON type, or undefined for unions of several types. */
function primaryType(schema: JsonObject): string | undefined {
  if (typeof schema.type === 'string') return schema.type
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((type: unknown) => type !== 'null')
    const [only] = types
    return types.length === 1 && typeof only === 'string' ? only : undefined
  }
  return undefined
}

/** Classifies one property schema into its wire shape; see `WireFieldKind`. */
function classifyField(prop: JsonObject, schemas: ComponentSchemas): FieldShape {
  if (primaryType(prop) === 'array') {
    const item = classifyValue(asObject(prop.items) ?? {}, schemas)
    return item ? { ...item, repeated: true } : JSON_SHAPE
  }
  const value = classifyValue(prop, schemas)
  if (value) return { ...value, repeated: false }
  // A `$ref` to a map-only component is a map field; other non-message objects travel as JSON.
  const ref = stringOf(prop.$ref)
  const target = ref === undefined ? prop : schemas.get(extractRefName(ref)) ?? prop
  return classifyMap(target, schemas) ?? JSON_SHAPE
}

function classifyValue(schema: JsonObject, schemas: ComponentSchemas): ValueShape | undefined {
  const ref = stringOf(schema.$ref)
  if (ref !== undefined) {
    const name = extractRefName(ref)
    const target = schemas.get(name)
    if (!target) return undefined
    if (Array.isArray(target.enum)) return { kind: 'enum', type: name }
    if (schemas.message(name)) return { kind: 'message', type: name }
    const type = primaryType(target)
    return type && SCALAR_SCHEMA_TYPES.has(type) && !hasComposition(target) ? { kind: 'scalar', type: resolveFieldScalarType(target) } : undefined
  }
  const type = primaryType(schema)
  if (type && SCALAR_SCHEMA_TYPES.has(type) && !hasComposition(schema)) {
    return { kind: 'scalar', type: resolveFieldScalarType(schema) }
  }
  return undefined
}

/** An object whose only members are `additionalProperties` of a scalar, enum, or message type. */
function classifyMap(schema: JsonObject, schemas: ComponentSchemas): FieldShape | undefined {
  if (primaryType(schema) !== 'object' || schema.properties !== undefined || hasComposition(schema)) return undefined
  const additional = asObject(schema.additionalProperties ?? schema.unevaluatedProperties)
  if (!additional) return undefined
  const value = classifyValue(additional, schemas)
  if (!value) return undefined
  return { kind: 'map', type: 'map', repeated: false, mapValue: { kind: value.kind, type: value.type } }
}

function hasComposition(schema: JsonObject): boolean {
  return [schema.oneOf, schema.anyOf, schema.allOf, schema.not].some(Boolean)
}

function resolveFieldScalarType(schema: JsonObject): string {
  const ref = stringOf(schema.$ref)
  if (ref !== undefined) return extractRefName(ref)
  const type = primaryType(schema)
  const format = schema.format

  if (type === 'string') {
    if (format === 'byte' || format === 'binary') return 'bytes'
    return 'string'
  }
  if (type === 'integer') {
    if (format === 'int8' || format === 'int16' || format === 'int32') return 'int32'
    if (format === 'uint8' || format === 'uint16' || format === 'uint32') return 'uint32'
    if (format === 'uint64') return 'uint64'
    // JSON Schema integers are unbounded: int64 keeps every safe integer and costs no more than
    // int32 on the wire.
    return 'int64'
  }
  if (type === 'number') {
    if (format === 'float' || format === 'float32') return 'float'
    return 'double'
  }
  if (type === 'boolean') {
    return 'bool'
  }
  return 'string'
}

// ─── Operations ─────────────────────────────────────────────────────────────

/** Prefers a media type whose schema is a component reference, as the wire message type. */
function pickMedia(content: unknown): { mediaType: string; typeName?: string } | undefined {
  const entries = Object.entries(asObject(content) ?? {})
  const schemaRef = (media: unknown): string | undefined => stringOf(asObject(asObject(media)?.schema)?.$ref)
  const [mediaType, media] = entries.find(([, candidate]) => schemaRef(candidate) !== undefined) ?? entries[0] ?? []
  if (mediaType === undefined) return undefined
  const ref = schemaRef(media)
  return ref !== undefined ? { mediaType, typeName: extractRefName(ref) } : { mediaType }
}

function resolveRequestBody(op: JsonObject): WirePayload | undefined {
  const body = asObject(op.requestBody)
  const media = pickMedia(body?.content)
  if (!media) return undefined
  return { ...media, required: body?.required === true }
}

function resolveSuccessResponse(op: JsonObject): (WirePayload & { status: number }) | undefined {
  const responses = asObject(op.responses)
  if (!responses) return undefined
  const statuses = Object.keys(responses)
    .filter(status => /^2(?:\d\d|XX)$/i.test(status))
    .sort((left, right) => (/^\d+$/.test(left) ? Number(left) : 299) - (/^\d+$/.test(right) ? Number(right) : 299))
  const status = statuses[0] ?? (responses.default ? 'default' : undefined)
  if (status === undefined) return undefined
  const media = pickMedia(asObject(responses[status])?.content)
  return { status: /^\d+$/.test(status) ? Number(status) : 200, mediaType: media?.mediaType ?? '', ...(media?.typeName ? { typeName: media.typeName } : {}) }
}

/** Wire format implied by a declared media type. */
function wireFormatOf(mediaType: string | undefined): string {
  const essence = (mediaType ?? '').split(';')[0]!.trim().toLowerCase()
  if (essence.includes('protobuf')) return 'protobuf'
  if (essence.includes('msgpack')) return 'msgpack'
  if (essence === 'application/octet-stream') return 'raw-binary'
  return 'json'
}

function parameterLocation(value: unknown): WireParameterLocation | undefined {
  return value === 'path' || value === 'query' || value === 'header' || value === 'cookie' ? value : undefined
}

/**
 * Operation parameters merged over path-item parameters (same name and location), with
 * `$ref`s to `components.parameters` resolved. Path template variables that no parameter
 * declares are added as required strings so the route can still be filled in.
 */
function resolveParameters(
  doc: OasDocument,
  path: string,
  pathLevel: unknown,
  operationLevel: unknown,
  enumNames: ReadonlySet<string>,
  schemas: ComponentSchemas,
): WireParameter[] {
  const merged = new Map<string, { parameter: JsonObject; name: string; location: WireParameterLocation }>()
  for (const list of [pathLevel, operationLevel]) {
    if (!Array.isArray(list)) continue
    for (const raw of list) {
      const parameter = resolveParameterRef(doc, raw)
      const name = stringOf(parameter?.name)
      const location = parameterLocation(parameter?.in)
      if (!parameter || name === undefined || location === undefined) continue
      merged.set(`${location}\0${name}`, { parameter, name, location })
    }
  }

  const parameters: WireParameter[] = [...merged.values()].map(({ parameter, name, location }) => {
    const schema = asObject(parameter.schema) ?? {}
    const repeated = schema.type === 'array'
    const itemSchema = repeated ? asObject(schema.items) ?? {} : schema
    const ref = stringOf(itemSchema.$ref)
    const refName = ref === undefined ? undefined : extractRefName(ref)
    const isEnum = refName !== undefined && (enumNames.has(refName) || Array.isArray(schemas.get(refName)?.enum))
    const doc = stringOf(parameter.description)
    return {
      name,
      in: location,
      required: location === 'path' || parameter.required === true,
      type: resolveFieldScalarType(itemSchema),
      repeated,
      ...(isEnum ? { isEnum } : {}),
      ...(doc !== undefined ? { doc } : {}),
    }
  })

  for (const match of path.matchAll(/\{([^}]+)\}/g)) {
    const name = match[1]!
    if (!parameters.some(parameter => parameter.in === 'path' && parameter.name === name)) {
      parameters.push({ name, in: 'path', required: true, type: 'string', repeated: false })
    }
  }
  return parameters
}

function resolveParameterRef(doc: OasDocument, value: unknown): JsonObject | undefined {
  const components = asObject(asObject(doc.components)?.parameters)
  let current = asObject(value)
  const seen = new Set<string>()
  for (let ref = stringOf(current?.$ref); current && ref !== undefined; ref = stringOf(current?.$ref)) {
    // A reference cycle names no parameter.
    if (seen.has(ref)) return undefined
    seen.add(ref)
    const match = ref.match(/^#\/components\/parameters\/(.+)$/)
    current = match?.[1] === undefined
      ? undefined
      : asObject(components?.[match[1].replace(/~1/g, '/').replace(/~0/g, '~')])
  }
  return current
}

// ─── JSON helpers ───────────────────────────────────────────────────────────

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item: unknown): item is string => typeof item === 'string') : []
}

function firstTag(tags: unknown): string | undefined {
  const [tag] = stringsOf(tags)
  return tag === '' ? undefined : tag
}

function extractRefName(ref: string): string {
  const parts = ref.split('/')
  return parts[parts.length - 1] ?? ref
}

function sanitizePackageName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'service'
}
