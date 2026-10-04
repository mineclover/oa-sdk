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
import {
  authorizeToolHttpRequest,
  readToolJsonRequest,
  ToolHttpError,
  validateToolHttpOptions,
} from './http-boundary.js'

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
  /** Optional bearer token required for every API and MCP request. */
  authToken?: string | undefined
  /** Origins allowed to access the API when an Origin header is present. */
  allowedOrigins?: string[] | undefined
  /** Maximum JSON request size in bytes (default: 1 MiB). */
  maxBodyBytes?: number | undefined
  /**
   * Keep the health endpoint unauthenticated. Defaults to true so liveness
   * probes can run without credentials. Set false to protect every route.
   */
  publicHealth?: boolean | undefined
}

export function createHttpApp(
  tools: ToolDefinition[],
  options: HttpAdapterOptions = {},
): Hono {
  const app = new Hono()
  const maxBodyBytes = validateToolHttpOptions(options)

  // Generate OpenAPI 3.1 document
  const openApiDoc = generateOpenApiDoc(tools, options)

  const authorize = (c: any, includeAuth = true) => {
    try {
      // A public health check still observes an explicitly configured origin
      // policy, while intentionally skipping only the bearer credential.
      authorizeToolHttpRequest(
        c.req.raw.headers,
        includeAuth ? options : { ...options, authToken: undefined },
      )
      return undefined
    } catch (error) {
      const boundary = error instanceof ToolHttpError ? error : undefined
      const status = boundary?.status ?? 500
      return c.json(
        { error: boundary?.message ?? 'Internal Server Error' },
        status as 401 | 403 | 500,
      )
    }
  }

  // OpenAPI and documentation can expose the complete tool catalog. Protect
  // them with the same policy as tool execution whenever one is configured.
  app.get('/openapi.json', (c) => {
    const denied = authorize(c)
    return denied ?? c.json(openApiDoc)
  })
  app.get('/api/v1/openapi.json', (c) => {
    const denied = authorize(c)
    return denied ?? c.json(openApiDoc)
  })

  // Swagger UI
  app.get('/docs', (c, next) => {
    const denied = authorize(c)
    return denied ?? swaggerUI({ url: '/openapi.json' })(c, next)
  })
  app.get('/api/v1/docs', (c, next) => {
    const denied = authorize(c)
    return denied ?? swaggerUI({ url: '/api/v1/openapi.json' })(c, next)
  })

  // Health check
  app.get('/health', (c) => {
    const denied = authorize(c, options.publicHealth !== false ? false : true)
    return (
      denied ??
      c.json({
        status: 'ok',
        service: options.title ?? 'tools-api',
        version: options.version ?? '1.0.0',
        toolsCount: tools.length,
      })
    )
  })

  // Mount MCP 2026-07-28 stateless endpoint
  if (options.enableMcp !== false) {
    const mcpServer = createMcpServer(tools, {
      name: options.title ?? 'tools-api',
      version: options.version ?? '1.0.0',
      description: options.description,
      authToken: options.authToken,
      allowedOrigins: options.allowedOrigins,
      maxBodyBytes,
    })
    const mcpPath = options.mcpPath ?? '/mcp'
    app.post(mcpPath, async (c) => {
      // The MCP dispatcher performs the same auth/origin/body checks and
      // preserves the JSON-RPC error envelope for rejected requests.
      return mcpServer.handleFetch(c.req.raw)
    })
  }

  // Mount each tool
  for (const tool of tools) {
    const rawPath = tool.api?.path ?? `/${tool.category ?? 'tools'}/${tool.name}`
    const method = (tool.api?.method ?? (tool.hints?.readOnly ? 'GET' : 'POST')).toLowerCase()

    const routeHandler = async (c: any) => {
      const denied = authorize(c)
      if (denied) return denied

      let input: Record<string, unknown> = {}
      if (c.req.method === 'GET') input = c.req.query()
      else {
        try {
          const parsed = await readToolJsonRequest(c.req.raw, maxBodyBytes)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return c.json({ error: 'Request body must be a JSON object' }, 400)
          }
          input = parsed as Record<string, unknown>
        } catch (error) {
          const status = error instanceof ToolHttpError ? error.status : 400
          return c.json(
            { error: error instanceof Error ? error.message : 'Invalid JSON' },
            status as 400 | 413,
          )
        }
      }

      // Merge query parameters if present
      const query = c.req.query()
      if (query && Object.keys(query).length > 0) {
        input = { ...query, ...input }
      }

      const validation = validateToolInput(tool.inputSchema, input)
      if (!validation.success) {
        return c.json(
          { error: 'Validation failed', detail: validation.error },
          resolveToolStatus(tool, 'validationError', 400) as any,
        )
      }

      const ctx = createToolContext({ meta: { http: true, path: rawPath, toolName: tool.name } })

      try {
        const result = await executeTool(tool, validation.data, ctx)
        const successStatus = method === 'post' && tool.api?.statusCodes?.created !== undefined
          ? tool.api.statusCodes.created
          : resolveToolStatus(tool, 'success', 200)
        return c.json(result, successStatus as any)
      } catch (err: any) {
        return c.json(
          { error: `Tool execution failed (requestId: ${ctx.requestId})` },
          resolveToolStatus(tool, 'serverError', 500) as any,
        )
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
  // Keep generated documentation aligned with the runtime boundary.  The
  // bearer scheme is only advertised when a token is configured; callers
  // without authToken retain the existing unauthenticated contract.
  const bearerSecurity = options.authToken ? [{ bearerAuth: [] }] : undefined

  for (const tool of tools) {
    const rawPath = tool.api?.path ?? `/${tool.category ?? 'tools'}/${tool.name}`
    const method = (tool.api?.method ?? (tool.hints?.readOnly ? 'GET' : 'POST')).toLowerCase()
    const inputSchema = normalizeJsonSchema(tool.inputSchema)

    const successStatus = method === 'post' && tool.api?.statusCodes?.created !== undefined
      ? tool.api.statusCodes.created
      : resolveToolStatus(tool, 'success', 200)
    const responses: Record<string, unknown> = {
      [String(successStatus)]: {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: tool.outputSchema ? normalizeJsonSchema(tool.outputSchema) : { type: 'object' },
          },
        },
      },
    }
    if (tool.api?.statusCodes?.notFound !== undefined) responses[String(resolveToolStatus(tool, 'notFound', 404))] = { description: 'Resource not found' }
    if (tool.api?.statusCodes?.validationError !== undefined) responses[String(resolveToolStatus(tool, 'validationError', 400))] = { description: 'Validation error' }
    if (tool.api?.statusCodes?.serverError !== undefined) responses[String(resolveToolStatus(tool, 'serverError', 500))] = { description: 'Server error' }

    const op: Record<string, unknown> = {
      operationId: tool.name,
      summary: tool.description,
      tags: tool.api?.tags ?? (tool.category ? [tool.category] : ['default']),
      responses,
      ...(bearerSecurity ? { security: bearerSecurity } : {}),
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

    const operationPath = {
      ...(paths[rawPath] ?? {}),
      [method]: op,
    }
    paths[rawPath] = operationPath

    // Tool routes are mounted at both the canonical path and the /api/v1
    // compatibility prefix. Advertise both concrete HTTP surfaces so clients
    // generated from the document do not miss a live route.
    if (!rawPath.startsWith('/api/v1')) {
      const prefixedPath = `/api/v1${rawPath.startsWith('/') ? rawPath : `/${rawPath}`}`
      paths[prefixedPath] = {
        ...(paths[prefixedPath] ?? {}),
        [method]: op,
      }
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
        ...(bearerSecurity ? { security: bearerSecurity } : {}),
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
    ...(bearerSecurity
      ? {
          components: {
            securitySchemes: {
              bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'opaque token',
              },
            },
          },
        }
      : {}),
  }
}

function resolveToolStatus(
  tool: ToolDefinition,
  key: 'success' | 'created' | 'notFound' | 'validationError' | 'serverError',
  fallback: number,
): number {
  const value = tool.api?.statusCodes?.[key]
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 100 || value > 599) {
    throw new RangeError(`Tool ${tool.name} statusCodes.${key} must be an integer between 100 and 599`)
  }
  return value
}
