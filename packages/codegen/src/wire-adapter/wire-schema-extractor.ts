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
  WireService,
  WireMethod,
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

      let autoIndex = 1
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

        const explicitIndex = typeof fieldMeta?.index === 'number' ? fieldMeta.index : undefined
        const index = explicitIndex ?? autoIndex++

        const isArray = prop.type === 'array' || fieldMeta?.repeated === true
        const itemSchema = isArray ? (prop.items ?? {}) : prop
        const refName = itemSchema.$ref ? extractRefName(itemSchema.$ref) : undefined
        const isEnum = Boolean(refName && (enums.some(e => e.name === refName) || (schemas[refName] as any)?.enum))
        const baseType = fieldMeta?.type ?? fieldMeta?.protoType ?? resolveFieldScalarType(itemSchema)
        const isRequired = requiredSet.has(propName)

        fields.push({
          name: propName,
          index,
          type: baseType,
          protoType: fieldMeta?.protoType ?? baseType,
          isEnum,
          enumRef: isEnum ? refName : undefined,
          optional: !isRequired,
          required: isRequired,
          repeated: isArray,
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

      const inputType = resolveOperationInputType(op)
      const outputType = resolveOperationOutputType(op)

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
        wireFormat: wireFormat ?? 'protobuf',
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

function resolveFieldScalarType(schema: Record<string, any>): string {
  if (schema.$ref) {
    return extractRefName(schema.$ref)
  }
  const type = schema.type
  const format = schema.format

  if (type === 'string') {
    if (format === 'byte' || format === 'binary') return 'bytes'
    return 'string'
  }
  if (type === 'integer') {
    if (format === 'int64') return 'int64'
    return 'int32'
  }
  if (type === 'number') {
    if (format === 'float') return 'float'
    return 'double'
  }
  if (type === 'boolean') {
    return 'bool'
  }
  return 'string'
}

function resolveOperationInputType(op: Record<string, any>): string {
  const content = op.requestBody?.content
  if (content && typeof content === 'object') {
    for (const mediaType of Object.values(content) as any[]) {
      if (mediaType?.schema?.$ref) {
        return extractRefName(mediaType.schema.$ref)
      }
    }
  }
  return 'Empty'
}

function resolveOperationOutputType(op: Record<string, any>): string {
  const responses = op.responses
  if (responses && typeof responses === 'object') {
    const success = responses['200'] ?? responses['201'] ?? responses['default']
    const content = success?.content
    if (content && typeof content === 'object') {
      for (const mediaType of Object.values(content) as any[]) {
        if (mediaType?.schema?.$ref) {
          return extractRefName(mediaType.schema.$ref)
        }
      }
    }
  }
  return 'Empty'
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
