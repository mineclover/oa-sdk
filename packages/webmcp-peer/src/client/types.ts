export const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";
export const DEFAULT_TIMEOUT_MS = 10_000;
/** MCP revision the client asks for in `initialize` (the newest initialize-era revision). */
export const PROTOCOL_VERSION = "2025-11-25";
/**
 * This package's version, which the agent client names as `clientInfo.version` in `initialize` and
 * in its `user-agent`. It must equal `version` in package.json: a test fails when a release bumps one
 * without the other.
 */
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

/**
 * How a transport closed, as far as it knows: the WebSocket close `code` and `reason` (RFC 6455
 * §7.1.5, §7.1.6). The relay's codes and what they mean are `WEBMCP_CLOSE_CODES`; 1006 is a
 * connection lost without a close frame. A transport without close codes (Streamable HTTP) reports
 * none.
 */
export interface PeerMcpTransportClose {
  readonly code?: number;
  readonly reason?: string;
}

export interface PeerMcpTransportCallbacks {
  onOpen?(): void;
  onMessage?(message: unknown): void;
  /** The transport closed; `close` says how, when the transport knows (`TRANSPORT_CLOSED` details). */
  onClose?(close?: PeerMcpTransportClose): void;
  /**
   * An error that leaves the connection open (a write that failed, say): the requests waiting fail
   * with it, and those sent keep their ids and relay slots until their answers arrive. A transport
   * whose connection the error ends reports that with `onClose`.
   */
  onError?(error: Error): void;
}

/**
 * What a session sends on and the relay's frames come through: a transport the session makes for one
 * connection (WebSocket, Streamable HTTP), a `transportFactory`'s, or the caller's own
 * (`options.transport`), which every connect uses again.
 *
 * One transport object is held by one live connection at most, across every session: a connect that
 * starts on it (the caller's own as the connect starts, any other once the connect has it) ends the
 * connection that held it before, of the same session or another, with TRANSPORT_SUPERSEDED. A
 * connection closes its transport when it ends only while it still holds it.
 *
 * A request id and a relay slot end with their connection, so a transport reused across connects
 * (the caller's own, or one a factory hands out again) MUST NOT deliver on a later connection a
 * message passed to `send()` while an earlier connection was live: it drops such a send or fails it.
 * Nor should it report what an earlier connection gets (a late answer, its close) through a later
 * connect's callbacks. The transports the session makes are made for one connection each and, once
 * closed, send nothing (TRANSPORT_CLOSED) and report nothing more of a POST.
 */
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
  /**
   * The relay's session id for this client ticket (the `sessionId` `joinPeerRoom` returns), sent to
   * the relay as it is. Leave it out when unknown: the relay's WebSocket `ready` frame supplies it.
   */
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

/** Options of a session `PeerMcpService` creates: the session's options and its registry key. */
export interface PeerMcpServiceSessionOptions extends PeerMcpSessionOptions {
  /**
   * The key the service registers the session under (`getSession(key)`, `revoke(key)`, ...).
   * It is the service's own name for the session and never reaches the relay; without it the key
   * is the session's `sessionId`, or a new `peer-session-<uuid>` when there is none.
   */
  key?: string;
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
  /**
   * The MCP revision: the one `initialize` negotiated for a room, and `PROTOCOL_VERSION` for the
   * room-independent deployment catalog (`GET /mcp/catalog`), which negotiates none.
   */
  protocolVersion?: string;
  /**
   * The relay protocol a deployment catalog (`GET /mcp/catalog`) reports, `webmcp-peer.v1`
   * (`WEBMCP_SUBPROTOCOL`) for this relay. Absent for a room, which is discovered over MCP.
   */
  protocol?: string;
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
