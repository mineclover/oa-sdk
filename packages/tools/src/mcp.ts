/**
 * @oa-sdk/tools — Model Context Protocol (MCP) Adapter (MCP 2026-07-28 Compatible)
 *
 * Implements MCP 2026-07-28 Stateless HTTP & JSON-RPC 2.0 Protocol:
 * - Stateless request/response model (no session-id or handshake required)
 * - Header-based routing: MCP-Protocol-Version, Mcp-Method, Mcp-Name validation
 * - Native JSON Schema Draft 2020-12 / OpenAPI 3.1 tool discovery
 * - Cacheable metadata (ttlMs, cacheScope) & tool behavioral annotations
 * - Multi Round-Trip Requests (MRTR) with input_required & continuationToken
 * - Backwards-compatible Stdio transport for local CLI/IDEs
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js'
import { createServer, type IncomingMessage, type ServerResponse, type Server as NodeHttpServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createToolContext, executeTool } from './context.js'
import { normalizeJsonSchema, validateToolInput } from './schema.js'
import {
  MCP_PROTOCOL_VERSION_2026_07_28,
  McpHeaders,
  type CallToolResult,
  type ToolDefinition,
} from './types.js'
import {
  authorizeToolHttpRequest,
  readToolJsonRequest,
  readToolNodeJsonRequest,
  ToolHttpError,
  validateToolHttpOptions,
  type ToolJsonBodySchema,
} from './http-boundary.js'

export interface McpServerOptions {
  name: string
  version?: string | undefined
  description?: string | undefined
  port?: number | undefined
  hostname?: string | undefined
  /** Optional bearer token required for HTTP MCP requests. */
  authToken?: string | undefined
  /** Maximum JSON request size in bytes (default: 1 MiB). */
  maxBodyBytes?: number | undefined
  /** Origins allowed to access HTTP MCP requests. */
  allowedOrigins?: string[] | undefined
  /** Keep the standalone health endpoint unauthenticated (default: true). */
  publicHealth?: boolean | undefined
}

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null | undefined
  method: string
  params?: Record<string, unknown> | undefined
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  } | undefined
}

export interface StatelessMcpDispatcher {
  /** Dispatch a decoded JSON-RPC body. The body is validated as a JSON-RPC 2.0 request first. */
  dispatch(
    body: unknown,
    headers?: Record<string, string | string[] | undefined> | Headers | undefined,
  ): Promise<{ status: number; response: JsonRpcResponse; headers: Record<string, string> }>
  handleNodeRequest(req: IncomingMessage, res: ServerResponse): Promise<void>
  handleFetchRequest(req: Request): Promise<Response>
}

export interface McpServerInstance {
  server: Server
  dispatcher: StatelessMcpDispatcher
  runStdio(): Promise<void>
  serveHttp(options?: Partial<McpServerOptions>): Promise<NodeHttpServer>
  getTools(): Array<{
    name: string
    description: string
    inputSchema: Record<string, unknown>
    annotations?: Record<string, unknown> | undefined
    ttlMs?: number | undefined
    cacheScope?: string | undefined
  }>
  handleFetch(req: Request): Promise<Response>
  handleNode(req: IncomingMessage, res: ServerResponse): Promise<void>
}

/**
 * Helper to safely extract headers case-insensitively
 */
function getHeaderValue(
  headers: Record<string, string | string[] | undefined> | Headers | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined
  const target = name.toLowerCase()

  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(target) ?? (headers as Headers).get(name) ?? undefined
  }

  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? value[0] : typeof value === 'string' ? value : undefined
    }
  }

  return undefined
}

/**
 * Do not reflect arbitrary exception text through MCP. The request ID gives
 * operators a correlation key while keeping stack traces, credentials, and
 * upstream response bodies out of the protocol response.
 */
function safeExecutionError(requestId: string): string {
  return `Tool execution failed (requestId: ${requestId})`
}

function httpBoundaryMessage(error: unknown): string {
  return error instanceof ToolHttpError ? error.message : 'Internal Server Error'
}

type JsonRpcId = JsonRpcResponse['id']

/** A decoded MCP request body: a valid JSON-RPC 2.0 request, or the id to answer an invalid one with. */
type McpRequestEnvelope =
  | { valid: true; request: JsonRpcRequest; id: JsonRpcId }
  | { valid: false; id: JsonRpcId }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === 'string' || typeof value === 'number'
}

/**
 * JSON-RPC 2.0 request envelope. Never throws: an invalid envelope still gets
 * a JSON-RPC error reply, echoing the id only when it has a protocol type.
 */
const McpRequestEnvelopeSchema: ToolJsonBodySchema<McpRequestEnvelope> = {
  parse(value) {
    if (!isPlainObject(value)) return { valid: false, id: null }
    const rawId = value.id
    if (rawId !== undefined && !isJsonRpcId(rawId)) return { valid: false, id: null }
    const id = rawId ?? null
    if (value.jsonrpc !== '2.0' || typeof value.method !== 'string') return { valid: false, id }
    const params = value.params
    if (params !== undefined && !isPlainObject(params)) return { valid: false, id }
    return {
      valid: true,
      id,
      request: {
        jsonrpc: '2.0',
        method: value.method,
        ...(rawId === undefined ? {} : { id: rawId }),
        ...(params === undefined ? {} : { params }),
      },
    }
  },
}

/** Map a tool's return value onto an MCP CallToolResult. */
function toCallToolResult(result: unknown): CallToolResult {
  const objectResult = typeof result === 'object' && result !== null ? result : undefined

  // Multi Round-Trip Request (MRTR) input_required detection
  if (objectResult && 'status' in objectResult && objectResult.status === 'input_required') {
    const prompt = 'prompt' in objectResult && typeof objectResult.prompt === 'string' ? objectResult.prompt : undefined
    const continuationToken = 'continuationToken' in objectResult && typeof objectResult.continuationToken === 'string'
      ? objectResult.continuationToken
      : undefined
    return {
      content: 'content' in objectResult && Array.isArray(objectResult.content)
        // Content items come from the tool implementation, which owns their MCP shape.
        ? objectResult.content as CallToolResult['content']
        : [{ type: 'text', text: prompt ?? 'Input required for continuation' }],
      status: 'input_required',
      continuationToken,
      prompt,
      isError: false,
    }
  }

  const content: CallToolResult['content'] =
    objectResult && 'content' in objectResult && Array.isArray(objectResult.content)
      ? objectResult.content as CallToolResult['content']
      : [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }]

  const rawData: unknown =
    objectResult && 'structuredContent' in objectResult
      ? objectResult.structuredContent
      : objectResult && 'data' in objectResult
        ? objectResult.data
        : objectResult && !('content' in objectResult)
          ? objectResult
          : undefined

  return {
    content,
    ...(rawData !== undefined ? { structuredContent: rawData, data: rawData } : {}),
    isError: false,
    status: 'success',
  }
}

/**
 * Create a pure Stateless MCP 2026-07-28 Dispatcher
 */
export function createStatelessMcpDispatcher(
  toolMap: Map<string, ToolDefinition>,
  options: McpServerOptions,
): StatelessMcpDispatcher {
  const serverName = options.name
  const serverVersion = options.version ?? '1.0.0'
  const maxBodyBytes = validateToolHttpOptions(options)

  const formatToolList = () => {
    return Array.from(toolMap.entries()).map(([name, tool]) => {
      const annotations: Record<string, unknown> = {
        ...(tool.hints?.readOnly !== undefined ? { readOnly: tool.hints.readOnly } : {}),
        ...(tool.hints?.destructive !== undefined ? { destructive: tool.hints.destructive } : {}),
        ...(tool.hints?.idempotent !== undefined ? { idempotent: tool.hints.idempotent } : {}),
        ...tool.mcp?.annotations,
      }

      return {
        name,
        description: tool.description,
        inputSchema: normalizeJsonSchema(tool.inputSchema),
        ...(tool.outputSchema ? { outputSchema: normalizeJsonSchema(tool.outputSchema) } : {}),
        ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
        ...(tool.mcp?.ttlMs !== undefined ? { ttlMs: tool.mcp.ttlMs } : {}),
        ...(tool.mcp?.cacheScope ? { cacheScope: tool.mcp.cacheScope } : {}),
      }
    })
  }

  const dispatchEnvelope = async (
    envelope: McpRequestEnvelope,
    headers: Parameters<StatelessMcpDispatcher['dispatch']>[1],
  ): ReturnType<StatelessMcpDispatcher['dispatch']> => {
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      [McpHeaders.PROTOCOL_VERSION]: MCP_PROTOCOL_VERSION_2026_07_28,
    }

    try {
      authorizeToolHttpRequest(headers, options)
    } catch (error) {
      const status = error instanceof ToolHttpError ? error.status : 500
      return {
        status,
        headers: responseHeaders,
        response: {
          jsonrpc: '2.0',
          id: envelope.id,
          error: {
            code: status === 401 ? -32001 : -32003,
            message: httpBoundaryMessage(error),
          },
        },
      }
    }

    if (!envelope.valid) {
      return {
        status: 400,
        headers: responseHeaders,
        response: {
          jsonrpc: '2.0',
          id: envelope.id,
          error: {
            code: -32600,
            message: 'Invalid Request: missing or invalid jsonrpc 2.0 structure',
          },
        },
      }
    }

    const body = envelope.request
    const reqId = envelope.id
    const headerMethod = getHeaderValue(headers, McpHeaders.METHOD)
    const headerName = getHeaderValue(headers, McpHeaders.NAME)

    // MCP 2026-07-28 Header-based routing validation
    if (headerMethod && headerMethod !== body.method) {
      return {
        status: 400,
        headers: responseHeaders,
        response: {
          jsonrpc: '2.0',
          id: reqId,
          error: {
            code: -32600,
            message: `Header ${McpHeaders.METHOD} "${headerMethod}" does not match body method "${body.method}"`,
          },
        },
      }
    }

    if (headerName && body.method === 'tools/call') {
      const toolNameInBody = body.params?.name
      if (headerName !== toolNameInBody) {
        return {
          status: 400,
          headers: responseHeaders,
          response: {
            jsonrpc: '2.0',
            id: reqId,
            error: {
              code: -32600,
              message: `Header ${McpHeaders.NAME} "${headerName}" does not match body tool name "${toolNameInBody}"`,
            },
          },
        }
      }
    }

    // Method Handling
    switch (body.method) {
      case 'tools/list': {
        return {
          status: 200,
          headers: responseHeaders,
          response: {
            jsonrpc: '2.0',
            id: reqId,
            result: {
              tools: formatToolList(),
            },
          },
        }
      }

      case 'tools/call': {
        const { name, arguments: args } = body.params ?? {}
        if (typeof name !== 'string') {
          return {
            status: 200,
            headers: responseHeaders,
            response: {
              jsonrpc: '2.0',
              id: reqId,
              error: {
                code: -32602,
                message: 'Invalid params: tools/call requires a string name',
              },
            },
          }
        }
        const tool = toolMap.get(name)

        if (!tool) {
          return {
            status: 200,
            headers: responseHeaders,
            response: {
              jsonrpc: '2.0',
              id: reqId,
              result: {
                content: [{ type: 'text', text: `Tool "${name}" is not registered on this server` }],
                isError: true,
                status: 'error',
              },
            },
          }
        }

        const validation = validateToolInput(tool.inputSchema, args ?? {})
        if (!validation.success) {
          return {
            status: 200,
            headers: responseHeaders,
            response: {
              jsonrpc: '2.0',
              id: reqId,
              result: {
                content: [{ type: 'text', text: `Tool input validation failed: ${validation.error}` }],
                isError: true,
                status: 'error',
              },
            },
          }
        }

        const ctx = createToolContext({
          meta: {
            mcp: true,
            toolName: name,
            protocolVersion: MCP_PROTOCOL_VERSION_2026_07_28,
            stateless: true,
          },
        })

        try {
          const result: unknown = await executeTool(tool, validation.data, ctx)
          return {
            status: 200,
            headers: responseHeaders,
            response: {
              jsonrpc: '2.0',
              id: reqId,
              result: toCallToolResult(result),
            },
          }
        } catch (error) {
          return {
            status: 200,
            headers: responseHeaders,
            response: {
              jsonrpc: '2.0',
              id: reqId,
              result: {
                content: [{ type: 'text', text: safeExecutionError(ctx.requestId) }],
                isError: true,
                status: 'error',
              },
            },
          }
        }
      }

      case 'server/discover': {
        return {
          status: 200,
          headers: responseHeaders,
          response: {
            jsonrpc: '2.0',
            id: reqId,
            result: {
              protocolVersion: MCP_PROTOCOL_VERSION_2026_07_28,
              supportedProtocolVersions: [MCP_PROTOCOL_VERSION_2026_07_28, '2025-11-25', '2024-11-05'],
              serverInfo: {
                name: serverName,
                version: serverVersion,
              },
              capabilities: {
                stateless: true,
                tools: {
                  listChanged: false,
                },
              },
              tools: formatToolList(),
            },
          },
        }
      }

      case 'initialize': {

        return {
          status: 200,
          headers: responseHeaders,
          response: {
            jsonrpc: '2.0',
            id: reqId,
            result: {
              protocolVersion: MCP_PROTOCOL_VERSION_2026_07_28,
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: serverName,
                version: serverVersion,
              },
            },
          },
        }
      }

      case 'ping': {
        return {
          status: 200,
          headers: responseHeaders,
          response: {
            jsonrpc: '2.0',
            id: reqId,
            result: {},
          },
        }
      }

      default: {
        return {
          status: 200,
          headers: responseHeaders,
          response: {
            jsonrpc: '2.0',
            id: reqId,
            error: {
              code: -32601,
              message: `Method not found: ${body.method}`,
            },
          },
        }
      }
    }
  }

  const dispatch: StatelessMcpDispatcher['dispatch'] = (body, headers) =>
    dispatchEnvelope(McpRequestEnvelopeSchema.parse(body), headers)

  const handleNodeRequest = async (req: IncomingMessage, res: ServerResponse) => {
    let envelope: McpRequestEnvelope
    try {
      authorizeToolHttpRequest(req.headers, options)
      envelope = await readToolNodeJsonRequest(req, maxBodyBytes, McpRequestEnvelopeSchema)
    } catch (error) {
      const boundary = error instanceof ToolHttpError ? error : undefined
      const status = boundary?.status ?? 400
      req.resume()
      res.writeHead(status, {
        'Content-Type': 'application/json',
        [McpHeaders.PROTOCOL_VERSION]: MCP_PROTOCOL_VERSION_2026_07_28,
      })
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: status === 413 ? -32000 : status === 401 ? -32001 : -32700,
            message: boundary?.message ?? 'Parse error: Invalid JSON',
          },
        }),
      )
      return
    }

    const { status, response, headers: resHeaders } = await dispatchEnvelope(envelope, req.headers)
    res.writeHead(status, resHeaders)
    res.end(JSON.stringify(response))
  }

  const handleFetchRequest = async (req: Request): Promise<Response> => {
    let envelope: McpRequestEnvelope
    try {
      authorizeToolHttpRequest(req.headers, options)
      envelope = await readToolJsonRequest(req, maxBodyBytes, McpRequestEnvelopeSchema)
    } catch (error) {
      const boundary = error instanceof ToolHttpError ? error : undefined
      const status = boundary?.status ?? 400
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: status === 413 ? -32000 : status === 401 ? -32001 : -32700,
            message: boundary?.message ?? 'Parse error: Invalid JSON',
          },
        }),
        {
          status,
          headers: {
            'Content-Type': 'application/json',
            [McpHeaders.PROTOCOL_VERSION]: MCP_PROTOCOL_VERSION_2026_07_28,
          },
        },
      )
    }

    const { status, response, headers: resHeaders } = await dispatchEnvelope(envelope, req.headers)
    return new Response(JSON.stringify(response), {
      status,
      headers: resHeaders,
    })
  }

  return {
    dispatch,
    handleNodeRequest,
    handleFetchRequest,
  }
}

/**
 * Build an MCP Server from an array of ToolDefinitions (MCP 2026-07-28 Compatible)
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

  const dispatcher = createStatelessMcpDispatcher(toolMap, options)
  const maxBodyBytes = validateToolHttpOptions(options)

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
      const toolList = Array.from(toolMap.entries()).map(([name, tool]) => {
        const annotations: Record<string, unknown> = {
          ...(tool.hints?.readOnly !== undefined ? { readOnly: tool.hints.readOnly } : {}),
          ...(tool.hints?.destructive !== undefined ? { destructive: tool.hints.destructive } : {}),
          ...(tool.hints?.idempotent !== undefined ? { idempotent: tool.hints.idempotent } : {}),
          ...tool.mcp?.annotations,
        }

        return {
          name,
          description: tool.description,
          inputSchema: normalizeJsonSchema(tool.inputSchema),
          ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
          ...(tool.mcp?.ttlMs !== undefined ? { ttlMs: tool.mcp.ttlMs } : {}),
          ...(tool.mcp?.cacheScope ? { cacheScope: tool.mcp.cacheScope } : {}),
        }
      })

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
          status: 'error',
        }
      }

      // Input validation
      const validation = validateToolInput(tool.inputSchema, args ?? {})
      if (!validation.success) {
        return {
          content: [{ type: 'text', text: `Tool input validation failed: ${validation.error}` }],
          isError: true,
          status: 'error',
        }
      }

      // Execution context
      const ctx = createToolContext({
        meta: {
          mcp: true,
          toolName: name,
          protocolVersion: MCP_PROTOCOL_VERSION_2026_07_28,
        },
      })

      try {
        const result: unknown = await executeTool(tool, validation.data, ctx)
        return toCallToolResult(result)
      } catch (error) {
        return {
          content: [{ type: 'text', text: safeExecutionError(ctx.requestId) }],
          isError: true,
          status: 'error',
        }
      }
    })

    return server
  }

  const getTools: McpServerInstance['getTools'] = () => {
    return Array.from(toolMap.entries()).map(([name, tool]) => {
      const annotations: Record<string, unknown> = {
        ...(tool.hints?.readOnly !== undefined ? { readOnly: tool.hints.readOnly } : {}),
        ...(tool.hints?.destructive !== undefined ? { destructive: tool.hints.destructive } : {}),
        ...(tool.hints?.idempotent !== undefined ? { idempotent: tool.hints.idempotent } : {}),
        ...tool.mcp?.annotations,
      }

      return {
        name,
        description: tool.description,
        inputSchema: normalizeJsonSchema(tool.inputSchema),
        ...(tool.outputSchema ? { outputSchema: normalizeJsonSchema(tool.outputSchema) } : {}),
        ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
        ...(tool.mcp?.ttlMs !== undefined ? { ttlMs: tool.mcp.ttlMs } : {}),
        ...(tool.mcp?.cacheScope ? { cacheScope: tool.mcp.cacheScope } : {}),
      }

    })
  }

  return {
    server: instantiateServer(),
    dispatcher,

    getTools,

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
      const serveOptions: McpServerOptions = { ...options, ...opts, name: options.name }
      const serveMaxBodyBytes = validateToolHttpOptions(serveOptions)
      const serveDispatcher = createStatelessMcpDispatcher(toolMap, serveOptions)

      const legacyTransports = new Map<string, StreamableHTTPServerTransport>()

      const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        const url = req.url ?? '/'

        // Health is public by default for liveness probes, but that policy is
        // explicit and still honors an origin allow-list when configured.
        if (url === '/health') {
          try {
            authorizeToolHttpRequest(
              req.headers,
              serveOptions.publicHealth !== false ? { ...serveOptions, authToken: undefined } : serveOptions,
            )
          } catch (error) {
            const status = error instanceof ToolHttpError ? error.status : 500
            res.writeHead(status, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: httpBoundaryMessage(error) }))
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              status: 'ok',
              server: serverName,
              version: serverVersion,
              protocolVersion: MCP_PROTOCOL_VERSION_2026_07_28,
              toolsCount: toolMap.size,
            }),
          )
          return
        }

        // Handle MCP endpoint
        if (url.startsWith('/mcp')) {
          const sessionId = req.headers['mcp-session-id'] as string | undefined

          if (req.method === 'POST') {
            // Check if client explicitly asks for legacy stateful session
            if (sessionId && legacyTransports.has(sessionId)) {
              try {
                authorizeToolHttpRequest(req.headers, serveOptions)
              } catch (error) {
                const status = error instanceof ToolHttpError ? error.status : 500
                req.resume()
                res.writeHead(status, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: httpBoundaryMessage(error) }))
                return
              }
              const transport = legacyTransports.get(sessionId)!
              let parsedBody: unknown
              try {
                parsedBody = await readToolNodeJsonRequest(req, serveMaxBodyBytes)
              } catch (error) {
                const status = error instanceof ToolHttpError ? error.status : 400
                req.resume()
                res.writeHead(status, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: httpBoundaryMessage(error) }))
                return
              }
              await transport.handleRequest(req, res, parsedBody)
              return
            }

            // Otherwise, handle as MCP 2026-07-28 Stateless HTTP request
            await serveDispatcher.handleNodeRequest(req, res)
            return
          }

          if (req.method === 'GET' && sessionId && legacyTransports.has(sessionId)) {
            try {
              authorizeToolHttpRequest(req.headers, serveOptions)
            } catch (error) {
              const status = error instanceof ToolHttpError ? error.status : 500
              res.writeHead(status, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: httpBoundaryMessage(error) }))
              return
            }
            const transport = legacyTransports.get(sessionId)!
            await transport.handleRequest(req, res)
            return
          }
        }

        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not Found' }))
      })

      return new Promise<NodeHttpServer>((resolve) => {
        httpServer.listen(port, hostname, () => {
          console.error(
            `[MCP] ${serverName} Stateless HTTP (MCP 2026-07-28) server running on http://${hostname}:${port}/mcp`,
          )
          resolve(httpServer)
        })
      })
    },

    handleFetch: (req: Request) => dispatcher.handleFetchRequest(req),
    handleNode: (req: IncomingMessage, res: ServerResponse) => dispatcher.handleNodeRequest(req, res),
  }
}
