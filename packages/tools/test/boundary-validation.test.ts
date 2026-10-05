import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ToolHttpError,
  WebMcpPeerBridgeClient,
  createHttpApp,
  createMcpServer,
  createWebMcpPeerApp,
  defineTool,
  readToolJsonRequest,
  validateToolInput,
} from '../src/index.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const echoTool = defineTool({
  name: 'echo',
  description: 'echo',
  inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
  execute: async (_ctx, input: { value?: string }) => ({ echoed: input.value ?? null }),
})

describe('MCP JSON-RPC envelope validation', () => {
  const mcp = createMcpServer([echoTool], { name: 'boundary-test' })

  it('treats a request id of a non-protocol type as an invalid request', async () => {
    const result = await mcp.dispatcher.dispatch({ jsonrpc: '2.0', id: { nested: 1 }, method: 'tools/list' })
    expect(result.status).toBe(400)
    expect(result.response).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request: missing or invalid jsonrpc 2.0 structure' },
    })
  })

  it('rejects non-object params and echoes a valid id', async () => {
    const result = await mcp.dispatcher.dispatch({ jsonrpc: '2.0', id: 'req-1', method: 'tools/list', params: [] })
    expect(result.status).toBe(400)
    expect(result.response.id).toBe('req-1')
    expect(result.response.error?.code).toBe(-32600)
  })

  it('answers tools/call without a string name with invalid params', async () => {
    const result = await mcp.dispatcher.dispatch({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 42 } })
    expect(result.status).toBe(200)
    expect(result.response).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32602, message: 'Invalid params: tools/call requires a string name' },
    })
  })

  it('still executes a valid tools/call and maps the tool result', async () => {
    const result = await mcp.dispatcher.dispatch({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'echo', arguments: { value: 'hi' } },
    })
    expect(result.response.result).toMatchObject({
      isError: false,
      status: 'success',
      structuredContent: { echoed: 'hi' },
    })
  })

  it('validates the envelope of HTTP bodies before dispatch', async () => {
    const response = await mcp.handleFetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(['not', 'an', 'envelope']),
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ id: null, error: { code: -32600 } })
  })

  it('only forwards string MRTR fields from an input_required tool result', async () => {
    const mrtr = createMcpServer([defineTool({
      name: 'ask',
      description: 'ask',
      inputSchema: { type: 'object' },
      execute: async () => ({ status: 'input_required', continuationToken: 9, prompt: 'Which file?', content: 'not-a-list' }),
    })], { name: 'mrtr' })
    const result = await mrtr.dispatcher.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ask' } })
    expect(result.response.result).toEqual({
      content: [{ type: 'text', text: 'Which file?' }],
      status: 'input_required',
      continuationToken: undefined,
      prompt: 'Which file?',
      isError: false,
    })
  })
})

describe('HTTP request body decoding', () => {
  it('returns unknown without a schema and validates with one', async () => {
    const request = () => new Request('http://localhost', { method: 'POST', body: '[1,2]' })
    await expect(readToolJsonRequest(request(), 1024)).resolves.toEqual([1, 2])
    await expect(readToolJsonRequest(request(), 1024, {
      parse: (value) => {
        if (!Array.isArray(value)) throw new ToolHttpError(422, 'expected a list')
        return value.length
      },
    })).resolves.toBe(2)
    await expect(readToolJsonRequest(new Request('http://localhost', { method: 'POST', body: '{' }), 1024, {
      parse: (value) => value,
    })).rejects.toMatchObject({ status: 400, message: 'Invalid JSON' })
  })

  it('rejects a non-object REST body before tool validation', async () => {
    const app = createHttpApp([echoTool])
    const response = await app.request('/tools/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '"text"',
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Request body must be a JSON object' })
  })

  it('reports a configured status that cannot carry a JSON body as a tool failure', async () => {
    const app = createHttpApp([defineTool({
      name: 'noContent',
      description: 'noContent',
      inputSchema: { type: 'object' },
      api: { statusCodes: { success: 204 } },
      execute: async () => ({ ok: true }),
    })])
    const response = await app.request('/tools/noContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Tool execution failed') })
  })
})

describe('custom validator objects', () => {
  it('reads safeParse errors that are not Error instances', () => {
    const schema = { safeParse: () => ({ success: false as const, error: { message: 'bad shape' } }) }
    expect(validateToolInput(schema, {})).toEqual({ success: false, error: 'bad shape' })
    const opaque = { safeParse: () => ({ success: false as const, error: 'nope' }) }
    expect(validateToolInput(opaque, {})).toEqual({ success: false, error: 'nope' })
  })

  it('formats zod-like issues with their paths', () => {
    const zodLike = {
      _zod: {},
      safeParse: () => ({ success: false, error: { issues: [{ path: ['user', 0], message: 'Required' }, { path: [], message: 'Bad' }] } }),
    }
    expect(validateToolInput(zodLike, {})).toEqual({ success: false, error: 'user.0: Required, input: Bad' })
  })
})

describe('WebMCP peer bridge fallback client', () => {
  let directory: string
  let storePath: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tools-peer-boundary-'))
    storePath = join(directory, 'peers.json')
    await writeFile(storePath, JSON.stringify({
      peers: {
        'wireframe-test': { alias: 'wireframe-test', token: 'secret', status: 'connected', cachedTools: [{ name: 'cached' }, { name: 5 }] },
      },
    }))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(directory, { recursive: true, force: true })
  })

  it('reads typed peer fields from the registry and never surfaces credentials', async () => {
    const client = new WebMcpPeerBridgeClient({ alias: 'wireframe-test', storePath })
    const peer = await client.resolvePeer()
    expect(peer).toEqual({ alias: 'wireframe-test', status: 'connected', cachedTools: [{ name: 'cached' }] })
  })

  it('validates bridge status and tool catalogs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => (
      url.includes('/tools')
        ? jsonResponse({ tools: [{ name: 'live', inputSchema: [] }, { description: 'nameless' }] })
        : jsonResponse({ ok: true, connected: true, peers: { 'wireframe-test': { alias: 'wireframe-test', token: 'secret' } } })
    )))
    const client = new WebMcpPeerBridgeClient({ alias: 'wireframe-test', storePath })

    await expect(client.listTools()).resolves.toEqual([
      { name: 'live', description: 'WebMCP tool live', inputSchema: { type: 'object', properties: {} } },
    ])
    await expect(client.getStatus()).resolves.toEqual({ ok: true, connected: true, peers: [{ alias: 'wireframe-test' }] })
  })

  it('falls back to the registry when the bridge status is not an object', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse('ready')))
    const client = new WebMcpPeerBridgeClient({ alias: 'wireframe-test', storePath })
    await expect(client.getStatus()).resolves.toMatchObject({ ok: true, activeAlias: 'wireframe-test', connected: true })
  })

  it('rejects malformed meta-tool and peer-tool arguments with a clear error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => (
      url.includes('/tools') ? jsonResponse({ tools: [{ name: 'live' }] }) : jsonResponse({ result: { ok: true } })
    )))
    const app = await createWebMcpPeerApp({ alias: 'wireframe-test', storePath, serverUrl: 'http://127.0.0.1:8787' })
    const ctx = { requestId: 't', logger: console }

    await expect(app.getTool('webmcp_call')!.execute(ctx, { tool: '' })).rejects.toThrow('webmcp_call requires a tool name')
    await expect(app.getTool('webmcp_call')!.execute(ctx, { tool: 'live', args: [] })).rejects.toThrow('webmcp_call args must be an object')
    await expect(app.getTool('live')!.execute(ctx, 'text')).rejects.toThrow('Peer tool arguments must be an object')
    await expect(app.getTool('live')!.execute(ctx, undefined)).resolves.toEqual({ ok: true })
  })
})
