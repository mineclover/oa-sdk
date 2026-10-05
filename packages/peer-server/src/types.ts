/**
 * @oa-sdk/peer-server — Types & Protocol Contracts
 */
import type { WebMcpPeerRecord } from '@oa-sdk/peer-transport'

export interface PeerServerOptions {
  /** Server port (default: 8787) */
  port?: number | undefined
  /** Server hostname (default: 127.0.0.1) */
  hostname?: string | undefined
  /** Path to ~/.webmcp/peers.json store */
  storePath?: string | undefined
  /** Allowed browser origins. Defaults to exact loopback origins. */
  allowedOrigins?: string[] | undefined
  /** Default peer alias if not specified */
  defaultAlias?: string | undefined
  /** Bearer secret required on every API request. Required for non-loopback listeners. */
  publishKey?: string | undefined
  /** Maximum JSON request body size in bytes (default: 1 MiB). */
  maxBodyBytes?: number | undefined
  /** Maximum number of in-flight provider calls (default: 1024). */
  maxPendingCalls?: number | undefined
}

/** JSON-RPC tool call the server forwards to a provider socket. */
export interface SignalingToolCallMessage {
  type: 'mcp'
  message: {
    jsonrpc: '2.0'
    id: number
    method: 'tools/call'
    params: { name: string; arguments: Record<string, unknown> }
  }
}

export interface SignalingPeerSocket {
  send: (message: SignalingToolCallMessage) => void
  close?: () => void
}

export interface SignalingRoomEntry {
  id: string
  alias: string
  title?: string | undefined
  origin?: string | undefined
  token?: string | undefined
  status: 'connected' | 'disconnected' | 'refreshing'
  providerSocket?: SignalingPeerSocket | undefined
  allowedTools?: string[] | undefined
  /** The provider's tool catalog as announced; GET /tools serves it as-is. */
  cachedTools: Array<{
    name: string
    description?: string | undefined
    inputSchema?: Record<string, unknown> | undefined
    title?: string | undefined
    annotations?: Record<string, unknown> | undefined
    outputSchema?: Record<string, unknown> | undefined
    /** Other JSON members of the announced tool, such as `_meta`. */
    [member: string]: unknown
  }>
  updatedAt: number
}

export interface PeerStoreData {
  version: number
  activeAlias?: string | undefined
  peers: Record<string, WebMcpPeerRecord>
}
