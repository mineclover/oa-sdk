import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { DeploymentCatalogInput } from "./deployment-catalog.js";
import type { WebMcpPeerServer } from "./peer-server.js";
import type { PublishRateLimitStore } from "./rate-limit.js";
import type { PeerSocket } from "./ws-upgrade.js";

export type PeerCapability = "mcp-control" | "mcp-crdt";
/**
 * The status of a client ticket. `expired` is a ticket whose approval request expired or whose room
 * expired; `room-rotated` one its room's rotation ended, which session status never reports (it
 * answers a rotated room 410 ROOM_ROTATED) but the `_meta.auth.state` of an MCP metadata request
 * made with the ticket does.
 */
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
  /**
   * The client ticket that authorized the request, over WebSocket or HTTP. When the ticket ends
   * (revoked, rejected, ended by a rotation or the room's expiry), every request it authorized ends
   * with it, an HTTP one too, although no client socket of the ticket carries it.
   */
  ticket?: ClientSessionTicket;
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
  /**
   * The room's state. `rotating` lasts only while a rotation runs, within one synchronous step, so
   * no response or frame ever shows it.
   */
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
  /**
   * When the reconnect lease expires as things stand. While a provider socket is attached the lease
   * lasts as long as the room (`expiresAt`); from the moment none is (the room was created or
   * reclaimed, or its provider socket went away) it expires 15 minutes later, or with the room.
   */
  reconnectLeaseExpiresAt: number;
  /**
   * When the relay deletes the room, after which its id is answered 404 ROOM_NOT_FOUND: its original
   * `expiresAt` plus 24 hours. An expired room and a rotated one are retained until then alike, so
   * their lifecycle routes answer 410 ROOM_EXPIRED or 410 ROOM_ROTATED rather than 404.
   */
  metadataRetainUntil?: number;
}

export interface WebMcpPeerServerOptions {
  port?: number;
  host?: string;
  /**
   * The browser origins the relay serves (`isOriginAllowed` rules). Configured here, in the config
   * file, `ALLOWED_ORIGINS` or the CLI, the lists replace the default policy (the relay's own
   * origin and `DEFAULT_ALLOWED_ORIGINS`); a request from any other origin gets 403
   * ORIGIN_NOT_ALLOWED. A request without an Origin is not from a browser page and is served.
   */
  allowedOrigins?: string[];
  /**
   * The hosts requests may be addressed to besides the relay's own `host` (`isHostAllowed` rules),
   * replacing `DEFAULT_ALLOWED_HOSTS` when configured here or elsewhere. Configuring them, or
   * binding a loopback `host`, makes the relay refuse a request for any other host with 403
   * HOST_NOT_ALLOWED, which keeps a DNS-rebound page out.
   */
  allowedHosts?: string[];
  /**
   * Which peers the relay takes `X-Forwarded-Proto`, `X-Forwarded-Host` and `X-Forwarded-For` from
   * (default `false`: none, so the headers are ignored). `true` trusts the relay's own peer, one
   * proxy in front of it; a list names the IP addresses and CIDR ranges of trusted proxies. From a
   * trusted proxy, the scheme (`http` or `https` only) and host of the descriptors' base URL are the
   * last values of those headers, and the publish rate limit counts the client `X-Forwarded-For`
   * names past the trusted hops (see `WebMcpPeerServer.clientAddress`). Also `trustProxy` in the
   * config file, `PEER_SERVER_TRUST_PROXY` or `--trust-proxy` (`true`, `false`, or a list).
   */
  trustProxy?: boolean | readonly string[];
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
  /** How long a relayed MCP request waits for the provider's answer (default 30 s, at least 1 s). */
  mcpRequestTimeoutMs?: number;
  /**
   * How long an approval request waits for the host's decision (default 5 minutes, at least 1 s;
   * `Infinity` waits as long as the room lives), never past the room's expiry. A person decides it,
   * so it does not share the MCP request timeout. A request nobody decides in time ends its ticket
   * as `expired`: the agent and the provider get `approval.expired`, and the room serves no other
   * agent (its invite is used) until it is rotated.
   */
  approvalTimeoutMs?: number;
  roomSweepIntervalMs?: number;
  /**
   * How often, in milliseconds, the relay pings each provider and client socket with an RFC 6455
   * ping, which browser and Node WebSocket clients answer on their own (default
   * `WEBSOCKET_PING_INTERVAL_MS`, 30 s): a number from 1 to 2147483647, or the constructor throws a
   * RangeError.
   */
  webSocketPingIntervalMs?: number;
  /**
   * How long, in milliseconds, the relay waits to hear anything from a provider or client socket
   * before it closes it with 1001 (Going Away), a peer that vanished without closing its connection
   * (default `WEBSOCKET_IDLE_TIMEOUT_MS`, 75 s): a number from 1 to 2147483647 and longer than
   * `webSocketPingIntervalMs`, or the constructor throws a RangeError.
   */
  webSocketIdleTimeoutMs?: number;
  /**
   * Upper bound for a room's `ttlMs` on `POST /p` and `POST /p/:id/rotate` (default 24 hours,
   * clamped to `[60_000, 365 days]`). Larger requested TTLs are clamped, so every room expires and
   * is eventually swept.
   */
  maxRoomTtlMs?: number;
  /**
   * The most rooms the relay holds at once (default 10000; a number of at least 1, `Infinity` for
   * no bound). Expired and rotated rooms the relay still retains count, until they are deleted a
   * day after their expiry. At the bound, `POST /p` and `POST /p/:id/rotate` answer 503
   * ROOM_CAPACITY_EXCEEDED with `Retry-After` until the first held room is deleted.
   */
  maxRooms?: number;
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
   * Optional custom HTTP route hook invoked after the Host and Origin validation, the CORS
   * preflight, the health routes and `GET /config`, and before `/p/*` room routes. Return `true`
   * if the request was handled.
   */
  customHttpHandler?: (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    origin: string | undefined,
    server: WebMcpPeerServer,
  ) => Promise<boolean> | boolean;
  /**
   * Optional custom WebSocket upgrade hook invoked after the Host and Origin validation and before
   * the relay checks the opening handshake and routes `/p/:id/provider` and `/p/:id/client`, so it
   * may take any upgrade. Return `true` if handled.
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
