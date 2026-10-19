export const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";
export const DEFAULT_TIMEOUT_MS = 10_000;
/** MCP revision the client asks for in `initialize` (the newest initialize-era revision). */
export const PROTOCOL_VERSION = "2025-11-25";
export const PACKAGE_VERSION = "0.1.0";

export type PeerMcpTransportMessage = Record<string, unknown> | string;

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

export interface JoinedPeerRoom {
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
  serverUrl: string;
  wsUrl: string;
  mcpEndpoint: string;
  [key: string]: unknown;
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
