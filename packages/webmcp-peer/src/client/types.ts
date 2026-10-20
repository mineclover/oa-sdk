export const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";
export const DEFAULT_TIMEOUT_MS = 10_000;
/** MCP revision the client asks for in `initialize` (the newest initialize-era revision). */
export const PROTOCOL_VERSION = "2025-11-25";
export const PACKAGE_VERSION = "0.1.0";

export type PeerMcpTransportMessage = Record<string, unknown> | string;

/** A JSON-RPC 2.0 response envelope as received from the peer; `result` and `error` are unvalidated. */
export interface PeerMcpRpcResponse {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

/** One MCP content block (`text`, `image`, `audio`, `resource_link`, `resource`, ...). */
export interface PeerMcpContentBlock {
  type: string;
  [key: string]: unknown;
}

/**
 * The validated `result` of a `tools/call`. `content` (when present) holds MCP content blocks,
 * `structuredContent` (when present) is a JSON object, and `isError` (when present) is a boolean.
 * Other members (for example the provider's legacy `data` mirror) pass through unvalidated.
 */
export interface PeerMcpCallToolResult {
  content?: PeerMcpContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface PeerMcpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  [key: string]: unknown;
}

export type PeerMcpSessionState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "disconnecting"
  | "error";

export interface PeerMcpCatalogSnapshot {
  cachedTools: PeerMcpTool[];
  catalogVersion: number | string;
  catalogHash: string;
  source: "peer";
  updatedAt: string | null;
  sessionId?: string;
  runtimeEpoch?: string;
  roomId?: string | null;
  roomEpoch?: number | null;
  serverUrl?: string;
  wsUrl?: string | null;
  mcpEndpoint?: string | null;
  state?: PeerMcpSessionState;
}

export interface PeerMcpSessionInfo {
  sessionId?: string;
  runtimeEpoch: string;
  state: PeerMcpSessionState;
  serverUrl: string;
  wsUrl: string | null;
  mcpEndpoint: string | null;
  roomId: string | null;
  roomEpoch: number | null;
  peerAlias: string | null;
  connectedAt: number | null;
  error: string | null;
  catalogVersion: number | string;
  catalogHash: string;
  toolsCount: number;
}

/** The tool catalog cache a session persists through its `storage` (see `JsonPeerMcpStore`). */
export interface PeerMcpCatalogCache {
  cachedTools: PeerMcpTool[];
  catalogVersion: number | string;
  catalogHash?: string;
  updatedAt: string | null;
}

export interface PeerMcpStore {
  load(): unknown;
  save(value: unknown): void;
}

export interface PeerMcpTransportCallbacks {
  onOpen?(): void;
  onMessage?(message: unknown): void;
  onClose?(): void;
  onError?(error: Error): void;
}

export interface PeerMcpTransport {
  raw?: boolean;
  readyState?: string | number;
  open?: boolean;
  connected?: boolean;
  connect?(callbacks?: PeerMcpTransportCallbacks): Promise<PeerMcpTransport | void> | PeerMcpTransport | void;
  send(value: PeerMcpTransportMessage): Promise<void> | void;
  close?(): Promise<void> | void;
  onMessage?: (message: unknown) => void;
  socket?: unknown;
}

export interface PeerMcpSessionOptions {
  serverUrl?: string;
  /** fetch used by the Streamable HTTP transport and by `revoke()`; defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  roomId?: string;
  roomEpoch?: number;
  descriptorUrl?: string;
  wsUrl?: string;
  mcpEndpoint?: string;
  clientToken?: string;
  peerAlias?: string;
  alias?: string;
  sessionId?: string;
  runtimeEpoch?: string;
  protocolVersion?: string;
  requestTimeoutMs?: number;
  WebSocket?: unknown;
  transport?: PeerMcpTransport;
  transportFactory?: (
    url: string,
    protocols: string[],
    callbacks: PeerMcpTransportCallbacks,
  ) => Promise<PeerMcpTransport> | PeerMcpTransport;
  storage?: PeerMcpStore;
}

export interface PeerMcpRequestOptions {
  id?: string | number;
  timeoutMs?: number;
  raw?: boolean;
}

export interface PeerMcpCallOptions extends PeerMcpRequestOptions {
  refresh?: boolean;
  readOnly?: boolean;
  retryOnCatalogChanged?: boolean;
}

export type PeerMcpListener = (info: PeerMcpSessionInfo) => void;
export type PeerMcpCatalogListener = (snapshot: PeerMcpCatalogSnapshot | Record<string, unknown>) => void;

export interface DiscoverPeerCatalogOptions {
  serverUrl?: string;
  roomId?: string;
  mcpEndpoint?: string;
  invitationUrl?: string;
  clientToken?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  protocolVersion?: string;
}

export interface DiscoveredPeerCatalog {
  serverInfo?: Record<string, unknown>;
  protocolVersion?: string;
  tools: PeerMcpTool[];
  catalogVersion: number | string;
  catalogHash: string;
  _meta?: Record<string, unknown>;
}

export interface JoinPeerRoomOptions {
  serverUrl?: string;
  roomId?: string;
  inviteToken?: string;
  invitationUrl?: string;
  clientLabel?: string;
  capabilities?: string[];
  fetchImpl?: typeof fetch;
}

/** The client ticket the relay issues from `POST /p/:id/join`. */
export interface PeerClientTicket {
  roomId: string;
  roomEpoch: number;
  clientToken: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
  approvalRequired: boolean;
  capabilities: string[];
  approvalState: string;
  state: string;
  approvalRequestId?: string;
  [key: string]: unknown;
}

/** A redeemed invitation: the relay's client ticket plus the endpoints the client derived for the room. */
export interface JoinedPeerRoom extends PeerClientTicket {
  serverUrl: string;
  wsUrl: string;
  mcpEndpoint: string;
}

export interface PeerSessionStatusOptions {
  serverUrl?: string;
  roomId?: string;
  sessionId?: string;
  clientToken?: string;
  fetchImpl?: typeof fetch;
}

export interface WaitForPeerApprovalOptions extends PeerSessionStatusOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RotatePeerRoomOptions {
  serverUrl?: string;
  roomId?: string;
  providerToken?: string;
  roomEpoch?: number;
  alias?: string;
  fetchImpl?: typeof fetch;
}
