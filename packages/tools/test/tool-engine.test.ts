import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createToolApp,
  createToolContext,
  defineTool,
  executeTool,
  normalizeJsonSchema,
  validateToolInput,
} from '../src/index.js'

describe('@oa-sdk/tools — Universal Tool Engine', () => {
  describe('1. Schema Normalization & Validation', () => {
    it('normalizes Zod schema to JSON Schema Draft 2020-12 / OpenAPI 3.1', () => {
      const schema = z.object({
        name: z.string().describe('Target item name'),
        count: z.number().optional().default(1),
        active: z.boolean().optional(),
      })

      const norm = normalizeJsonSchema(schema)
      expect(norm.type).toBe('object')
      expect(norm.properties).toBeDefined()
      expect(norm.properties!.name.type).toBe('string')
      expect(norm.properties!.name.description).toBe('Target item name')
      expect(norm.properties!.count.type).toBe('number')
      expect(norm.required).toContain('name')
    })

    it('normalizes plain JSON Schema objects preserving definitions', () => {
      const plain = {
        type: 'object',
        properties: {
          sheetId: { type: 'string', description: 'Sheet ID' },
          limit: { type: 'integer', default: 20 },
        },
        required: ['sheetId'],
      }

      const norm = normalizeJsonSchema(plain)
      expect(norm.type).toBe('object')
      expect(norm.properties!.sheetId.description).toBe('Sheet ID')
      expect(norm.required).toContain('sheetId')
    })

    it('validates input against Zod schema', () => {
      const schema = z.object({
        id: z.string(),
        qty: z.number(),
      })

      const valid = validateToolInput(schema, { id: 'x-1', qty: 5 })
      expect(valid.success).toBe(true)
      if (valid.success) {
        expect(valid.data).toEqual({ id: 'x-1', qty: 5 })
      }

      const invalid = validateToolInput(schema, { id: 'x-1', qty: 'not-number' })
      expect(invalid.success).toBe(false)
    })

    it('validates input against plain JSON Schema required fields', () => {
      const plain = {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
      }

      expect(validateToolInput(plain, { key: 'val' }).success).toBe(true)
      expect(validateToolInput(plain, {}).success).toBe(false)
    })
  })

  describe('2. Tool Definition & Execution', () => {
    it('executes tool with (ctx, input) signature', async () => {
      const tool = defineTool({
        name: 'test_calc',
        description: 'Multiplies two numbers',
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        execute: async (_ctx, input) => {
          return { result: input.a * input.b }
        },
      })

      const ctx = createToolContext()
      const output = await executeTool(tool, { a: 6, b: 7 }, ctx)
      expect(output).toEqual({ result: 42 })
    })

    it('executes middleware pipeline correctly', async () => {
      const steps: string[] = []

      const tool = defineTool({
        name: 'middleware_tool',
        description: 'Tool with middleware',
        inputSchema: z.object({ val: z.string() }),
        middleware: [
          async (ctx, input, next) => {
            steps.push('mw1-before')
            const res = await next()
            steps.push('mw1-after')
            return res
          },
          async (ctx, input, next) => {
            steps.push('mw2-before')
            const res = await next()
            steps.push('mw2-after')
            return res
          },
        ],
        execute: async (_ctx, input) => {
          steps.push(`exec-${input.val}`)
          return { done: true }
        },
      })

      const res = await executeTool(tool, { val: 'test' })
      expect(res).toEqual({ done: true })
      expect(steps).toEqual(['mw1-before', 'mw2-before', 'exec-test', 'mw2-after', 'mw1-after'])
    })
  })

  describe('3. MCP Server Adapter', () => {
    it('exposes registered tools in ListTools format', () => {
      const tool = defineTool({
        name: 'test_mcp_tool',
        description: 'Sample MCP tool',
        category: 'testing',
        mcp: { toolName: 'custom_mcp_name' },
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
          required: ['query'],
        },
        execute: async (_ctx, input: any) => ({ query: input.query }),
      })

      const app = createToolApp({ name: 'test-app', version: '1.2.3' }).tools(tool)
      const mcp = app.buildMcp()
      const tools = mcp.getTools()

      expect(tools.length).toBe(1)
      expect(tools[0]!.name).toBe('custom_mcp_name')
      expect(tools[0]!.description).toBe('Sample MCP tool')
      expect(tools[0]!.inputSchema.properties).toBeDefined()
    })
  })

  describe('4. CLI Adapter (Commander)', () => {
    it('creates command hierarchy with positional args and options', () => {
      const tool = defineTool({
        name: 'sheet-vcs-sample',
        description: 'Sample CLI command',
        category: 'sheet-vcs',
        cli: {
          command: 'sample',
          arguments: [{ name: 'spreadsheetId', required: true, description: 'Sheet ID' }],
        },
        inputSchema: z.object({
          spreadsheetId: z.string(),
          limit: z.number().optional().default(10),
          force: z.boolean().optional(),
        }),
        execute: async (_ctx, input) => input,
      })

      const app = createToolApp({ name: 'test-cli' }).tools(tool)
      const cli = app.buildCli()

      const catCmd = cli.commands.find((c) => c.name() === 'sheet-vcs')
      expect(catCmd).toBeDefined()

      const subCmd = catCmd!.commands.find((c) => c.name() === 'sample')
      expect(subCmd).toBeDefined()
      expect(subCmd!.description()).toBe('Sample CLI command')
    })
  })

  describe('5. HTTP / Hono Adapter', async () => {
    it('serves OpenAPI 3.1.0 document and REST endpoints', async () => {
      const tool = defineTool({
        name: 'get-status',
        description: 'Get service status',
        category: 'status',
        hints: { readOnly: true },
        api: { path: '/status/check', method: 'GET' },
        inputSchema: z.object({ verbose: z.string().optional() }),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: async () => ({ ok: true }),
      })

      const app = createToolApp({ name: 'test-api', version: '2.0.0' }).tools(tool)
      const honoApp = app.buildApi()

      const openApiRes = await honoApp.request('/openapi.json')
      expect(openApiRes.status).toBe(200)
      const openApi = await openApiRes.json()
      expect(openApi.openapi).toBe('3.1.0')
      expect(openApi.paths['/status/check']).toBeDefined()

      const healthRes = await honoApp.request('/health')
      expect(healthRes.status).toBe(200)
      const health = await healthRes.json()
      expect(health.status).toBe('ok')

      const routeRes = await honoApp.request('/status/check')
      expect(routeRes.status).toBe(200)
      const data = await routeRes.json()
      expect(data).toEqual({ ok: true })
    })
  })
})
