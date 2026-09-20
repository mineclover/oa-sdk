/**
 * @oa-sdk/tools — TypeSpec JSON Schema to Tool Bridge
 *
 * Grounded in the Pragmatic Schema Bridge pattern:
 * Directly consumes TypeSpec compiled JSON Schema Draft 2020-12 definitions
 * into MCP Tool and CLI definitions with 0 schema drift, field picking/omitting,
 * LLM description overrides, and zero duplicate typing.
 */
import { defineTool } from './index.js'
import type {
  ToolDefinition,
  ToolContext,
  ToolHints,
  ToolCliConfig,
  ToolApiConfig,
  ToolMcpConfig,
  ToolMiddleware,
} from './types.js'
import {
  normalizeJsonSchema,
  type JsonSchemaObject,
  type JsonSchemaProperty,
} from './schema.js'

export interface SchemaBridgeOptions<TInput = any, TOutput = any> {
  /** Tool name (e.g. 'drive_upload_file') */
  name: string
  /** Human & LLM readable description explaining what the tool does */
  description: string
  /** Optional categorization (e.g. 'drive', 'users') */
  category?: string
  /**
   * The source JSON Schema from TypeSpec (e.g. schemas.UploadFileRequest, or $defs.Order)
   */
  schema: JsonSchemaObject | Record<string, unknown>
  /**
   * Fields to pick from the source schema. If specified, only these properties are included.
   */
  pick?: string[]
  /**
   * Fields to omit from the source schema (e.g. internal ID, audit fields).
   */
  omit?: string[]
  /**
   * Override the required fields list. If not specified, uses source schema's required list.
   */
  required?: string[]
  /**
   * Property overrides (e.g. providing agent-tailored descriptions or defaults)
   */
  overrides?: Record<string, Partial<JsonSchemaProperty>>
  /**
   * Additional properties to extend the tool with (e.g. isBase64: boolean for LLM convenience)
   */
  extend?: Record<string, JsonSchemaProperty>
  /**
   * Execution handler
   */
  execute: (ctx: ToolContext, input: TInput) => Promise<TOutput>
  hints?: ToolHints
  cli?: ToolCliConfig
  api?: ToolApiConfig
  mcp?: ToolMcpConfig
  middleware?: ToolMiddleware<TInput, TOutput>[]
}

/**
 * Creates a type-safe ToolDefinition directly from a TypeSpec/JSON Schema.
 *
 * Eliminates schema duplication between TypeSpec models and MCP/CLI tools.
 */
export function createSchemaTool<TInput = any, TOutput = any>(
  options: SchemaBridgeOptions<TInput, TOutput>,
): ToolDefinition<TInput, TOutput> {
  const base = normalizeJsonSchema(options.schema as any)
  const sourceProps = base.properties ?? {}
  const targetProps: Record<string, JsonSchemaProperty> = {}
  let targetRequired = new Set<string>(base.required ?? [])

  // 1. Pick filter
  const allowedKeys = options.pick ? new Set(options.pick) : new Set(Object.keys(sourceProps))

  // 2. Omit filter
  if (options.omit) {
    for (const omitKey of options.omit) {
      allowedKeys.delete(omitKey)
      targetRequired.delete(omitKey)
    }
  }

  for (const [key, prop] of Object.entries(sourceProps)) {
    if (allowedKeys.has(key)) {
      targetProps[key] = { ...prop }
    }
  }

  // 3. Property overrides
  if (options.overrides) {
    for (const [key, override] of Object.entries(options.overrides)) {
      if (targetProps[key]) {
        targetProps[key] = { ...targetProps[key], ...override }
      }
    }
  }

  // 4. Extend additional properties
  if (options.extend) {
    for (const [key, prop] of Object.entries(options.extend)) {
      targetProps[key] = prop
    }
  }

  // 5. Explicit required override
  if (options.required) {
    targetRequired = new Set(options.required)
  }

  const finalSchema: JsonSchemaObject = {
    type: 'object',
    properties: targetProps,
    required: targetRequired.size > 0 ? Array.from(targetRequired) : undefined,
    description: base.description ?? options.description,
  }

  return defineTool({
    name: options.name,
    description: options.description,
    inputSchema: finalSchema,
    execute: options.execute,
    ...(options.category !== undefined ? { category: options.category } : {}),
    ...(options.hints !== undefined ? { hints: options.hints } : {}),
    ...(options.cli !== undefined ? { cli: options.cli } : {}),
    ...(options.api !== undefined ? { api: options.api } : {}),
    ...(options.mcp !== undefined ? { mcp: options.mcp } : {}),
    ...(options.middleware !== undefined ? { middleware: options.middleware } : {}),
  })
}
