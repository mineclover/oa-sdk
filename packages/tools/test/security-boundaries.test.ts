import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createHttpApp, createMcpServer, createToolApp, defineTool, validateToolInput } from '../src/index.js'

describe('@oa-sdk/tools security boundaries', () => {
  it('enforces object shape, enum, integer, and nested schema constraints', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'count'],
      properties: {
        kind: { type: 'string', enum: ['delta', 'snapshot'] },
        count: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    } as const

    expect(validateToolInput(schema, { kind: 'delta', count: 2, tags: ['a'] }).success).toBe(true)
    expect(validateToolInput(schema, { kind: 'other', count: 2 }).success).toBe(false)
    expect(validateToolInput(schema, { kind: 'delta', count: 2.5 }).success).toBe(false)
    expect(validateToolInput(schema, { kind: 'delta', count: 2, extra: true }).success).toBe(false)
  })

  it('rejects malformed or oversized HTTP bodies before tool execution', async () => {
    let executions = 0
    const app = createHttpApp([
      defineTool({
        name: 'mutate',
        description: 'mutate',
        inputSchema: { type: 'object', additionalProperties: false },
        execute: async () => {
          executions += 1
          return { ok: true }
        },
      }),
    ], { maxBodyBytes: 32 })

    const malformed = await app.request('/tools/mutate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })
    expect(malformed.status).toBe(400)

    const oversized = await app.request('/tools/mutate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(100) }),
    })
    expect(oversized.status).toBe(413)
    expect(executions).toBe(0)
  })

  it('requires the configured bearer token for fetch and stateless MCP calls', async () => {
    const tool = defineTool({
      name: 'read',
      description: 'read',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ ok: true }),
    })
    const http = createHttpApp([tool], { authToken: 'test-secret' })
    expect((await http.request('/tools/read', { method: 'POST', body: '{}' })).status).toBe(401)
    expect((await http.request('/tools/read', { method: 'POST', headers: { authorization: 'Bearer test-secret' }, body: '{}' })).status).toBe(200)
    const mcpRouteUnauthorized = await http.request('/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/list' }),
    })
    expect(mcpRouteUnauthorized.status).toBe(401)
    expect((await mcpRouteUnauthorized.json()).jsonrpc).toBe('2.0')

    const mcp = createMcpServer([tool], { name: 'secure-mcp', authToken: 'test-secret' })
    const unauthorized = await mcp.handleFetch(new Request('http://localhost/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }))
    expect(unauthorized.status).toBe(401)
    const authorized = await mcp.handleFetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    }))
    expect(authorized.status).toBe(200)
  })

  it('protects schema and docs while making the public health policy explicit', async () => {
    const securedTool = defineTool({
      name: 'read',
      description: 'read',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ ok: true }),
    })
    const http = createHttpApp([securedTool], { authToken: 'test-secret' })
    expect((await http.request('/openapi.json')).status).toBe(401)
    expect((await http.request('/docs')).status).toBe(401)
    expect((await http.request('/health')).status).toBe(200)

    const openapi = await http.request('/openapi.json', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const document = await openapi.json()
    expect(document.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    })
    expect(document.paths['/tools/read'].post.security).toEqual([{ bearerAuth: [] }])
    expect(document.paths['/api/v1/tools/read'].post.security).toEqual([{ bearerAuth: [] }])
    expect(document.paths['/mcp'].post.security).toEqual([{ bearerAuth: [] }])

    const protectedHealth = createHttpApp([], { authToken: 'test-secret', publicHealth: false })
    expect((await protectedHealth.request('/health')).status).toBe(401)
    expect(
      (await protectedHealth.request('/health', { headers: { authorization: 'Bearer test-secret' } })).status,
    ).toBe(200)
  })

  it('keeps MCP execution errors safe and returns a closeable HTTP handle', async () => {
    const mcp = createMcpServer(
      [
        defineTool({
          name: 'explode',
          description: 'throws',
          inputSchema: { type: 'object', properties: {} },
          execute: async () => {
            throw new Error('database password=secret')
          },
        }),
      ],
      { name: 'secure-mcp' },
    )

    const response = await mcp.handleFetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'explode', arguments: {} },
        }),
      }),
    )
    const body = await response.json()
    expect(body.result.content[0].text).toMatch(/^Tool execution failed \(requestId: /)
    expect(body.result.content[0].text).not.toContain('database password')

    const server = await mcp.serveHttp({ port: 0, hostname: '127.0.0.1' })
    expect(server.listening).toBe(true)
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  })

  it('keeps declared tool status codes aligned with runtime responses and OpenAPI', async () => {
    const app = createHttpApp([
      defineTool({
        name: 'create',
        description: 'create',
        api: { path: '/create', method: 'POST', statusCodes: { created: 201, validationError: 422, serverError: 503 } },
        inputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'string' } } },
        execute: async (_ctx, input: any) => ({ value: input.value }),
      }),
    ])
    expect((await app.request('/create', { method: 'POST', body: '{}' })).status).toBe(422)
    expect((await app.request('/create', { method: 'POST', body: JSON.stringify({ value: 'ok' }) })).status).toBe(201)
    const spec = await (await app.request('/openapi.json')).json()
    expect(spec.paths['/create'].post.responses['201']).toBeDefined()
    expect(spec.paths['/create'].post.responses['422']).toBeDefined()
    expect(spec.paths['/create'].post.responses['503']).toBeDefined()
  })

  it('forwards MCP security options through ToolApp route mounting', async () => {
    const app = createToolApp({ name: 'forwarding-app' }).tools(
      defineTool({
        name: 'read',
        description: 'read',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({ ok: true }),
      }),
    )
    const hono = new Hono()
    app.mountMcpRoute(hono, '/custom-mcp', {
      authToken: 'route-secret',
      allowedOrigins: ['https://client.example'],
      maxBodyBytes: 128,
    })

    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect((await hono.request('/custom-mcp', { method: 'POST', body })).status).toBe(401)
    expect(
      (
        await hono.request('/custom-mcp', {
          method: 'POST',
          headers: {
            authorization: 'Bearer route-secret',
            origin: 'https://evil.example',
          },
          body,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await hono.request('/custom-mcp', {
          method: 'POST',
          headers: {
            authorization: 'Bearer route-secret',
            origin: 'https://client.example',
          },
          body,
        })
      ).status,
    ).toBe(200)

    const shorthand = new Hono()
    app.mountMcpRoute(shorthand, { authToken: 'route-secret' })
    expect((await shorthand.request('/mcp', { method: 'POST', body })).status).toBe(401)
  })
})
