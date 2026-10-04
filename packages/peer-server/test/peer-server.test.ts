import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createPeerServer, type PeerServerInstance } from '../src/index.js'
import { WebMcpBridgeClient } from '@oa-sdk/peer-transport'

describe('@oa-sdk/peer-server — Peering & Signaling Daemon Integration', () => {
  const testPort = 8798
  const testStorePath = `/tmp/test-webmcp-peers-${Date.now()}.json`
  let peerServer: PeerServerInstance
  let client: WebMcpBridgeClient

  beforeAll(async () => {
    peerServer = createPeerServer({
      port: testPort,
      hostname: '127.0.0.1',
      storePath: testStorePath,
      defaultAlias: 'wireframe-test',
    })
    await peerServer.start()

    client = new WebMcpBridgeClient({
      serverUrl: `http://127.0.0.1:${testPort}`,
      alias: 'wireframe-test',
      storePath: testStorePath,
    })
  })

  afterAll(async () => {
    await peerServer.close()
  })

  describe('1. Server Status & Peer Registration (/announce & /status)', () => {
    it('returns empty status initially', async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/status`)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(data.connected).toBe(false)
      expect(data.toolsCount).toBe(0)
    })

    it('registers a peer via /announce and exposes it on /status', async () => {
      const announceRes = await fetch(`http://127.0.0.1:${testPort}/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alias: 'wireframe-test',
          id: 'peer_abc123',
          title: 'Framebook Wireframe Test Studio',
          origin: 'http://localhost:4500',
          cachedTools: [
            { name: 'storyboard_page_create', description: 'Create storyboard page' },
            { name: 'storyboard_screen_read', description: 'Read active screen' },
          ],
        }),
      })

      expect(announceRes.status).toBe(200)
      const announceData = await announceRes.json()
      expect(announceData.ok).toBe(true)
      expect(announceData.peer.alias).toBe('wireframe-test')

      // Query status via client
      const status = await client.getStatus()
      expect(status.ok).toBe(true)
      expect(status.toolsCount).toBe(2)

      // Query tools via client
      const tools = await client.listTools('wireframe-test')
      expect(tools).toHaveLength(2)
      expect(tools.map((t) => t.name)).toContain('storyboard_page_create')
    })
  })

  describe('2. P2P Rendezvous Descriptor Spec (/p/:id/mcp)', () => {
    it('returns rendezvous descriptor on GET /p/:id/mcp', async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/p/peer_abc123/mcp`)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.rendezvous).toBe(true)
      expect(data.protocol).toBe('webmcp-p2p')
      expect(data.peerId).toBe('peer_abc123')
      expect(data.iceServers).toBeDefined()
    })

    it('rejects POST /p/:id/mcp with 426 P2P_TRANSPORT_REQUIRED', async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/p/peer_abc123/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list' }),
      })

      expect(res.status).toBe(426)
      const data = await res.json()
      expect(data.error).toBe('P2P_TRANSPORT_REQUIRED')
    })
  })

  describe('3. Home MCP Endpoint (/home/mcp)', () => {
    it('returns service metadata on GET /home/mcp', async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/home/mcp`)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.protocolVersion).toBe('2026-07-28')
      expect(data.service).toBe('oa-sdk-home-mcp')
      expect(data.tools.map((t: any) => t.name)).toContain('home_service_status')
    })

    it('executes tools/call on Home MCP via JSON-RPC POST', async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/home/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'home_service_status',
            arguments: {},
          },
        }),
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.result.isError).toBe(false)
      expect(data.result.content[0].text).toContain('oa-sdk-peer-server')
    })
  })
})

describe('@oa-sdk/peer-server — authentication and request boundaries', () => {
  it('enforces publishKey, origin policy, and bounded request bodies', async () => {
    const secured = createPeerServer({
      port: 8799,
      hostname: '127.0.0.1',
      storePath: `/tmp/test-webmcp-secure-${Date.now()}.json`,
      publishKey: 'test-secret',
      allowedOrigins: ['http://allowed.example'],
      maxBodyBytes: 128,
    })
    await secured.start()
    try {
      const unauthorized = await fetch('http://127.0.0.1:8799/status')
      expect(unauthorized.status).toBe(401)

      const wrongOrigin = await fetch('http://127.0.0.1:8799/status', {
        headers: { authorization: 'Bearer test-secret', origin: 'http://evil.example' },
      })
      expect(wrongOrigin.status).toBe(403)

      const authorized = await fetch('http://127.0.0.1:8799/status', {
        headers: { authorization: 'Bearer test-secret', origin: 'http://allowed.example' },
      })
      expect(authorized.status).toBe(200)
      expect(authorized.headers.get('access-control-allow-origin')).toBe('http://allowed.example')

      const oversized = await fetch('http://127.0.0.1:8799/announce', {
        method: 'POST',
        headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
        body: JSON.stringify({ alias: 'peer-a', title: 'x'.repeat(512) }),
      })
      expect(oversized.status).toBe(413)
    } finally {
      await secured.close()
    }
  })
})
