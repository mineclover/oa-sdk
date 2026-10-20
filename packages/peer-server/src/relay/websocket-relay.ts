/**
 * @oa-sdk/peer-server/relay — WebSocket Relay Server & Upgrade Handler
 *
 * Provides bidirectional relaying between WebMCP peers for both
 * WebRTC signaling and data channel packets. Compatible with Node.js `ws`
 * and Cloudflare Workers `WebSocketPair`.
 *
 * Upgrade endpoints (room and role are both required):
 * - `/p/:roomId/:role`
 * - `/ws?room=:roomId&role=:role` (also `/relay?...`)
 * Each socket is authorized by its per-room ticket (the providerToken, or the
 * clientToken from `POST /p/:roomId/join`), sent as the `ticket.<token>`
 * subprotocol or the `ticket` query parameter. A provider may add
 * `alias=<peer-alias>` to bind its room to Cloud Transit when the relay was
 * given a `transitBridge`.
 */
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket, type RawData } from 'ws'
import {
  WEBMCP_SUBPROTOCOL,
  type DataChannelPacket,
  type PeerRole,
  DEFAULT_ROOM_TTL_MS,
  MAX_RELAY_BYTES,
} from '@oa-sdk/peer-transport'
import { MAX_SIGNAL_FRAMES, SignalingRoom, type RoomDelivery, type SignalingRoomOptions } from './signaling-room.js'
import { resolveRelaySessionLimits, roomTtlMs, timerMs } from './session-limits.js'

export interface RelaySocket {
  send(data: string): void
  close(code?: number, reason?: string): void
  readonly readyState: number
}

/**
 * Every limit is validated by the constructor, which throws RangeError for a
 * value outside its range, so a bad configuration fails before any room exists.
 */
export interface PeerRelayManagerOptions {
  /** TTL of a room created without an explicit TTL in ms, a positive integer (default: DEFAULT_ROOM_TTL_MS). */
  roomTtlMs?: number | undefined
  /** How often expired rooms are pruned in ms, an integer 0..2^31-1 (default 60000; 0 disables the timer). */
  cleanupIntervalMs?: number | undefined
  /** Idle limit of an approved relay session in ms, an integer 0..2^31-1 (default 5 minutes, 0 disables). See SignalingRoomOptions. */
  relayIdleTimeoutMs?: number | undefined
  /** Hard limit of an approved relay session in ms, an integer 1..2^31-1 (default 24 hours). */
  relayMaxSessionMs?: number | undefined
  /** Clock for rooms and pruning (default Date.now). */
  clock?: (() => number) | undefined
}

/**
 * Binds a provider's relay room to a Cloud Transit alias. The relay calls
 * `acceptsAlias` before it completes the upgrade and `bind` once the provider
 * is authenticated and attached; a `bind` that throws ends the room.
 */
export interface RelayTransitBinder {
  acceptsAlias(alias: string): boolean
  bind(roomId: string, alias: string): void
}

export interface WebSocketRelayOptions {
  relayManager?: PeerRelayManager | undefined
  allowedOrigins?: string[] | undefined
  /**
   * @deprecated Not used: WebSocket upgrades are authorized by their per-room
   * ticket, never by the server-wide publishKey (room creation over HTTP is).
   */
  publishKey?: string | undefined
  /**
   * Accept `alias=` on provider upgrades and bind those rooms to Cloud
   * Transit. Without it, an upgrade that names an alias is refused with 400.
   */
  transitBridge?: RelayTransitBinder | undefined
}

const WS_OPEN = 1
/** Frames a socket may send while its ticket is still being checked. */
const MAX_PENDING_FRAMES = MAX_SIGNAL_FRAMES
const MAX_PENDING_BYTES = 2 * MAX_RELAY_BYTES
/** How long close() waits for sockets to finish their close handshake before terminating them. */
const CLOSE_GRACE_MS = 1000
/** RFC 6455 limits a close reason to 123 bytes. */
const MAX_CLOSE_REASON_BYTES = 123

function closeReason(reason: string): string {
  let text = reason
  while (Buffer.byteLength(text, 'utf8') > MAX_CLOSE_REASON_BYTES) text = text.slice(0, -1)
  return text
}

/** Tell a socket why it is being closed, then close it with a policy-violation code. */
function closeWithReason(socket: RelaySocket, reason: string): void {
  if (socket.readyState !== WS_OPEN) return
  try {
    socket.send(JSON.stringify({ type: 'closed', reason }))
  } catch {}
  try {
    socket.close(1008, closeReason(reason))
  } catch {}
}

/** Why an expired room ends: its relay session expired, or it was never approved in time. */
function expiryReason(room: SignalingRoom): string {
  return room.state.relayMaxExpiresAt === undefined ? 'SIGNAL_EXPIRED' : 'RELAY_EXPIRED'
}

export class PeerRelayManager {
  private readonly rooms = new Map<string, SignalingRoom>()
  private readonly sockets = new Map<string, { provider?: RelaySocket; client?: RelaySocket }>()
  private readonly cleanupTimer: NodeJS.Timeout | null = null
  private readonly roomTtlMs: number
  private readonly roomOptions: SignalingRoomOptions
  private disposed = false

  constructor(options: PeerRelayManagerOptions = {}) {
    this.roomTtlMs = roomTtlMs(options.roomTtlMs ?? DEFAULT_ROOM_TTL_MS)
    this.roomOptions = { ...resolveRelaySessionLimits(options), clock: options.clock }
    const cleanupInterval = timerMs(options.cleanupIntervalMs ?? 60_000, 'cleanupIntervalMs', 0)
    if (cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => {
        this.pruneExpiredRooms()
      }, cleanupInterval)
      if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
        this.cleanupTimer.unref()
      }
    }
  }

  async createRoom(ttlMs = this.roomTtlMs): Promise<{
    room: SignalingRoom
    providerToken: string
    inviteToken: string
  }> {
    if (this.disposed) throw new Error('RELAY_MANAGER_CLOSED')
    const created = await SignalingRoom.create(ttlMs, undefined, this.roomOptions)
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

  /**
   * Make an in-process socket the room's client (the Cloud Transit bridge).
   * The room is approved at once; `socket` receives what the provider relays.
   */
  attachVirtualClient(roomId: string, clientLabel: string, socket: RelaySocket): void {
    const room = this.rooms.get(roomId)
    if (!room) throw new Error('NOT_FOUND')
    const deliveries = room.bindVirtualClient(clientLabel)
    const roomSockets = this.sockets.get(roomId) ?? {}
    roomSockets.client = socket
    this.sockets.set(roomId, roomSockets)
    this.dispatchDeliveries(roomId, deliveries)
  }

  /**
   * Relay a packet to a room's provider on behalf of its virtual client.
   *
   * Returns false when the room or its provider socket is gone, and when the
   * room's relay session has expired; the room is then ended for the provider.
   * A frame the room refuses fails only this packet and leaves the room as it
   * was: the call throws, with `PAYLOAD_TOO_LARGE` when the relay frame would
   * exceed MAX_RELAY_BYTES, or with the room's own error code otherwise.
   */
  relayToProvider(roomId: string, packet: DataChannelPacket): boolean {
    const room = this.rooms.get(roomId)
    const provider = this.sockets.get(roomId)?.provider
    if (!room || room.state.phase === 'closed' || !provider || provider.readyState !== WS_OPEN) return false

    const frame = JSON.stringify({ type: 'relay', packet })
    const frameBytes = Buffer.byteLength(frame, 'utf8')
    if (frameBytes > MAX_RELAY_BYTES) {
      throw new Error(`PAYLOAD_TOO_LARGE: the relay frame would be ${frameBytes} bytes; the relay carries at most ${MAX_RELAY_BYTES}`)
    }

    // The frame is the server's own, so a refusal is not the virtual client
    // misbehaving: it must not go through handleSocketMessage's error path,
    // which closes the sender and ends the room.
    let deliveries: RoomDelivery[]
    try {
      deliveries = room.receive('client', frame)
    } catch (err: unknown) {
      if (!room.isExpired()) throw err
      // The room itself is over (its relay session expired): end it for the provider too.
      this.endRoom(roomId, expiryReason(room))
      return false
    }
    this.dispatchDeliveries(roomId, deliveries)
    return this.rooms.has(roomId)
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
      if (senderSocket) closeWithReason(senderSocket, message)

      if (room.state.phase === 'closed') {
        // receive() closed the room itself (an expired room or relay session).
        // disconnect() would deliver nothing, so end it for the other side here.
        if (roomSockets) delete roomSockets[role]
        this.endRoom(roomId, message)
        return
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

  /** End a room: both sides get `{type:'closed', reason}` and their sockets are closed. */
  endRoom(roomId: string, reason: string): boolean {
    const room = this.rooms.get(roomId)
    if (!room) return false
    this.dispatchDeliveries(roomId, room.end(reason))
    this.rooms.delete(roomId)
    this.sockets.delete(roomId)
    return true
  }

  private dispatchDeliveries(roomId: string, deliveries: RoomDelivery[]): void {
    const roomSockets = this.sockets.get(roomId)
    if (!roomSockets) return

    for (const delivery of deliveries) {
      const targetSocket = roomSockets[delivery.to]
      if (targetSocket && targetSocket.readyState === WS_OPEN) {
        try {
          targetSocket.send(JSON.stringify(delivery.message))
          if (delivery.close) {
            targetSocket.close(1000, 'signaling complete')
          }
        } catch {}
      }
    }
  }

  /**
   * End every room that is closed, whose approved relay session passed its
   * idle or hard deadline, or that was never approved within its TTL. Runs
   * on the cleanup timer; hosts without timers may call it themselves.
   */
  pruneExpiredRooms(): void {
    for (const [id, room] of this.rooms) {
      if (room.isExpired()) {
        const deliveries = room.end(expiryReason(room))
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

type RelayTarget =
  | { kind: 'relay'; roomId: string; role: PeerRole; alias: string | undefined; searchParams: URLSearchParams }
  /** A relay path with a missing or malformed room, role or URL. */
  | { kind: 'invalid' }
  /** A path this relay does not serve. */
  | { kind: 'foreign' }

const ROOM_ID = /^[a-f0-9]{32}$/

/**
 * Resolve an upgrade request-target. Only the path and query are read, so the
 * URL base is a constant: the client-supplied Host header is never parsed.
 */
function parseRelayTarget(requestUrl: string | undefined): RelayTarget {
  let url: URL
  try {
    url = new URL(requestUrl ?? '/', 'http://relay.invalid')
  } catch {
    return { kind: 'invalid' }
  }
  const { pathname, searchParams } = url

  let roomId: string | null
  let role: string | null
  const match = /^\/p\/([a-f0-9]{32})\/(provider|client)$/.exec(pathname)
  if (match) {
    roomId = match[1]!
    role = match[2]!
  } else if (pathname === '/ws' || pathname === '/relay') {
    roomId = searchParams.get('room')
    role = searchParams.get('role')
  } else if (pathname.startsWith('/p/')) {
    return { kind: 'invalid' }
  } else {
    return { kind: 'foreign' }
  }

  if (!roomId || !ROOM_ID.test(roomId) || (role !== 'provider' && role !== 'client')) {
    return { kind: 'invalid' }
  }
  return { kind: 'relay', roomId, role, alias: searchParams.get('alias') ?? undefined, searchParams }
}

/** Answer an upgrade with a plain HTTP error and close the connection. */
function rejectUpgrade(socket: Duplex, status: number, statusText: string): void {
  // The HTTP server removed its own error listener when it handed the socket over.
  socket.on('error', () => socket.destroy())
  if (!socket.writable) {
    socket.destroy()
    return
  }
  socket.once('finish', () => socket.destroy())
  socket.end(`HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

function rawDataText(data: RawData): { text: string; bytes: number } {
  const buffer = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
  return { text: buffer.toString('utf8'), bytes: buffer.byteLength }
}

/**
 * Attach WebSocket signaling & packet relaying to a Node.js HTTP server.
 *
 * Upgrades to `/ws`, `/relay` or `/p/...` that lack a valid room or role are
 * answered with 400. Other paths are left to other `upgrade` listeners when
 * there are any, and answered with 404 otherwise, so no socket is left hanging.
 */
export function attachWebSocketRelay(
  server: Server,
  options: WebSocketRelayOptions = {},
): {
  relayManager: PeerRelayManager
  close: () => Promise<void>
} {
  const relayManager = options.relayManager ?? new PeerRelayManager()
  const transitBridge = options.transitBridge
  // Larger frames could never pass parseSignalMessage; ws refuses them with 1009.
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_RELAY_BYTES })

  /**
   * Listeners are attached before the asynchronous ticket check, so no frame
   * and no close event is missed: frames wait in a bounded queue until the
   * socket is attached, and a socket that closed meanwhile is detached again.
   */
  const acceptSocket = (ws: WebSocket, roomId: string, role: PeerRole, ticket: string, alias: string | undefined) => {
    let attached = false
    let closed = false
    const pending: string[] = []
    let pendingBytes = 0

    const onClosed = () => {
      if (closed) return
      closed = true
      pending.length = 0
      if (attached) relayManager.handleSocketClose(roomId, role)
    }

    ws.on('message', (data: RawData) => {
      if (closed) return
      const { text, bytes } = rawDataText(data)
      if (attached) {
        relayManager.handleSocketMessage(roomId, role, text)
        return
      }
      pendingBytes += bytes
      if (pending.length >= MAX_PENDING_FRAMES || pendingBytes > MAX_PENDING_BYTES) {
        pending.length = 0
        closeWithReason(ws, 'SIGNAL_LIMIT')
        return
      }
      pending.push(text)
    })
    ws.on('close', onClosed)
    ws.on('error', onClosed)

    relayManager.authenticateAndAttach(roomId, role, ticket, ws).then(
      () => {
        attached = true
        if (closed || ws.readyState !== WS_OPEN) {
          // Closed while the ticket was checked: detach like any other disconnect.
          relayManager.handleSocketClose(roomId, role)
          return
        }
        if (alias !== undefined && transitBridge) {
          try {
            transitBridge.bind(roomId, alias)
          } catch (err: unknown) {
            relayManager.endRoom(roomId, err instanceof Error ? err.message : 'TRANSIT_BIND_FAILED')
            return
          }
        }
        for (const text of pending.splice(0)) {
          if (closed) break
          relayManager.handleSocketMessage(roomId, role, text)
        }
      },
      (err: unknown) => {
        pending.length = 0
        if (closed) return
        closeWithReason(ws, err instanceof Error ? err.message : 'AUTH_FAILED')
      },
    )
  }

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const target = parseRelayTarget(req.url)
    if (target.kind === 'foreign') {
      // Leave the request to another upgrade listener, or answer it so it cannot hang.
      if (server.listenerCount('upgrade') > 1) return
      rejectUpgrade(socket, 404, 'Not Found')
      return
    }
    if (target.kind === 'invalid') {
      rejectUpgrade(socket, 400, 'Bad Request')
      return
    }
    const { roomId, role, alias, searchParams } = target

    if (alias !== undefined && (role !== 'provider' || !transitBridge || !transitBridge.acceptsAlias(alias))) {
      rejectUpgrade(socket, 400, 'Bad Request')
      return
    }

    // Validate origin if configured
    if (options.allowedOrigins && options.allowedOrigins.length > 0) {
      const origin = req.headers.origin
      if (!origin || !options.allowedOrigins.includes(origin)) {
        rejectUpgrade(socket, 403, 'Forbidden')
        return
      }
    }

    // Extract ticket
    const protoHeader = req.headers['sec-websocket-protocol']
    const ticket = extractTicketFromRequest(protoHeader, searchParams)
    if (!ticket) {
      rejectUpgrade(socket, 401, 'Unauthorized')
      return
    }

    // Check subprotocol request
    const requestedProtocols = (protoHeader ?? '').split(',').map((p) => p.trim())
    if (protoHeader && !requestedProtocols.includes(WEBMCP_SUBPROTOCOL)) {
      rejectUpgrade(socket, 400, 'Bad Request')
      return
    }

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      acceptSocket(ws, roomId, role, ticket, alias)
    })
  })

  return {
    relayManager,
    close: async () => {
      relayManager.dispose()
      await new Promise<void>((resolve) => {
        // dispose() closed every tracked socket; a socket that still has not
        // finished its close handshake after the grace period is terminated.
        const grace = setTimeout(() => {
          for (const client of wss.clients) client.terminate()
        }, CLOSE_GRACE_MS)
        wss.close(() => {
          clearTimeout(grace)
          resolve()
        })
        for (const client of wss.clients) {
          if (client.readyState === WS_OPEN) client.close(1001, 'SERVER_SHUTDOWN')
        }
      })
    },
  }
}
