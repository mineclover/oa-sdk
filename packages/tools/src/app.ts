/**
 * @oa-sdk/tools — ToolApp Orchestrator
 *
 * Unified application builder connecting tools with MCP, CLI, and REST interfaces.
 */
import type { Command } from 'commander'
import type { Hono } from 'hono'
import type { ServerType } from '@hono/node-server'
import { createCli, type CliAdapterOptions } from './cli.js'
import { createHttpApp, serveHttpApp, type HttpAdapterOptions } from './http.js'
import { createMcpServer, type McpServerInstance, type McpServerOptions } from './mcp.js'
import type { ToolDefinition } from './types.js'

export interface ToolAppConfig {
  name: string
  version?: string | undefined
  description?: string | undefined
}

export class ToolApp {
  readonly config: ToolAppConfig
  private toolList: ToolDefinition[] = []

  constructor(config: ToolAppConfig) {
    this.config = config
  }

  /**
   * Register one or more tools with this app
   */
  tools(...tools: ToolDefinition<any, any, any>[]): this {
    this.toolList.push(...tools)
    return this
  }

  /**
   * Alias for backward compatibility with unified-interface
   */
  actions(...actions: ToolDefinition<any, any, any>[]): this {
    return this.tools(...actions)
  }

  /**
   * Get all registered tools
   */
  getTools(): ToolDefinition[] {
    return [...this.toolList]
  }

  /**
   * Alias for backward compatibility
   */
  getActions(): ToolDefinition[] {
    return this.getTools()
  }

  /**
   * Find a tool by name or MCP toolName
   */
  getTool(name: string): ToolDefinition | undefined {
    return this.toolList.find((t) => t.name === name || t.mcp?.toolName === name)
  }

  /**
   * Build MCP server instance
   */
  buildMcp(options?: Partial<McpServerOptions>): McpServerInstance {
    return createMcpServer(this.toolList, {
      name: this.config.name,
      version: this.config.version ?? '1.0.0',
      description: this.config.description,
      ...options,
    })
  }

  /**
   * Run MCP server on stdio transport (for Cursor, Claude Desktop, Cline)
   */
  async runMcpStdio(options?: Partial<McpServerOptions>): Promise<void> {
    const mcp = this.buildMcp(options)
    await mcp.runStdio()
  }

  /**
   * Start MCP server on HTTP transport (for local testing & inspector)
   */
  async serveMcp(options?: { port?: number; hostname?: string }): Promise<void> {
    const mcp = this.buildMcp()
    await mcp.serveHttp(options)
  }

  /**
   * Build Commander CLI instance
   */
  buildCli(options?: CliAdapterOptions): Command {
    return createCli(this.toolList, {
      name: this.config.name.toLowerCase().replace(/\s+/g, '-'),
      version: this.config.version ?? '1.0.0',
      description: this.config.description,
      ...options,
    })
  }

  /**
   * Run CLI with argv
   */
  async runCli(argv?: string[], options?: CliAdapterOptions): Promise<void> {
    const program = this.buildCli(options)
    await program.parseAsync(argv ?? process.argv)
  }

  /**
   * Build Hono HTTP API application
   */
  buildApi(options?: HttpAdapterOptions): Hono {
    return createHttpApp(this.toolList, {
      title: this.config.name,
      version: this.config.version ?? '1.0.0',
      description: this.config.description,
      ...options,
    })
  }

  /**
   * Start HTTP API server
   */
  async serveApi(options?: HttpAdapterOptions): Promise<ServerType> {
    return serveHttpApp(this.toolList, {
      title: this.config.name,
      version: this.config.version ?? '1.0.0',
      description: this.config.description,
      ...options,
    })
  }
}

/**
 * Create a new ToolApp instance
 */
export function createToolApp(config: ToolAppConfig): ToolApp {
  return new ToolApp(config)
}

/**
 * Alias for backward compatibility with unified-interface createApp
 */
export const createApp = createToolApp
