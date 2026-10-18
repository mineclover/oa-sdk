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
  clientToken: string;
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
  clientTokens: Map<string, ClientSessionTicket>;
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
  journalPath?: string;
  publishKey?: string;
  publishKeyOwner?: string;
  publishRateLimitWindowMs?: number;
  publishRateLimitMax?: number;
  publishRateLimitStore?: PublishRateLimitStore;
  mcpRequestTimeoutMs?: number;
  roomSweepIntervalMs?: number;
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
