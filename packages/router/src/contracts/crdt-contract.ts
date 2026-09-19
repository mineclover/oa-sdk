/**
 * Pure TypeScript CRDT handler contract generator decoupled from server framework runtime APIs.
 * Generates session context, message envelopes, and aggregate CrdtApiHandlers interfaces.
 */

import type { OasDocument, ParsedDocument } from '@oa-sdk/parser/browser'
import {
  assertParsedDocumentComplete,
  isParsedDocument,
  parseDocument,
} from '@oa-sdk/parser/browser'
import {
  toTypeScriptIdentifier,
  toOperationMethodName,
  formatGeneratedTs,
} from '../common/route-utils.js'

export interface CrdtContractOptions {
  /** Path to import generated API types from (e.g. './types.js') */
  typesImport?: string | undefined
  /** Header banner comment (default: true) */
  banner?: boolean | undefined
  /** Name of the handlers aggregate interface (default: 'CrdtApiHandlers') */
  contractName?: string | undefined
  /** Base path for resolving relative external $refs */
  basePath?: string | undefined
}

export interface CrdtFieldMeta {
  name: string
  type: string
  resolution?: string | undefined
  engine?: string | undefined
  role?: string | undefined
}

export interface CrdtEntityMeta {
  name: string
  partitionKey: string
  timeRange?: unknown
  compaction?: string | undefined
  strategy?: string | undefined
  fields: Record<string, CrdtFieldMeta>
}

/**
 * Extracts CRDT entity and field metadata from an OpenAPI document.
 */
export function extractCrdtEntities(spec: OasDocument | ParsedDocument): CrdtEntityMeta[] {
  const schemas = isParsedDocument(spec)
    ? spec.schemas
    : spec.components?.schemas ?? {}

  const entities: CrdtEntityMeta[] = []

  for (const [name, rawSchema] of Object.entries(schemas)) {
    if (!rawSchema || typeof rawSchema !== 'object') continue
    const schema = rawSchema as Record<string, unknown>
    const entityExt = schema['x-oa-sdk-crdt-entity'] as Record<string, unknown> | undefined
    if (!entityExt) continue

    const partitionKey = typeof entityExt.partitionKey === 'string' ? entityExt.partitionKey : 'id'
    const compaction = typeof entityExt.compaction === 'string' ? entityExt.compaction : undefined
    const strategy = typeof entityExt.strategy === 'string' ? entityExt.strategy : undefined
    const timeRange = entityExt.timeRange

    const fields: Record<string, CrdtFieldMeta> = {}
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
    for (const [propName, propSchema] of Object.entries(properties)) {
      if (!propSchema || typeof propSchema !== 'object') continue
      const crdtPropExt = propSchema['x-oa-sdk-crdt'] as Record<string, unknown> | undefined
      if (crdtPropExt && typeof crdtPropExt.type === 'string') {
        fields[propName] = {
          name: propName,
          type: crdtPropExt.type,
          resolution: typeof crdtPropExt.resolution === 'string' ? crdtPropExt.resolution : undefined,
          engine: typeof crdtPropExt.engine === 'string' ? crdtPropExt.engine : undefined,
          role: typeof crdtPropExt.role === 'string' ? crdtPropExt.role : undefined,
        }
      }
    }

    entities.push({
      name,
      partitionKey,
      timeRange,
      compaction,
      strategy,
      fields,
    })
  }

  return entities
}

/**
 * Generates pure TypeScript CRDT handler contracts from OAS document or ParsedDocument IR.
 */
export function generateCrdtHandlerContract(
  spec: OasDocument | ParsedDocument,
  options: CrdtContractOptions = {},
): string {
  const doc = isParsedDocument(spec) ? spec : parseDocument(spec)
  assertParsedDocumentComplete(doc, '@oa-sdk/router generateCrdtHandlerContract')
  return generateCrdtHandlerContractFromParsed(doc, options)
}

/**
 * Generates pure TypeScript CRDT handler contracts from ParsedDocument IR.
 */
export function generateCrdtHandlerContractFromParsed(
  doc: ParsedDocument,
  options: CrdtContractOptions = {},
): string {
  const {
    typesImport,
    banner = true,
    contractName = 'CrdtApiHandlers',
  } = options

  const entities = extractCrdtEntities(doc)
  const lines: string[] = []

  if (banner) {
    lines.push('// Auto-generated CRDT handler contracts from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/router')
    lines.push('')
  }

  if (typesImport && entities.length > 0) {
    const typeNames = entities.map(e => toTypeScriptIdentifier(e.name)).sort()
    lines.push(`import type { ${typeNames.join(', ')} } from ${JSON.stringify(typesImport)}`)
    lines.push('')
  }

  // 1. Core protocol and session types
  lines.push(`/** Wire protocol message types supported across CRDT sync sessions. */
export type CrdtWireMessageType =
  | 'sync-step-1'
  | 'sync-step-2'
  | 'update'
  | 'awareness'

/** Standard wire envelope for CRDT sync exchange over WebSocket, WebTransport, or SSE. */
export interface CrdtWireMessage {
  type: CrdtWireMessageType
  roomId: string
  peerId?: string | undefined
  payload: Uint8Array | string
}

/** Session context passed to CRDT connection and lifecycle handlers. */
export interface CrdtSessionContext<TAuth = unknown> {
  /** Active collaboration room or document partition ID */
  roomId: string
  /** Unique client/peer identifier */
  peerId: string
  /** Authenticated user/session context */
  auth?: TAuth | undefined
  /** Route path parameters (e.g. { trackId: '123' }) */
  params?: Record<string, string> | undefined
  /** Upgrade handshake headers */
  headers?: Record<string, string | string[] | undefined> | undefined
}
`)

  // 2. Per-entity handler contracts
  for (const entity of entities) {
    const identifier = toTypeScriptIdentifier(entity.name)
    const handlerName = `${identifier}CrdtHandler`
    const desc = [
      `CRDT handler contract for ${entity.name}.`,
      `Partition Key: ${entity.partitionKey}`,
      entity.compaction ? `Compaction Strategy: ${entity.compaction}` : undefined,
    ].filter(Boolean).join('\n * ')

    lines.push(`/**
 * ${desc}
 */
export interface ${handlerName}<TAuth = unknown> {
  /** Authenticate and admit a peer attempting to connect to the room. */
  onConnect?(ctx: CrdtSessionContext<TAuth>): Promise<{ allowed: boolean; auth?: TAuth }> | { allowed: boolean; auth?: TAuth }

  /** Load the latest persisted state snapshot for the room (e.g. from PostgreSQL/S3). */
  loadSnapshot?(roomId: string, ctx: CrdtSessionContext<TAuth>): Promise<Uint8Array | null> | Uint8Array | null

  /** Persist a compacted document state snapshot. */
  saveSnapshot?(roomId: string, snapshot: Uint8Array, ctx: CrdtSessionContext<TAuth>): Promise<void> | void

  /** Append one or more delta update binary blobs to an append-only log. */
  appendUpdates?(roomId: string, updates: Uint8Array[], ctx: CrdtSessionContext<TAuth>): Promise<void> | void

  /** Invoked when ephemeral peer awareness (cursors, selections) is updated. */
  onAwareness?(roomId: string, peerId: string, presence: unknown, ctx: CrdtSessionContext<TAuth>): void

  /** Invoked when a peer disconnects. */
  onDisconnect?(roomId: string, peerId: string, ctx: CrdtSessionContext<TAuth>): Promise<void> | void
}
`)
  }

  // 3. Aggregate handlers interface
  lines.push(`/** Aggregate collection of all declared CRDT entity handlers. */
export interface ${contractName}<TAuth = unknown> {`)
  for (const entity of entities) {
    const identifier = toTypeScriptIdentifier(entity.name)
    const propertyKey = toOperationMethodName(entity.name)
    lines.push(`  ${propertyKey}?: ${identifier}CrdtHandler<TAuth> | undefined`)
  }
  lines.push('}')
  lines.push('')

  return formatGeneratedTs(lines.join('\n'))
}
