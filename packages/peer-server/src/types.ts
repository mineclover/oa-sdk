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
  /**
   * Bearer secret (`Authorization: Bearer` or `X-Peer-Publish-Key`) required on
   * every HTTP API request except `POST /p/:roomId/join`, whose credential is
   * the room's invite token. Required for non-loopback listeners. WebSocket
   * relay upgrades are authorized by their per-room ticket instead.
   */
  publishKey?: string | undefined
  /** Maximum JSON request body size in bytes (default: 1 MiB). */
  maxBodyBytes?: number | undefined
  /** Maximum number of in-flight provider calls (default: 1024). */
  maxPendingCalls?: number | undefined
  /**
   * Enable WebSocket signaling & packet relay (default: false). The relay
   * answers `ws://host:port/p/:roomId/:role` and
   * `ws://host:port/ws?room=:roomId&role=:role`; both the room and the role
   * (`provider` or `client`) are required, and other `/ws` or `/p/` upgrades
   * are refused with 400. Rooms come from `POST /relay/rooms`.
   *
   * @important Must be set to `true` when browser peers connect via `createWebSocketTransportAdapter`.
   * When `false`, no upgrade is answered by the relay.
   */
  enableRelay?: boolean | undefined
  /**
   * Enable Cloud Transit proxy routes at `/transit/:peer/mcp` and `/mcp` (default: false).
   * Together with `enableRelay`, a relay provider that connects with
   * `alias=<peer-alias>` serves the Cloud Transit calls for that alias.
   *
   * @important Must be set to `true` when external AI agents invoke tools via `createCloudTransitClient`.
   * When `false`, POST requests to `/transit/:peer/mcp` return 404 Not Found.
   */
  enableCloudTransit?: boolean | undefined
  /** Idle limit of an approved relay session in ms; any relay frame renews it (default 5 minutes, 0 disables). */
  relayIdleTimeoutMs?: number | undefined
  /** Hard limit of an approved relay session in ms (default 24 hours). */
  relayMaxSessionMs?: number | undefined
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
