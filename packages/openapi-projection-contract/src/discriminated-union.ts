import type {
  OpenApiProjectionProfile,
  OpenApiProjectionResult,
  SchemaRefEdge,
  SchemaSourceCoordinate,
} from './index.js'

export interface DiscriminatedUnionProjectionOptions {
  /** Discriminator property name in JSON payload (e.g., 'method', 'operation', 'type', 'kind') */
  discriminatorProperty: string
  /** Name/Identifier for the projected union schema (e.g., 'NativeRpcRequest', 'DevLinkMcpControlRequestV1') */
  unionSchemaId: string
  /** Mapping of discriminator values to variant schemas (plain schema objects, descriptors, or wrapper objects) */
  variants: Record<string, unknown>
  /** Target OpenAPI Projection Profile ('operation-contract' | 'component-bundle') */
  profile?: 'operation-contract' | 'component-bundle'
  /** Base path prefix when projecting operation paths (e.g., '/rpc', '/mcp') */
  pathPrefix?: string
  /** Human-readable description for the root union schema */
  description?: string
  /** Optional base/common properties to declare on the root union schema */
  baseProperties?: Record<string, unknown>
  /** Optional base/common required property names to declare on the root union schema */
  baseRequired?: string[]
  /** Optional schema component reference prefix (defaults to '#/components/schemas') */
  componentRefPrefix?: string
  /** Optional default response schema for operation contract paths */
  defaultResponseSchema?: Record<string, unknown>
  /** Optional default response schema ref for operation contract paths (e.g. '#/components/schemas/RpcResult') */
  defaultResponseSchemaRef?: string
}

export interface DiscriminatedUnionProjectionResult {
  /** Root union schema containing discriminator and oneOf array */
  unionSchema: Record<string, unknown>
  /** Extracted reusable component schemas for each variant keyed by schema name */
  variantSchemas: Record<string, Record<string, unknown>>
  /** Generated OpenAPI 3.1 paths object (present when profile is 'operation-contract' or pathPrefix is provided) */
  paths?: Record<string, unknown>
}

export interface DiscriminatedUnionDocumentOptions extends DiscriminatedUnionProjectionOptions {
  title?: string
  version?: string
  infoDescription?: string
  info?: Record<string, unknown>
  openapiVersion?: string
}

type VariantInputParsed = {
  schema: Record<string, unknown>
  name?: string | undefined
  title?: string | undefined
  summary?: string | undefined
  description?: string | undefined
  operationId?: string | undefined
  responses?: Record<string, unknown> | undefined
  responseSchemaRef?: string | undefined
  responseSchema?: Record<string, unknown> | undefined
}

/**
 * Projects polymorphic schemas or multiplexed single-stream RPC/MCP operations
 * into canonical OpenAPI 3.1 discriminator + oneOf models.
 */
export function projectDiscriminatedUnion(
  options: DiscriminatedUnionProjectionOptions,
): DiscriminatedUnionProjectionResult {
  if (!options || typeof options !== 'object') {
    throw new Error('DiscriminatedUnionProjectionOptions must be an object')
  }

  const {
    discriminatorProperty,
    unionSchemaId,
    variants,
    profile,
    pathPrefix,
    description,
    baseProperties,
    baseRequired,
    componentRefPrefix = '#/components/schemas',
    defaultResponseSchema,
    defaultResponseSchemaRef,
  } = options

  if (typeof discriminatorProperty !== 'string' || !discriminatorProperty.trim()) {
    throw new Error('discriminatorProperty must be a non-empty string')
  }

  if (typeof unionSchemaId !== 'string' || !unionSchemaId.trim()) {
    throw new Error('unionSchemaId must be a non-empty string')
  }

  if (!variants || typeof variants !== 'object' || Array.isArray(variants)) {
    throw new Error('variants must be an object mapping discriminator keys to variant schemas')
  }

  const variantEntries = Object.entries(variants)
  if (variantEntries.length === 0) {
    throw new Error('Discriminated union must contain at least one variant')
  }

  const variantSchemas: Record<string, Record<string, unknown>> = {}
  const mapping: Record<string, string> = {}
  const oneOf: Array<{ $ref: string }> = []
  const operationPaths: Record<string, unknown> = {}
  const allocatedSchemaNames = new Set<string>()

  const effectiveProfile = profile ?? (pathPrefix ? 'operation-contract' : 'component-bundle')
  const shouldGeneratePaths = effectiveProfile === 'operation-contract' || pathPrefix !== undefined

  for (const [key, rawVariant] of variantEntries) {
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error('Variant discriminator key must be a non-empty string')
    }

    const {
      schema: extractedSchema,
      name: customName,
      title: customTitle,
      summary: customSummary,
      description: customDescription,
      operationId: customOperationId,
      responses: customResponses,
      responseSchemaRef: customResponseRef,
      responseSchema: customResponseSchema,
    } = parseVariantInput(rawVariant)

    const baseVariantSchemaName = determineVariantSchemaName(
      key,
      unionSchemaId,
      customName || customTitle || (extractedSchema.title as string | undefined),
    )

    let variantSchemaName = baseVariantSchemaName
    if (allocatedSchemaNames.has(variantSchemaName)) {
      let disambiguationIndex = 2
      while (
        allocatedSchemaNames.has(`${baseVariantSchemaName}_${disambiguationIndex}`) ||
        allocatedSchemaNames.has(`${baseVariantSchemaName}${disambiguationIndex}`)
      ) {
        disambiguationIndex++
      }
      variantSchemaName = `${baseVariantSchemaName}_${disambiguationIndex}`
    }
    allocatedSchemaNames.add(variantSchemaName)

    const normalizedVariantSchema = normalizeVariantSchema(
      extractedSchema,
      discriminatorProperty,
      key,
      variantSchemaName,
    )

    variantSchemas[variantSchemaName] = normalizedVariantSchema

    const cleanRefPrefix = componentRefPrefix.replace(/\/$/, '')
    const ref = `${cleanRefPrefix}/${variantSchemaName}`
    mapping[key] = ref
    oneOf.push({ $ref: ref })

    if (shouldGeneratePaths) {
      const prefixInput = (pathPrefix !== undefined && pathPrefix.trim() !== '') ? pathPrefix.trim() : '/rpc'
      const strippedPrefix = prefixInput.replace(/^\/+|\/+$/g, '')
      const normalizedPrefix = strippedPrefix ? `/${strippedPrefix}` : ''
      const cleanKey = key.replace(/^\/+/, '')
      const pathKey = normalizedPrefix ? `${normalizedPrefix}/${cleanKey}` : `/${cleanKey}`

      const operationId = customOperationId ?? deriveOperationId(key, normalizedPrefix)
      const summary = customSummary ?? `Execute ${key} operation`
      const desc = customDescription ?? `Canonical operation contract for ${key}.`

      const responses =
        customResponses ??
        buildDefaultResponses(
          customResponseRef ?? defaultResponseSchemaRef,
          customResponseSchema ?? defaultResponseSchema,
        )

      operationPaths[pathKey] = {
        post: {
          summary,
          description: desc,
          operationId,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: ref },
              },
            },
          },
          responses,
        },
      }
    }
  }

  // Build root union schema
  const unionProperties: Record<string, unknown> = { ...(baseProperties ?? {}) }
  if (!unionProperties[discriminatorProperty]) {
    unionProperties[discriminatorProperty] = { type: 'string' }
  }

  const unionRequiredSet = new Set<string>(baseRequired ?? [])
  unionRequiredSet.add(discriminatorProperty)

  const unionSchema: Record<string, unknown> = {
    type: 'object',
    ...(description ? { description } : {}),
    required: Array.from(unionRequiredSet),
    properties: unionProperties,
    discriminator: {
      propertyName: discriminatorProperty,
      mapping,
    },
    oneOf,
  }

  const result: DiscriminatedUnionProjectionResult = {
    unionSchema,
    variantSchemas,
  }

  if (shouldGeneratePaths) {
    result.paths = operationPaths
  }

  return result
}

/**
 * Helper to produce a full validated OpenApiProjectionResult containing
 * the projected discriminated union schema, variant components, and operations.
 */
export function projectDiscriminatedUnionDocument(
  options: DiscriminatedUnionDocumentOptions,
): OpenApiProjectionResult<{
  openapi: string
  info: { title: string; version: string; [key: string]: unknown }
  paths: Record<string, unknown>
  components: { schemas: Record<string, unknown> }
}> {
  const projection = projectDiscriminatedUnion(options)
  const profile: OpenApiProjectionProfile =
    options.profile ?? (options.pathPrefix ? 'operation-contract' : 'component-bundle')

  const schemas: Record<string, unknown> = {
    [options.unionSchemaId]: projection.unionSchema,
    ...projection.variantSchemas,
  }

  const paths = projection.paths ?? {}

  const openapiDoc = {
    openapi: options.openapiVersion ?? '3.1.0',
    info: {
      title: options.title ?? `${options.unionSchemaId} Projection Document`,
      version: options.version ?? '1.0.0',
      ...(options.infoDescription ? { description: options.infoDescription } : {}),
      ...(options.info ?? {}),
    },
    paths,
    components: {
      schemas,
    },
  }

  const refs: SchemaRefEdge[] = Object.keys(projection.variantSchemas).map((variantName) => ({
    from: `#/components/schemas/${options.unionSchemaId}`,
    to: `#/components/schemas/${variantName}`,
    ref: `#/components/schemas/${variantName}`,
    kind: 'discriminator-variant',
    source: {
      kind: 'file',
      filePath: `schemas/${options.unionSchemaId}.ts`,
      pointer: `#/components/schemas/${options.unionSchemaId}/oneOf`,
    },
  }))

  const sources: Record<string, SchemaSourceCoordinate> = {
    [options.unionSchemaId]: {
      kind: 'file',
      filePath: `schemas/${options.unionSchemaId}.ts`,
      pointer: `#/components/schemas/${options.unionSchemaId}`,
    },
  }

  for (const variantName of Object.keys(projection.variantSchemas)) {
    sources[variantName] = {
      kind: 'file',
      filePath: `schemas/${variantName}.ts`,
      pointer: `#/components/schemas/${variantName}`,
    }
  }

  return {
    profile,
    projection: openapiDoc,
    refs,
    diagnostics: [],
    sources,
    versionHash: `sha256:${simpleDeterministicHash(JSON.stringify(openapiDoc))}`,
  }
}

function parseVariantInput(rawVariant: unknown): VariantInputParsed {
  if (!rawVariant || typeof rawVariant !== 'object' || Array.isArray(rawVariant)) {
    return { schema: { type: 'object' } }
  }

  const record = rawVariant as Record<string, unknown>

  if ('schema' in record && record.schema && typeof record.schema === 'object' && !Array.isArray(record.schema)) {
    return {
      schema: { ...(record.schema as Record<string, unknown>) },
      name: typeof record.name === 'string' ? record.name : undefined,
      title: typeof record.title === 'string' ? record.title : undefined,
      summary: typeof record.summary === 'string' ? record.summary : undefined,
      description: typeof record.description === 'string' ? record.description : undefined,
      operationId: typeof record.operationId === 'string' ? record.operationId : undefined,
      responses:
        record.responses && typeof record.responses === 'object'
          ? (record.responses as Record<string, unknown>)
          : undefined,
      responseSchemaRef: typeof record.responseSchemaRef === 'string' ? record.responseSchemaRef : undefined,
      responseSchema:
        record.responseSchema && typeof record.responseSchema === 'object'
          ? (record.responseSchema as Record<string, unknown>)
          : undefined,
    }
  }

  return {
    schema: { ...record },
    name: typeof record.name === 'string' ? record.name : undefined,
    title: typeof record.title === 'string' ? record.title : undefined,
    summary: typeof record.summary === 'string' ? record.summary : undefined,
    description: typeof record.description === 'string' ? record.description : undefined,
    operationId: typeof record.operationId === 'string' ? record.operationId : undefined,
  }
}

function normalizeVariantSchema(
  rawSchema: Record<string, unknown>,
  discriminatorProperty: string,
  expectedKey: string,
  variantSchemaName: string,
): Record<string, unknown> {
  const schema: Record<string, unknown> = { ...rawSchema }

  if (!schema.type && !schema.properties && !schema.$ref && !schema.allOf && !schema.oneOf && !schema.anyOf) {
    schema.type = 'object'
  }

  if (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
    const properties = { ...(schema.properties as Record<string, unknown>) }
    const existingDisc = properties[discriminatorProperty]

    if (existingDisc && typeof existingDisc === 'object' && existingDisc !== null) {
      const discObj = existingDisc as Record<string, unknown>
      if ('const' in discObj && discObj.const !== expectedKey) {
        throw new Error(
          `Variant "${expectedKey}" discriminator property "${discriminatorProperty}" has mismatched const value "${discObj.const}" in schema "${variantSchemaName}".`,
        )
      }
      if ('enum' in discObj && Array.isArray(discObj.enum) && !discObj.enum.includes(expectedKey)) {
        throw new Error(
          `Variant "${expectedKey}" discriminator property "${discriminatorProperty}" has mismatched enum value in schema "${variantSchemaName}".`,
        )
      }
    } else {
      properties[discriminatorProperty] = {
        type: 'string',
        const: expectedKey,
      }
    }
    schema.properties = properties
  } else if (schema.type === 'object' || !schema.type) {
    schema.properties = {
      [discriminatorProperty]: {
        type: 'string',
        const: expectedKey,
      },
    }
  }

  if (schema.properties) {
    const required = Array.isArray(schema.required) ? [...schema.required] : []
    if (!required.includes(discriminatorProperty)) {
      required.push(discriminatorProperty)
    }
    schema.required = required
  }

  return schema
}

function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
    .replace(/^[a-z]/, (chr) => chr.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '')
}

function determineVariantSchemaName(
  key: string,
  unionSchemaId: string,
  explicitName?: string,
): string {
  if (explicitName && explicitName.trim()) {
    return explicitName.trim()
  }

  const pascalKey = toPascalCase(key) || 'Variant'
  const cleanUnionId = unionSchemaId.trim()

  if (pascalKey.toLowerCase().startsWith(cleanUnionId.toLowerCase())) {
    return pascalKey
  }

  return `${cleanUnionId}${pascalKey}`
}

function deriveOperationId(key: string, pathPrefix: string): string {
  const prefixPart = pathPrefix.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]/g, '')
  const pascalKey = toPascalCase(key)
  if (!prefixPart) {
    return pascalKey.replace(/^[A-Z]/, (chr) => chr.toLowerCase())
  }
  return `${prefixPart.toLowerCase()}${pascalKey}`
}

function buildDefaultResponses(
  responseRef?: string,
  responseSchema?: Record<string, unknown>,
): Record<string, unknown> {
  const successSchema = responseRef
    ? { $ref: responseRef }
    : (responseSchema ?? { type: 'object' })

  return {
    '200': {
      description: 'Operation executed successfully',
      content: {
        'application/json': {
          schema: successSchema,
        },
      },
    },
    '422': {
      description: 'Validation error or invalid request payload',
      content: {
        'application/json': {
          schema: { type: 'object' },
        },
      },
    },
    '500': {
      description: 'Internal server or daemon error',
      content: {
        'application/json': {
          schema: { type: 'object' },
        },
      },
    },
  }
}

function simpleDeterministicHash(str: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0')
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0')
  return (hex1 + hex2).repeat(4).slice(0, 64)
}
