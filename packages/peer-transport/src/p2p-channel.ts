/**
 * @oa-sdk/peer-transport — P2P DataChannel & Resilient Buffer Queue
 *
 * Multiplexes MCP JSON-RPC, CRDT Deltatrees, and Presence over a resilient peer stream.
 */
import { TRANSPORT_CHANNELS, type DataChannelPacket, type TransportChannelType } from './types.js'

/**
 * Packet listener. Payloads arrive from a remote peer, so the default payload
 * type is `unknown`; a listener that names `T` is responsible for narrowing.
 */
export interface ChannelListener<T = unknown> {
  (packet: DataChannelPacket<T>): void
}

type PacketSender = (packet: DataChannelPacket) => Promise<boolean>

export interface P2pChannelConfig {
  peerId: string
  alias: string
  bufferLimit?: number | undefined
  /** Send a liveness heartbeat at this interval while connected (milliseconds). */
  heartbeatIntervalMs?: number | undefined
  /** Maximum time to wait for a direct sender before buffering the packet (milliseconds). */
  directSendTimeoutMs?: number | undefined
  /** Maximum age of a buffered packet before it is discarded (milliseconds). */
  packetDeadlineMs?: number | undefined
  /** Called when an automatic presence heartbeat is emitted. */
  onHeartbeat?: ((packet: DataChannelPacket) => void) | undefined
  /** Maximum serialized packet size accepted by the transport (default 1 MiB). */
  maxPacketBytes?: number | undefined
  /** Optional diagnostic hook for isolated listener failures. */
  onListenerError?: ((error: unknown) => void) | undefined
}

const DEFAULT_BUFFER_LIMIT = 1000
const DEFAULT_MAX_PACKET_BYTES = 1024 * 1024
const DEFAULT_DIRECT_SEND_TIMEOUT_MS = 5000
const DEFAULT_PACKET_DEADLINE_MS = 5_000
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const QUEUE_PRIORITY: readonly TransportChannelType[] = ['mcp-jsonrpc', 'crdt-delta', 'presence']
// Drop lower-priority state first when the bounded aggregate queue is full.
const DROP_PRIORITY: readonly TransportChannelType[] = ['presence', 'crdt-delta', 'mcp-jsonrpc']

function packetByteLength(packet: unknown): number {
  let serialized: string
  try {
    serialized = JSON.stringify(packet) ?? ''
  } catch {
    return Number.POSITIVE_INFINITY
  }
  return Buffer.byteLength(serialized, 'utf8')
}

function isPacketChannel(value: unknown): value is TransportChannelType {
  return typeof value === 'string' && (TRANSPORT_CHANNELS as readonly string[]).includes(value)
}

function finitePositive(value: number, name: string, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${name} must be an integer between 1 and ${max}`)
  }
  return value
}

export class P2pTransportChannel {
  readonly peerId: string
  readonly alias: string
  readonly bufferLimit: number
  readonly maxPacketBytes: number
  readonly heartbeatIntervalMs: number | undefined
  readonly directSendTimeoutMs: number
  readonly packetDeadlineMs: number
  private connected = false
  private sendQueues: Record<TransportChannelType, DataChannelPacket[]> = {
    'mcp-jsonrpc': [],
    'crdt-delta': [],
    presence: [],
  }
  private listeners = new Map<TransportChannelType | '*', Set<ChannelListener>>()
  private seqCounter = 0
  private sessionEpoch = 1
  private lastReceivedSeq = new Map<string, { epoch: number; seq: number }>()
  private sendHandler: PacketSender | undefined
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined
  private readonly onHeartbeat?: ((packet: DataChannelPacket) => void) | undefined
  private readonly onListenerError?: ((error: unknown) => void) | undefined

  constructor(config: P2pChannelConfig) {
    if (!SAFE_ID.test(config.peerId) || !SAFE_ID.test(config.alias)) {
      throw new TypeError('peerId and alias must be safe non-empty identifiers')
    }
    const bufferLimit = config.bufferLimit ?? DEFAULT_BUFFER_LIMIT
    if (!Number.isSafeInteger(bufferLimit) || bufferLimit < 0 || bufferLimit > 100_000) {
      throw new RangeError('bufferLimit must be an integer between 0 and 100000')
    }
    const maxPacketBytes = config.maxPacketBytes ?? DEFAULT_MAX_PACKET_BYTES
    if (!Number.isSafeInteger(maxPacketBytes) || maxPacketBytes < 1 || maxPacketBytes > 16 * 1024 * 1024) {
      throw new RangeError('maxPacketBytes must be an integer between 1 and 16777216')
    }
    const heartbeatIntervalMs = config.heartbeatIntervalMs
    if (heartbeatIntervalMs !== undefined) finitePositive(heartbeatIntervalMs, 'heartbeatIntervalMs', 24 * 60 * 60 * 1000)
    const directSendTimeoutMs = config.directSendTimeoutMs ?? DEFAULT_DIRECT_SEND_TIMEOUT_MS
    finitePositive(directSendTimeoutMs, 'directSendTimeoutMs', 300_000)
    const packetDeadlineMs = config.packetDeadlineMs ?? DEFAULT_PACKET_DEADLINE_MS
    finitePositive(packetDeadlineMs, 'packetDeadlineMs', 24 * 60 * 60 * 1000)
    this.peerId = config.peerId
    this.alias = config.alias
    this.bufferLimit = bufferLimit
    this.maxPacketBytes = maxPacketBytes
    this.heartbeatIntervalMs = heartbeatIntervalMs
    this.directSendTimeoutMs = directSendTimeoutMs
    this.packetDeadlineMs = packetDeadlineMs
    this.onHeartbeat = config.onHeartbeat
    this.onListenerError = config.onListenerError
  }

  get isConnected(): boolean {
    return this.connected
  }

  get bufferedCount(): number {
    return QUEUE_PRIORITY.reduce((total, channel) => total + this.sendQueues[channel].length, 0)
  }

  /** Current reconnect epoch. Sequence numbers are scoped to this value. */
  get currentSessionEpoch(): number {
    return this.sessionEpoch
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat()
    if (!this.connected || !this.sendHandler || this.heartbeatIntervalMs === undefined) return
    this.heartbeatTimer = setInterval(() => {
      const sender = this.sendHandler
      if (!this.connected || !sender) return
      const packet: DataChannelPacket = {
        channel: 'presence',
        payload: { type: 'heartbeat', epoch: this.sessionEpoch },
        seq: ++this.seqCounter,
        timestamp: Date.now(),
        senderId: this.peerId,
        sessionEpoch: this.sessionEpoch,
      }
      if (packetByteLength(packet) > this.maxPacketBytes) return
      try {
        this.onHeartbeat?.(packet)
      } catch (error) {
        this.onListenerError?.(error)
      }
      void this.sendDirect(packet, sender).catch(() => undefined)
    }, this.heartbeatIntervalMs)
    // Node timers should not keep a CLI process alive solely for liveness checks.
    // Browser timers are numeric handles without unref.
    const timer: unknown = this.heartbeatTimer
    if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
      timer.unref()
    }
  }

  /**
   * Set connection state and flush any buffered packets if connected.
   * A new connection starts a new session epoch so sequence numbers may safely restart.
   */
  setConnectionState(connected: boolean, sendHandler?: PacketSender): void {
    if (sendHandler) this.sendHandler = sendHandler
    const becameConnected = connected && !this.connected
    this.connected = connected
    if (!connected) {
      this.clearHeartbeat()
      return
    }
    if (becameConnected) {
      this.sessionEpoch = this.sessionEpoch >= Number.MAX_SAFE_INTEGER ? 1 : this.sessionEpoch + 1
      this.seqCounter = 0
    }
    const sender = this.sendHandler
    if (sender && this.bufferedCount > 0) this.flushBuffered(sender)
    this.startHeartbeat()
  }

  private sendDirect(packet: DataChannelPacket, sender: PacketSender): Promise<boolean> {
    let sendPromise: Promise<boolean>
    try {
      // Invoke synchronously so callers can observe send order before the next tick.
      sendPromise = Promise.resolve(sender(packet))
    } catch (error) {
      sendPromise = Promise.reject(error)
    }
    return new Promise<boolean>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error(`direct send timed out after ${this.directSendTimeoutMs}ms`))
      }, this.directSendTimeoutMs)
      sendPromise.then(
        (ok) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(ok === true)
        },
        (error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  }

  private enqueue(packet: DataChannelPacket): boolean {
    if (this.bufferLimit === 0) return false
    if (packet.timestamp !== undefined && Date.now() - packet.timestamp >= this.packetDeadlineMs) return false
    while (this.bufferedCount >= this.bufferLimit) {
      const dropChannel = DROP_PRIORITY.find((channel) => this.sendQueues[channel].length > 0)
      if (!dropChannel) break
      this.sendQueues[dropChannel].shift()
    }
    this.sendQueues[packet.channel].push(packet)
    return true
  }

  private flushBuffered(sender: PacketSender): void {
    const packets: DataChannelPacket[] = []
    for (const channel of QUEUE_PRIORITY) {
      packets.push(...this.sendQueues[channel])
      this.sendQueues[channel] = []
    }
    // Buffered packets belong to the old connection. Re-sequence them into the
    // current epoch before delivery so a reconnect cannot discard them as stale.
    const currentPackets = packets
      .filter((packet) => packet.timestamp === undefined || Date.now() - packet.timestamp < this.packetDeadlineMs)
      .map((packet) => ({
        ...packet,
        seq: ++this.seqCounter,
        sessionEpoch: this.sessionEpoch,
      }))
    // Invoke each sender immediately in priority order; failures are re-queued.
    for (const packet of currentPackets) {
      void this.sendDirect(packet, sender).then((ok) => {
        if (!ok) this.enqueue(packet)
      }).catch(() => {
        this.enqueue(packet)
      })
    }
  }

  /**
   * Send a packet across the channel. If disconnected (or direct delivery fails),
   * the packet is retained in a bounded, channel-prioritized queue.
   */
  async send<T = unknown>(
    channel: TransportChannelType,
    payload: T,
    directSender?: (packet: DataChannelPacket<T>) => Promise<boolean>,
  ): Promise<boolean> {
    if (!isPacketChannel(channel)) throw new TypeError('Unknown transport channel')
    const packet: DataChannelPacket<T> = {
      channel,
      payload,
      seq: ++this.seqCounter,
      timestamp: Date.now(),
      senderId: this.peerId,
      sessionEpoch: this.sessionEpoch,
    }
    if (packetByteLength(packet) > this.maxPacketBytes) {
      throw new RangeError(`Packet exceeds maxPacketBytes (${this.maxPacketBytes})`)
    }

    const sender = directSender as PacketSender | undefined ?? this.sendHandler
    if (this.connected && sender) {
      try {
        const ok = await this.sendDirect(packet, sender)
        if (ok) return true
      } catch {
        // Fall through to buffer.
      }
    }

    this.enqueue(packet)
    return false
  }

  /**
   * Ingest an incoming packet from the peer transport.
   */
  receivePacket<T = unknown>(packet: DataChannelPacket<T>): void {
    if (!packet || typeof packet !== 'object' || !isPacketChannel(packet.channel)) return
    if (packetByteLength(packet) > this.maxPacketBytes) return
    if (packet.senderId !== undefined && (!SAFE_ID.test(packet.senderId) || packet.senderId === this.peerId)) return
    if (packet.sessionEpoch !== undefined && (!Number.isSafeInteger(packet.sessionEpoch) || packet.sessionEpoch < 1)) return
    if (packet.seq !== undefined) {
      if (!Number.isSafeInteger(packet.seq) || packet.seq < 1) return
      const sender = packet.senderId ?? 'unknown'
      const epoch = packet.sessionEpoch ?? 0
      const previous = this.lastReceivedSeq.get(sender)
      // Older reconnect epochs can arrive after a newer epoch; discard them.
      if (previous && epoch < previous.epoch) return
      if (previous && epoch === previous.epoch && packet.seq <= previous.seq) return
      this.lastReceivedSeq.set(sender, { epoch, seq: packet.seq })
    }
    if (packet.timestamp !== undefined && (!Number.isFinite(packet.timestamp) || packet.timestamp < 0)) return
    // Notify channel-specific listeners
    const specific = this.listeners.get(packet.channel)
    if (specific) {
      for (const listener of specific) {
        try {
          listener(packet)
        } catch (error) {
          this.onListenerError?.(error)
        }
      }
    }

    // Notify wildcard listeners
    const wildcard = this.listeners.get('*')
    if (wildcard) {
      for (const listener of wildcard) {
        try {
          listener(packet)
        } catch (error) {
          this.onListenerError?.(error)
        }
      }
    }
  }

  /** Subscribe to a specific multiplexed channel. */
  on<T = unknown>(channel: TransportChannelType | '*', listener: ChannelListener<T>): () => void {
    if (!this.listeners.has(channel)) this.listeners.set(channel, new Set())
    this.listeners.get(channel)!.add(listener as ChannelListener)
    return () => this.listeners.get(channel)?.delete(listener as ChannelListener)
  }

  /** Clear all buffered packets. */
  clearBuffer(): void {
    this.sendQueues = { 'mcp-jsonrpc': [], 'crdt-delta': [], presence: [] }
  }

  /** Stop heartbeat scheduling and release the retained sender. */
  dispose(): void {
    this.clearHeartbeat()
    this.connected = false
    this.sendHandler = undefined
    this.clearBuffer()
  }
}
