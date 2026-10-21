import { getEventListeners } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudTransitClient } from '../src/index.js'

function rpcResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** A fetch that never answers on its own and rejects like undici when its signal aborts. */
function hangingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    signal?.addEventListener('abort', () => {
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('This operation was aborted', 'AbortError'))
    }, { once: true })
  }))
}

describe('CloudTransitClient cancellation and timeouts', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends nothing for an already-aborted signal and reports a cancellation', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const client = new CloudTransitClient({ serverUrl: 'http://127.0.0.1:8787', peerAlias: 'peer-a' })

    const res = await client.callTool({ tool: 'echo', signal: AbortSignal.abort() })
    expect(res).toEqual({ error: 'TOOL_CALL_CANCELLED', isError: true, status: 'error' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('removes its abort listener from a reused signal after every call', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => rpcResponse({ jsonrpc: '2.0', id: 1, result: { content: [] } })))
    const client = new CloudTransitClient({ serverUrl: 'http://127.0.0.1:8787', peerAlias: 'peer-a' })
    const controller = new AbortController()

    for (let i = 0; i < 5; i++) {
      const res = await client.callTool({ tool: 'echo', signal: controller.signal })
      expect(res.status).toBe('success')
    }
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })

  it('reports a caller abort as a cancellation, not as a timeout', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const client = new CloudTransitClient({ serverUrl: 'http://127.0.0.1:8787', peerAlias: 'peer-a', timeoutMs: 5000 })
    const controller = new AbortController()

    const pending = client.callTool({ tool: 'echo', signal: controller.signal })
    setTimeout(() => controller.abort(), 10)
    expect(await pending).toEqual({ error: 'TOOL_CALL_CANCELLED', isError: true, status: 'error' })

    const withReason = new AbortController()
    const reasoned = client.callTool({ tool: 'echo', signal: withReason.signal })
    setTimeout(() => withReason.abort(new Error('user-cancelled')), 10)
    expect((await reasoned).error).toBe('user-cancelled')
  })

  it('reports its own timeout as TOOL_CALL_TIMEOUT', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const client = new CloudTransitClient({ serverUrl: 'http://127.0.0.1:8787', peerAlias: 'peer-a' })
    const res = await client.callTool({ tool: 'echo', timeoutMs: 20 })
    expect(res).toEqual({ error: 'TOOL_CALL_TIMEOUT', isError: true, status: 'error' })
  })

  it('rejects a malformed JSON-RPC response instead of treating it as a result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => rpcResponse({ result: 'not-an-object' })))
    const client = new CloudTransitClient({ serverUrl: 'http://127.0.0.1:8787', peerAlias: 'peer-a' })
    const res = await client.callTool({ tool: 'echo' })
    expect(res.status).toBe('error')
    expect(res.error).toBe('Cloud Transit returned an invalid JSON-RPC response')
  })

  it('surfaces the error message of a non-2xx body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => rpcResponse({ error: 'Unauthorized' }, 401)))
    const client = new CloudTransitClient({ serverUrl: 'http://127.0.0.1:8787', peerAlias: 'peer-a' })
    expect(await client.callTool({ tool: 'echo' })).toEqual({ error: 'Unauthorized', isError: true, status: 'error' })
  })
})

describe('CloudTransitClient.listTools', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists tools with a JSON-RPC tools/list through /transit/:peer/mcp', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => rpcResponse({
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [{ name: 'echo', description: 'Echo' }, { name: '' }, { name: 'sum', inputSchema: { type: 'object' } }] },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new CloudTransitClient({ serverUrl: 'http://127.0.0.1:8787/', peerAlias: 'peer-a', authToken: 'secret' })

    const tools = await client.listTools()
    expect(tools).toEqual([{ name: 'echo', description: 'Echo' }, { name: 'sum', inputSchema: { type: 'object' } }])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://127.0.0.1:8787/transit/peer-a/mcp')
    expect(init?.method).toBe('POST')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret', 'X-Target-Peer': 'peer-a' })
    expect(JSON.parse(String(init?.body))).toMatchObject({ jsonrpc: '2.0', method: 'tools/list', params: {} })
  })

  it('throws on HTTP and JSON-RPC errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => rpcResponse({ error: 'METHOD_NOT_ALLOWED' }, 405)))
    const client = new CloudTransitClient({ serverUrl: 'http://127.0.0.1:8787', peerAlias: 'peer-a' })
    await expect(client.listTools()).rejects.toThrow('Failed to list tools: HTTP 405')

    vi.stubGlobal('fetch', vi.fn(async () => rpcResponse({ jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'NO_PEER' } })))
    await expect(client.listTools()).rejects.toThrow('Failed to list tools: NO_PEER')
  })

  it('gives up after the client timeout', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const client = new CloudTransitClient({ serverUrl: 'http://127.0.0.1:8787', peerAlias: 'peer-a', timeoutMs: 20 })
    await expect(client.listTools()).rejects.toThrow('Failed to list tools: request exceeded 20ms')
  })
})
