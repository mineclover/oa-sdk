/**
 * @oa-sdk/tools — Universal Tool Engine for MCP, CLI, and REST APIs
 *
 * Grounded in the official Model Context Protocol (MCP) tool specification.
 * Designed with promotion in mind for seamless extraction into @oa-sdk/tools.
 */

import type {
  ToolDefinition,
  ToolHints,
  ToolCliConfig,
  ToolApiConfig,
  ToolMcpConfig,
  ToolMiddleware,
  ToolSchema,
  ToolContext,
} from './types.js'

/**
 * Define a type-safe tool with input inference from inputSchema
 */
export function defineTool<
  TInput = any,
  TOutput = any,
  TSchema extends ToolSchema<TInput> = any,
>(
  definition: {
    name: string
    description: string
    category?: string
    inputSchema: TSchema
    outputSchema?: ToolSchema<TOutput>
    execute: (ctx: ToolContext, input: TInput) => Promise<TOutput>
    hints?: ToolHints
    cli?: ToolCliConfig
    api?: ToolApiConfig
    mcp?: ToolMcpConfig
    middleware?: ToolMiddleware<TInput, TOutput>[]
  },
): ToolDefinition<TInput, TOutput, TSchema> {
  return definition as ToolDefinition<TInput, TOutput, TSchema>
}

/**
 * Alias for backward compatibility with unified-interface defineAction
 */
export const defineAction = defineTool

export * from './types.js'
export * from './context.js'
export * from './schema.js'
export * from './schema-bridge.js'
export * from './mcp.js'
export * from './cli.js'
export * from './http.js'
export * from './app.js'
export * from './peer.js'
export * from './chunk-stream.js'
