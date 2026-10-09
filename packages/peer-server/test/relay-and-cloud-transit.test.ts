import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  createPeerServer,
  SignalingRoom,
  PeerRelayManager,
  CloudTransitProxy,
  handleCloudTransitWorker,
  type PeerServerInstance,
} from '../src/index.js'
import { WEBMCP_SUBPROTOCOL, type SignalMessage, type DataChannelPacket } from '@oa-sdk/peer-transport'

describe('WebMCP Peer Server — Relay & Cloud Transit', () => {
  let activeServer: PeerServerInstance | null = null

  afterEach(async () => {
    if (activeServer) {
      await activeServer.close()
      activeServer = null
    }
  })

  describe('1. Signaling Room FSM & Token Security', () => {
    it('creates a room with secure 48-hex tokens and handles claim & authentication', async () => {
      const { room, providerToken, inviteToken } = await SignalingRoom.create()
      expect(room.state.id).toMatch(/^[a-f0-9]{32}$/)
      expect(providerToken).toMatch(/^[a-f0-9]{48}$/)
      expect(inviteToken).toMatch(/^[a-f0-9]{48}$/)
      expect(room.state.phase).toBe('provider-wait')

      // Provider authenticates and attaches
      await expect(room.authenticate('provider', 'wrong-token-length')).rejects.toThrow('UNAUTHORIZED')
      await expect(room.authenticate('provider', 'a'.repeat(48))).rejects.toThrow('UNAUTHORIZED')
      await room.authenticate('provider', providerToken)

      const providerDeliveries = room.attach('provider')
      expect(providerDeliveries).toHaveLength(1)
      expect(providerDeliveries[0]!.message.type).toBe('ready')
      expect(room.state.phase).toBe('client-wait')

      // Client claims invitation
      await expect(room.claim('wrong_token', 'test-client')).rejects.toThrow('UNAUTHORIZED')
      const claimResult = await room.claim(inviteToken, 'Antigravity IDE')
      expect(claimResult.clientToken).toMatch(/^[a-f0-9]{48}$/)
      expect(room.state.phase).toBe('pending')

      // Second claim should fail with ROOM_BUSY
      await expect(room.claim(inviteToken, 'Another Client')).rejects.toThrow('ROOM_BUSY')

      // Client authenticates and attaches
      await room.authenticate('client', claimResult.clientToken)
      const clientDeliveries = room.attach('client')
      expect(clientDeliveries).toHaveLength(2)
      expect(clientDeliveries[0]!.to).toBe('client')
      expect(clientDeliveries[0]!.message.type).toBe('ready')
      expect(clientDeliveries[1]!.to).toBe('provider')
      expect(clientDeliveries[1]!.message.type).toBe('request')
    })

    it('processes decision, offer, answer, and duplex relay packets', async () => {
      const { room, providerToken, inviteToken } = await SignalingRoom.create()
      await room.authenticate('provider', providerToken)
      room.attach('provider')
      const { clientToken, requestId } = await room.claim(inviteToken, 'Client 1')
      await room.authenticate('client', clientToken)
      room.attach('client')

      // Provider approves
      const approvalDeliveries = room.receive('provider', JSON.stringify({
        type: 'decision',
        requestId,
        allow: true,
      }))
      expect(approvalDeliveries).toHaveLength(2)
      expect(approvalDeliveries[0]!.message.type).toBe('approved')
      expect(room.state.phase).toBe('approved')

      // Client offers
      const validSdp = [
        'v=0',
        'o=- 123 2 IN IP4 127.0.0.1',
        's=-',
        't=0 0',
        'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
        'c=IN IP4 0.0.0.0',
        'a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF',
        'a=ice-ufrag:u1',
        'a=ice-pwd:pwd1',
      ].join('\r\n')

      const offerDeliveries = room.receive('client', JSON.stringify({
        type: 'offer',
        requestId,
        sdp: validSdp,
      }))
      expect(offerDeliveries[0]!.to).toBe('provider')
      expect(room.state.phase).toBe('offered')

      // Provider answers
      const answerDeliveries = room.receive('provider', JSON.stringify({
        type: 'answer',
        requestId,
        sdp: validSdp,
      }))
      expect(answerDeliveries[0]!.to).toBe('client')
      expect(room.state.phase).toBe('answered')

      // Duplex packet relay (when data channel is relayed)
      const packet: DataChannelPacket = {
        channel: 'mcp-jsonrpc',
        payload: { method: 'ping' },
        id: 'p1',
        timestamp: Date.now(),
      }
      const relayed = room.receive('client', JSON.stringify({
        type: 'relay',
        packet,
      }))
      expect(relayed).toHaveLength(1)
      expect(relayed[0]!.to).toBe('provider')
      expect(relayed[0]!.message.type).toBe('relay')
    })
  })

  describe('2. WebSocket Signaling & Duplex Packet Relay (E2E)', () => {
    it('relays signaling handshakes and duplex packets between provider and client over WebSocket', async () => {
      // Find an available port by using port: 0
      activeServer = createPeerServer({
        port: 0,
        enableRelay: true,
      })
      const { port } = await activeServer.start()
      const relayManager = activeServer.relayManager!
      expect(relayManager).toBeDefined()

      // 1. Create room
      const { room, providerToken, inviteToken } = await relayManager.createRoom()
      const roomId = room.state.id

      // 2. Connect Provider WebSocket
      const providerWs = new WebSocket(`ws://127.0.0.1:${port}/p/${roomId}/provider`, [
        WEBMCP_SUBPROTOCOL,
        `ticket.${providerToken}`,
      ])

      const providerMessages: SignalMessage[] = []
      providerWs.on('message', (data) => {
        providerMessages.push(JSON.parse(data.toString('utf8')))
      })

      await new Promise<void>((resolve, reject) => {
        providerWs.on('open', () => resolve())
        providerWs.on('error', reject)
      })

      // Provider should receive ready
      await expect.poll(() => providerMessages.length).toBeGreaterThanOrEqual(1)
      expect(providerMessages[0]!.type).toBe('ready')

      // 3. Client claims invitation via POST /p/:roomId/join
      const joinRes = await fetch(`http://127.0.0.1:${port}/p/${roomId}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${inviteToken}`,
        },
        body: JSON.stringify({ clientLabel: 'Automated Test Client' }),
      })
      expect(joinRes.status).toBe(201)
      const { clientToken, requestId } = (await joinRes.json()) as { clientToken: string; requestId: string }
      expect(clientToken).toBeDefined()
      expect(requestId).toBeDefined()

      // 4. Connect Client WebSocket
      const clientWs = new WebSocket(`ws://127.0.0.1:${port}/p/${roomId}/client`, [
        WEBMCP_SUBPROTOCOL,
        `ticket.${clientToken}`,
      ])

      const clientMessages: SignalMessage[] = []
      clientWs.on('message', (data) => {
        clientMessages.push(JSON.parse(data.toString('utf8')))
      })

      await new Promise<void>((resolve, reject) => {
        clientWs.on('open', () => resolve())
        clientWs.on('error', reject)
      })

      // Client receives ready; provider receives request
      await expect.poll(() => clientMessages.length).toBeGreaterThanOrEqual(1)
      expect(clientMessages[0]!.type).toBe('ready')

      await expect.poll(() => providerMessages.length).toBeGreaterThanOrEqual(2)
      expect(providerMessages[1]!.type).toBe('request')

      // 5. Provider approves request
      providerWs.send(JSON.stringify({
        type: 'decision',
        requestId,
        allow: true,
      }))

      await expect.poll(() => clientMessages.some((m) => m.type === 'approved')).toBe(true)

      // 6. Test bidirectional packet relay
      const clientPacket: DataChannelPacket = {
        channel: 'mcp-jsonrpc',
        payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        id: 'c_pkt_1',
        timestamp: Date.now(),
      }

      clientWs.send(JSON.stringify({
        type: 'relay',
        packet: clientPacket,
      }))

      await expect.poll(() =>
        providerMessages.some((m) => m.type === 'relay' && (m as any).packet.id === 'c_pkt_1')
      ).toBe(true)

      const providerPacket: DataChannelPacket = {
        channel: 'mcp-jsonrpc',
        payload: { jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'test_tool' }] } },
        id: 'p_pkt_1',
        timestamp: Date.now(),
      }

      providerWs.send(JSON.stringify({
        type: 'relay',
        packet: providerPacket,
      }))

      await expect.poll(() =>
        clientMessages.some((m) => m.type === 'relay' && (m as any).packet.id === 'p_pkt_1')
      ).toBe(true)

      providerWs.close()
      clientWs.close()
    })
  })

  describe('3. Cloud Transit Proxy (E2E & Edge Worker)', () => {
    it('routes MCP JSON-RPC tools/list and tools/call through Cloud Transit Proxy', async () => {
      activeServer = createPeerServer({
        port: 0,
        enableCloudTransit: true,
        defaultAlias: 'demo-peer',
      })
      const { port } = await activeServer.start()

      // Register mock room with an active tool
      activeServer.roomManager.registerRoom({
        id: 'demo-room',
        alias: 'demo-peer',
        status: 'connected',
        cachedTools: [
          {
            name: 'storyboard_create_slide',
            description: 'Creates a slide in the storyboard',
          },
        ],
        updatedAt: Date.now(),
        providerSocket: {
          send: (msg) => {
            // Emulate provider returning success on tool call
            if (msg.message.method === 'tools/call') {
              activeServer!.roomManager.handleProviderMessage('demo-peer', {
                type: 'mcp',
                message: {
                  id: msg.message.id,
                  result: {
                    content: [{ type: 'text', text: 'Slide created successfully' }],
                    isError: false,
                  },
                },
              })
            }
          },
        },
      })

      // 1. POST /transit/demo-peer/mcp (initialize)
      const initRes = await fetch(`http://127.0.0.1:${port}/transit/demo-peer/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
        }),
      })
      expect(initRes.status).toBe(200)
      const initBody = await initRes.json()
      expect(initBody.result.serverInfo.name).toBe('oa-sdk-cloud-transit-proxy')

      // 2. POST /transit/demo-peer/mcp (tools/list)
      const listRes = await fetch(`http://127.0.0.1:${port}/transit/demo-peer/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
        }),
      })
      expect(listRes.status).toBe(200)
      const listBody = await listRes.json()
      expect(listBody.result.tools).toHaveLength(1)
      expect(listBody.result.tools[0].name).toBe('storyboard_create_slide')

      // 3. POST /transit/demo-peer/mcp (tools/call)
      const callRes = await fetch(`http://127.0.0.1:${port}/transit/demo-peer/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'storyboard_create_slide',
            arguments: { title: 'Intro' },
          },
        }),
      })
      expect(callRes.status).toBe(200)
      const callBody = await callRes.json()
      expect(callBody.result.isError).toBe(false)
      expect(callBody.result.content[0].text).toBe('Slide created successfully')
    })

    it('executes in Edge/Cloudflare Worker environment via handleCloudTransitWorker', async () => {
      const proxy = new CloudTransitProxy({
        roomManager: {
          getRoom: () => ({
            id: 'edge-room',
            alias: 'edge-peer',
            status: 'connected',
            cachedTools: [{ name: 'edge_render' }],
            updatedAt: Date.now(),
          }),
          executeMcpCallOnPeer: async () => ({
            content: [{ type: 'text', text: 'Rendered on edge' }],
            isError: false,
          }),
        } as any,
      })

      const req = new Request('https://transit.example.com/transit/edge-peer/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 42,
          method: 'tools/call',
          params: { name: 'edge_render' },
        }),
      })

      const workerRes = await handleCloudTransitWorker(req, proxy)
      expect(workerRes.status).toBe(200)
      const workerBody = await workerRes.json()
      expect(workerBody.id).toBe(42)
      expect(workerBody.result.content[0].text).toBe('Rendered on edge')
    })
  })

  describe('4. Fail-Closed Boundaries & Error Handling', () => {
    it('rejects unauthorized ticket upgrades with 401', async () => {
      activeServer = createPeerServer({ port: 0, enableRelay: true })
      const { port } = await activeServer.start()

      const ws = new WebSocket(`ws://127.0.0.1:${port}/p/${'a'.repeat(32)}/provider`, [
        WEBMCP_SUBPROTOCOL,
        `ticket.${'b'.repeat(48)}`,
      ])

      const result = await new Promise<{ code?: number; error?: string }>((resolve) => {
        ws.on('close', (code) => resolve({ code }))
        ws.on('error', (err) => resolve({ error: err.message }))
        ws.on('unexpected-response', (_req, res) => resolve({ code: res.statusCode }))
      })

      expect(result.code === 1008 || result.code === 401 || typeof result.error === 'string').toBe(true)
      ws.terminate()
    })

    it('rejects join requests with bodies exceeding 1024 bytes', async () => {
      activeServer = createPeerServer({ port: 0, enableRelay: true })
      const { port } = await activeServer.start()
      const { room, inviteToken } = await activeServer.relayManager!.createRoom()

      const hugeRes = await fetch(`http://127.0.0.1:${port}/p/${room.state.id}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${inviteToken}`,
        },
        body: JSON.stringify({ clientLabel: 'x'.repeat(2048) }),
      })

      expect(hugeRes.status).toBe(413)
    })
  })
})
