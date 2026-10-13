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

import type { OasDocument } from '@oa-sdk/parser'
import type {
  WireSchemaModel,
  WireModel,
  WireField,
  WireEnum,
  WireEnumMember,
  WireFieldKind,
  WireMapValue,
  WireService,
  WireMethod,
  WireParameter,
  WireParameterLocation,
  WirePayload,
} from './wire-schema-model.js'
import {
  PROTOBUF_EXTENSION,
  PROTOBUF_FIELD_EXTENSION,
  RPC_EXTENSION,
  WIRE_FORMAT_EXTENSION,
} from '@oa-sdk/typespec-decorators'

export interface ExtractorOptions {
  readonly defaultPackage?: string | undefined
  readonly defaultServiceName?: string | undefined
}

/**
 * Extracts a canonical WireSchemaModel from an OpenAPI document.
 */
export function extractWireSchemaFromOas(
  doc: OasDocument,
  options: ExtractorOptions = {},
): WireSchemaModel {
  const packageName = options.defaultPackage ?? sanitizePackageName(doc.info?.title ?? 'service')
  const defaultServiceName = options.defaultServiceName ?? toPascalCase(packageName) + 'Service'

  const models: WireModel[] = []
  const enums: WireEnum[] = []
  const schemas = doc.components?.schemas ?? {}

  for (const [schemaName, rawSchema] of Object.entries(schemas)) {
    const schema = rawSchema as Record<string, any>
    if (!schema || typeof schema !== 'object') continue

    // Detect enum
    if (Array.isArray(schema.enum)) {
      const members: WireEnumMember[] = schema.enum.map((val: any, idx: number) => ({
        name: String(val).toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
        number: idx,
      }))
      enums.push({
        name: schemaName,
        doc: schema.description,
        members,
        values: schema.enum.map(String),
        literals: [...schema.enum],
      })
      continue
    }

    // Process object schema as model
    if (schema.type === 'object' || schema.properties) {
      const protoMeta = schema[PROTOBUF_EXTENSION] as { messageName?: string; package?: string } | undefined
      const wireFormat = schema[WIRE_FORMAT_EXTENSION] as string | undefined

      const fields: WireField[] = []
      const requiredSet = new Set(Array.isArray(schema.required) ? schema.required : [])
      const properties = schema.properties ?? {}

      // Explicit field numbers win; the others take the lowest free numbers in declaration order.
      const usedIndexes = new Set<number>()
      for (const rawProp of Object.values(properties)) {
        const explicit = (rawProp as Record<string, any> | undefined)?.[PROTOBUF_FIELD_EXTENSION]?.index
        if (typeof explicit === 'number') usedIndexes.add(explicit)
      }
      let nextIndex = 1
      const allocateIndex = (): number => {
        while (usedIndexes.has(nextIndex) || (nextIndex >= 19000 && nextIndex <= 19999)) nextIndex++
        usedIndexes.add(nextIndex)
        return nextIndex
      }

      for (const [propName, rawProp] of Object.entries(properties)) {
        const prop = rawProp as Record<string, any>
        if (!prop || typeof prop !== 'object') continue

        const fieldMeta = prop[PROTOBUF_FIELD_EXTENSION] as {
          index?: number
          type?: string
          protoType?: string
          repeated?: boolean
          packed?: boolean
        } | undefined

        const index = typeof fieldMeta?.index === 'number' ? fieldMeta.index : allocateIndex()
        const isRequired = requiredSet.has(propName)
        const shape = classifyField(prop, schemas)
        const scalarOverride = shape.kind === 'scalar' ? fieldMeta?.type ?? fieldMeta?.protoType : undefined
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
          packed: fieldMeta?.packed,
          doc: prop.description,
          format: prop.format,
          defaultValue: prop.default,
        })
      }

      // Sort fields by index for deterministic order
      fields.sort((a, b) => a.index - b.index)

      models.push({
        name: schemaName,
        messageName: protoMeta?.messageName ?? schemaName,
        protobufMessageName: protoMeta?.messageName ?? schemaName,
        package: protoMeta?.package ?? packageName,
        doc: schema.description,
        fields,
        wireFormat: wireFormat ?? (protoMeta ? 'protobuf' : undefined),
      })
    }
  }

  // Extract RPC Services from paths
  const serviceMap = new Map<string, WireMethod[]>()
  const paths = doc.paths ?? {}

  for (const [pathStr, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue

    const methods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'] as const
    for (const httpMethod of methods) {
      const op = (pathItem as Record<string, any>)[httpMethod]
      if (!op || typeof op !== 'object') continue

      const rpcMeta = op[RPC_EXTENSION] as {
        methodName?: string
        serviceName?: string
        service?: string
        method?: string
        streaming?: 'none' | 'client' | 'server' | 'bidirectional'
        clientStreaming?: boolean
        serverStreaming?: boolean
      } | undefined

      const wireFormat = op[WIRE_FORMAT_EXTENSION] as string | undefined

      const serviceName = rpcMeta?.serviceName ?? rpcMeta?.service ?? (op.tags?.[0] ? toPascalCase(op.tags[0]) + 'Service' : defaultServiceName)
      const opId = op.operationId ?? `${httpMethod}_${pathStr.replace(/[^a-zA-Z0-9]/g, '_')}`
      const methodName = rpcMeta?.methodName ?? rpcMeta?.method ?? toPascalCase(opId)

      const requestBody = resolveRequestBody(op)
      const response = resolveSuccessResponse(op)
      const inputType = requestBody?.typeName ?? 'Empty'
      const outputType = response?.typeName ?? 'Empty'
      const parameters = resolveParameters(doc, pathStr, (pathItem as Record<string, any>).parameters, op.parameters, enums, schemas)

      const clientStreaming = rpcMeta?.clientStreaming ?? (rpcMeta?.streaming === 'client' || rpcMeta?.streaming === 'bidirectional' || false)
      const serverStreaming = rpcMeta?.serverStreaming ?? (rpcMeta?.streaming === 'server' || rpcMeta?.streaming === 'bidirectional' || false)

      const wireMethod: WireMethod = {
        name: methodName,
        methodName,
        doc: op.description ?? op.summary,
        inputType,
        outputType,
        route: pathStr,
        httpMethod: httpMethod.toUpperCase(),
        streaming: rpcMeta?.streaming ?? (clientStreaming && serverStreaming ? 'bidirectional' : clientStreaming ? 'client' : serverStreaming ? 'server' : 'none'),
        clientStreaming,
        serverStreaming,
        wireFormat: wireFormat ?? wireFormatOf(requestBody?.mediaType || response?.mediaType),
        parameters,
        requestBody,
        response,
      }

      if (!serviceMap.has(serviceName)) {
        serviceMap.set(serviceName, [])
      }
      serviceMap.get(serviceName)!.push(wireMethod)
    }
  }

  const services: WireService[] = Array.from(serviceMap.entries()).map(([serviceName, methods]) => ({
    name: serviceName,
    serviceName,
    methods,
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

type FieldShape = {
  kind: WireFieldKind
  type: string
  repeated: boolean
  mapValue?: WireMapValue
}

const SCALAR_SCHEMA_TYPES = new Set(['string', 'integer', 'number', 'boolean'])

/** Primary non-null JSON type, or undefined for unions of several types. */
function primaryType(schema: Record<string, any>): string | undefined {
  if (typeof schema.type === 'string') return schema.type
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((type: unknown) => type !== 'null')
    return types.length === 1 ? types[0] : undefined
  }
  return undefined
}

/** Classifies one property schema into its wire shape; see `WireFieldKind`. */
function classifyField(prop: Record<string, any>, schemas: Record<string, unknown>): FieldShape {
  if (primaryType(prop) === 'array') {
    const item = classifyValue(prop.items ?? {}, schemas)
    if (item && item.kind !== 'map') return { ...item, repeated: true }
    return { kind: 'json', type: 'string', repeated: false }
  }
  const value = classifyValue(prop, schemas)
  if (value) return { ...value, repeated: false }
  const map = classifyMap(prop, schemas)
  if (map) return map
  return { kind: 'json', type: 'string', repeated: false }
}

function classifyValue(
  schema: Record<string, any>,
  schemas: Record<string, unknown>,
): { kind: Exclude<WireFieldKind, 'json'>; type: string; mapValue?: WireMapValue } | undefined {
  if (typeof schema.$ref === 'string') {
    const name = extractRefName(schema.$ref)
    const target = schemas[name] as Record<string, any> | undefined
    if (!target) return undefined
    if (Array.isArray(target.enum)) return { kind: 'enum', type: name }
    if (target.type === 'object' || target.properties) {
      if (!target.properties && classifyMap(target, schemas)) return undefined
      return { kind: 'message', type: name }
    }
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
function classifyMap(schema: Record<string, any>, schemas: Record<string, unknown>): FieldShape | undefined {
  if (primaryType(schema) !== 'object' || schema.properties || hasComposition(schema)) return undefined
  const additional = schema.additionalProperties ?? schema.unevaluatedProperties
  if (!additional || typeof additional !== 'object') return undefined
  const value = classifyValue(additional, schemas)
  if (!value || value.kind === 'map') return undefined
  return { kind: 'map', type: 'map', repeated: false, mapValue: { kind: value.kind, type: value.type } }
}

function hasComposition(schema: Record<string, any>): boolean {
  return Boolean(schema.oneOf || schema.anyOf || schema.allOf || schema.not)
}

function resolveFieldScalarType(schema: Record<string, any>): string {
  if (schema.$ref) {
    return extractRefName(schema.$ref)
  }
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

/** Prefers a media type whose schema is a component reference, as the wire message type. */
function pickMedia(content: unknown): { mediaType: string; typeName?: string } | undefined {
  if (!content || typeof content !== 'object') return undefined
  const entries = Object.entries(content as Record<string, any>)
  const referenced = entries.find(([, media]) => typeof media?.schema?.$ref === 'string')
  const [mediaType, media] = referenced ?? entries[0] ?? []
  if (mediaType === undefined) return undefined
  const ref = media?.schema?.$ref
  return typeof ref === 'string' ? { mediaType, typeName: extractRefName(ref) } : { mediaType }
}

function resolveRequestBody(op: Record<string, any>): WirePayload | undefined {
  const media = pickMedia(op.requestBody?.content)
  if (!media) return undefined
  return { ...media, required: op.requestBody?.required === true }
}

function resolveSuccessResponse(op: Record<string, any>): (WirePayload & { status: number }) | undefined {
  const responses = op.responses
  if (!responses || typeof responses !== 'object') return undefined
  const statuses = Object.keys(responses)
    .filter(status => /^2(?:\d\d|XX)$/i.test(status))
    .sort((left, right) => (/^\d+$/.test(left) ? Number(left) : 299) - (/^\d+$/.test(right) ? Number(right) : 299))
  const status = statuses[0] ?? (responses.default ? 'default' : undefined)
  if (status === undefined) return undefined
  const media = pickMedia(responses[status]?.content)
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

const PARAMETER_LOCATIONS = new Set<WireParameterLocation>(['path', 'query', 'header', 'cookie'])

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
  enums: readonly WireEnum[],
  schemas: Record<string, unknown>,
): WireParameter[] {
  const merged = new Map<string, Record<string, any>>()
  for (const list of [pathLevel, operationLevel]) {
    if (!Array.isArray(list)) continue
    for (const raw of list) {
      const parameter = resolveParameterRef(doc, raw)
      if (!parameter || typeof parameter.name !== 'string' || !PARAMETER_LOCATIONS.has(parameter.in)) continue
      merged.set(`${parameter.in}\0${parameter.name}`, parameter)
    }
  }

  const parameters: WireParameter[] = [...merged.values()].map(parameter => {
    const schema = (parameter.schema ?? {}) as Record<string, any>
    const repeated = schema.type === 'array'
    const itemSchema = (repeated ? schema.items ?? {} : schema) as Record<string, any>
    const refName = typeof itemSchema.$ref === 'string' ? extractRefName(itemSchema.$ref) : undefined
    const isEnum = Boolean(refName && (enums.some(e => e.name === refName) || (schemas[refName] as any)?.enum))
    return {
      name: parameter.name,
      in: parameter.in,
      required: parameter.in === 'path' || parameter.required === true,
      type: resolveFieldScalarType(itemSchema),
      repeated,
      ...(isEnum ? { isEnum } : {}),
      ...(typeof parameter.description === 'string' ? { doc: parameter.description } : {}),
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

function resolveParameterRef(doc: OasDocument, value: unknown): Record<string, any> | undefined {
  let current = value as Record<string, any> | undefined
  const seen = new Set<string>()
  while (current && typeof current.$ref === 'string' && !seen.has(current.$ref)) {
    seen.add(current.$ref)
    const match = current.$ref.match(/^#\/components\/parameters\/(.+)$/)
    current = match?.[1] === undefined
      ? undefined
      : (doc.components?.parameters as Record<string, any> | undefined)?.[match[1].replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return current && typeof current === 'object' ? current : undefined
}

function extractRefName(ref: string): string {
  const parts = ref.split('/')
  return parts[parts.length - 1] ?? ref
}

function toPascalCase(str: string): string {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (letter) => letter.toUpperCase())
    .replace(/[\s\-_]+/g, '')
}

function sanitizePackageName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'service'
}
