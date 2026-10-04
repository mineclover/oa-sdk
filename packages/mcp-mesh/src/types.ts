/**
 * @oa-sdk/mcp-mesh — Protocol Types & Domain Contracts
 *
 * Implements 1:N Domain Skill vs Runtime Session Instance Separation.
 */
import type { ToolDefinition } from '@oa-sdk/tools'

export interface DomainSkillDefinition {
  /** Canonical domain name (e.g. 'wireframe', 'git', 'database') */
  domain: string
  /** Human-readable title */
  name: string
  /** Version */
  version: string
  /** Description */
  description: string
  /** Agent system prompt instructions / usage guide */
  instructions?: string | undefined
  /** Canonical tool definitions for this domain */
  tools: ToolDefinition[]
  /** Collaborative workspace folder scoping rules */
  workspaceRules?: {
    allowedPaths?: string[] | undefined
    readOnly?: boolean | undefined
  } | undefined
}

export type McpTransportType = 'p2p-webrtc' | 'bridge-http' | 'stdio' | 'http-stateless'

export interface McpSessionInstance {
  /** Unique session ID (e.g. peer id or tab UUID) */
  sessionId: string
  /** The canonical domain this session belongs to (e.g. 'wireframe') */
  domain: string
  /** Friendly alias (e.g. 'wireframe-local', 'wireframe-tab-2') */
  alias: string
  /** Transport mechanism */
  transportType: McpTransportType
  /** Physical endpoint URL if applicable */
  endpointUrl?: string | undefined
  /** Current connection status */
  status: 'active' | 'idle' | 'disconnected'
  /** Invocation handler executing tools on this session instance */
  callTool: (toolName: string, args?: Record<string, unknown>) => Promise<any>
  /** Metadata */
  meta?: Record<string, unknown> | undefined
}

export interface SkillPackage {
  domain: string
  name: string
  version: string
  description: string
  instructions?: string | undefined
  tools: Array<{
    name: string
    description: string
    inputSchema: Record<string, unknown>
    annotations?: {
      readOnly?: boolean | undefined
      destructive?: boolean | undefined
      idempotent?: boolean | undefined
    } | undefined
  }>
  workspaceRules?: {
    allowedPaths?: string[] | undefined
    readOnly?: boolean | undefined
  } | undefined
}

export interface MetaSkillDefinition {
  name: string
  version: string
  description: string
  /** Required domain skills that must have at least one active session */
  requiresDomains: string[]
  instructions: string
  workflow?: Array<{ step: string; description?: string }> | undefined
}

export interface MeshRoutingDecision {
  domain: string
  session: McpSessionInstance
  toolName: string
}
