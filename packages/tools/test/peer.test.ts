import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebMcpPeerBridgeClient, createWebMcpPeerApp } from '../src/index.js'

describe('@oa-sdk/tools — WebMCP Peer Bridge', () => {
  let mockServer: Server
  let serverPort: number
  let serverUrl: string
  let tempDir: string
  let storePath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webmcp-peer-test-'))
    storePath = join(tempDir, 'peers.json')

    await writeFile(
      storePath,
      JSON.stringify({
        activeAlias: 'wireframe-test',
        peers: {
          'wireframe-test': {
            alias: 'wireframe-test',
            title: 'Test Storyboard',
            status: 'connected',
            cachedTools: [
              {
                name: 'storyboard_context_get',
                description: 'Get storyboard context',
                inputSchema: { type: 'object', properties: {} },
              },
            ],
          },
        },
      }),
      'utf-8',
    )
  })

  afterEach(async () => {
    if (mockServer) {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()))
    }
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('resolves peer record from peer store file', async () => {
    const client = new WebMcpPeerBridgeClient({
      alias: 'wireframe-test',
      storePath,
    })

    const peer = await client.resolvePeer('wireframe-test')
    expect(peer).not.toBeNull()
    expect(peer?.title).toBe('Test Storyboard')
    expect(peer?.cachedTools?.length).toBe(1)
  })

  it('buffers and retries during simulated browser refresh (503 -> 200)', async () => {
    let callAttempts = 0
    let authorization: string | undefined

    mockServer = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${serverPort}`)
      if (url.pathname === '/call' && req.method === 'POST') {
        callAttempts++
        authorization = req.headers.authorization
        if (callAttempts === 1) {
          // Simulate browser F5 refreshing (not ready yet)
          res.writeHead(503, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'PEER_UNAVAILABLE: reconnecting', message: 'Browser tab reconnecting...' }))
          return
        }
        // Second attempt: browser reconnected!
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, result: { frameCount: 3 } }))
        return
      }
      res.writeHead(404)
      res.end()
    })

    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        const addr = mockServer.address() as any
        serverPort = addr.port
        serverUrl = `http://127.0.0.1:${serverPort}`
        resolve()
      })
    })

    const client = new WebMcpPeerBridgeClient({
      serverUrl,
      alias: 'wireframe-test',
      storePath,
      refreshRetryMs: 2000,
      authToken: 'bridge-secret',
    })

    const result = await client.callTool('storyboard_context_get')
    expect(callAttempts).toBe(2)
    expect(authorization).toBe('Bearer bridge-secret')
    expect(result).toEqual({ frameCount: 3 })
  })

  it('does not retry a 404 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new WebMcpPeerBridgeClient({
      serverUrl: 'http://127.0.0.1:8787',
      alias: 'wireframe-test',
      refreshRetryMs: 100,
    })

    await expect(client.callTool('storyboard_context_get')).rejects.toThrow('Not found')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry an unrelated 503 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'PEER_REFRESHING', message: 'Browser tab reconnecting...' }), { status: 503 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = new WebMcpPeerBridgeClient({
      serverUrl: 'http://127.0.0.1:8787',
      alias: 'wireframe-test',
      refreshRetryMs: 100,
    })

    await expect(client.callTool('storyboard_context_get')).rejects.toThrow('PEER_REFRESHING')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry a network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)
    const client = new WebMcpPeerBridgeClient({
      serverUrl: 'http://127.0.0.1:8787',
      alias: 'wireframe-test',
      refreshRetryMs: 100,
    })

    await expect(client.callTool('storyboard_context_get')).rejects.toThrow('fetch failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry a request timeout', async () => {
    const timeoutError = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    const fetchMock = vi.fn().mockRejectedValue(timeoutError)
    vi.stubGlobal('fetch', fetchMock)
    const client = new WebMcpPeerBridgeClient({
      serverUrl: 'http://127.0.0.1:8787',
      alias: 'wireframe-test',
      timeoutMs: 25,
      refreshRetryMs: 100,
    })

    await expect(client.callTool('storyboard_context_get')).rejects.toThrow('Tool call timeout after 25ms')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('creates ToolApp with meta-tools and registered peer tools', async () => {
    const app = await createWebMcpPeerApp({
      serverUrl: 'http://127.0.0.1:9999', // offline
      alias: 'wireframe-test',
      storePath,
    })

    const tools = app.getTools()
    const names = tools.map((t) => t.name)

    expect(names).toContain('webmcp_list_peers')
    expect(names).toContain('webmcp_peer_status')
    expect(names).toContain('webmcp_call')
    // Discovered from cachedTools
    expect(names).toContain('storyboard_context_get')
  })
})
