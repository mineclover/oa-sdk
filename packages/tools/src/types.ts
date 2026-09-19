/**
 * @oa-sdk/tools — Core Protocol Types
 *
 * Grounded in the official Model Context Protocol (MCP) tool specification:
 * - https://spec.modelcontextprotocol.io/specification/server/tools/
 * - Zero external framework lock-in, designed for clean promotion to @oa-sdk/tools
 */
import type { z } from 'zod'

/**
 * Execution context passed to tool handlers
 */
export interface ToolContext {
  /** Unique request ID for tracing and idempotency */
  requestId: string
  /** Structured logger */
  logger: ToolLogger
  /** Optional cancellation signal */
  signal?: AbortSignal | undefined
  /** Arbitrary execution metadata */
  meta?: Record<string, unknown> | undefined
}

/**
 * Standard logger contract for tools
 */
export interface ToolLogger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

/**
 * Behavioral hints for tool consumers and LLM planners
 */
export interface ToolHints {
  /** True if tool only queries data without mutations */
  readOnly?: boolean | undefined
  /** True if tool performs irreversible state alterations */
  destructive?: boolean | undefined
  /** True if calling multiple times with same input produces identical state */
  idempotent?: boolean | undefined
  /** True to hide from discovery */
  hidden?: boolean | undefined
}

/**
 * CLI generation metadata
 */
export interface ToolCliConfig {
  /** Command name (defaults to tool name or category-stripped name) */
  command?: string | undefined
  /** Subcommand aliases */
  aliases?: string[] | undefined
  /** Positional CLI arguments mapping to schema fields */
  arguments?: Array<{
    name: string
    description?: string | undefined
    required?: boolean | undefined
  }> | undefined
  /** Example CLI invocations */
  examples?: string[] | undefined
}

/**
 * REST API generation metadata
 */
export interface ToolApiConfig {
  /** HTTP method (defaults: GET for readOnly, POST otherwise) */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | undefined
  /** Custom route path (defaults to /{category}/{name}) */
  path?: string | undefined
  /** OpenAPI documentation tags */
  tags?: string[] | undefined
  /** Custom HTTP status codes */
  statusCodes?: {
    success?: number | undefined
    created?: number | undefined
    notFound?: number | undefined
    validationError?: number | undefined
    serverError?: number | undefined
  } | undefined
}

/**
 * MCP-specific metadata
 */
export interface ToolMcpConfig {
  /** Custom MCP tool name (defaults to tool.name) */
  toolName?: string | undefined
}

/**
 * Schema input definition supporting:
 * 1. JSON Schema Draft 2020-12 / OpenAPI 3.1 Schema Object
 * 2. Zod Type (z.ZodType<T>)
 * 3. Custom validator object with validate/parse methods
 */
export type ToolSchema<T = unknown> =
  | z.ZodType<T, any, any>
  | Record<string, unknown>
  | {
      parse?: (input: unknown) => T
      safeParse?: (input: unknown) => { success: true; data: T } | { success: false; error: unknown }
      validate?: (input: unknown) => input is T
      _def?: unknown
      shape?: unknown
    }

/**
 * Type helper to infer schema input/output type
 */
export type InferSchema<T> =
  T extends z.ZodType<infer O, any, any>
    ? O
    : T extends { parse: (val: any) => infer O }
      ? O
      : any

/**
 * Tool execution handler accepting (ctx, input)
 */
export type ToolHandler<TInput = any, TOutput = any> = (
  ctx: ToolContext,
  input: TInput,
) => Promise<TOutput>

/**
 * Tool middleware
 */
export type ToolMiddleware<TInput = unknown, TOutput = unknown> = (
  ctx: ToolContext,
  input: TInput,
  next: () => Promise<TOutput>,
) => Promise<TOutput>

/**
 * Full Tool Definition preserving concrete TSchema for upstream validators
 */
export interface ToolDefinition<
  TInput = any,
  TOutput = any,
  TSchema extends ToolSchema<TInput> = any,
> {
  /** Unique tool identifier (e.g. 'sheets_vcs_commit') */
  name: string
  /** Human & LLM readable description */
  description: string
  /** Logical category for grouping (e.g. 'sheet-vcs', 'docs-writer') */
  category?: string | undefined
  /** Input schema specification */
  inputSchema: TSchema
  /** Optional output schema specification */
  outputSchema?: ToolSchema<TOutput> | undefined
  /** Core execution logic */
  execute: ToolHandler<TInput, TOutput>
  /** Behavioral hints */
  hints?: ToolHints | undefined
  /** CLI configuration */
  cli?: ToolCliConfig | undefined
  /** HTTP REST configuration */
  api?: ToolApiConfig | undefined
  /** MCP configuration */
  mcp?: ToolMcpConfig | undefined
  /** Middleware chain */
  middleware?: ToolMiddleware<TInput, TOutput>[] | undefined
}

/**
 * MCP Text Content item
 */
export interface ToolTextContent {
  type: 'text'
  text: string
}

/**
 * MCP Image Content item
 */
export interface ToolImageContent {
  type: 'image'
  data: string
  mimeType: string
}

/**
 * MCP CallToolResult per official Model Context Protocol
 */
export interface CallToolResult {
  content: Array<ToolTextContent | ToolImageContent>
  isError?: boolean | undefined
  _meta?: Record<string, unknown> | undefined
}
