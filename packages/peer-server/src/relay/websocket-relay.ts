/**
 * @oa-sdk/peer-server/relay — WebSocket Relay Server & Upgrade Handler
 *
 * Provides bidirectional relaying between WebMCP peers for both
 * WebRTC signaling and data channel packets. Compatible with Node.js `ws`
 * and Cloudflare Workers `WebSocketPair`.
 */
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'
import {
  WEBMCP_SUBPROTOCOL,
  type PeerRole,
  type SignalMessage,
  DEFAULT_ROOM_TTL_MS,
} from '@oa-sdk/peer-transport'
import { SignalingRoom, type RoomDelivery } from './signaling-room.js'

export interface RelaySocket {
  send(data: string): void
  close(code?: number, reason?: string): void
  readonly readyState: number
}

export interface PeerRelayManagerOptions {
  roomTtlMs?: number | undefined
  cleanupIntervalMs?: number | undefined
}

export interface WebSocketRelayOptions {
  relayManager?: PeerRelayManager | undefined
  allowedOrigins?: string[] | undefined
  publishKey?: string | undefined
}

export class PeerRelayManager {
  private readonly rooms = new Map<string, SignalingRoom>()
  private readonly sockets = new Map<string, { provider?: RelaySocket; client?: RelaySocket }>()
  private readonly cleanupTimer: NodeJS.Timeout | null = null
  private disposed = false

  constructor(options: PeerRelayManagerOptions = {}) {
    const cleanupInterval = options.cleanupIntervalMs ?? 60_000
    if (cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => {
        this.pruneExpiredRooms()
      }, cleanupInterval)
      if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
        this.cleanupTimer.unref()
      }
    }
  }

  async createRoom(ttlMs = DEFAULT_ROOM_TTL_MS): Promise<{
    room: SignalingRoom
    providerToken: string
    inviteToken: string
  }> {
    if (this.disposed) throw new Error('RELAY_MANAGER_CLOSED')
    const created = await SignalingRoom.create(ttlMs)
    this.rooms.set(created.room.state.id, created.room)
    this.sockets.set(created.room.state.id, {})
    return created
  }

  getRoom(roomId: string): SignalingRoom | undefined {
    return this.rooms.get(roomId)
  }

  async claimInvitation(
    roomId: string,
    inviteToken: string,
    clientLabel: string,
  ): Promise<{ clientToken: string; requestId: string }> {
    const room = this.rooms.get(roomId)
    if (!room) throw new Error('NOT_FOUND')
    return await room.claim(inviteToken, clientLabel)
  }

  async authenticateAndAttach(
    roomId: string,
    role: PeerRole,
    ticket: string,
    socket: RelaySocket,
  ): Promise<void> {
    const room = this.rooms.get(roomId)
    if (!room) throw new Error('NOT_FOUND')

    await room.authenticate(role, ticket)
    const deliveries = room.attach(role)

    let roomSockets = this.sockets.get(roomId)
    if (!roomSockets) {
      roomSockets = {}
      this.sockets.set(roomId, roomSockets)
    }
    roomSockets[role] = socket

    this.dispatchDeliveries(roomId, deliveries)
  }

  handleSocketMessage(roomId: string, role: PeerRole, rawText: string): void {
    const room = this.rooms.get(roomId)
    if (!room) return

    try {
      const deliveries = room.receive(role, rawText)
      this.dispatchDeliveries(roomId, deliveries)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'SIGNAL_ERROR'
      const roomSockets = this.sockets.get(roomId)
      const senderSocket = roomSockets?.[role]
      if (senderSocket && senderSocket.readyState === 1 /* OPEN */) {
        try {
          senderSocket.send(JSON.stringify({ type: 'closed', reason: message }))
          senderSocket.close(1008, message)
        } catch {}
      }
      this.handleSocketClose(roomId, role)
    }
  }

  handleSocketClose(roomId: string, role: PeerRole): void {
    const room = this.rooms.get(roomId)
    const roomSockets = this.sockets.get(roomId)
    if (roomSockets) {
      delete roomSockets[role]
    }
    if (!room) return

    const deliveries = room.disconnect(role)
    this.dispatchDeliveries(roomId, deliveries)

    if (room.state.phase === 'closed') {
      this.rooms.delete(roomId)
      this.sockets.delete(roomId)
    }
  }

  private dispatchDeliveries(roomId: string, deliveries: RoomDelivery[]): void {
    const roomSockets = this.sockets.get(roomId)
    if (!roomSockets) return

    for (const delivery of deliveries) {
      const targetSocket = roomSockets[delivery.to]
      if (targetSocket && targetSocket.readyState === 1 /* OPEN */) {
        try {
          targetSocket.send(JSON.stringify(delivery.message))
          if (delivery.close) {
            targetSocket.close(1000, 'signaling complete')
          }
        } catch {}
      }
    }
  }

  private pruneExpiredRooms(): void {
    const now = Date.now()
    for (const [id, room] of this.rooms) {
      if (room.state.phase === 'closed' || now >= room.state.expiresAt) {
        const deliveries = room.end('SIGNAL_EXPIRED')
        this.dispatchDeliveries(id, deliveries)
        this.rooms.delete(id)
        this.sockets.delete(id)
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)

    for (const [id, room] of this.rooms) {
      const deliveries = room.end('SERVER_SHUTDOWN')
      this.dispatchDeliveries(id, deliveries)
    }
    this.rooms.clear()
    this.sockets.clear()
  }
}

/**
 * Extract ticket token from Sec-WebSocket-Protocol header or query string.
 */
export function extractTicketFromRequest(
  protocols: string[] | string | undefined,
  searchParams?: URLSearchParams,
): string | null {
  if (protocols) {
    const list = Array.isArray(protocols)
      ? protocols
      : protocols.split(',').map((p) => p.trim())
    const ticketSub = list.find((p) => /^ticket\.[a-f0-9]{48}$/.test(p))
    if (ticketSub) {
      return ticketSub.slice(7)
    }
  }
  if (searchParams) {
    const queryTicket = searchParams.get('ticket')
    if (queryTicket && /^[a-f0-9]{48}$/.test(queryTicket)) {
      return queryTicket
    }
  }
  return null
}

/**
 * Attach WebSocket signaling & packet relaying to a Node.js HTTP server.
 */
export function attachWebSocketRelay(
  server: Server,
  options: WebSocketRelayOptions = {},
): {
  relayManager: PeerRelayManager
  close: () => Promise<void>
} {
  const relayManager = options.relayManager ?? new PeerRelayManager()
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const pathname = url.pathname

    // Expected paths:
    // 1. /p/:roomId/:role (e.g. /p/3a1b.../provider or /p/3a1b.../client)
    // 2. /ws or /relay with ?room=:roomId&role=:role
    let roomId: string | null = null
    let role: PeerRole | null = null

    const match = pathname.match(/^\/p\/([a-f0-9]{32})\/(provider|client)$/)
    if (match) {
      roomId = match[1]!
      role = match[2] as PeerRole
    } else if (pathname === '/ws' || pathname === '/relay') {
      roomId = url.searchParams.get('room')
      const roleParam = url.searchParams.get('role')
      if (roleParam === 'provider' || roleParam === 'client') {
        role = roleParam
      }
    }

    if (!roomId || !role) {
      // Not a recognized relay upgrade path, allow other upgrade listeners
      return
    }

    // Validate origin if configured
    if (options.allowedOrigins && options.allowedOrigins.length > 0) {
      const origin = req.headers.origin
      if (!origin || !options.allowedOrigins.includes(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
    }

    // Extract ticket
    const protoHeader = req.headers['sec-websocket-protocol']
    const ticket = extractTicketFromRequest(protoHeader, url.searchParams)
    if (!ticket) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    // Check subprotocol request
    const requestedProtocols = (protoHeader ?? '').split(',').map((p) => p.trim())
    if (protoHeader && !requestedProtocols.includes(WEBMCP_SUBPROTOCOL)) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      relayManager
        .authenticateAndAttach(roomId!, role!, ticket, ws)
        .then(() => {
          ws.on('message', (data) => {
            const text = typeof data === 'string' ? data : data.toString('utf8')
            relayManager.handleSocketMessage(roomId!, role!, text)
          })

          ws.on('close', () => {
            relayManager.handleSocketClose(roomId!, role!)
          })

          ws.on('error', () => {
            relayManager.handleSocketClose(roomId!, role!)
          })
        })
        .catch((err: unknown) => {
          const reason = err instanceof Error ? err.message : 'AUTH_FAILED'
          try {
            ws.send(JSON.stringify({ type: 'closed', reason }))
            ws.close(1008, reason)
          } catch {
            ws.terminate()
          }
        })
    })
  })

  return {
    relayManager,
    close: async () => {
      relayManager.dispose()
      await new Promise<void>((resolve) => {
        wss.close(() => resolve())
      })
    },
  }
}
