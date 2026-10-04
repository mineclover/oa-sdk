import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  P2pTransportChannel,
  WebMcpBridgeClient,
  type DataChannelPacket,
} from '../src/index.js'

describe('@oa-sdk/peer-transport', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  describe('1. P2pTransportChannel & Resilient Buffering', () => {
    it('buffers packets when disconnected and flushes upon reconnection', async () => {
      const channel = new P2pTransportChannel({
        peerId: 'cli_01',
        alias: 'wireframe-local',
        bufferLimit: 50,
      })

      expect(channel.isConnected).toBe(false)
      expect(channel.bufferedCount).toBe(0)

      // Send when disconnected -> should buffer
      const sent = await channel.send('mcp-jsonrpc', {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'storyboard_page_create' },
      })
      expect(sent).toBe(false)
      expect(channel.bufferedCount).toBe(1)

      // Send second packet
      await channel.send('crdt-delta', { file: 'index.tsx', delta: 'change_1' })
      expect(channel.bufferedCount).toBe(2)

      // Reconnect and flush
      const flushed: DataChannelPacket[] = []
      channel.setConnectionState(true, async (pkt) => {
        flushed.push(pkt)
        return true
      })

      expect(channel.isConnected).toBe(true)
      expect(flushed).toHaveLength(2)
      expect(flushed[0]!.channel).toBe('mcp-jsonrpc')
      expect(flushed[1]!.channel).toBe('crdt-delta')
      expect(channel.bufferedCount).toBe(0)
    })

    it('multiplexes incoming packets to specific and wildcard listeners', () => {
      const channel = new P2pTransportChannel({
        peerId: 'cli_01',
        alias: 'wireframe-local',
      })

      const mcpPackets: any[] = []
      const crdtPackets: any[] = []
      const allPackets: any[] = []

      channel.on('mcp-jsonrpc', (pkt) => mcpPackets.push(pkt.payload))
      channel.on('crdt-delta', (pkt) => crdtPackets.push(pkt.payload))
      channel.on('*', (pkt) => allPackets.push(pkt.channel))

      channel.receivePacket({
        channel: 'mcp-jsonrpc',
        payload: { tool: 'test_tool' },
      })

      channel.receivePacket({
        channel: 'crdt-delta',
        payload: { patch: '+hello' },
      })

      expect(mcpPackets).toEqual([{ tool: 'test_tool' }])
      expect(crdtPackets).toEqual([{ patch: '+hello' }])
      expect(allPackets).toEqual(['mcp-jsonrpc', 'crdt-delta'])
    })

    it('rejects unbounded configuration and drops replayed or oversized packets', async () => {
      expect(() => new P2pTransportChannel({ peerId: 'cli_01', alias: 'wireframe-local', bufferLimit: Number.POSITIVE_INFINITY })).toThrow()
      const errors: unknown[] = []
      const channel = new P2pTransportChannel({
        peerId: 'cli_01',
        alias: 'wireframe-local',
        maxPacketBytes: 128,
        onListenerError: (error) => errors.push(error),
      })
      const received: unknown[] = []
      channel.on('mcp-jsonrpc', (packet) => {
        received.push(packet.payload)
        throw new Error('listener failure')
      })

      channel.receivePacket({ channel: 'mcp-jsonrpc', payload: { ok: true }, seq: 2, senderId: 'peer_01' })
      channel.receivePacket({ channel: 'mcp-jsonrpc', payload: { replay: true }, seq: 1, senderId: 'peer_01' })
      channel.receivePacket({ channel: 'mcp-jsonrpc', payload: { oversized: 'x'.repeat(1000) }, seq: 3, senderId: 'peer_01' })

      expect(received).toEqual([{ ok: true }])
      expect(errors).toHaveLength(1)
    })

    it('does not retain packets when bufferLimit is zero', async () => {
      const channel = new P2pTransportChannel({ peerId: 'cli_01', alias: 'wireframe-local', bufferLimit: 0 })
      await expect(channel.send('presence', { active: true })).resolves.toBe(false)
      expect(channel.bufferedCount).toBe(0)
    })

    it('flushes buffered channels by priority and drops presence before MCP under pressure', async () => {
      const channel = new P2pTransportChannel({ peerId: 'cli_01', alias: 'wireframe-local', bufferLimit: 2 })
      await channel.send('presence', { cursor: 1 })
      await channel.send('crdt-delta', { patch: 1 })
      // MCP traffic is retained by evicting the lower-priority presence packet.
      await channel.send('mcp-jsonrpc', { request: 1 })
      const flushed: string[] = []
      channel.setConnectionState(true, async (packet) => {
        flushed.push(packet.channel)
        return true
      })
      expect(flushed).toEqual(['mcp-jsonrpc', 'crdt-delta'])
      expect(channel.bufferedCount).toBe(0)
    })

    it('accepts sequence restarts in a new epoch and rejects stale epochs', () => {
      const channel = new P2pTransportChannel({ peerId: 'cli_01', alias: 'wireframe-local' })
      const received: unknown[] = []
      channel.on('mcp-jsonrpc', (packet) => received.push(packet.payload))
      channel.receivePacket({ channel: 'mcp-jsonrpc', payload: 'old', seq: 10, sessionEpoch: 1, senderId: 'peer_01' })
      channel.receivePacket({ channel: 'mcp-jsonrpc', payload: 'new', seq: 1, sessionEpoch: 2, senderId: 'peer_01' })
      channel.receivePacket({ channel: 'mcp-jsonrpc', payload: 'stale', seq: 11, sessionEpoch: 1, senderId: 'peer_01' })
      expect(received).toEqual(['old', 'new'])
    })

    it('times out a stalled direct sender and retains the packet', async () => {
      const channel = new P2pTransportChannel({
        peerId: 'cli_01',
        alias: 'wireframe-local',
        directSendTimeoutMs: 10,
      })
      channel.setConnectionState(true, () => new Promise<boolean>(() => undefined))
      await expect(channel.send('mcp-jsonrpc', { request: 1 })).resolves.toBe(false)
      expect(channel.bufferedCount).toBe(1)
      channel.dispose()
    })

    it('drops queued packets after their deadline', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      const channel = new P2pTransportChannel({
        peerId: 'cli_01',
        alias: 'wireframe-local',
        packetDeadlineMs: 10,
      })
      await channel.send('mcp-jsonrpc', { request: 1 })
      vi.setSystemTime(11)
      const flushed: DataChannelPacket[] = []
      channel.setConnectionState(true, async (packet) => {
        flushed.push(packet)
        return true
      })
      expect(flushed).toHaveLength(0)
      expect(channel.bufferedCount).toBe(0)
      channel.dispose()
      vi.useRealTimers()
    })

    it('emits configured heartbeats while connected and stops after disconnect', () => {
      vi.useFakeTimers()
      const heartbeats: DataChannelPacket[] = []
      const sent: DataChannelPacket[] = []
      const channel = new P2pTransportChannel({
        peerId: 'cli_01',
        alias: 'wireframe-local',
        heartbeatIntervalMs: 20,
        onHeartbeat: (packet) => heartbeats.push(packet),
      })
      channel.setConnectionState(true, async (packet) => {
        sent.push(packet)
        return true
      })
      vi.advanceTimersByTime(41)
      expect(heartbeats).toHaveLength(2)
      expect(sent).toHaveLength(2)
      expect(sent.every((packet) => packet.channel === 'presence')).toBe(true)
      channel.setConnectionState(false)
      vi.advanceTimersByTime(100)
      expect(heartbeats).toHaveLength(2)
      channel.dispose()
      vi.useRealTimers()
    })
  })

  describe('2. WebMcpBridgeClient', () => {
    it('handles offline bridge server gracefully via store fallback', async () => {
      const client = new WebMcpBridgeClient({
        serverUrl: 'http://127.0.0.1:59999', // Guaranteed offline dummy port
        alias: 'test-peer',
        storePath: '/tmp/non-existent-peers-999.json',
      })

      const peers = await client.listPeers()
      expect(peers).toEqual({})

      const status = await client.getStatus()
      expect(status.ok).toBe(false)
      expect(status.connected).toBe(false)
    })

    it('reads from local peers store when provided valid path', async () => {
      const client = new WebMcpBridgeClient({
        serverUrl: 'http://127.0.0.1:59999',
        alias: 'wireframe-local',
      })

      const peers = await client.listPeers()
      expect(typeof peers).toBe('object')
      if (peers['wireframe-local']) {
        expect(peers['wireframe-local'].alias).toBe('wireframe-local')
      }
    })

    it('sends bearer credentials and retries only explicit peer-unavailable responses', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'PEER_UNAVAILABLE: reconnecting' }), { status: 503 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ result: { ok: true } }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      const client = new WebMcpBridgeClient({
        serverUrl: 'http://127.0.0.1:8787',
        alias: 'test-peer',
        authToken: 'secret-token',
        refreshRetryMs: 100,
        timeoutMs: 1000,
      })

      await expect(client.callTool({ tool: 'echo', args: {}, peer: 'test-peer' })).resolves.toMatchObject({ status: 'success' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[0]![1]).toMatchObject({ headers: { Authorization: 'Bearer secret-token' }, redirect: 'error' })

      fetchMock.mockReset()
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }))
      await expect(client.callTool({ tool: 'echo', peer: 'test-peer' })).resolves.toMatchObject({ status: 'error' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })
})
