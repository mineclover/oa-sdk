import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createToolApp,
  defineTool,
  MCP_PROTOCOL_VERSION_2026_07_28,
  McpHeaders,
  type ToolInputRequiredResult,
} from '../src/index.js'

describe('MCP 2026-07-28 Specification Conformance (@oa-sdk/tools)', () => {
  // Setup sample tools covering read-only, mutating, cached, and MRTR interactive tools
  const searchTool = defineTool({
    name: 'search_database',
    description: 'Searches database for matching records',
    hints: { readOnly: true, idempotent: true },
    mcp: {
      ttlMs: 30000,
      cacheScope: 'user',
      annotations: { openWorld: false },
    },
    inputSchema: z.object({
      query: z.string().describe('Search query text'),
      limit: z.number().optional().default(10),
    }),
    outputSchema: z.object({
      matches: z.array(z.string()),
      count: z.number(),
    }),
    execute: async (_ctx, input) => {
      return { matches: [`Item matching "${input.query}"`], count: 1 }
    },
  })

  const dangerousActionTool = defineTool({
    name: 'transfer_funds',
    description: 'Transfer funds with human-in-the-loop approval (MRTR)',
    hints: { destructive: true },
    inputSchema: z.object({
      toAccount: z.string(),
      amount: z.number(),
      confirmation: z.boolean().optional(),
    }),
    execute: async (_ctx, input): Promise<any> => {
      if (!input.confirmation) {
        const required: ToolInputRequiredResult = {
          status: 'input_required',
          continuationToken: `tok_transfer_${input.amount}`,
          prompt: `Please confirm transfer of $${input.amount} to account ${input.toAccount}`,
        }
        return required
      }
      return { success: true, txId: 'tx_987654' }
    },
  })

  const app = createToolApp({
    name: 'financial-mcp-service',
    version: '2026.7.0',
    description: 'Stateless MCP Service',
  }).tools(searchTool, dangerousActionTool)

  describe('1. Stateless Execution (No Session Handshake / No Mcp-Session-Id)', () => {
    it('executes tools/list directly as a stateless HTTP POST request', async () => {
      const mcp = app.buildMcp()
      const req = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 101,
          method: 'tools/list',
        }),
      })

      const res = await mcp.handleFetch(req)
      expect(res.status).toBe(200)
      expect(res.headers.get(McpHeaders.PROTOCOL_VERSION)).toBe(MCP_PROTOCOL_VERSION_2026_07_28)

      const body = await res.json()
      expect(body.jsonrpc).toBe('2.0')
      expect(body.id).toBe(101)
      expect(body.result.tools).toHaveLength(2)

      const searchMcpTool = body.result.tools.find((t: any) => t.name === 'search_database')
      expect(searchMcpTool).toBeDefined()
      expect(searchMcpTool.inputSchema.type).toBe('object')
      expect(searchMcpTool.inputSchema.properties.query).toBeDefined()

      // Output schema verification (Native Structured Output)
      expect(searchMcpTool.outputSchema).toBeDefined()
      expect(searchMcpTool.outputSchema.type).toBe('object')
      expect(searchMcpTool.outputSchema.properties.matches).toBeDefined()

      // Cache metadata & annotations verification
      expect(searchMcpTool.ttlMs).toBe(30000)
      expect(searchMcpTool.cacheScope).toBe('user')
      expect(searchMcpTool.annotations).toEqual({
        readOnly: true,
        idempotent: true,
        openWorld: false,
      })
    })

    it('executes server/discover returning protocolVersion, capabilities, and tool list', async () => {
      const mcp = app.buildMcp()
      const req = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1011,
          method: 'server/discover',
        }),
      })

      const res = await mcp.handleFetch(req)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.result.protocolVersion).toBe('2026-07-28')
      expect(body.result.capabilities.stateless).toBe(true)
      expect(body.result.tools).toHaveLength(2)
      expect(body.result.tools[0].outputSchema).toBeDefined()
    })

    it('executes tools/call directly without prior session initialization', async () => {
      const mcp = app.buildMcp()
      const req = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 102,
          method: 'tools/call',
          params: {
            name: 'search_database',
            arguments: {
              query: 'invoice-2026',
            },
          },
        }),
      })

      const res = await mcp.handleFetch(req)
      expect(res.status).toBe(200)
      expect(res.headers.get(McpHeaders.PROTOCOL_VERSION)).toBe(MCP_PROTOCOL_VERSION_2026_07_28)

      const body = await res.json()
      expect(body.result.isError).toBe(false)
      expect(body.result.status).toBe('success')
      expect(body.result.content[0].type).toBe('text')
      expect(body.result.content[0].text).toContain('invoice-2026')
      expect(body.result.structuredContent).toEqual({
        matches: ['Item matching "invoice-2026"'],
        count: 1,
      })
      expect(body.result.data).toEqual(body.result.structuredContent)
    })
  })

  describe('2. Header-Based Routing Validation (Mcp-Method & Mcp-Name)', () => {
    it('accepts request when headers match body method and tool name', async () => {
      const mcp = app.buildMcp()
      const req = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Method': 'tools/call',
          'Mcp-Name': 'search_database',
          'MCP-Protocol-Version': '2026-07-28',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 103,
          method: 'tools/call',
          params: {
            name: 'search_database',
            arguments: { query: 'test' },
          },
        }),
      })

      const res = await mcp.handleFetch(req)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.result.isError).toBe(false)
    })

    it('rejects request with 400 -32600 when Mcp-Method header does not match body', async () => {
      const mcp = app.buildMcp()
      const req = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Method': 'tools/call', // Header specifies tools/call
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 104,
          method: 'tools/list', // Body specifies tools/list
        }),
      })

      const res = await mcp.handleFetch(req)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe(-32600)
      expect(body.error.message).toContain('Header Mcp-Method "tools/call" does not match body method "tools/list"')
    })

    it('rejects request with 400 -32600 when Mcp-Name header does not match body tool name', async () => {
      const mcp = app.buildMcp()
      const req = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Method': 'tools/call',
          'Mcp-Name': 'transfer_funds', // Header specifies transfer_funds
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 105,
          method: 'tools/call',
          params: {
            name: 'search_database', // Body specifies search_database
            arguments: { query: 'fraud-check' },
          },
        }),
      })

      const res = await mcp.handleFetch(req)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe(-32600)
      expect(body.error.message).toContain('Header Mcp-Name "transfer_funds" does not match body tool name "search_database"')
    })
  })

  describe('3. Multi Round-Trip Requests (MRTR)', () => {
    it('returns input_required status and continuationToken when user confirmation is required', async () => {
      const mcp = app.buildMcp()
      const req = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Method': 'tools/call',
          'Mcp-Name': 'transfer_funds',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 106,
          method: 'tools/call',
          params: {
            name: 'transfer_funds',
            arguments: {
              toAccount: 'acc_555',
              amount: 500,
            },
          },
        }),
      })

      const res = await mcp.handleFetch(req)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.result.status).toBe('input_required')
      expect(body.result.continuationToken).toBe('tok_transfer_500')
      expect(body.result.prompt).toContain('Please confirm transfer of $500')
      expect(body.result.isError).toBe(false)
    })

    it('completes the action in next round-trip when confirmation is provided', async () => {
      const mcp = app.buildMcp()
      const req = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 107,
          method: 'tools/call',
          params: {
            name: 'transfer_funds',
            arguments: {
              toAccount: 'acc_555',
              amount: 500,
              confirmation: true,
            },
          },
        }),
      })

      const res = await mcp.handleFetch(req)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.result.status).toBe('success')
      expect(body.result.content[0].text).toContain('tx_987654')
    })
  })

  describe('4. Hono REST API & OpenAPI 3.1 Documentation Integration', () => {
    it('mounts /mcp route on Hono app and documents headers in OpenAPI 3.1', async () => {
      const honoApp = app.buildApi({ enableMcp: true })

      // Verify OpenAPI doc
      const openApiRes = await honoApp.request('/openapi.json')
      expect(openApiRes.status).toBe(200)
      const openApi = await openApiRes.json()

      expect(openApi.paths['/mcp']).toBeDefined()
      expect(openApi.paths['/mcp'].post).toBeDefined()
      expect(openApi.paths['/mcp'].post.operationId).toBe('mcpStatelessEndpoint')

      // Verify documented routing headers
      const paramNames = openApi.paths['/mcp'].post.parameters.map((p: any) => p.name)
      expect(paramNames).toContain('MCP-Protocol-Version')
      expect(paramNames).toContain('Mcp-Method')
      expect(paramNames).toContain('Mcp-Name')

      // Verify executing tool through Hono /mcp endpoint
      const callRes = await honoApp.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Method': 'tools/call',
          'Mcp-Name': 'search_database',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 201,
          method: 'tools/call',
          params: {
            name: 'search_database',
            arguments: { query: 'hono-gateway' },
          },
        }),
      })

      expect(callRes.status).toBe(200)
      const callBody = await callRes.json()
      expect(callBody.result.status).toBe('success')
      expect(callBody.result.content[0].text).toContain('hono-gateway')
    })
  })
})
