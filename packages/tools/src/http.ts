/**
 * @oa-sdk/tools — Hono HTTP / REST Adapter
 *
 * Exposes ToolDefinitions as HTTP REST endpoints with automatic OpenAPI 3.1 documentation
 * and Swagger UI.
 */
import { Hono } from 'hono'
import { swaggerUI } from '@hono/swagger-ui'
import { serve, type ServerType } from '@hono/node-server'
import { createToolContext, executeTool } from './context.js'
import { normalizeJsonSchema, validateToolInput } from './schema.js'
import { createMcpServer } from './mcp.js'
import type { ToolDefinition } from './types.js'

export interface HttpAdapterOptions {
  title?: string | undefined
  version?: string | undefined
  description?: string | undefined
  port?: number | undefined
  hostname?: string | undefined
  /** Enable MCP 2026-07-28 stateless endpoint (default: true) */
  enableMcp?: boolean | undefined
  /** Custom route path for MCP endpoint (default: '/mcp') */
  mcpPath?: string | undefined
  onListen?: ((info: { port: number; hostname: string }) => void) | undefined
}

export function createHttpApp(
  tools: ToolDefinition[],
  options: HttpAdapterOptions = {},
): Hono {
  const app = new Hono()

  // Generate OpenAPI 3.1 document
  const openApiDoc = generateOpenApiDoc(tools, options)

  // OpenAPI endpoints
  app.get('/openapi.json', (c) => c.json(openApiDoc))
  app.get('/api/v1/openapi.json', (c) => c.json(openApiDoc))

  // Swagger UI
  app.get('/docs', swaggerUI({ url: '/openapi.json' }))
  app.get('/api/v1/docs', swaggerUI({ url: '/api/v1/openapi.json' }))

  // Health check
  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: options.title ?? 'tools-api',
      version: options.version ?? '1.0.0',
      toolsCount: tools.length,
    }),
  )

  // Mount MCP 2026-07-28 stateless endpoint
  if (options.enableMcp !== false) {
    const mcpServer = createMcpServer(tools, {
      name: options.title ?? 'tools-api',
      version: options.version ?? '1.0.0',
      description: options.description,
    })
    const mcpPath = options.mcpPath ?? '/mcp'
    app.post(mcpPath, async (c) => {
      return mcpServer.handleFetch(c.req.raw)
    })
  }

  // Mount each tool
  for (const tool of tools) {
    const rawPath = tool.api?.path ?? `/${tool.category ?? 'tools'}/${tool.name}`
    const method = (tool.api?.method ?? (tool.hints?.readOnly ? 'GET' : 'POST')).toLowerCase()

    const routeHandler = async (c: any) => {
      let input: Record<string, unknown> = {}

      if (c.req.method === 'GET') {
        input = c.req.query()
      } else {
        try {
          input = await c.req.json()
        } catch {
          input = {}
        }
      }

      // Merge query parameters if present
      const query = c.req.query()
      if (query && Object.keys(query).length > 0) {
        input = { ...query, ...input }
      }

      const validation = validateToolInput(tool.inputSchema, input)
      if (!validation.success) {
        return c.json({ error: 'Validation failed', detail: validation.error }, 400)
      }

      const ctx = createToolContext({ meta: { http: true, path: rawPath, toolName: tool.name } })

      try {
        const result = await executeTool(tool, validation.data, ctx)
        return c.json(result)
      } catch (err: any) {
        return c.json({ error: err.message ?? 'Internal Server Error' }, 500)
      }
    }

    // Mount on root path
    const pathsToMount = [rawPath]
    // Also mount with /api/v1 prefix if not already present
    if (!rawPath.startsWith('/api/v1')) {
      pathsToMount.push(`/api/v1${rawPath.startsWith('/') ? rawPath : `/${rawPath}`}`)
    }

    for (const p of pathsToMount) {
      if (method === 'get') app.get(p, routeHandler)
      else if (method === 'post') app.post(p, routeHandler)
      else if (method === 'put') app.put(p, routeHandler)
      else if (method === 'delete') app.delete(p, routeHandler)
      else if (method === 'patch') app.patch(p, routeHandler)
    }
  }

  return app
}

/**
 * Start HTTP server for the tools
 */
export async function serveHttpApp(
  tools: ToolDefinition[],
  options: HttpAdapterOptions = {},
): Promise<ServerType> {
  const app = createHttpApp(tools, options)
  const port = options.port ?? 3000
  const hostname = options.hostname ?? '0.0.0.0'

  return serve(
    {
      fetch: app.fetch,
      port,
      hostname,
    },
    (info) => {
      options.onListen?.({ port: info.port, hostname: info.address })
    },
  )
}

function generateOpenApiDoc(tools: ToolDefinition[], options: HttpAdapterOptions) {
  const paths: Record<string, Record<string, unknown>> = {}

  for (const tool of tools) {
    const rawPath = tool.api?.path ?? `/${tool.category ?? 'tools'}/${tool.name}`
    const method = (tool.api?.method ?? (tool.hints?.readOnly ? 'GET' : 'POST')).toLowerCase()
    const inputSchema = normalizeJsonSchema(tool.inputSchema)

    const op: Record<string, unknown> = {
      operationId: tool.name,
      summary: tool.description,
      tags: tool.api?.tags ?? (tool.category ? [tool.category] : ['default']),
      responses: {
        '200': {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: tool.outputSchema ? normalizeJsonSchema(tool.outputSchema) : { type: 'object' },
            },
          },
        },
      },
    }

    if (method === 'get') {
      op.parameters = Object.entries(inputSchema.properties ?? {}).map(([name, prop]) => ({
        name,
        in: 'query',
        required: inputSchema.required?.includes(name) ?? false,
        schema: prop,
        description: prop.description,
      }))
    } else {
      op.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: inputSchema,
          },
        },
      }
    }

    paths[rawPath] = {
      ...(paths[rawPath] ?? {}),
      [method]: op,
    }
  }

  // Document MCP 2026-07-28 stateless endpoint
  if (options.enableMcp !== false) {
    const mcpPath = options.mcpPath ?? '/mcp'
    paths[mcpPath] = {
      post: {
        operationId: 'mcpStatelessEndpoint',
        summary: 'Model Context Protocol (MCP 2026-07-28) Stateless Endpoint',
        description:
          'Stateless JSON-RPC 2.0 tool execution endpoint conforming to the MCP 2026-07-28 specification.',
        tags: ['mcp'],
        parameters: [
          {
            name: 'MCP-Protocol-Version',
            in: 'header',
            required: false,
            schema: { type: 'string', default: '2026-07-28' },
            description: 'MCP protocol version specification',
          },
          {
            name: 'Mcp-Method',
            in: 'header',
            required: false,
            schema: { type: 'string', enum: ['tools/list', 'tools/call', 'initialize', 'ping'] },
            description: 'Target MCP method for gateway routing',
          },
          {
            name: 'Mcp-Name',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description: 'Target MCP tool name for tools/call gateway routing',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  jsonrpc: { type: 'string', enum: ['2.0'] },
                  id: { type: ['string', 'number', 'null'] },
                  method: { type: 'string' },
                  params: { type: 'object' },
                },
                required: ['jsonrpc', 'method'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'JSON-RPC 2.0 Response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    jsonrpc: { type: 'string', enum: ['2.0'] },
                    id: { type: ['string', 'number', 'null'] },
                    result: { type: 'object' },
                    error: { type: 'object' },
                  },
                  required: ['jsonrpc'],
                },
              },
            },
          },
        },
      },
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: options.title ?? 'Tools API',
      version: options.version ?? '1.0.0',
      description: options.description ?? 'API powered by @oa-sdk/tools',
    },
    paths,
  }
}
