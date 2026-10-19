/**
 * @oa-sdk/peer-transport — WebSocket Transport Adapter for P2P Channel
 *
 * Implements a host adapter for P2pTransportChannel that transmits and
 * receives packets over a WebSocket relay server.
 *
 * Connection lifecycle, as the @oa-sdk/peer-server relay drives it:
 * 1. The socket opens and the relay checks the ticket. `{type:'ready'}` means
 *    the ticket was accepted: `connect()` resolves and `isConnected` is true.
 * 2. `{type:'approved'}` opens the relay for packets. Only then is the channel
 *    marked connected, so packets the channel buffered before approval are
 *    flushed to a peer that may receive them.
 * 3. `{type:'closed'}` or `{type:'released'}` ends the session. Relay tickets
 *    are single-use, so the adapter does not reconnect after a terminal signal
 *    or a normal (1000) or policy (1008) close; it reconnects only after an
 *    abnormal drop, and never after `disconnect()` or `dispose()`.
 */
import { P2pTransportChannel } from '../p2p-channel.js'
import type { DataChannelPacket } from '../types.js'
import {
  WEBMCP_SUBPROTOCOL,
  parseSignalMessage,
  type SignalMessage,
} from '../relay-protocol.js'

/** WebSocket readyState values (identical in browsers, Node and `ws`). */
const WS_OPEN = 1
/** Close codes after which the same ticket can never be accepted again. */
const TERMINAL_CLOSE_CODES: ReadonlySet<number> = new Set([1000, 1008])

export interface WebSocketTransportAdapterOptions {
  /**
   * Relay endpoint for one room and role. With @oa-sdk/peer-server this is
   * `ws://host:8787/p/<roomId>/<provider|client>` or
   * `ws://host:8787/ws?room=<roomId>&role=<provider|client>`; both room and
   * role are required. A provider may add `alias=<peer-alias>` to serve Cloud
   * Transit calls for that alias (see the relay guide).
   */
  url: string
  /** Authentication ticket: the room's providerToken, or the clientToken returned by `POST /p/:roomId/join`. */
  tokenOrTicket: string
  /** Optional custom WebSocket constructor (defaults to globalThis.WebSocket) */
  webSocketClass?: typeof WebSocket | undefined
  /** Reconnect after an abnormal drop (default: true). Terminal closes never reconnect. */
  autoReconnect?: boolean | undefined
  /** Initial reconnect delay in ms (default: 1000) */
  reconnectDelayMs?: number | undefined
  /** Maximum reconnect delay in ms (default: 15000) */
  maxReconnectDelayMs?: number | undefined
  /** Maximum reconnect attempts before giving up (default: 10, 0 = unlimited). Reset only when the relay accepts the ticket. */
  maxReconnectAttempts?: number | undefined
  /** Custom logger for diagnostics */
  logger?: ((msg: string) => void) | undefined
  /** Callback on every non-relay signal received (ready, request, approved, closed, offer/answer, ...) */
  onSignal?: ((message: SignalMessage) => void) | undefined
}

export interface WebSocketTransportAdapter {
  readonly channel: P2pTransportChannel
  /** True from the relay's `ready` signal until the socket closes. */
  readonly isConnected: boolean
  sendSignal(signal: Exclude<SignalMessage, { type: 'relay' }>): Promise<boolean>
  /**
   * Open the socket. Resolves when the relay accepts the ticket (`ready`);
   * rejects when the relay refuses it, the socket closes first, or
   * `disconnect()` is called meanwhile.
   */
  connect(): Promise<void>
  /** Close the socket for good: no reconnect is scheduled. `connect()` may be called again. */
  disconnect(): void
  dispose(): void
}

export function createWebSocketTransportAdapter(
  channel: P2pTransportChannel,
  options: WebSocketTransportAdapterOptions,
): WebSocketTransportAdapter {
  const WebSocketCtor = options.webSocketClass ?? (globalThis.WebSocket as typeof WebSocket | undefined)
  if (!WebSocketCtor) {
    throw new Error('WebSocket is not available in current environment. Provide options.webSocketClass.')
  }

  /** The socket of the current connection; handlers of any other socket are ignored. */
  let ws: WebSocket | null = null
  let connecting: Promise<void> | null = null
  /** Rejects the pending `connect()` when `disconnect()` abandons its socket. */
  let abandonPending: ((error: Error) => void) | null = null
  let disposed = false
  let intentionalClose = false
  let terminal = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let isConnected = false

  const autoReconnect = options.autoReconnect ?? true
  const initialDelay = options.reconnectDelayMs ?? 1000
  const maxDelay = options.maxReconnectDelayMs ?? 15000
  const maxAttempts = options.maxReconnectAttempts ?? 10
  const log = options.logger ?? (() => {})

  /** A packet sender bound to one socket, so a stale sender never writes to a newer connection. */
  const senderFor = (socket: WebSocket) => async (packet: DataChannelPacket): Promise<boolean> => {
    if (ws !== socket || socket.readyState !== WS_OPEN) return false
    try {
      socket.send(JSON.stringify({ type: 'relay', packet }))
      return true
    } catch (err) {
      log(`WebSocket sender error: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const scheduleReconnect = () => {
    if (disposed || !autoReconnect || intentionalClose || terminal) return
    if (maxAttempts > 0 && reconnectAttempts >= maxAttempts) {
      log(`Maximum reconnect attempts reached (${maxAttempts}). Stopping auto-reconnect.`)
      return
    }

    const delay = Math.min(initialDelay * Math.pow(1.5, reconnectAttempts), maxDelay)
    reconnectAttempts++
    log(`Scheduling reconnect attempt ${reconnectAttempts} in ${delay}ms...`)

    clearReconnectTimer()
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect().catch((err) => {
        log(`Reconnect attempt failed: ${err instanceof Error ? err.message : String(err)}`)
      })
    }, delay)
  }

  const openSocket = (): Promise<void> => new Promise<void>((resolve, reject) => {
    let settled = false
    const settle = (error?: Error) => {
      if (settled) return
      settled = true
      abandonPending = null
      if (error) reject(error)
      else resolve()
    }

    let socket: WebSocket
    try {
      socket = new WebSocketCtor(options.url, [WEBMCP_SUBPROTOCOL, `ticket.${options.tokenOrTicket}`])
    } catch (err) {
      settle(err instanceof Error ? err : new Error(String(err)))
      scheduleReconnect()
      return
    }
    ws = socket
    abandonPending = settle
    const send = senderFor(socket)
    /** Set by the relay's `approved` signal: packets may flow in both directions. */
    let approved = false

    socket.onmessage = (event: MessageEvent) => {
      if (ws !== socket) return
      const text = typeof event.data === 'string' ? event.data : String(event.data)
      let signal: SignalMessage
      try {
        signal = parseSignalMessage(text)
      } catch (err) {
        log(`Malformed signal frame dropped: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      if (signal.type === 'relay') {
        // A peer may only send packets once the session is approved.
        if (approved) channel.receivePacket(signal.packet)
        else log('Relay packet received before approval dropped')
        return
      }

      if (signal.type === 'ready') {
        reconnectAttempts = 0
        isConnected = true
        log(`Connected to WebSocket relay at ${options.url}`)
        settle()
      } else if (signal.type === 'approved') {
        approved = true
        channel.setConnectionState(true, send)
      } else if (signal.type === 'closed' || signal.type === 'released') {
        // The relay closes the socket next; the ticket cannot be used again.
        terminal = true
        approved = false
        channel.setConnectionState(false)
        settle(new Error(signal.type === 'closed' ? `Relay closed the session: ${signal.reason}` : 'Relay session released'))
      }
      options.onSignal?.(signal)
    }

    socket.onerror = () => {
      if (ws !== socket) return
      log('WebSocket error event received')
      settle(new Error('WebSocket connection failed'))
    }

    socket.onclose = (event: { readonly code?: number } | undefined) => {
      settle(new Error('WebSocket closed before the relay accepted the ticket'))
      if (ws !== socket) return
      ws = null
      isConnected = false
      channel.setConnectionState(false)
      log('Disconnected from WebSocket relay')
      const code = event?.code
      if (typeof code === 'number' && TERMINAL_CLOSE_CODES.has(code)) terminal = true
      scheduleReconnect()
    }
  })

  const connect = (): Promise<void> => {
    if (disposed) return Promise.reject(new Error('WebSocket transport adapter is disposed'))
    if (connecting) return connecting
    if (ws && isConnected) return Promise.resolve()

    clearReconnectTimer()
    intentionalClose = false
    terminal = false
    const attempt = openSocket()
    connecting = attempt
    const clear = () => {
      if (connecting === attempt) connecting = null
    }
    attempt.then(clear, clear)
    return attempt
  }

  const disconnect = () => {
    intentionalClose = true
    clearReconnectTimer()
    const socket = ws
    ws = null
    connecting = null
    abandonPending?.(new Error('WebSocket transport adapter disconnected'))
    if (socket) {
      // The socket's handlers stay attached: they ignore every event once `ws`
      // no longer points at this socket, so its late close event cannot touch a
      // later connection. Removing them would be unsafe: closing a socket that
      // is still CONNECTING makes the `ws` package emit 'error', and an
      // EventEmitter 'error' without a listener is an uncaught exception.
      try {
        socket.close(1000, 'client-disconnect')
      } catch {}
    }
    isConnected = false
    channel.setConnectionState(false)
  }

  const dispose = () => {
    disposed = true
    disconnect()
  }

  const sendSignal = async (signal: Exclude<SignalMessage, { type: 'relay' }>): Promise<boolean> => {
    const socket = ws
    if (!socket || socket.readyState !== WS_OPEN) {
      return false
    }
    try {
      socket.send(JSON.stringify(signal))
      return true
    } catch {
      return false
    }
  }

  return {
    get channel() {
      return channel
    },
    get isConnected() {
      return isConnected
    },
    sendSignal,
    connect,
    disconnect,
    dispose,
  }
}
