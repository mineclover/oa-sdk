/**
 * @oa-sdk/peer-transport — Protocol Types & Data Contracts
 */

export interface WebMcpPeerRecord {
  alias: string
  id?: string | undefined
  title?: string | undefined
  origin?: string | undefined
  signalingUrl?: string | undefined
  invitationUrl?: string | undefined
  token?: string | undefined
  status?: 'connected' | 'disconnected' | 'idle' | 'ready' | string | undefined
  allowedTools?: string[] | undefined
  cachedTools?: Array<{
    name: string
    description?: string | undefined
    inputSchema?: Record<string, unknown> | undefined
  }> | undefined
  skillManifest?: {
    id: string
    name: string
    version: string
    description: string
    instructions?: string | undefined
  } | undefined
  updatedAt?: number | undefined
}

export type TransportChannelType = 'mcp-jsonrpc' | 'crdt-delta' | 'presence'

export interface DataChannelPacket<TPayload = unknown> {
  channel: TransportChannelType
  payload: TPayload
  seq?: number | undefined
  timestamp?: number | undefined
  senderId?: string | undefined
  /** Reconnect epoch used to scope sequence numbers and prevent stale replay drops. */
  sessionEpoch?: number | undefined
}

export const TRANSPORT_CHANNELS = ['mcp-jsonrpc', 'crdt-delta', 'presence'] as const

export interface BridgeClientConfig {
  /** Local signaling/bridge daemon URL (default: http://127.0.0.1:8787) */
  serverUrl?: string | undefined
  /** Bearer token used for bridge requests. Remote plain HTTP is rejected when set. */
  authToken?: string | undefined
  /** Default target peer alias */
  alias?: string | undefined
  /** Path to local peers.json registry */
  storePath?: string | undefined
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number | undefined
  /** Window for retrying calls while peer refreshes (F5) in ms (default: 5000) */
  refreshRetryMs?: number | undefined
}

export interface PeerCallPayload {
  tool: string
  args?: Record<string, unknown> | undefined
  peer?: string | undefined
  sessionId?: string | undefined
  timeoutMs?: number | undefined
  /** Cancel this request. The signal is never sent over the wire. */
  signal?: AbortSignal | null | undefined
}

export interface PeerCallResult<T = unknown> {
  result?: T | undefined
  error?: string | undefined
  isError?: boolean | undefined
  status?: 'success' | 'error' | 'input_required' | undefined
  continuationToken?: string | undefined
  prompt?: string | undefined
}
