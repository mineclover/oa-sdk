import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  createPeerServer,
  type PeerServerInstance,
} from '../src/index.js'
import {
  P2pTransportChannel,
  createWebSocketTransportAdapter,
  createCloudTransitClient,
  type DataChannelPacket,
  WEBMCP_SUBPROTOCOL,
} from '@oa-sdk/peer-transport'

describe('WebMCP Relay & Cloud Transit — Comprehensive Integration & Resilience Test', () => {
  let activeServer: PeerServerInstance | null = null

  afterEach(async () => {
    if (activeServer) {
      await activeServer.close()
      activeServer = null
    }
  })

  describe('1. Full Duplex Provider <-> Relay <-> Client over WebSocketTransportAdapter', () => {
    it('establishes room, connects two P2pTransportChannels via WebSocketTransportAdapter, and exchanges packets on all 3 channels', async () => {
      activeServer = createPeerServer({
        port: 0,
        enableRelay: true,
      })
      const { port } = await activeServer.start()
      const relayManager = activeServer.relayManager!
      expect(relayManager).toBeDefined()

      // 1. Create Room on Server
      const { room, providerToken, inviteToken } = await relayManager.createRoom()
      const roomId = room.state.id

      // 2. Setup Provider Channel & WebSocket Transport Adapter
      const providerChannel = new P2pTransportChannel({
        peerId: 'provider-host-01',
        alias: 'wireframe-local',
      })

      const providerReceivedPackets: DataChannelPacket[] = []
      providerChannel.on('*', (pkt) => {
        providerReceivedPackets.push(pkt)
      })

      let providerApproved = false
      const providerAdapter = createWebSocketTransportAdapter(providerChannel, {
        url: `ws://127.0.0.1:${port}/p/${roomId}/provider`,
        tokenOrTicket: providerToken,
        onSignal: (signal) => {
          if (signal.type === 'request') {
            // Automatically approve incoming client request
            void providerAdapter.sendSignal({
              type: 'decision',
              requestId: signal.requestId,
              allow: true,
            })
          } else if (signal.type === 'approved') {
            providerApproved = true
          }
        },
      })

      await providerAdapter.connect()
      expect(providerAdapter.isConnected).toBe(true)

      // 3. Client claims invitation via POST /p/:roomId/join
      const joinRes = await fetch(`http://127.0.0.1:${port}/p/${roomId}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${inviteToken}`,
        },
        body: JSON.stringify({ clientLabel: 'Antigravity IDE Assistant' }),
      })
      expect(joinRes.status).toBe(201)
      const { clientToken } = (await joinRes.json()) as { clientToken: string; requestId: string }

      // 4. Setup Client Channel & WebSocket Transport Adapter
      const clientChannel = new P2pTransportChannel({
        peerId: 'agent-client-01',
        alias: 'agent-assistant',
      })

      const clientReceivedPackets: DataChannelPacket[] = []
      clientChannel.on('*', (pkt) => {
        clientReceivedPackets.push(pkt)
      })

      let clientApproved = false
      const clientAdapter = createWebSocketTransportAdapter(clientChannel, {
        url: `ws://127.0.0.1:${port}/p/${roomId}/client`,
        tokenOrTicket: clientToken,
        onSignal: (signal) => {
          if (signal.type === 'approved') {
            clientApproved = true
          }
        },
      })

      await clientAdapter.connect()
      expect(clientAdapter.isConnected).toBe(true)

      // Wait for approval handshake
      await expect.poll(() => providerApproved && clientApproved).toBe(true)

      // 5. Channel 1: mcp-jsonrpc tool call from client to provider
      const sentMcp = await clientChannel.send('mcp-jsonrpc', {
        jsonrpc: '2.0',
        id: 101,
        method: 'tools/call',
        params: { name: 'artboard_insert_frame', arguments: { width: 1440, height: 900 } },
      })
      expect(sentMcp).toBe(true)

      await expect.poll(() => providerReceivedPackets.length).toBeGreaterThanOrEqual(1)
      const receivedToolCall = providerReceivedPackets.find((p) => p.channel === 'mcp-jsonrpc')
      expect(receivedToolCall).toBeDefined()
      expect(receivedToolCall!.payload).toEqual({
        jsonrpc: '2.0',
        id: 101,
        method: 'tools/call',
        params: { name: 'artboard_insert_frame', arguments: { width: 1440, height: 900 } },
      })

      // Provider responds to tool call
      await providerChannel.send('mcp-jsonrpc', {
        jsonrpc: '2.0',
        id: 101,
        result: { content: [{ type: 'text', text: 'Frame created' }], isError: false },
      })

      await expect.poll(() => clientReceivedPackets.some((p) => p.channel === 'mcp-jsonrpc')).toBe(true)
      const clientMcpResponse = clientReceivedPackets.find((p) => p.channel === 'mcp-jsonrpc')
      expect((clientMcpResponse?.payload as any)?.result?.content[0]?.text).toBe('Frame created')

      // 6. Channel 2: crdt-delta from provider to client
      await providerChannel.send('crdt-delta', {
        docId: 'doc_artboard_1',
        delta: { insert: 'Frame 1', attributes: { bold: true } },
      })

      await expect.poll(() => clientReceivedPackets.some((p) => p.channel === 'crdt-delta')).toBe(true)
      const crdtPacket = clientReceivedPackets.find((p) => p.channel === 'crdt-delta')
      expect((crdtPacket?.payload as any)?.docId).toBe('doc_artboard_1')

      // 7. Channel 3: presence from client to provider
      await clientChannel.send('presence', {
        user: 'junwoo',
        cursor: { x: 450, y: 320 },
      })

      await expect.poll(() => providerReceivedPackets.some((p) => p.channel === 'presence')).toBe(true)
      const presencePacket = providerReceivedPackets.find((p) => p.channel === 'presence')
      expect((presencePacket?.payload as any)?.cursor).toEqual({ x: 450, y: 320 })

      // Clean teardown
      providerAdapter.dispose()
      clientAdapter.dispose()
      providerChannel.dispose()
      clientChannel.dispose()
    })
  })

  describe('2. Disconnection, Resilient Buffering, and Priority Reconnection Flush', () => {
    it('buffers packets when connection drops and flushes in strict priority order (mcp -> crdt -> presence)', async () => {
      const channel = new P2pTransportChannel({
        peerId: 'client-resilience-01',
        alias: 'resilient-peer',
        bufferLimit: 50,
      })

      expect(channel.isConnected).toBe(false)

      // Send lower priority presence first, then crdt, then highest priority mcp
      await channel.send('presence', { cursor: { x: 10, y: 10 } })
      await channel.send('crdt-delta', { change: 'v1' })
      await channel.send('mcp-jsonrpc', { jsonrpc: '2.0', id: 1, method: 'tools/call' })
      await channel.send('crdt-delta', { change: 'v2' })
      await channel.send('mcp-jsonrpc', { jsonrpc: '2.0', id: 2, method: 'tools/call' })

      expect(channel.bufferedCount).toBe(5)

      // Reconnect and capture flushed order
      const flushedOrder: Array<{ channel: string; id?: any }> = []
      channel.setConnectionState(true, async (pkt) => {
        flushedOrder.push({
          channel: pkt.channel,
          id: (pkt.payload as any)?.id ?? (pkt.payload as any)?.change ?? (pkt.payload as any)?.cursor,
        })
        return true
      })

      expect(channel.isConnected).toBe(true)
      expect(channel.bufferedCount).toBe(0)
      expect(flushedOrder).toHaveLength(5)

      // Priority Invariant: All mcp-jsonrpc packets must come first, followed by crdt-delta, then presence
      expect(flushedOrder[0]!.channel).toBe('mcp-jsonrpc')
      expect(flushedOrder[1]!.channel).toBe('mcp-jsonrpc')
      expect(flushedOrder[2]!.channel).toBe('crdt-delta')
      expect(flushedOrder[3]!.channel).toBe('crdt-delta')
      expect(flushedOrder[4]!.channel).toBe('presence')

      channel.dispose()
    })
  })

  describe('3. Cloud Transit Proxy & CloudTransitClient E2E (Concurrence, Error, Timeout)', () => {
    it('handles concurrent tool calls, timeouts, and error propagation via Cloud Transit Proxy', async () => {
      activeServer = createPeerServer({
        port: 0,
        enableCloudTransit: true,
        defaultAlias: 'wireframe-cloud',
      })
      const { port } = await activeServer.start()

      let callCounter = 0
      activeServer.roomManager.registerRoom({
        id: 'wireframe-room',
        alias: 'wireframe-cloud',
        status: 'connected',
        cachedTools: [
          { name: 'fast_calc', description: 'Computes fast value' },
          { name: 'slow_calc', description: 'Simulates slow operation' },
          { name: 'failing_tool', description: 'Always fails' },
        ],
        updatedAt: Date.now(),
        providerSocket: {
          send: (msg) => {
            const toolName = msg.message.params.name
            const id = msg.message.id

            if (toolName === 'fast_calc') {
              callCounter++
              activeServer!.roomManager.handleProviderMessage('wireframe-cloud', {
                type: 'mcp',
                message: {
                  id,
                  result: {
                    content: [{ type: 'text', text: `Result ${msg.message.params.arguments.val}` }],
                  },
                },
              })
            } else if (toolName === 'slow_calc') {
              // Delayed response
              setTimeout(() => {
                activeServer!.roomManager.handleProviderMessage('wireframe-cloud', {
                  type: 'mcp',
                  message: {
                    id,
                    result: { content: [{ type: 'text', text: 'Slow done' }] },
                  },
                })
              }, 150)
            } else if (toolName === 'failing_tool') {
              activeServer!.roomManager.handleProviderMessage('wireframe-cloud', {
                type: 'mcp',
                message: {
                  id,
                  error: { code: -32000, message: 'DATABASE_LOCKED' },
                },
              })
            }
          },
        },
      })

      const client = createCloudTransitClient({
        serverUrl: `http://127.0.0.1:${port}`,
        peerAlias: 'wireframe-cloud',
      })

      // 1. tools/list
      const tools = await client.listTools()
      expect(tools).toHaveLength(3)
      expect(tools.map((t) => t.name)).toContain('fast_calc')

      // 2. Concurrent Execution: 10 parallel fast calls
      const concurrentCalls = Array.from({ length: 10 }, (_, i) =>
        client.callTool({
          tool: 'fast_calc',
          args: { val: i },
        })
      )
      const results = await Promise.all(concurrentCalls)
      expect(results).toHaveLength(10)
      for (const res of results) {
        expect(res.status).toBe('success')
        expect(res.isError).toBe(false)
      }
      expect(callCounter).toBe(10)

      // 3. Error propagation
      const failRes = await client.callTool({
        tool: 'failing_tool',
      })
      expect(failRes.status).toBe('error')
      expect(failRes.isError).toBe(true)
      expect(failRes.error).toBe('DATABASE_LOCKED')

      // 4. Client Timeout via AbortSignal / timeoutMs
      const timeoutRes = await client.callTool({
        tool: 'slow_calc',
        timeoutMs: 30, // Shorter than 150ms delay
      })
      expect(timeoutRes.status).toBe('error')
      expect(timeoutRes.isError).toBe(true)
      expect(timeoutRes.error).toBe('TOOL_CALL_TIMEOUT')
    })
  })

  describe('4. Adversarial Boundaries & Security Invariants', () => {
    it('prevents replay attacks on invitation claim tokens', async () => {
      activeServer = createPeerServer({ port: 0, enableRelay: true })
      const { port } = await activeServer.start()
      const { room, providerToken, inviteToken } = await activeServer.relayManager!.createRoom()
      // Provider attaches first so room moves from provider-wait to client-wait
      await room.authenticate('provider', providerToken)
      room.attach('provider')

      // First claim succeeds
      const firstClaim = await fetch(`http://127.0.0.1:${port}/p/${room.state.id}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${inviteToken}`,
        },
        body: JSON.stringify({ clientLabel: 'Valid Client' }),
      })
      expect(firstClaim.status).toBe(201)

      // Second claim with SAME inviteToken MUST be rejected (401 or 409 ROOM_BUSY)
      const secondClaim = await fetch(`http://127.0.0.1:${port}/p/${room.state.id}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${inviteToken}`,
        },
        body: JSON.stringify({ clientLabel: 'Replay Attacker' }),
      })
      expect(secondClaim.status).toBe(409)
      const body = await secondClaim.json()
      expect(body.error).toBe('ROOM_BUSY')
    })

    it('enforces frame limits against signaling frame floods', async () => {
      activeServer = createPeerServer({ port: 0, enableRelay: true })
      const { port } = await activeServer.start()
      const { room, providerToken, inviteToken } = await activeServer.relayManager!.createRoom()

      // Provider connects
      const ws = new WebSocket(`ws://127.0.0.1:${port}/p/${room.state.id}/provider`, [
        WEBMCP_SUBPROTOCOL,
        `ticket.${providerToken}`,
      ])

      await new Promise<void>((resolve) => {
        ws.on('open', resolve)
      })

      // Client claims invitation to establish a valid requestId in room
      const claimRes = await fetch(`http://127.0.0.1:${port}/p/${room.state.id}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${inviteToken}`,
        },
        body: JSON.stringify({ clientLabel: 'Flood Tester' }),
      })
      const { requestId } = (await claimRes.json()) as { requestId: string }

      let closedReason = ''
      ws.on('close', (_code, reason) => {
        closedReason = reason.toString('utf8')
      })

      // Send signals with matching requestId until frame limit (>32) is reached
      for (let i = 0; i < 35; i++) {
        try {
          ws.send(JSON.stringify({ type: 'decision', requestId, allow: true }))
        } catch {}
      }

      await expect.poll(() => closedReason.length > 0).toBe(true)
      expect(closedReason.includes('SIGNAL_LIMIT') || closedReason.includes('WRONG_PHASE')).toBe(true)
      ws.terminate()
    })
  })
})
