import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { DeploymentCatalogInput } from "./deployment-catalog.js";
import type { WebMcpPeerServer } from "./peer-server.js";
import type { PublishRateLimitStore } from "./rate-limit.js";
import type { PeerSocket } from "./ws-upgrade.js";

export type PeerCapability = "mcp-control" | "mcp-crdt";
export type ClientSessionStatus = "pending" | "approved" | "rejected" | "revoked" | "expired" | "room-rotated";

export interface ClientSessionTicket {
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
  status: ClientSessionStatus;
  approvedAt?: number;
  revokedAt?: number;
  approvalRequestId?: string;
  clientLabel?: string;
  readonly capabilities: readonly PeerCapability[];
}

export interface PendingApprovalRequest {
  requestId: string;
  /** The SHA-256 hex of the ticket's client token: its key in `RoomEntry.clientTickets`. */
  clientTokenHash: string;
  sessionId: string;
  roomId: string;
  roomEpoch: number;
  clientLabel: string;
  identity: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
}

export interface PendingMcpRequest {
  socket: PeerSocket;
  timer: ReturnType<typeof setTimeout>;
  method: string;
  id: string | number;
  wireId: string | number;
  includeCatalogMeta?: boolean;
  /**
   * True for an agent's `tools/list` without a `cursor` and its `server/discover`: the result lists
   * the provider's whole catalog, which the relay adopts. When the relay refuses that catalog, or
   * the provider answers with an error, the relay answers from its own catalog instead, as its HTTP
   * route would. No other reply, such as a `tools/call` result or a page of a paginated listing,
   * can change the room catalog.
   */
  listsCatalog?: boolean;
  /**
   * For a `server/discover`: the MCP protocol version the relay negotiated from the request, which
   * a discover result the relay answers itself carries.
   */
  protocolVersion?: string;
}

export interface RoomEntry {
  id: string;
  roomEpoch: number;
  roomState: "provisioned" | "provider-connected" | "accepting-clients" | "active" | "rotating" | "rotated" | "expired";
  createdAt: number;
  updatedAt: number;
  alias: string;
  ownerId?: string;
  providerToken: string;
  inviteToken: string;
  inviteConsumed: boolean;
  capabilities: readonly PeerCapability[];
  approvalRequired: boolean;
  expiresAt: number;
  providerSocket?: PeerSocket;
  clientSockets: Set<PeerSocket>;
  cachedTools?: unknown[];
  catalogSource?: "deployment" | "provider";
  catalogVersion: number;
  catalogHash: string;
  catalogUpdatedAt?: number;
  mcpPending: Map<string, PendingMcpRequest>;
  /**
   * The room's client tickets, keyed by the SHA-256 hex of each ticket's client token. The relay
   * keeps no client token itself: it finds a ticket by hashing the token presented, so the secret is
   * never compared character by character, like the provider token and the reconnect lease.
   */
  clientTickets: Map<string, ClientSessionTicket>;
  pendingApprovals: Map<string, PendingApprovalRequest>;
  clientSocketTickets: Map<PeerSocket, ClientSessionTicket>;
  rotatedTo?: string;
  reconnectLeaseToken: string;
  reconnectLeaseHash: string;
  reconnectLeaseExpiresAt: number;
  rotatedRetainUntil?: number;
  metadataRetainUntil?: number;
}

export interface WebMcpPeerServerOptions {
  port?: number;
  host?: string;
  allowedOrigins?: string[];
  allowedHosts?: string[];
  configPath?: string;
  publishKey?: string;
  publishKeyOwner?: string;
  publishRateLimitWindowMs?: number;
  publishRateLimitMax?: number;
  /**
   * The publish rate-limit store. Without one the relay opens the store its configuration names
   * (`resolvePeerServerConfig`): a `SqlitePublishRateLimitStore` at `publishRateLimitSqlitePath`
   * (closed with the relay), else a `FilePublishRateLimitStore` at `publishRateLimitPath`, else it
   * keeps the limits in memory.
   */
  publishRateLimitStore?: PublishRateLimitStore;
  mcpRequestTimeoutMs?: number;
  roomSweepIntervalMs?: number;
  /**
   * Upper bound for a room's `ttlMs` on `POST /p` and `POST /p/:id/rotate` (default 24 hours,
   * clamped to `[60_000, 365 days]`). Larger requested TTLs are clamped, so every room expires and
   * is eventually swept.
   */
  maxRoomTtlMs?: number;
  /**
   * CLI arguments to resolve (`--port`, `--host`, `--config`, `--publish-key`, ...). Default: none.
   * The embedded server never reads `process.argv` on its own; a CLI entry point opts in with
   * `argv: process.argv.slice(2)`. When given, CLI flags take precedence over these options.
   */
  argv?: readonly string[];
  /**
   * Load `.env.local` / `.env` from `cwd` and up to three parent directories into `process.env`
   * (existing variables are never overwritten) before resolving the configuration. Default: `false`,
   * so constructing a server never mutates the host process environment.
   */
  loadEnvFiles?: boolean;
  /**
   * Directory used to resolve config files, `.env` files and relative paths, including the deployment
   * catalog candidates (`api/webmcp-tools.json`, `$WEBMCP_CATALOG_PATH`). Default: `process.cwd()`.
   */
  cwd?: string;
  deploymentCatalog?: DeploymentCatalogInput;
  serverName?: string;
  serverVersion?: string;
  /**
   * Optional custom HTTP route hook invoked after CORS/Origin validation and
   * before `/p/*` room routes. Return `true` if the request was handled.
   */
  customHttpHandler?: (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    origin: string | undefined,
    server: WebMcpPeerServer,
  ) => Promise<boolean> | boolean;
  /**
   * Optional custom WebSocket upgrade hook invoked after Origin validation and
   * before `/p/:id/provider` and `/p/:id/client` routes. Return `true` if handled.
   */
  customUpgradeHandler?: (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    url: URL,
    origin: string | undefined,
    server: WebMcpPeerServer,
  ) => Promise<boolean> | boolean;
  /** Optional custom error mapper for unhandled HTTP exceptions. */
  formatHttpError?: (
    req: IncomingMessage,
    error: unknown,
  ) => { status: number; error: string; requestId?: string };
}
