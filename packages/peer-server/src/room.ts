/**
 * @oa-sdk/peer-server — Signaling & Call Dispatch Room
 *
 * Manages active peer sockets, RPC correlation, and F5 reload buffering.
 */
import type { SignalingPeerSocket, SignalingRoomEntry } from './types.js'

interface PendingCall {
  alias: string
  socket?: SignalingPeerSocket
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

interface WaitingCall {
  alias: string
  resolve: (room: SignalingRoomEntry) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export interface PeerRoomManagerOptions {
  /** Maximum number of calls, including calls waiting for a reconnect. */
  maxPendingCalls?: number | undefined
}

const DEFAULT_MAX_PENDING_CALLS = 1024
const DEFAULT_WAIT_TIMEOUT_MS = 3500
const DEFAULT_CALL_TIMEOUT_MS = 30_000
const MAX_TIMER_MS = 2_147_483_647

function finiteTimeout(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > MAX_TIMER_MS) {
    throw new RangeError(`${name} must be a finite number between 0 and ${MAX_TIMER_MS}`)
  }
  return value
}

function finitePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`)
  }
  return value
}

export class PeerRoomManager {
  private readonly rooms = new Map<string, SignalingRoomEntry>()
  private readonly pendingCalls = new Map<number, PendingCall>()
  private readonly waitingCalls = new Map<number, WaitingCall>()
  private rpcIdSeq = 0
  private readonly maxPendingCalls: number
  private disposed = false

  constructor(options: PeerRoomManagerOptions = {}) {
    this.maxPendingCalls = finitePositiveInteger(
      options.maxPendingCalls ?? DEFAULT_MAX_PENDING_CALLS,
      'maxPendingCalls',
    )
  }

  /** Register or update a provider room. */
  registerRoom(entry: SignalingRoomEntry): void {
    if (this.disposed) throw new Error('ROOM_MANAGER_CLOSED')
    if (!entry || typeof entry !== 'object' || typeof entry.alias !== 'string' || entry.alias.length === 0) {
      throw new TypeError('Invalid room entry')
    }
    if (!Array.isArray(entry.cachedTools)) throw new TypeError('Room cachedTools must be an array')
    this.rooms.set(entry.alias, entry)
  }

  /** Get room entry by alias. */
  getRoom(alias: string): SignalingRoomEntry | undefined {
    return this.rooms.get(alias)
  }

  /** List all active rooms. */
  listRooms(): SignalingRoomEntry[] {
    return Array.from(this.rooms.values())
  }

  /** Attach or detach provider socket and wake reconnect waiters. */
  setProviderSocket(alias: string, socket?: SignalingPeerSocket): void {
    if (this.disposed) return
    const room = this.rooms.get(alias)
    if (!room) return
    // Rebind outstanding calls to the replacement socket. Responses from the
    // stale socket are then rejected by handleProviderMessage's identity check.
    if (socket && room.providerSocket !== socket) {
      for (const pending of this.pendingCalls.values()) {
        if (pending.alias === alias) pending.socket = socket
      }
    }
    room.providerSocket = socket
    room.status = socket ? 'connected' : 'refreshing'
    room.updatedAt = Date.now()
    if (!socket) return

    for (const [id, waiting] of this.waitingCalls) {
      if (waiting.alias !== alias) continue
      clearTimeout(waiting.timer)
      this.waitingCalls.delete(id)
      waiting.resolve(room)
    }
  }

  /**
   * Ingest an incoming message from a provider socket. If the transport can
   * provide the socket object, pass it to prevent a stale/replaced socket from
   * settling a newer call. The optional argument preserves existing adapters.
   */
  handleProviderMessage(alias: string, message: unknown, sourceSocket?: SignalingPeerSocket): void {
    if (this.disposed || !message || typeof message !== 'object') return
    const envelope = message as Record<string, unknown>
    if (envelope.type !== 'mcp' || !envelope.message || typeof envelope.message !== 'object') return

    const inner = envelope.message as Record<string, unknown>
    const id = inner.id
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return
    const pending = this.pendingCalls.get(id)
    if (!pending || pending.alias !== alias) return
    if (sourceSocket && pending.socket && sourceSocket !== pending.socket) return

    clearTimeout(pending.timer)
    this.pendingCalls.delete(id)

    const rpcError = inner.error
    if (rpcError && typeof rpcError === 'object') {
      const errorMessage = (rpcError as Record<string, unknown>).message
      pending.reject(new Error(typeof errorMessage === 'string' ? errorMessage : 'RPC execution error'))
      return
    }
    if (!('result' in inner)) {
      pending.reject(new Error('Invalid RPC response: missing result'))
      return
    }
    pending.resolve(inner.result)
  }

  /** Execute an MCP tool call on a provider with reconnect buffering. */
  async executeMcpCallOnPeer(
    alias: string,
    tool: string,
    args: Record<string, unknown> = {},
    waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
    callTimeoutMs = DEFAULT_CALL_TIMEOUT_MS,
    maxPendingCalls = this.maxPendingCalls,
  ): Promise<unknown> {
    if (this.disposed) throw new Error('ROOM_MANAGER_CLOSED')
    if (typeof alias !== 'string' || alias.length === 0) throw new TypeError('Invalid peer alias')
    if (typeof tool !== 'string' || tool.length === 0 || tool.length > 256) throw new TypeError('Invalid tool name')
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('Tool args must be an object')
    const waitMs = finiteTimeout(waitTimeoutMs, 'waitTimeoutMs')
    const callMs = finiteTimeout(callTimeoutMs, 'callTimeoutMs')
    const limit = finitePositiveInteger(maxPendingCalls, 'maxPendingCalls')

    const roomNow = this.rooms.get(alias)
    if (roomNow?.allowedTools && !roomNow.allowedTools.includes(tool)) {
      throw new Error(`TOOL_NOT_ALLOWED: Tool "${tool}" is not allowed for peer "${alias}"`)
    }

    if (this.pendingCalls.size + this.waitingCalls.size >= limit) {
      throw new Error('TOO_MANY_PENDING_CALLS: provider call capacity is exhausted')
    }

    let room = roomNow
    if (!room?.providerSocket) {
      room = await this.waitForProvider(alias, waitMs)
    }
    if (!room.providerSocket) {
      throw new Error(`PEER_UNAVAILABLE: Peer "${alias}" is disconnected or refreshing`)
    }
    if (room.allowedTools && !room.allowedTools.includes(tool)) {
      throw new Error(`TOOL_NOT_ALLOWED: Tool "${tool}" is not allowed for peer "${alias}"`)
    }

    if (this.pendingCalls.size >= limit) {
      throw new Error('TOO_MANY_PENDING_CALLS: provider call capacity is exhausted')
    }
    const id = ++this.rpcIdSeq
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(id)
        reject(new Error(`TOOL_CALL_TIMEOUT: Tool "${tool}" on peer "${alias}" timed out after ${callMs}ms`))
      }, callMs)
      const socket = room!.providerSocket!
      const pending: PendingCall = { alias, socket, resolve, reject, timer }
      this.pendingCalls.set(id, pending)
      try {
        socket.send({
          type: 'mcp',
          message: { jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } },
        })
      } catch (err) {
        clearTimeout(timer)
        this.pendingCalls.delete(id)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  private waitForProvider(alias: string, timeoutMs: number): Promise<SignalingRoomEntry> {
    if (this.disposed) return Promise.reject(new Error('ROOM_MANAGER_CLOSED'))
    const room = this.rooms.get(alias)
    if (room?.providerSocket) return Promise.resolve(room)
    if (timeoutMs === 0) return Promise.reject(new Error(`PEER_UNAVAILABLE: Peer "${alias}" is disconnected or refreshing`))

    const id = ++this.rpcIdSeq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waitingCalls.delete(id)
        reject(new Error(`PEER_UNAVAILABLE: Peer "${alias}" is disconnected or refreshing`))
      }, timeoutMs)
      this.waitingCalls.set(id, { alias, resolve, reject, timer })
    })
  }

  /** Reject all calls and release timers before server shutdown. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const error = new Error('ROOM_MANAGER_CLOSED')
    for (const pending of this.pendingCalls.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    for (const waiting of this.waitingCalls.values()) {
      clearTimeout(waiting.timer)
      waiting.reject(error)
    }
    this.pendingCalls.clear()
    this.waitingCalls.clear()
    this.rooms.clear()
  }

  close(): void {
    this.dispose()
  }
}
