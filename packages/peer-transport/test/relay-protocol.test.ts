import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseSignalMessage,
  validateSdp,
  isRelayPacket,
  P2pTransportChannel,
  createWebSocketTransportAdapter,
  createCloudTransitClient,
  CloudTransitClient,
  type DataChannelPacket,
} from '../src/index.js'

describe('relay-protocol & adapters', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('1. parseSignalMessage & validation', () => {
    it('parses valid ready, request, decision, and relay messages', () => {
      const ready = parseSignalMessage(JSON.stringify({ type: 'ready', role: 'provider', roomId: 'r1', requestId: null }))
      expect(ready.type).toBe('ready')

      const req = parseSignalMessage(JSON.stringify({ type: 'request', roomId: 'r1', requestId: 'req1', clientLabel: 'CLI', identity: 'user_1' }))
      expect(req.type).toBe('request')

      const decision = parseSignalMessage(JSON.stringify({ type: 'decision', requestId: 'req1', allow: true, allowedTools: ['tool1'] }))
      expect(decision.type).toBe('decision')

      const relay = parseSignalMessage(JSON.stringify({
        type: 'relay',
        packet: { channel: 'mcp-jsonrpc', payload: { test: true }, id: 'p1', timestamp: 1000 },
      }))
      expect(relay.type).toBe('relay')
    })

    it('rejects malformed messages and unknown types', () => {
      expect(() => parseSignalMessage('not-json')).toThrow('BAD_SIGNAL')
      expect(() => parseSignalMessage(JSON.stringify({ type: 'unknown_type' }))).toThrow('UNKNOWN_SIGNAL_TYPE')
      expect(() => parseSignalMessage(JSON.stringify({ type: 'ready', role: 'invalid' }))).toThrow('BAD_ROLE')
      expect(() => parseSignalMessage(JSON.stringify({ type: 'request', roomId: 'r1' }))).toThrow('BAD_REQUEST_ID')
    })

    it('enforces payload size limits (64KB for signal, 1MB for relay)', () => {
      const hugeSignal = JSON.stringify({ type: 'ready', role: 'provider', roomId: 'a'.repeat(70 * 1024), requestId: null })
      expect(() => parseSignalMessage(hugeSignal)).toThrow('SIGNAL_TOO_LARGE')

      const hugeRelay = JSON.stringify({
        type: 'relay',
        packet: { channel: 'mcp-jsonrpc', payload: 'a'.repeat(1024 * 1024 + 100) },
      })
      expect(() => parseSignalMessage(hugeRelay)).toThrow('RELAY_PAYLOAD_TOO_LARGE')
    })
  })

  describe('2. validateSdp', () => {
    const validSdp = [
      'v=0',
      'o=- 123456 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      'a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF',
      'a=ice-ufrag:testufrag',
      'a=ice-pwd:testpassword12345678',
    ].join('\r\n')

    it('accepts valid DataChannel-only SDP', () => {
      expect(() => validateSdp(validSdp)).not.toThrow()
    })

    it('rejects SDP containing audio/video media streams', () => {
      const audioSdp = validSdp + '\r\nm=audio 54321 RTP/SAVPF 111'
      expect(() => validateSdp(audioSdp)).toThrow('DATA_CHANNEL_ONLY')
    })

    it('rejects SDP without DTLS fingerprint or ICE credentials', () => {
      const noDtls = validSdp.replace(/a=fingerprint:.*\r?\n/, '')
      expect(() => validateSdp(noDtls)).toThrow('DTLS_REQUIRED')

      const noIce = validSdp.replace(/a=ice-ufrag:.*\r?\n/, '')
      expect(() => validateSdp(noIce)).toThrow('ICE_REQUIRED')
    })
  })

  describe('3. isRelayPacket', () => {
    it('accurately identifies data channel packets', () => {
      expect(isRelayPacket({ channel: 'mcp-jsonrpc', payload: {} })).toBe(true)
      expect(isRelayPacket({ channel: 'crdt-delta', payload: {} })).toBe(true)
      expect(isRelayPacket({ channel: 'presence', payload: {} })).toBe(true)
      expect(isRelayPacket({ channel: 'audio-stream', payload: {} })).toBe(false)
      expect(isRelayPacket(null)).toBe(false)
      expect(isRelayPacket({ notAChannel: true })).toBe(false)
    })
  })

  describe('4. WebSocketTransportAdapter', () => {
    class MockWebSocket {
      static OPEN = 1
      static CLOSED = 3
      readyState = MockWebSocket.OPEN
      sentMessages: string[] = []
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onclose: (() => void) | null = null
      onerror: ((event: unknown) => void) | null = null

      constructor(public url: string, public protocols?: string[]) {
        setTimeout(() => {
          this.onopen?.()
        }, 10)
      }

      send(data: string) {
        this.sentMessages.push(data)
      }

      close() {
        this.readyState = MockWebSocket.CLOSED
        this.onclose?.()
      }
    }

    it('attaches to P2pTransportChannel and transmits packets enveloped in relay frames', async () => {
      const channel = new P2pTransportChannel({ peerId: 'client-1', alias: 'client' })
      let mockWsInstance: MockWebSocket | null = null

      const adapter = createWebSocketTransportAdapter(channel, {
        url: 'ws://127.0.0.1:8787/ws',
        tokenOrTicket: 'test-ticket-xyz',
        webSocketClass: function (url, proto) {
          mockWsInstance = new MockWebSocket(url, proto)
          return mockWsInstance as unknown as WebSocket
        } as unknown as typeof WebSocket,
      })

      await adapter.connect()
      expect(adapter.isConnected).toBe(true)
      expect(channel.isConnected).toBe(true)

      // Send packet through channel
      await channel.send('mcp-jsonrpc', { jsonrpc: '2.0', method: 'ping' })

      expect(mockWsInstance!.sentMessages).toHaveLength(1)
      const rawSent = JSON.parse(mockWsInstance!.sentMessages[0]!)
      expect(rawSent.type).toBe('relay')
      expect(rawSent.packet.channel).toBe('mcp-jsonrpc')
      expect(rawSent.packet.payload).toEqual({ jsonrpc: '2.0', method: 'ping' })

      // Inbound relay packet from mock socket
      const inboundPacket: DataChannelPacket = {
        channel: 'presence',
        payload: { user: 'alice', online: true },
        id: 'p_99',
        timestamp: Date.now(),
      }

      let receivedPacket: DataChannelPacket | null = null
      channel.on('*', (pkt) => {
        receivedPacket = pkt
      })

      mockWsInstance!.onmessage?.({
        data: JSON.stringify({
          type: 'relay',
          packet: inboundPacket,
        }),
      })

      expect(receivedPacket).not.toBeNull()
      expect((receivedPacket as any)?.channel).toBe('presence')
      expect((receivedPacket as any)?.payload).toEqual({ user: 'alice', online: true })

      adapter.dispose()
      expect(channel.isConnected).toBe(false)
    })
  })

  describe('5. CloudTransitClient', () => {
    it('executes tool call via HTTP POST /transit/:peer/mcp', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{ type: 'text', text: 'Created storyboard page page_1' }],
          },
        }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const client = createCloudTransitClient({
        serverUrl: 'http://127.0.0.1:8787',
        peerAlias: 'wireframe-local',
        authToken: 'pub_secret_key',
      })

      const res = await client.callTool({
        tool: 'storyboard_page_create',
        args: { title: 'Home' },
      })

      expect(res.status).toBe('success')
      expect(res.isError).toBe(false)
      expect(res.result).toEqual({
        content: [{ type: 'text', text: 'Created storyboard page page_1' }],
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8787/transit/wireframe-local/mcp',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json; charset=utf-8',
            'X-Target-Peer': 'wireframe-local',
            Authorization: 'Bearer pub_secret_key',
          }),
        }),
      )
    })

    it('handles RPC error responses gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32601,
            message: 'Tool not found',
          },
        }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const client = new CloudTransitClient({
        serverUrl: 'http://127.0.0.1:8787',
        peerAlias: 'wireframe-local',
      })

      const res = await client.callTool({
        tool: 'nonexistent_tool',
      })

      expect(res.status).toBe('error')
      expect(res.isError).toBe(true)
      expect(res.error).toBe('Tool not found')
    })
  })
})
