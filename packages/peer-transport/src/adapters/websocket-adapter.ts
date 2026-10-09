/**
 * @oa-sdk/peer-transport — WebSocket Transport Adapter for P2P Channel
 *
 * Implements a host adapter for P2pTransportChannel that transmits and
 * receives packets over a WebSocket relay server.
 */
import { P2pTransportChannel } from '../p2p-channel.js'
import type { DataChannelPacket } from '../types.js'
import {
  WEBMCP_SUBPROTOCOL,
  parseSignalMessage,
  type SignalMessage,
} from '../relay-protocol.js'

export interface WebSocketTransportAdapterOptions {
  /** Target relay server URL (e.g. ws://127.0.0.1:8787/ws or wss://relay.example.com/ws) */
  url: string
  /** Authentication ticket or provider token */
  tokenOrTicket: string
  /** Optional custom WebSocket constructor (defaults to globalThis.WebSocket) */
  webSocketClass?: typeof WebSocket | undefined
  /** Enable automatic reconnect on disconnect (default: true) */
  autoReconnect?: boolean | undefined
  /** Initial reconnect delay in ms (default: 1000) */
  reconnectDelayMs?: number | undefined
  /** Maximum reconnect delay in ms (default: 15000) */
  maxReconnectDelayMs?: number | undefined
  /** Maximum reconnect attempts before giving up (default: 10, 0 = unlimited) */
  maxReconnectAttempts?: number | undefined
  /** Custom logger for diagnostics */
  logger?: ((msg: string) => void) | undefined
  /** Callback on raw signal message received (e.g. for WebRTC handshakes) */
  onSignal?: ((message: SignalMessage) => void) | undefined
}

export interface WebSocketTransportAdapter {
  readonly channel: P2pTransportChannel
  readonly isConnected: boolean
  sendSignal(signal: Exclude<SignalMessage, { type: 'relay' }>): Promise<boolean>
  connect(): Promise<void>
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

  let ws: WebSocket | null = null
  let disposed = false
  let reconnectTimer: NodeJS.Timeout | null = null
  let reconnectAttempts = 0
  let isConnected = false

  const autoReconnect = options.autoReconnect ?? true
  const initialDelay = options.reconnectDelayMs ?? 1000
  const maxDelay = options.maxReconnectDelayMs ?? 15000
  const maxAttempts = options.maxReconnectAttempts ?? 10
  const log = options.logger ?? (() => {})

  const sender = async (packet: DataChannelPacket): Promise<boolean> => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false
    }
    try {
      const envelope = JSON.stringify({
        type: 'relay',
        packet,
      })
      ws.send(envelope)
      return true
    } catch (err) {
      log(`WebSocket sender error: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  const scheduleReconnect = () => {
    if (disposed || !autoReconnect) return
    if (maxAttempts > 0 && reconnectAttempts >= maxAttempts) {
      log(`Maximum reconnect attempts reached (${maxAttempts}). Stopping auto-reconnect.`)
      return
    }

    const delay = Math.min(initialDelay * Math.pow(1.5, reconnectAttempts), maxDelay)
    reconnectAttempts++
    log(`Scheduling reconnect attempt ${reconnectAttempts} in ${delay}ms...`)

    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect().catch((err) => {
        log(`Reconnect attempt failed: ${err instanceof Error ? err.message : String(err)}`)
      })
    }, delay)
  }

  const connect = async (): Promise<void> => {
    if (disposed) return
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    return new Promise<void>((resolve, reject) => {
      let resolved = false
      const protocols = [WEBMCP_SUBPROTOCOL, `ticket.${options.tokenOrTicket}`]

      try {
        ws = new WebSocketCtor(options.url, protocols)
      } catch (err) {
        scheduleReconnect()
        reject(err)
        return
      }

      ws.onopen = () => {
        reconnectAttempts = 0
        isConnected = true
        channel.setConnectionState(true, sender)
        log(`Connected to WebSocket relay at ${options.url}`)
        if (!resolved) {
          resolved = true
          resolve()
        }
      }

      ws.onmessage = (event: MessageEvent) => {
        const text = typeof event.data === 'string' ? event.data : String(event.data)
        try {
          const signal = parseSignalMessage(text)
          if (signal.type === 'relay') {
            channel.receivePacket(signal.packet)
          } else {
            options.onSignal?.(signal)
          }
        } catch (err) {
          log(`Malformed signal frame dropped: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      ws.onerror = (event: Event) => {
        log(`WebSocket error event received`)
        if (!resolved) {
          resolved = true
          reject(new Error('WebSocket connection failed'))
        }
      }

      ws.onclose = () => {
        isConnected = false
        channel.setConnectionState(false)
        ws = null
        log(`Disconnected from WebSocket relay`)
        if (!resolved) {
          resolved = true
          resolve()
        }
        scheduleReconnect()
      }
    })
  }

  const disconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      try {
        ws.close(1000, 'client-disconnect')
      } catch {}
      ws = null
    }
    isConnected = false
    channel.setConnectionState(false)
  }

  const dispose = () => {
    disposed = true
    disconnect()
  }

  const sendSignal = async (signal: Exclude<SignalMessage, { type: 'relay' }>): Promise<boolean> => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false
    }
    try {
      ws.send(JSON.stringify(signal))
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
