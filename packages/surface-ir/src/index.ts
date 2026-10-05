import { createHash } from 'node:crypto'
import type {
  CompleteParsedDocument,
  OperationEntry,
  ParsedDocument,
  OasMediaType,
  OasResponse,
  OasSchema,
} from '@oa-sdk/parser'
// Browser entry: pure helpers without the root entry's TypeScript/Ajv load.
import { escapeJsonPointerToken, unescapeJsonPointerToken } from '@oa-sdk/parser/browser'

export const SURFACE_IR_VERSION = 'oa-sdk.surface-ir.v1' as const

export type SurfaceTarget = 'generic' | 'forge'

export type SurfaceAvailability =
  | 'alpha'
  | 'beta'
  | 'preview'
  | 'generally-available'
  | 'deprecated'
  | 'legacy'

export type SurfaceVisibility = {
  ignored?: boolean
  hidden?: boolean
  internal?: boolean
}

export type SurfaceAlias = {
  groupPath: string[]
  methodName: string
  availability?: SurfaceAvailability
  visibility?: SurfaceVisibility
}

export type SurfaceArgument = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  required: true | { default: string | number | boolean }
  description?: string
  alias?: string
  values?: readonly (string | number | boolean | { literal: string; description: string })[]
}

export type SurfaceParamOverride = {
  description?: string
  default?: string | number | boolean | null
  hidden?: boolean
  required?: boolean
  choices?: readonly (string | number | boolean)[]
  array?: boolean
  positional?: boolean
  fromFile?: false | { format: 'binary' | 'base64' | 'json' }
}

export type SurfacePagination = {
  itemsPath: string
  totalPath?: string
  pagePath?: string
  limitPath?: string
  cursorPath?: string
}

export type SurfaceStreaming = {
  mediaType: 'text/event-stream' | 'application/x-ndjson' | string
  itemSchemaPresent: boolean
}

export type SurfaceRuntime = {
  envelope: 'direct' | 'cloudflare'
  errors: 'status-body' | 'cloudflare-envelope'
  pagination?: SurfacePagination
  streaming?: SurfaceStreaming
}

export type SurfaceOperation = {
  operationId: string
  contract: {
    path: string
    method: string
    tags: string[]
    summary?: string
    description?: string
  }
  projection: {
    groupPath: string[]
    methodName: string
    availability: SurfaceAvailability
    visibility: SurfaceVisibility
    aliases: SurfaceAlias[]
  }
  cli: {
    args?: SurfaceArgument[]
    params?: Record<string, SurfaceParamOverride>
    globals?: SurfaceArgument[]
  }
  runtime: SurfaceRuntime
  provenance: {
    openapiPointer: string
  }
}

export type SurfaceOperationOverride =
  Partial<SurfaceOperation['projection']> & {
    cli?: SurfaceOperation['cli']
  }

export type SurfaceDiagnosticSeverity = 'error' | 'warning' | 'info'

export type SurfaceDiagnostic = {
  severity: SurfaceDiagnosticSeverity
  code: string
  message: string
  operationId?: string
  pointer?: string
}

export type SurfaceIr = {
  schemaVersion: typeof SURFACE_IR_VERSION
  target: SurfaceTarget
  source: {
    openapiVersion: string
    operationCount: number
    artifactHash: string
  }
  operations: Record<string, SurfaceOperation>
  diagnostics: SurfaceDiagnostic[]
  versionHash: string
}

export type SurfaceIrOptions = {
  target?: SurfaceTarget
  defaultAvailability?: SurfaceAvailability
  defaultEnvelope?: SurfaceRuntime['envelope']
  defaultErrors?: SurfaceRuntime['errors']
  groupForOperation?: (operation: OperationEntry) => readonly string[]
  methodForOperation?: (operation: OperationEntry) => string
  operationOverrides?: Readonly<Record<string, SurfaceOperationOverride>>
}

export type ForgeOperationProjection = {
  operationId: string
  'x-fern-sdk-group-name': string
  'x-fern-sdk-method-name': string
  'x-fern-availability': Exclude<SurfaceAvailability, 'legacy'>
  'x-fern-ignore'?: boolean
  'x-forge-hidden'?: boolean
  'x-forge-internal'?: boolean
  'x-forge-globals'?: SurfaceArgument[]
  'x-forge-args'?: SurfaceArgument[]
  'x-forge-params'?: Record<string, SurfaceParamOverride>
}

export type ForgeCommandCatalog = Record<string, {
  description: string
  methods: ForgeOperationProjection[]
}>

export type ForgeProjection = {
  operations: ForgeOperationProjection[]
  commands: ForgeCommandCatalog
  diagnostics: SurfaceDiagnostic[]
}

export type ForgeOverlayBundle = {
  name: string
  overlay: ForgeOverlay
}[]

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace', 'query'])

export function buildSurfaceIr(
  document: ParsedDocument | CompleteParsedDocument,
  options: SurfaceIrOptions = {},
): SurfaceIr {
  const target = options.target ?? 'generic'
  const diagnostics: SurfaceDiagnostic[] = []

  if (document.resolution?.status !== 'complete') {
    diagnostics.push({
      severity: 'error',
      code: 'surface-ir/incomplete-document',
      message: 'Surface IR requires a ParsedDocument with complete reference resolution.',
    })
  }

  const operations: Record<string, SurfaceOperation> = {}
  const methodNames = new Map<string, string>()
  const defaultAvailability = options.defaultAvailability ?? 'generally-available'

  for (const operation of document.operations) {
    const operationId = operation.operationId
    if (!operationId) {
      diagnostics.push({
        severity: 'error',
        code: 'surface-ir/missing-operation-id',
        message: `Operation ${operation.method.toUpperCase()} ${operation.openApiPath} has no operationId.`,
        pointer: operationPointer(operation),
      })
      continue
    }

    if (!HTTP_METHODS.has(operation.method)) {
      diagnostics.push({
        severity: 'error',
        code: 'surface-ir/unsupported-method',
        message: `HTTP method ${operation.method} is not supported by the surface builder.`,
        operationId,
        pointer: operationPointer(operation),
      })
    }

    const override = options.operationOverrides?.[operationId]
    const groupPath = [...(override?.groupPath ?? options.groupForOperation?.(operation) ?? defaultGroup(operation))]
    const methodName = override?.methodName ?? options.methodForOperation?.(operation) ?? operationId
    const availability = override?.availability ?? defaultAvailability
    const visibility = {
      ...(override?.visibility ?? {}),
    }
    const groupKey = groupPath.join('.')
    const collisionKey = `${groupKey}\0${methodName}`
    const previous = methodNames.get(collisionKey)
    if (previous !== undefined && previous !== operationId) {
      diagnostics.push({
        severity: 'error',
        code: 'surface-ir/method-collision',
        message: `Surface method ${groupKey}.${methodName} is assigned to both ${previous} and ${operationId}.`,
        operationId,
        pointer: operationPointer(operation),
      })
    } else {
      methodNames.set(collisionKey, operationId)
    }

    const runtime = inferRuntime(operation, document, options)
    if (target === 'forge' && operation.method === 'query') {
      diagnostics.push({
        severity: 'error',
        code: 'surface-ir/forge-query-method',
        message: 'Forge target does not currently expose OpenAPI QUERY operations.',
        operationId,
        pointer: operationPointer(operation),
      })
    }

    operations[operationId] = {
      operationId,
      contract: {
        path: operation.openApiPath,
        method: operation.method,
        tags: [...operation.tags],
        ...(operation.summary === undefined ? {} : { summary: operation.summary }),
        ...(operation.description === undefined ? {} : { description: operation.description }),
      },
      projection: {
        groupPath,
        methodName,
        availability,
        visibility,
        aliases: [...(override?.aliases ?? [])],
      },
      cli: override?.cli === undefined ? {} : cloneCli(override.cli),
      runtime,
      provenance: {
        openapiPointer: operationPointer(operation),
      },
    }
  }

  const artifactHash = sha256(stableStringify({
    openapi: document.openapi,
    info: document.info,
    operations: Object.values(operations).map(operation => ({
      operationId: operation.operationId,
      contract: operation.contract,
      projection: operation.projection,
      runtime: operation.runtime,
    })),
  }))
  const versionHash = sha256(stableStringify({
    schemaVersion: SURFACE_IR_VERSION,
    target,
    artifactHash,
  }))

  return {
    schemaVersion: SURFACE_IR_VERSION,
    target,
    source: {
      openapiVersion: document.openapi,
      operationCount: Object.keys(operations).length,
      artifactHash,
    },
    operations,
    diagnostics,
    versionHash,
  }
}

export function toForgeProjection(ir: SurfaceIr, document: ParsedDocument): ForgeProjection {
  const diagnostics = [...ir.diagnostics]
  const operations: ForgeOperationProjection[] = []
  const commands: ForgeCommandCatalog = {}

  for (const operation of Object.values(ir.operations)) {
    const availability = operation.projection.availability === 'legacy'
      ? 'deprecated'
      : operation.projection.availability
    const groupPath = operation.projection.groupPath
    if (groupPath.length === 0) {
      diagnostics.push({
        severity: 'error',
        code: 'forge-projection/empty-group',
        message: `Forge operation ${operation.operationId} has an empty SDK group path.`,
        operationId: operation.operationId,
      })
      continue
    }

    const projection: ForgeOperationProjection = {
      operationId: operation.operationId,
      'x-fern-sdk-group-name': groupPath.join('.'),
      'x-fern-sdk-method-name': operation.projection.methodName,
      'x-fern-availability': availability,
      ...(operation.projection.visibility.ignored === undefined ? {} : { 'x-fern-ignore': operation.projection.visibility.ignored }),
      ...(operation.projection.visibility.hidden === undefined ? {} : { 'x-forge-hidden': operation.projection.visibility.hidden }),
      ...(operation.projection.visibility.internal === undefined ? {} : { 'x-forge-internal': operation.projection.visibility.internal }),
      ...(operation.cli.globals === undefined ? {} : { 'x-forge-globals': operation.cli.globals }),
      ...(operation.cli.args === undefined ? {} : { 'x-forge-args': operation.cli.args }),
      ...(operation.cli.params === undefined ? {} : { 'x-forge-params': operation.cli.params }),
    }
    operations.push(projection)

    const commandName = groupPath[0]!
    const command = commands[commandName] ?? {
      description: commandDescription(document, commandName),
      methods: [],
    }
    command.methods.push(projection)
    commands[commandName] = command
  }

  return { operations, commands, diagnostics }
}

export function emitForgeOverlay(
  ir: SurfaceIr,
  document: ParsedDocument,
  options: { name?: string; version?: string } = {},
): { name: string; overlay: ForgeOverlay } {
  const projection = toForgeProjection(ir, document)
  const name = options.name ?? 'oa-sdk-forge'
  const version = options.version ?? '1.0.0'
  const actions: ForgeOverlayAction[] = []

  for (const operation of projection.operations) {
    actions.push({
      target: `$.paths.*[?@.operationId==${JSON.stringify(operation.operationId)}]`,
      update: operation,
    })
  }

  return {
    name,
    overlay: {
      overlay: '1.0.0',
      info: { title: 'OA SDK Forge projection', version },
      actions,
    },
  }
}

/**
 * Forge resolves one command per overlay file. Emit one overlay per top-level
 * command so the bundle can be passed directly to Forge's `init()` API.
 */
export function emitForgeOverlays(
  ir: SurfaceIr,
  document: ParsedDocument,
  options: { version?: string } = {},
): ForgeOverlayBundle {
  const projection = toForgeProjection(ir, document)
  return Object.entries(projection.commands).map(([commandName, command]) => {
    const operationIds = new Set(command.methods.map(method => method.operationId))
    const actions: ForgeOverlayAction[] = [
      {
        target: '$',
        update: {
          'x-forge-commands': {
            [commandName]: {
              description: command.description,
              methods: command.methods,
            },
          },
        },
      },
      ...projection.operations
        .filter(operation => operationIds.has(operation.operationId))
        .map(operation => ({
          target: `$.paths.*[?@.operationId==${JSON.stringify(operation.operationId)}]`,
          update: operation,
        })),
    ]
    return {
      name: commandName,
      overlay: {
        overlay: '1.0.0',
        info: { title: `OA SDK Forge projection: ${commandName}`, version: options.version ?? '1.0.0' },
        actions,
      },
    }
  })
}

export type ForgeOverlay = {
  overlay: '1.0.0'
  info: { title: string; version: string }
  actions: ForgeOverlayAction[]
}

export type ForgeOverlayAction = {
  target: string
  update: unknown
}

function defaultGroup(operation: OperationEntry): string[] {
  const tag = operation.tags[0]
  return [normalizeSegment(tag ?? 'api')]
}

function normalizeSegment(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'api'
}

function operationPointer(operation: OperationEntry): string {
  return `#/paths/${escapeJsonPointerToken(operation.openApiPath)}/${operation.method}`
}

function inferRuntime(
  operation: OperationEntry,
  document: ParsedDocument,
  options: SurfaceIrOptions,
): SurfaceRuntime {
  const streaming = findStreaming(operation)
  const pagination = findPagination(operation, document)
  const runtime: SurfaceRuntime = {
    envelope: options.defaultEnvelope ?? 'direct',
    errors: options.defaultErrors ?? 'status-body',
    ...(pagination === undefined ? {} : { pagination }),
    ...(streaming === undefined ? {} : { streaming }),
  }
  return runtime
}

function findStreaming(operation: OperationEntry): SurfaceStreaming | undefined {
  for (const response of Object.values(operation.responses)) {
    for (const [mediaType, media] of Object.entries(response.content ?? {})) {
      if (mediaType !== 'text/event-stream' && mediaType !== 'application/x-ndjson') continue
      const itemSchemaPresent = isRecord(media) && (media as Record<string, unknown>).itemSchema !== undefined
      return { mediaType, itemSchemaPresent }
    }
  }
  return undefined
}

function findPagination(operation: OperationEntry, document: ParsedDocument): SurfacePagination | undefined {
  for (const response of Object.values(operation.responses)) {
    const mediaValue: unknown = response.content?.['application/json']
    if (!isRecord(mediaValue)) continue
    const schemaValue: unknown = mediaValue.schema
    if (!isRecord(schemaValue)) continue
    const schema = resolveSchema(schemaValue as OasSchema, document)
    const properties = schema?.properties
    if (!properties || !('items' in properties)) continue

    const hasArrayItems = resolveSchema(properties.items, document)?.type === 'array'
    if (!hasArrayItems) continue

    const result: SurfacePagination = { itemsPath: 'items' }
    if ('total' in properties) result.totalPath = 'total'
    if ('page' in properties) result.pagePath = 'page'
    if ('limit' in properties) result.limitPath = 'limit'
    if ('cursor' in properties || 'nextCursor' in properties) {
      result.cursorPath = 'cursor' in properties ? 'cursor' : 'nextCursor'
    }
    return result
  }
  return undefined
}

function resolveSchema(schema: OasSchema | undefined, document: ParsedDocument): OasSchema | undefined {
  if (!schema) return undefined
  const ref = schema.$ref
  if (typeof ref !== 'string') return schema
  const match = ref.match(/^#\/components\/schemas\/(.+)$/)
  if (!match?.[1]) return schema
  return document.schemas[unescapeJsonPointerToken(match[1])] ?? schema
}

function commandDescription(document: ParsedDocument, commandName: string): string {
  const tag = document.tags.get(commandName)
  return tag?.description?.trim() || `Operations for ${commandName}`
}

function cloneCli(cli: SurfaceOperation['cli']): SurfaceOperation['cli'] {
  return {
    ...(cli.args === undefined ? {} : { args: [...cli.args] }),
    ...(cli.params === undefined ? {} : { params: { ...cli.params } }),
    ...(cli.globals === undefined ? {} : { globals: [...cli.globals] }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}
