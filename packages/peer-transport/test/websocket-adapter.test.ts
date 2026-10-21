import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import {
  P2pTransportChannel,
  createWebSocketTransportAdapter,
  type SignalMessage,
} from '../src/index.js'

/**
 * A scripted stand-in for a relay socket. Like a real WebSocket, close events
 * are delivered asynchronously, after `close()` returns.
 */
class ScriptedSocket {
  static instances: ScriptedSocket[] = []
  readyState = 0
  sent: string[] = []
  closedWith: { code?: number | undefined; reason?: string | undefined } | null = null
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null

  constructor(readonly url: string, readonly protocols?: string[]) {
    ScriptedSocket.instances.push(this)
    setTimeout(() => {
      if (this.readyState !== 0) return
      this.readyState = 1
      this.onopen?.({})
      ScriptedSocket.script(this)
    }, 1)
  }

  /** Server behavior for each new socket; replaced per test. */
  static script: (socket: ScriptedSocket) => void = () => {}

  deliver(message: SignalMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  /** The server closes the socket. */
  serverClose(code: number): void {
    if (this.readyState === 3) return
    this.readyState = 3
    setTimeout(() => this.onclose?.({ code }), 0)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === 3) return
    this.closedWith = { code, reason }
    this.readyState = 3
    setTimeout(() => this.onclose?.({ code: code ?? 1005 }), 0)
  }
}

const socketClass = ScriptedSocket as unknown as typeof WebSocket

type WsEventType = 'open' | 'message' | 'error' | 'close'

/**
 * A socket with the event semantics of the Node `ws` package: it is an
 * EventEmitter, the `on<event>` attributes add and remove ordinary listeners
 * (assigning null leaves none), and `close()` while CONNECTING aborts the
 * handshake and emits 'error' on the next tick. An EventEmitter 'error'
 * without a listener throws; in a process that is an uncaught exception, so
 * this socket records what the emit threw. Its relay never answers the upgrade.
 */
class WsLikeSocket extends EventEmitter {
  static instances: WsLikeSocket[] = []
  static uncaught: unknown[] = []
  readyState = 0
  private readonly attributes = new Map<WsEventType, (...args: unknown[]) => void>()

  constructor(readonly url: string, readonly protocols?: string[]) {
    super()
    WsLikeSocket.instances.push(this)
  }

  private setAttribute(type: WsEventType, handler: unknown): void {
    const previous = this.attributes.get(type)
    if (previous) this.removeListener(type, previous)
    this.attributes.delete(type)
    if (typeof handler !== 'function') return
    const listener = (event: unknown) => (handler as (event: unknown) => void)(event)
    this.attributes.set(type, listener)
    this.on(type, listener)
  }

  set onopen(handler: unknown) { this.setAttribute('open', handler) }
  set onmessage(handler: unknown) { this.setAttribute('message', handler) }
  set onerror(handler: unknown) { this.setAttribute('error', handler) }
  set onclose(handler: unknown) { this.setAttribute('close', handler) }

  private emitSafely(type: WsEventType, event: unknown): boolean {
    try {
      this.emit(type, event)
      return true
    } catch (err) {
      WsLikeSocket.uncaught.push(err)
      return false
    }
  }

  /** The connection drops before the handshake completes. */
  drop(): void {
    this.readyState = 3
    process.nextTick(() => this.emitSafely('close', { code: 1006, reason: '' }))
  }

  send(): void {
    throw new Error('WebSocket is not open: readyState 0 (CONNECTING)')
  }

  close(code?: number): void {
    if (this.readyState === 3) return
    if (this.readyState === 0) {
      this.readyState = 2
      process.nextTick(() => {
        if (!this.emitSafely('error', new Error('WebSocket was closed before the connection was established'))) return
        this.readyState = 3
        this.emitSafely('close', { code: 1006, reason: '' })
      })
      return
    }
    this.readyState = 3
    process.nextTick(() => this.emitSafely('close', { code: code ?? 1005, reason: '' }))
  }
}

const wsLikeClass = WsLikeSocket as unknown as typeof WebSocket

function ready(socket: ScriptedSocket): void {
  socket.deliver({ type: 'ready', role: 'client', roomId: 'room-1', requestId: 'req-1' })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('WebSocketTransportAdapter lifecycle', () => {
  afterEach(() => {
    ScriptedSocket.instances = []
    ScriptedSocket.script = () => {}
  })

  it('does not reconnect after disconnect()', async () => {
    ScriptedSocket.script = ready
    const channel = new P2pTransportChannel({ peerId: 'c1', alias: 'client' })
    const adapter = createWebSocketTransportAdapter(channel, {
      url: 'ws://relay.test/p/room-1/client',
      tokenOrTicket: 't',
      webSocketClass: socketClass,
      reconnectDelayMs: 5,
    })

    await adapter.connect()
    expect(adapter.isConnected).toBe(true)
    adapter.disconnect()
    await sleep(60)

    expect(ScriptedSocket.instances).toHaveLength(1)
    expect(ScriptedSocket.instances[0]!.closedWith).toEqual({ code: 1000, reason: 'client-disconnect' })
    expect(adapter.isConnected).toBe(false)
    adapter.dispose()
  })

  it('keeps a newer connection intact when the previous socket closes late', async () => {
    ScriptedSocket.script = ready
    const channel = new P2pTransportChannel({ peerId: 'c1', alias: 'client' })
    const adapter = createWebSocketTransportAdapter(channel, {
      url: 'ws://relay.test/p/room-1/client',
      tokenOrTicket: 't',
      webSocketClass: socketClass,
      autoReconnect: false,
    })

    await adapter.connect()
    adapter.disconnect()
    await adapter.connect()
    // Let the first socket's close event run.
    await sleep(20)

    const [first, second] = ScriptedSocket.instances
    expect(ScriptedSocket.instances).toHaveLength(2)
    expect(adapter.isConnected).toBe(true)
    await expect(adapter.sendSignal({ type: 'cancel' })).resolves.toBe(true)
    expect(second!.sent).toEqual([JSON.stringify({ type: 'cancel' })])
    expect(first!.sent).toEqual([])

    adapter.dispose()
    expect(second!.closedWith).toEqual({ code: 1000, reason: 'client-disconnect' })
  })

  it('treats a relay refusal as terminal: connect() rejects and nothing reconnects', async () => {
    ScriptedSocket.script = (socket) => {
      socket.deliver({ type: 'closed', reason: 'UNAUTHORIZED' })
      socket.serverClose(1008)
    }
    const channel = new P2pTransportChannel({ peerId: 'c1', alias: 'client' })
    const signals: string[] = []
    const adapter = createWebSocketTransportAdapter(channel, {
      url: 'ws://relay.test/p/room-1/client',
      tokenOrTicket: 't',
      webSocketClass: socketClass,
      reconnectDelayMs: 1,
      onSignal: (signal) => signals.push(signal.type),
    })

    await expect(adapter.connect()).rejects.toThrow('UNAUTHORIZED')
    await sleep(60)
    expect(ScriptedSocket.instances).toHaveLength(1)
    expect(signals).toEqual(['closed'])
    expect(adapter.isConnected).toBe(false)
    adapter.dispose()
  })

  it('does not reconnect after the relay ends a session with a normal close', async () => {
    ScriptedSocket.script = (socket) => {
      ready(socket)
      setTimeout(() => socket.serverClose(1000), 2)
    }
    const channel = new P2pTransportChannel({ peerId: 'c1', alias: 'client' })
    const adapter = createWebSocketTransportAdapter(channel, {
      url: 'ws://relay.test/p/room-1/client',
      tokenOrTicket: 't',
      webSocketClass: socketClass,
      reconnectDelayMs: 1,
    })

    await adapter.connect()
    await sleep(60)
    expect(ScriptedSocket.instances).toHaveLength(1)
    adapter.dispose()
  })

  it('holds maxReconnectAttempts when sockets open but the relay never accepts the ticket', async () => {
    ScriptedSocket.script = (socket) => socket.serverClose(1006)
    const channel = new P2pTransportChannel({ peerId: 'c1', alias: 'client' })
    const adapter = createWebSocketTransportAdapter(channel, {
      url: 'ws://relay.test/p/room-1/client',
      tokenOrTicket: 't',
      webSocketClass: socketClass,
      reconnectDelayMs: 1,
      maxReconnectDelayMs: 2,
      maxReconnectAttempts: 3,
    })

    await expect(adapter.connect()).rejects.toThrow('WebSocket closed before the relay accepted the ticket')
    await sleep(150)
    // The first attempt plus three reconnects.
    expect(ScriptedSocket.instances).toHaveLength(4)
    adapter.dispose()
  })

  it('flushes buffered packets only once the relay approves the session', async () => {
    let socket: ScriptedSocket | undefined
    ScriptedSocket.script = (s) => {
      socket = s
      ready(s)
    }
    const channel = new P2pTransportChannel({ peerId: 'c1', alias: 'client' })
    await channel.send('mcp-jsonrpc', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo' } })
    expect(channel.bufferedCount).toBe(1)

    const received: unknown[] = []
    channel.on('*', (packet) => received.push(packet.payload))
    const adapter = createWebSocketTransportAdapter(channel, {
      url: 'ws://relay.test/p/room-1/client',
      tokenOrTicket: 't',
      webSocketClass: socketClass,
      autoReconnect: false,
    })

    await adapter.connect()
    // Authenticated but not approved: nothing is flushed, and inbound packets are refused.
    expect(channel.isConnected).toBe(false)
    expect(socket!.sent).toEqual([])
    socket!.deliver({ type: 'relay', packet: { channel: 'presence', payload: 'early' } })
    expect(received).toEqual([])

    socket!.deliver({ type: 'approved', requestId: 'req-1' })
    await expect.poll(() => socket!.sent.length).toBe(1)
    const frame = JSON.parse(socket!.sent[0]!) as { type: string; packet: { channel: string } }
    expect(frame.type).toBe('relay')
    expect(frame.packet.channel).toBe('mcp-jsonrpc')
    expect(channel.bufferedCount).toBe(0)

    socket!.deliver({ type: 'relay', packet: { channel: 'presence', payload: 'late' } })
    expect(received).toEqual(['late'])
    adapter.dispose()
    channel.dispose()
  })

  it('rejects a pending connect() when disconnect() abandons it', async () => {
    const channel = new P2pTransportChannel({ peerId: 'c1', alias: 'client' })
    const adapter = createWebSocketTransportAdapter(channel, {
      url: 'ws://relay.test/p/room-1/client',
      tokenOrTicket: 't',
      webSocketClass: socketClass,
    })
    const pending = adapter.connect()
    adapter.disconnect()
    await expect(pending).rejects.toThrow('disconnected')
    await sleep(20)
    expect(ScriptedSocket.instances).toHaveLength(1)
    adapter.dispose()
  })
})

describe('WebSocketTransportAdapter with ws-style sockets', () => {
  afterEach(() => {
    WsLikeSocket.instances = []
    WsLikeSocket.uncaught = []
  })

  it('keeps an error listener on a socket disconnect() closes while CONNECTING', async () => {
    const channel = new P2pTransportChannel({ peerId: 'c1', alias: 'client' })
    const adapter = createWebSocketTransportAdapter(channel, {
      url: 'ws://relay.test/p/room-1/client',
      tokenOrTicket: 't',
      webSocketClass: wsLikeClass,
      reconnectDelayMs: 1,
    })

    const pending = adapter.connect()
    adapter.disconnect()
    await expect(pending).rejects.toThrow('disconnected')
    await sleep(20)

    const [socket] = WsLikeSocket.instances
    expect(WsLikeSocket.uncaught).toEqual([])
    expect(socket!.readyState).toBe(3)
    expect(WsLikeSocket.instances).toHaveLength(1)
    expect(adapter.isConnected).toBe(false)
    adapter.dispose()
  })

  it('keeps an error listener on a reconnect attempt dispose() closes while CONNECTING', async () => {
    const channel = new P2pTransportChannel({ peerId: 'c1', alias: 'client' })
    const adapter = createWebSocketTransportAdapter(channel, {
      url: 'ws://relay.test/p/room-1/client',
      tokenOrTicket: 't',
      webSocketClass: wsLikeClass,
      reconnectDelayMs: 1,
      maxReconnectDelayMs: 1,
    })

    const first = adapter.connect()
    WsLikeSocket.instances[0]!.drop()
    await expect(first).rejects.toThrow('WebSocket closed before the relay accepted the ticket')
    await expect.poll(() => WsLikeSocket.instances.length).toBe(2)

    adapter.dispose()
    await sleep(20)
    expect(WsLikeSocket.uncaught).toEqual([])
    expect(WsLikeSocket.instances[1]!.readyState).toBe(3)
    expect(WsLikeSocket.instances).toHaveLength(2)
  })
})
