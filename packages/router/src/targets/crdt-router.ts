/**
 * Multi-framework CRDT WebSocket router generator.
 * Emits typed WebSocket route bindings for Hono, Fastify, Bun Elysia, and Express.
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
import { extractCrdtEntities, type CrdtEntityMeta } from '../contracts/crdt-contract.js'

export type CrdtRouterTarget = 'hono' | 'fastify' | 'elysia' | 'express'

export interface CrdtRouterOptions {
  target?: CrdtRouterTarget | undefined
  contractImport?: string | undefined
  contractName?: string | undefined
  typesImport?: string | undefined
  banner?: boolean | undefined
  routePrefix?: string | undefined
  basePath?: string | undefined
}

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase()
}

/**
 * Generates framework-specific WebSocket router for CRDT sync exchange.
 */
export function generateCrdtRouter(
  spec: OasDocument | ParsedDocument,
  options: CrdtRouterOptions = {},
): string {
  const doc = isParsedDocument(spec) ? spec : parseDocument(spec)
  assertParsedDocumentComplete(doc, '@oa-sdk/router generateCrdtRouter')
  return generateCrdtRouterFromParsed(doc, options)
}

/**
 * Generates framework-specific WebSocket router from ParsedDocument IR.
 */
export function generateCrdtRouterFromParsed(
  doc: ParsedDocument,
  options: CrdtRouterOptions = {},
): string {
  const {
    target = 'hono',
    contractImport = './crdt.contract.js',
    contractName = 'CrdtApiHandlers',
    banner = true,
    routePrefix = '/ws',
  } = options

  const entities = extractCrdtEntities(doc)
  const lines: string[] = []

  if (banner) {
    lines.push(`// Auto-generated CRDT WebSocket router for ${target} from OpenAPI spec. Do not edit.`)
    lines.push('// @oa-sdk/router')
    lines.push('')
  }

  // Common contract imports
  lines.push(`import type {
  ${contractName},
  CrdtSessionContext,
  CrdtWireMessage,
} from ${JSON.stringify(contractImport)}`)
  lines.push('')

  // Target-specific imports
  if (target === 'hono') {
    lines.push(`import type { Hono } from 'hono'`)
    lines.push(`import { upgradeWebSocket } from 'hono/ws'`)
  } else if (target === 'fastify') {
    lines.push(`import type { FastifyPluginAsync } from 'fastify'`)
  } else if (target === 'elysia') {
    lines.push(`import type { Elysia } from 'elysia'`)
  } else if (target === 'express') {
    lines.push(`import type { Router, Request } from 'express'`)
    lines.push(`import type { WebSocket, WebSocketServer } from 'ws'`)
  }
  lines.push('')

  // Lightweight in-memory room connection hub
  lines.push(`/** Minimal peer connection interface compatible across web/node runtimes. */
export interface CrdtSocketLike {
  send(data: string | Uint8Array | ArrayBuffer): void
  readyState: number
}

/**
 * In-memory room connection and message multiplexer for CRDT sessions.
 */
export class CrdtRoomHub {
  private rooms = new Map<string, Map<string, CrdtSocketLike>>()

  public addPeer(roomId: string, peerId: string, socket: CrdtSocketLike): void {
    let peers = this.rooms.get(roomId)
    if (!peers) {
      peers = new Map()
      this.rooms.set(roomId, peers)
    }
    peers.set(peerId, socket)
  }

  public removePeer(roomId: string, peerId: string): void {
    const peers = this.rooms.get(roomId)
    if (!peers) return
    peers.delete(peerId)
    if (peers.size === 0) {
      this.rooms.delete(roomId)
    }
  }

  public getPeers(roomId: string): string[] {
    const peers = this.rooms.get(roomId)
    return peers ? Array.from(peers.keys()) : []
  }

  public broadcast(roomId: string, senderPeerId: string, message: CrdtWireMessage | string | Uint8Array): void {
    const peers = this.rooms.get(roomId)
    if (!peers) return

    const payload = typeof message === 'string' || message instanceof Uint8Array
      ? message
      : JSON.stringify(message)

    for (const [peerId, socket] of peers.entries()) {
      if (peerId !== senderPeerId && socket.readyState === 1 /* OPEN */) {
        socket.send(payload)
      }
    }
  }
}
`)

  // Render registration per target
  if (target === 'hono') {
    renderHonoCrdtRouter(lines, entities, contractName, routePrefix)
  } else if (target === 'fastify') {
    renderFastifyCrdtRouter(lines, entities, contractName, routePrefix)
  } else if (target === 'elysia') {
    renderElysiaCrdtRouter(lines, entities, contractName, routePrefix)
  } else if (target === 'express') {
    renderExpressCrdtRouter(lines, entities, contractName, routePrefix)
  }

  return formatGeneratedTs(lines.join('\n'))
}

function renderHonoCrdtRouter(
  lines: string[],
  entities: CrdtEntityMeta[],
  contractName: string,
  routePrefix: string,
): void {
  lines.push(`/**
 * Registers CRDT WebSocket routes onto a Hono application instance.
 */
export function registerCrdtRoutes(
  app: Hono<any>,
  handlers: ${contractName},
  options: { hub?: CrdtRoomHub; getPeerId?: (c: any) => string } = {},
): CrdtRoomHub {
  const hub = options.hub ?? new CrdtRoomHub()
  const resolvePeerId = options.getPeerId ?? (() => Math.random().toString(36).slice(2, 10))
`)

  for (const entity of entities) {
    const path = `${routePrefix}/${toKebabCase(entity.name)}/:${entity.partitionKey}`
    const propertyKey = toOperationMethodName(entity.name)

    lines.push(`  // Route for ${entity.name}
  app.get(
    ${JSON.stringify(path)},
    upgradeWebSocket((c) => {
      const roomId = c.req.param(${JSON.stringify(entity.partitionKey)}) ?? 'default'
      const peerId = resolvePeerId(c)
      const handler = handlers.${propertyKey}
      const sessionCtx: CrdtSessionContext = {
        roomId,
        peerId,
        params: c.req.param() as Record<string, string>,
      }

      return {
        async onOpen(_evt: any, ws: any) {
          if (handler?.onConnect) {
            const result = await handler.onConnect(sessionCtx)
            if (result && !result.allowed) {
              (ws as any).close(4403, 'Forbidden')
              return
            }
          }
          hub.addPeer(roomId, peerId, ws as any)
          if (handler?.loadSnapshot) {
            const snapshot = await handler.loadSnapshot(roomId, sessionCtx)
            if (snapshot) {
              ws.send(JSON.stringify({ type: 'sync-step-2', roomId, payload: Array.from(snapshot) }))
            }
          }
        },
        async onMessage(evt: any, ws: any) {
          try {
            const raw = typeof evt.data === 'string' ? JSON.parse(evt.data) : evt.data
            if (raw && typeof raw === 'object' && 'type' in raw) {
              const msg = raw as CrdtWireMessage
              if (msg.type === 'update') {
                hub.broadcast(roomId, peerId, msg)
                if (handler?.appendUpdates && msg.payload) {
                  const bin = typeof msg.payload === 'string'
                    ? new TextEncoder().encode(msg.payload)
                    : new Uint8Array(msg.payload)
                  await handler.appendUpdates(roomId, [bin], sessionCtx)
                }
              } else if (msg.type === 'awareness') {
                hub.broadcast(roomId, peerId, msg)
                if (handler?.onAwareness) {
                  handler.onAwareness(roomId, peerId, msg.payload, sessionCtx)
                }
              } else {
                hub.broadcast(roomId, peerId, msg)
              }
            }
          } catch {
            // malformed frame ignore
          }
        },
        async onClose() {
          hub.removePeer(roomId, peerId)
          if (handler?.onDisconnect) {
            await handler.onDisconnect(roomId, peerId, sessionCtx)
          }
        },
      }
    }),
  )
`)
  }

  lines.push(`  return hub
}
`)
}

function renderFastifyCrdtRouter(
  lines: string[],
  entities: CrdtEntityMeta[],
  contractName: string,
  routePrefix: string,
): void {
  lines.push(`/**
 * Fastify plugin for mounting CRDT WebSocket routes.
 */
export const crdtRouterPlugin: FastifyPluginAsync<{
  handlers: ${contractName}
  hub?: CrdtRoomHub
  getPeerId?: (req: any) => string
}> = async (fastify, opts) => {
  const hub = opts.hub ?? new CrdtRoomHub()
  const resolvePeerId = opts.getPeerId ?? (() => Math.random().toString(36).slice(2, 10))
`)

  for (const entity of entities) {
    const path = `${routePrefix}/${toKebabCase(entity.name)}/:${entity.partitionKey}`
    const propertyKey = toOperationMethodName(entity.name)

    lines.push(`  // Fastify route for ${entity.name}
  fastify.get(${JSON.stringify(path)}, { websocket: true }, (connection, req) => {
    const roomId = (req.params as Record<string, string>)[${JSON.stringify(entity.partitionKey)}] ?? 'default'
    const peerId = resolvePeerId(req)
    const socket = connection.socket as unknown as CrdtSocketLike
    const handler = opts.handlers.${propertyKey}
    const sessionCtx: CrdtSessionContext = {
      roomId,
      peerId,
      params: req.params as Record<string, string>,
    }

    hub.addPeer(roomId, peerId, socket)

    socket.send(JSON.stringify({ type: 'sync-step-1', roomId, peerId }))

    connection.socket.on('message', async (data: any) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf8')
        const msg = JSON.parse(text) as CrdtWireMessage
        if (msg.type === 'update') {
          hub.broadcast(roomId, peerId, msg)
          if (handler?.appendUpdates && msg.payload) {
            const bin = typeof msg.payload === 'string'
              ? new TextEncoder().encode(msg.payload)
              : new Uint8Array(msg.payload as any)
            await handler.appendUpdates(roomId, [bin], sessionCtx)
          }
        } else if (msg.type === 'awareness') {
          hub.broadcast(roomId, peerId, msg)
          if (handler?.onAwareness) {
            handler.onAwareness(roomId, peerId, msg.payload, sessionCtx)
          }
        } else {
          hub.broadcast(roomId, peerId, msg)
        }
      } catch {
        // ignore
      }
    })

    connection.socket.on('close', async () => {
      hub.removePeer(roomId, peerId)
      if (handler?.onDisconnect) {
        await handler.onDisconnect(roomId, peerId, sessionCtx)
      }
    })
  })
`)
  }

  lines.push(`}
`)
}

function renderElysiaCrdtRouter(
  lines: string[],
  entities: CrdtEntityMeta[],
  contractName: string,
  routePrefix: string,
): void {
  lines.push(`/**
 * Registers CRDT WebSocket endpoints onto a Bun Elysia application instance.
 */
export function registerCrdtRoutes(
  app: Elysia<any>,
  handlers: ${contractName},
  options: { hub?: CrdtRoomHub; getPeerId?: (ctx: any) => string } = {},
): Elysia<any> {
  const hub = options.hub ?? new CrdtRoomHub()
  const resolvePeerId = options.getPeerId ?? (() => Math.random().toString(36).slice(2, 10))
  let currentApp = app
`)

  for (const entity of entities) {
    const path = `${routePrefix}/${toKebabCase(entity.name)}/:${entity.partitionKey}`
    const propertyKey = toOperationMethodName(entity.name)

    lines.push(`  currentApp = currentApp.ws(${JSON.stringify(path)}, {
    open(ws: any) {
      const roomId = ws.data.params[${JSON.stringify(entity.partitionKey)}] ?? 'default'
      const peerId = resolvePeerId(ws.data)
      ws.data.__peerId = peerId
      ws.data.__roomId = roomId
      hub.addPeer(roomId, peerId, ws)
      ws.send(JSON.stringify({ type: 'sync-step-1', roomId, peerId }))
    },
    message(ws: any, message: any) {
      const roomId = ws.data.__roomId
      const peerId = ws.data.__peerId
      const handler = handlers.${propertyKey}
      try {
        const msg = typeof message === 'string' ? JSON.parse(message) : message
        hub.broadcast(roomId, peerId, msg)
        if (msg.type === 'awareness' && handler?.onAwareness) {
          handler.onAwareness(roomId, peerId, msg.payload, { roomId, peerId })
        }
      } catch {
        // ignore
      }
    },
    close(ws: any) {
      const roomId = ws.data.__roomId
      const peerId = ws.data.__peerId
      hub.removePeer(roomId, peerId)
      handlers.${propertyKey}?.onDisconnect?.(roomId, peerId, { roomId, peerId })
    },
  }) as any
`)
  }

  lines.push(`  return currentApp
}
`)
}

function renderExpressCrdtRouter(
  lines: string[],
  entities: CrdtEntityMeta[],
  contractName: string,
  routePrefix: string,
): void {
  lines.push(`/**
 * Registers CRDT WebSocket endpoints for an Express application using standard 'ws' WebSocketServer.
 */
export function registerCrdtRoutes(
  router: Router,
  handlers: ${contractName},
  wss: WebSocketServer,
  options: { hub?: CrdtRoomHub; getPeerId?: (req: Request) => string } = {},
): CrdtRoomHub {
  const hub = options.hub ?? new CrdtRoomHub()
  const resolvePeerId = options.getPeerId ?? (() => Math.random().toString(36).slice(2, 10))

  wss.on('connection', async (socket: WebSocket, req: Request) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    const pathname = url.pathname
`)

  for (const entity of entities) {
    const prefix = `${routePrefix}/${toKebabCase(entity.name)}/`
    const propertyKey = toOperationMethodName(entity.name)

    lines.push(`    if (pathname.startsWith(${JSON.stringify(prefix)})) {
      const roomId = pathname.slice(${JSON.stringify(prefix)}.length) || 'default'
      const peerId = resolvePeerId(req)
      const handler = handlers.${propertyKey}
      const sessionCtx: CrdtSessionContext = { roomId, peerId }

      hub.addPeer(roomId, peerId, socket as unknown as CrdtSocketLike)

      socket.on('message', async (data: any) => {
        try {
          const text = typeof data === 'string' ? data : data.toString('utf8')
          const msg = JSON.parse(text) as CrdtWireMessage
          hub.broadcast(roomId, peerId, msg)
        } catch {
          // ignore
        }
      })

      socket.on('close', () => {
        hub.removePeer(roomId, peerId)
        handler?.onDisconnect?.(roomId, peerId, sessionCtx)
      })
      return
    }
`)
  }

  lines.push(`  })

  return hub
}
`)
}
