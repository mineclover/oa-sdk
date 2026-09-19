/**
 * Generates typed CRDT client SDK with reconnection, state synchronization, and pluggable adapter support.
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
} from '@oa-sdk/core/browser'

export interface CrdtClientRenderOptions {
  typesImport?: string | undefined
  banner?: boolean | undefined
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
  fields: Record<string, CrdtFieldMeta>
}

export function extractCrdtEntitiesFromDoc(spec: OasDocument | ParsedDocument): CrdtEntityMeta[] {
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

    entities.push({ name, partitionKey, fields })
  }

  return entities
}

/**
 * Generates typed CRDT Client SDK source code.
 */
export function generateCrdtClient(
  spec: OasDocument | ParsedDocument,
  options: CrdtClientRenderOptions = {},
): string {
  const doc = isParsedDocument(spec) ? spec : parseDocument(spec)
  assertParsedDocumentComplete(doc, '@oa-sdk/client generateCrdtClient')
  return generateCrdtClientFromParsed(doc, options)
}

export function generateCrdtClientFromParsed(
  doc: ParsedDocument,
  options: CrdtClientRenderOptions = {},
): string {
  const { typesImport, banner = true } = options
  const entities = extractCrdtEntitiesFromDoc(doc)
  const lines: string[] = []

  if (banner) {
    lines.push('// Auto-generated CRDT Client SDK from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/client')
    lines.push('')
  }

  if (typesImport && entities.length > 0) {
    const typeNames = entities.map(e => toTypeScriptIdentifier(e.name)).sort()
    lines.push(`import type { ${typeNames.join(', ')} } from ${JSON.stringify(typesImport)}`)
    lines.push('')
  }

  lines.push(`export type CrdtWireMessageType = 'sync-step-1' | 'sync-step-2' | 'update' | 'awareness'

export interface CrdtWireMessage {
  type: CrdtWireMessageType
  roomId: string
  peerId?: string | undefined
  payload: Uint8Array | string | unknown
}

export type CrdtConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'synced'
  | 'error'

export interface CrdtEngineAdapter<TDoc = Record<string, unknown>> {
  readonly name: string
  createDoc(): void
  applyUpdate(update: Uint8Array | string): void
  encodeStateVector(): Uint8Array | string
  encodeDiff(stateVector: Uint8Array | string): Uint8Array | string
  getState(): TDoc
  updateField(field: string, value: unknown): Uint8Array | string
  onUpdate(callback: (update: Uint8Array | string) => void): () => void
}

/** Built-in zero-dependency LWW JSON adapter */
export class DefaultLwwJsonAdapter<TDoc = Record<string, unknown>> implements CrdtEngineAdapter<TDoc> {
  public readonly name = 'lww-json'
  private properties = new Map<string, { value: unknown; timestamp: number; actorId: string }>()
  private listeners = new Set<(update: string) => void>()
  private actorId: string
  private logicalClock = 0

  constructor(actorId?: string) {
    this.actorId = actorId ?? (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))
  }

  public createDoc(): void {
    this.properties.clear()
    this.logicalClock = 0
  }

  public updateField(field: string, value: unknown): string {
    const timestamp = Math.max(Date.now(), this.logicalClock + 1)
    this.logicalClock = timestamp
    const entry = { value, timestamp, actorId: this.actorId }
    this.properties.set(field, entry)
    const update = JSON.stringify({ [field]: entry })
    for (const l of this.listeners) l(update)
    return update
  }

  public applyUpdate(update: Uint8Array | string): void {
    const text = typeof update === 'string' ? update : new TextDecoder().decode(update)
    try {
      const incoming = JSON.parse(text)
      for (const [f, inEntry] of Object.entries(incoming) as [string, any][]) {
        const cur = this.properties.get(f)
        if (!cur || inEntry.timestamp > cur.timestamp || (inEntry.timestamp === cur.timestamp && inEntry.actorId > cur.actorId)) {
          this.properties.set(f, inEntry)
        }
      }
    } catch {
      // ignore
    }
  }

  public encodeStateVector(): string {
    const v: Record<string, number> = {}
    for (const [k, e] of this.properties) v[k] = e.timestamp
    return JSON.stringify(v)
  }

  public encodeDiff(stateVector: Uint8Array | string): string {
    const text = typeof stateVector === 'string' ? stateVector : new TextDecoder().decode(stateVector)
    let peerV: Record<string, number> = {}
    try { peerV = JSON.parse(text) } catch { /* ignore */ }
    const diff: Record<string, any> = {}
    for (const [k, e] of this.properties) {
      if (e.timestamp > (peerV[k] ?? 0)) diff[k] = e
    }
    return JSON.stringify(diff)
  }

  public getState(): TDoc {
    const res: Record<string, unknown> = {}
    for (const [k, e] of this.properties) res[k] = e.value
    return res as TDoc
  }

  public onUpdate(callback: (update: string) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }
}

export interface CrdtClientConfig<TDoc = Record<string, unknown>> {
  wsUrl: string
  adapter?: CrdtEngineAdapter<TDoc>
  peerId?: string
  WebSocketImpl?: any
}

export class CrdtRoomSession<TDoc = Record<string, unknown>> {
  public status: CrdtConnectionStatus = 'disconnected'
  public peerId: string
  private adapter: CrdtEngineAdapter<TDoc>
  private ws: any = null
  private awarenessMap = new Map<string, unknown>()
  private statusListeners = new Set<(status: CrdtConnectionStatus) => void>()
  private changeListeners = new Set<(data: TDoc) => void>()
  private awarenessListeners = new Set<(peers: Map<string, unknown>) => void>()
  private unsubscribeAdapter: (() => void) | null = null

  constructor(
    public readonly roomId: string,
    private config: CrdtClientConfig<TDoc>,
  ) {
    this.peerId = config.peerId ?? Math.random().toString(36).slice(2, 10)
    this.adapter = config.adapter ?? new DefaultLwwJsonAdapter<TDoc>(this.peerId)
    this.adapter.createDoc()
  }

  public connect(): void {
    if (this.status === 'connecting' || this.status === 'connected' || this.status === 'synced') return

    this.setStatus('connecting')
    const WS = this.config.WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : null)
    if (!WS) {
      this.setStatus('error')
      return
    }

    const url = new URL(this.config.wsUrl)
    url.searchParams.set('peerId', this.peerId)

    try {
      this.ws = new WS(url.toString())
    } catch {
      this.setStatus('error')
      return
    }

    this.unsubscribeAdapter = this.adapter.onUpdate((delta) => {
      this.sendMessage({
        type: 'update',
        roomId: this.roomId,
        peerId: this.peerId,
        payload: delta,
      })
      this.notifyChange()
    })

    this.ws.onopen = () => {
      this.setStatus('connected')
      // Send sync-step-1: local state vector
      const vector = this.adapter.encodeStateVector()
      this.sendMessage({
        type: 'sync-step-1',
        roomId: this.roomId,
        peerId: this.peerId,
        payload: vector,
      })
    }

    this.ws.onmessage = (event: any) => {
      try {
        const raw = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (!raw || typeof raw !== 'object') return
        const msg = raw as CrdtWireMessage

        if (msg.type === 'sync-step-1') {
          const diff = this.adapter.encodeDiff(msg.payload as any)
          this.sendMessage({
            type: 'sync-step-2',
            roomId: this.roomId,
            peerId: this.peerId,
            payload: diff,
          })
        } else if (msg.type === 'sync-step-2') {
          if (msg.payload) {
            this.adapter.applyUpdate(msg.payload as any)
            this.notifyChange()
          }
          this.setStatus('synced')
        } else if (msg.type === 'update') {
          if (msg.payload) {
            this.adapter.applyUpdate(msg.payload as any)
            this.notifyChange()
          }
        } else if (msg.type === 'awareness') {
          if (msg.peerId) {
            this.awarenessMap.set(msg.peerId, msg.payload)
            this.notifyAwareness()
          }
        }
      } catch {
        // ignore
      }
    }

    this.ws.onclose = () => {
      this.setStatus('disconnected')
    }

    this.ws.onerror = () => {
      this.setStatus('error')
    }
  }

  public disconnect(): void {
    if (this.unsubscribeAdapter) {
      this.unsubscribeAdapter()
      this.unsubscribeAdapter = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.setStatus('disconnected')
  }

  public getState(): TDoc {
    return this.adapter.getState()
  }

  public updateField(field: string, value: unknown): void {
    this.adapter.updateField(field, value)
  }

  public setAwareness(presence: unknown): void {
    this.awarenessMap.set(this.peerId, presence)
    this.sendMessage({
      type: 'awareness',
      roomId: this.roomId,
      peerId: this.peerId,
      payload: presence,
    })
    this.notifyAwareness()
  }

  public getAwareness(): Map<string, unknown> {
    return new Map(this.awarenessMap)
  }

  public onStatus(cb: (status: CrdtConnectionStatus) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  public onChange(cb: (data: TDoc) => void): () => void {
    this.changeListeners.add(cb)
    return () => this.changeListeners.delete(cb)
  }

  public onAwareness(cb: (peers: Map<string, unknown>) => void): () => void {
    this.awarenessListeners.add(cb)
    return () => this.awarenessListeners.delete(cb)
  }

  private setStatus(s: CrdtConnectionStatus): void {
    this.status = s
    for (const l of this.statusListeners) l(s)
  }

  private notifyChange(): void {
    const data = this.adapter.getState()
    for (const l of this.changeListeners) l(data)
  }

  private notifyAwareness(): void {
    const m = new Map(this.awarenessMap)
    for (const l of this.awarenessListeners) l(m)
  }

  private sendMessage(msg: CrdtWireMessage): void {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(JSON.stringify(msg))
    }
  }
}
`)

  // Create entity-specific client factories
  for (const entity of entities) {
    const typeName = toTypeScriptIdentifier(entity.name)
    const factoryName = `create${typeName}CrdtClient`

    lines.push(`/**
 * Factory for connecting to collaborative ${typeName} sessions.
 */
export function ${factoryName}(
  roomId: string,
  config: CrdtClientConfig<${typesImport ? typeName : 'Record<string, unknown>'}>,
): CrdtRoomSession<${typesImport ? typeName : 'Record<string, unknown>'}> {
  return new CrdtRoomSession<${typesImport ? typeName : 'Record<string, unknown>'}>(${JSON.stringify(entity.partitionKey)} + ':' + roomId, config)
}
`)
  }

  return formatGeneratedTs(lines.join('\n'))
}
