/**
 * @oa-sdk/tools — Official Model Context Protocol (MCP) Adapter
 *
 * Implemented with @modelcontextprotocol/sdk low-level Server:
 * - Native JSON Schema Draft 2020-12 / OpenAPI 3.1 support (no Zod lock-in)
 * - Full JSON-RPC 2.0 tool discovery & execution handling
 * - Clean Stdio & Streamable HTTP transports
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createToolContext, executeTool } from './context.js'
import { normalizeJsonSchema, validateToolInput } from './schema.js'
import type { CallToolResult, ToolDefinition } from './types.js'

export interface McpServerOptions {
  name: string
  version?: string | undefined
  description?: string | undefined
  port?: number | undefined
  hostname?: string | undefined
}

export interface McpServerInstance {
  server: Server
  runStdio(): Promise<void>
  serveHttp(options?: { port?: number; hostname?: string }): Promise<void>
  getTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
}

/**
 * Build an MCP Server from an array of ToolDefinitions
 */
export function createMcpServer(
  tools: ToolDefinition[],
  options: McpServerOptions,
): McpServerInstance {
  const serverName = options.name
  const serverVersion = options.version ?? '1.0.0'

  // Map tool by MCP toolName or name
  const toolMap = new Map<string, ToolDefinition>()
  for (const tool of tools) {
    const toolName = tool.mcp?.toolName ?? tool.name
    toolMap.set(toolName, tool)
  }

  function instantiateServer(): Server {
    const server = new Server(
      {
        name: serverName,
        version: serverVersion,
      },
      {
        capabilities: {
          tools: {},
        },
      },
    )

    // 1. ListTools Request Handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const toolList = Array.from(toolMap.entries()).map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: normalizeJsonSchema(tool.inputSchema),
      }))

      return {
        tools: toolList,
      }
    })

    // 2. CallTool Request Handler
    server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      const { name, arguments: args } = request.params
      const tool = toolMap.get(name)

      if (!tool) {
        return {
          content: [{ type: 'text', text: `Tool "${name}" is not registered on this server` }],
          isError: true,
        }
      }

      // Input validation
      const validation = validateToolInput(tool.inputSchema, args ?? {})
      if (!validation.success) {
        return {
          content: [{ type: 'text', text: `Tool input validation failed: ${validation.error}` }],
          isError: true,
        }
      }

      // Execution context
      const ctx = createToolContext({
        meta: {
          mcp: true,
          toolName: name,
        },
      })

      try {
        const result = await executeTool(tool, validation.data, ctx)
        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
          isError: false,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text', text: `Execution failed: ${message}` }],
          isError: true,
        }
      }
    })

    return server
  }

  return {
    server: instantiateServer(),

    getTools: () => {
      return Array.from(toolMap.entries()).map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: normalizeJsonSchema(tool.inputSchema),
      }))
    },

    runStdio: async () => {
      const server = instantiateServer()
      const transport = new StdioServerTransport()

      const cleanup = async () => {
        try {
          await transport.close()
          await server.close()
        } catch {
          // ignore shutdown errors
        }
      }

      process.once('SIGINT', cleanup)
      process.once('SIGTERM', cleanup)
      process.stdin.once('close', cleanup)

      await server.connect(transport)
      // Log to stderr to keep stdio clean for MCP JSON-RPC protocol
      console.error(`[MCP] ${serverName} v${serverVersion} running on stdio transport`)
    },

    serveHttp: async (opts = {}) => {
      const port = opts.port ?? options.port ?? 3001
      const hostname = opts.hostname ?? options.hostname ?? '0.0.0.0'

      const transports = new Map<string, StreamableHTTPServerTransport>()

      const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        const url = req.url ?? '/'

        // Health check
        if (url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              status: 'ok',
              server: serverName,
              version: serverVersion,
              toolsCount: toolMap.size,
              activeSessions: transports.size,
            }),
          )
          return
        }

        // Handle MCP endpoint
        if (url.startsWith('/mcp')) {
          const sessionId = req.headers['mcp-session-id'] as string | undefined

          if (req.method === 'POST') {
            let body = ''
            for await (const chunk of req) {
              body += chunk
            }
            const parsedBody = body ? JSON.parse(body) : undefined

            let transport: StreamableHTTPServerTransport

            if (sessionId && transports.has(sessionId)) {
              transport = transports.get(sessionId)!
            } else if (parsedBody && isInitializeRequest(parsedBody)) {
              transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (newSid) => {
                  transports.set(newSid, transport)
                },
              })
              transport.onclose = () => {
                if (transport.sessionId) {
                  transports.delete(transport.sessionId)
                }
              }

              const s = instantiateServer()
              await s.connect(transport as any)
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Invalid session' }, id: null }))
              return
            }

            await transport.handleRequest(req, res, parsedBody)
            return
          }

          if (req.method === 'GET' && sessionId && transports.has(sessionId)) {
            const transport = transports.get(sessionId)!
            await transport.handleRequest(req, res)
            return
          }
        }

        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not Found' }))
      })

      return new Promise((resolve) => {
        httpServer.listen(port, hostname, () => {
          console.error(`[MCP] ${serverName} HTTP server running on http://${hostname}:${port}/mcp`)
          resolve()
        })
      })
    },
  }
}
