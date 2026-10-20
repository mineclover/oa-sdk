import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isUtf8 } from "node:buffer";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Duplex } from "node:stream";
import { TLSSocket } from "node:tls";
import { MCP_INITIALIZE_PROTOCOL_VERSIONS } from "../provider/commit-receipt.js";
import {
  hashDeploymentCatalog,
  loadDeploymentCatalog,
  normalizeToolCatalog,
  type DeploymentCatalogSnapshot,
} from "./deployment-catalog.js";
import {
  FilePublishRateLimitStore,
  InMemoryPublishRateLimitStore,
  validatePublishRateLimitDecision,
  type PublishRateLimitDecision,
  type PublishRateLimitStore,
} from "./rate-limit.js";
import {
  isHostAllowed,
  isOriginAllowed,
  resolvePeerServerConfig,
} from "./server-config.js";
import type {
  ClientSessionStatus,
  ClientSessionTicket,
  PeerCapability,
  PendingApprovalRequest,
  PendingMcpRequest,
  RoomEntry,
  WebMcpPeerServerOptions,
} from "./types.js";
import {
  JsonObjectBodySchema,
  PeerFrameSchema,
  type WireSchema,
} from "./wire-schemas.js";
import {
  MAX_WEBSOCKET_MESSAGE_BYTES,
  MAX_WEBSOCKET_OUTBOUND_BUFFER_BYTES,
  MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES,
  upgradeWebSocket,
  type PeerSendResult,
  type PeerSocket,
} from "./ws-upgrade.js";
import { isBodyConsumedError, readBoundedBody, type BoundedBody } from "./http-body.js";
import {
  PEER_RELAY_MAX_ANNOUNCEMENT_BYTES,
  PEER_RELAY_MAX_PENDING_REQUESTS,
  PEER_RELAY_MAX_REQUEST_BYTES,
  PEER_RELAY_MAX_REQUEST_ID_BYTES,
  utf8ByteLength,
} from "../config/limits.js";

/** Default upper bound for a room's `ttlMs` (24 hours); see `WebMcpPeerServerOptions.maxRoomTtlMs`. */
const DEFAULT_MAX_ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_ROOM_TTL_MS = 60_000;
/** Hard ceiling for `maxRoomTtlMs`, which keeps every room timestamp inside the JS Date range. */
const ROOM_TTL_CEILING_MS = 365 * 24 * 60 * 60 * 1000;
const ROOM_METADATA_RETAIN_MS = 24 * 60 * 60_000;
/** The default size limit of a JSON request body (`readJsonBody`) outside the MCP endpoint. */
const MAX_JSON_BODY_BYTES = 64 * 1024;
/**
 * The largest identifier an agent gives the relay that the answer repeats, as UTF-8 bytes of its
 * JSON text: a JSON-RPC request id, and the `requestId` of an `offer` (the provider's `answer` and
 * `release` frames repeat it). Every reply echoes the id, so with this bound the `tools/list` reply
 * for any catalog the relay accepts (an announcement of at most PEER_RELAY_MAX_ANNOUNCEMENT_BYTES)
 * fits the relay message limit, a pending request holds at most this much of it, and the provider's
 * answer to an offer fits beside its SDP. A longer one is refused up front (REQUEST_ID_TOO_LARGE)
 * rather than forwarded for an answer that could never be sent.
 */
const MAX_RPC_ID_BYTES = PEER_RELAY_MAX_REQUEST_ID_BYTES;
/**
 * The most requests one agent WebSocket may have waiting at a time, for the provider or for the
 * agent to read their replies (see `AgentOutbox`): PEER_RELAY_MAX_PENDING_REQUESTS, which the agent
 * client keeps to by queueing its own requests.
 */
const MAX_PENDING_REQUESTS_PER_SOCKET = PEER_RELAY_MAX_PENDING_REQUESTS;
/**
 * The most client WebSockets one client ticket holds open. Every socket of a room receives each
 * catalog announcement and notification, so this bounds what one agent can make the relay send. A
 * socket past the bound replaces the ticket's oldest one (a reconnect whose previous socket the
 * relay has not yet seen close).
 */
const MAX_CLIENT_SOCKETS_PER_TICKET = 4;
/**
 * How many `register` frames that change nothing the relay evaluates for one room at once: those
 * it refuses (CATALOG_INVALID, CATALOG_TOO_LARGE) and those that carry the catalog the room already
 * holds. Evaluating a catalog (normalizing, hashing and measuring it) costs far more than receiving
 * it, so a provider that kept sending such frames would otherwise spend relay CPU at the rate it
 * sends. One more is allowed every REGISTER_EVALUATION_INTERVAL_MS, up to this many; a frame that
 * changes the catalog is evaluated whenever one is allowed and uses none (see `receiveRegister`).
 */
const REGISTER_EVALUATION_BURST = 8;
/** How often one more `register` evaluation is allowed once REGISTER_EVALUATION_BURST is used up. */
const REGISTER_EVALUATION_INTERVAL_MS = 1_000;

/**
 * Non-MCP frame types a client socket may relay to the provider. Every other type is dropped, so
 * a client can never inject relay-authored control frames (`session.revoked`, `room.rotated`,
 * `approval.*`, `register`, ...) into the provider's signaling channel.
 */
const CLIENT_SIGNALING_FRAME_TYPES: ReadonlySet<string> = new Set(['offer']);

type RpcRequest = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: unknown };
type RpcErrorBody = { code: number; message: string; data?: unknown };

/** A request over the agent request limit (PEER_RELAY_MAX_REQUEST_BYTES), which the relay does not forward. */
const REQUEST_TOO_LARGE_ERROR: RpcErrorBody = {
  code: -32600,
  message: 'REQUEST_TOO_LARGE',
  data: { limitBytes: PEER_RELAY_MAX_REQUEST_BYTES },
};
/** A request the relay cannot forward because the provider socket is closing or closed. */
const PROVIDER_UNAVAILABLE_ERROR: RpcErrorBody = { code: -32001, message: 'PROVIDER_UNAVAILABLE' };
/**
 * A request the relay did not forward because the provider's outbound queue is full: the provider
 * has not yet read what the relay already sent it. Nothing reached the provider and it stays
 * attached, so the agent may send the request again.
 */
const PROVIDER_BUSY_ERROR: RpcErrorBody = { code: -32001, message: 'PROVIDER_BUSY', data: { retryable: true } };
/** The `Retry-After` (seconds) of an HTTP agent's PROVIDER_BUSY response. */
const PROVIDER_BUSY_RETRY_AFTER_SECONDS = 1;
/**
 * The longest `clientLabel` a join keeps, in Unicode code points (at most 1 KiB of UTF-8). The label
 * is only shown to the provider's user, in every `approval.request`, so a longer one is truncated
 * rather than refused.
 */
const MAX_CLIENT_LABEL_CODE_POINTS = 256;
/** A provider reply the relay cannot deliver to a WebSocket agent because it is over the limit. */
const RESULT_TOO_LARGE_ERROR: RpcErrorBody = {
  code: -32603,
  message: 'RESULT_TOO_LARGE',
  data: { limitBytes: MAX_WEBSOCKET_MESSAGE_BYTES },
};
/**
 * A request whose id, or an offer whose requestId, is over MAX_RPC_ID_BYTES. The id is not echoed:
 * the request is answered with id null, the offer's `offer.refused` has no requestId.
 */
const REQUEST_ID_TOO_LARGE_ERROR: RpcErrorBody = {
  code: -32600,
  message: 'REQUEST_ID_TOO_LARGE',
  data: { limitBytes: MAX_RPC_ID_BYTES },
};
/**
 * A request from an agent socket that already has MAX_PENDING_REQUESTS_PER_SOCKET in flight: waiting
 * for the provider, or answered and waiting for the agent to read the answer.
 */
const TOO_MANY_PENDING_REQUESTS_ERROR: RpcErrorBody = {
  code: -32087,
  message: 'TOO_MANY_PENDING_REQUESTS',
  data: { limit: MAX_PENDING_REQUESTS_PER_SOCKET },
};
/** An MCP request whose body a `customHttpHandler` (or another reader) consumed before the relay. */
const BODY_CONSUMED_ERROR: RpcErrorBody = { code: -32603, message: 'BODY_CONSUMED' };

/**
 * What the relay did with a catalog a provider sent; see `acceptProviderCatalog`. `unchanged` is a
 * valid catalog that fits and hashes like the one the relay already holds, so nothing changed.
 */
type ProviderCatalogOutcome =
  | { kind: 'accepted'; announcement: Record<string, unknown> }
  | { kind: 'unchanged' }
  | { kind: 'invalid' }
  | { kind: 'too-large'; announcementBytes: number };

/** The outcome of a `register` frame that took no new catalog: what the provider is answered. */
type IdleCatalogOutcome = Exclude<ProviderCatalogOutcome, { kind: 'accepted' }>;

/** A `register` frame from a room's provider socket (see `WebMcpPeerServer.receiveRegister`). */
interface ProviderRegister {
  /** Everything the frame announces: the frame without its `registerSeq`. */
  readonly frame: Record<string, unknown>;
  /** The provider's numbering of the frame, echoed in a refusal when it is a number. */
  readonly registerSeq: unknown;
  /** SHA-256 of `frame` as JSON: frames with the same fingerprint announce the same thing. */
  readonly fingerprint: string;
  readonly sender: PeerSocket;
}

/** What the relay keeps about one room's `register` frames (see `WebMcpPeerServer.receiveRegister`). */
interface RegisterState {
  /** Evaluations of frames that change nothing allowed now, refilling continuously (so fractional). */
  tokens: number;
  /** When `tokens` was brought up to date, in `performance.now()` milliseconds. */
  updatedAt: number;
  /**
   * The last frame evaluated, the room catalog it left (version and hash), and its outcome, which a
   * frame with the same fingerprint gets again while the room catalog is still that one.
   */
  last?: { fingerprint: string; catalogVersion: number; catalogHash: string; outcome: IdleCatalogOutcome };
  /** The latest frame waiting for an evaluation to be allowed, and the timer that evaluates it. */
  waiting?: { register: ProviderRegister; timer: ReturnType<typeof setTimeout> };
}

/** A JSON-RPC response a provider sent, as `isRpcResponse` validates it. */
type RpcResponse = { jsonrpc: '2.0'; id: string | number; result?: unknown; error?: unknown };

/** The error that answers an agent request the relay could not send to the provider (`sent`). */
/**
 * Decodes a request body as UTF-8, refusing ill-formed input (a SyntaxError, so it is answered
 * like malformed JSON) instead of substituting U+FFFD and acting on altered content.
 */
function decodeUtf8Body(body: Buffer): string {
  if (!isUtf8(body)) throw new SyntaxError('Request body is not valid UTF-8');
  return body.toString('utf8');
}

/**
 * True when an agent frame is over the request limit, either as sent or as the relay re-serializes
 * it for forwarding (JSON not written by JSON.stringify can grow, e.g. 1e20 or escaped characters).
 */
function exceedsRequestLimit(text: string, frame: unknown): boolean {
  return utf8ByteLength(text) > PEER_RELAY_MAX_REQUEST_BYTES
    || utf8ByteLength(JSON.stringify(frame)) > PEER_RELAY_MAX_REQUEST_BYTES;
}

/** True for a string identifier whose JSON text is over MAX_RPC_ID_BYTES (a number id never is). */
function isOversizedEchoedId(id: unknown): boolean {
  return typeof id === 'string' && utf8ByteLength(JSON.stringify(id)) > MAX_RPC_ID_BYTES;
}

function unforwardedRpcError(sent: Exclude<PeerSendResult, 'sent'>): RpcErrorBody {
  if (sent === 'too-large') return REQUEST_TOO_LARGE_ERROR;
  if (sent === 'busy') return PROVIDER_BUSY_ERROR;
  return PROVIDER_UNAVAILABLE_ERROR;
}

/**
 * `value` cut to its first `max` Unicode code points, never inside a surrogate pair. A cut string
 * also loses the whitespace the cut leaves at its end.
 */
function truncateCodePoints(value: string, max: number): string {
  let end = 0;
  let count = 0;
  for (const codePoint of value) {
    if (count === max) return value.slice(0, end).trimEnd();
    end += codePoint.length;
    count += 1;
  }
  return value;
}

/**
 * What became of a frame the relay owes an agent (see `WebMcpPeerServer.replyToAgent`): `sent`;
 * `queued`, to go out once the agent has read enough of what was sent before it; or, with nothing
 * sent or queued, `too-large` (over the relay message limit) or `closed`. `busy` is reported only
 * for a socket the relay keeps no outbox for: never one of its own agent WebSockets, and never the
 * HTTP bridge, whose reply goes into the HTTP response.
 */
type AgentDelivery = PeerSendResult | 'queued';

/**
 * The most wire bytes the frame headers of a message within the relay message limit take: those of
 * a message of the full limit, which goes out as two fragments.
 */
const MAX_MESSAGE_HEADER_BYTES = MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES - MAX_WEBSOCKET_MESSAGE_BYTES;

/**
 * The most bytes an agent's outbound queue may hold with a frame the agent did not ask for (a
 * catalog announcement, `list_changed`, a provider notification) in it. The rest of
 * MAX_WEBSOCKET_OUTBOUND_BUFFER_BYTES stays free for a reply of the full limit, so what the agent
 * did not ask for never makes a reply it asked for wait.
 */
const MAX_UNREQUESTED_QUEUE_BYTES = MAX_WEBSOCKET_OUTBOUND_BUFFER_BYTES - MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES;

/**
 * How often the oldest frame waiting for an agent is offered to its socket again, besides when the
 * socket's queue has drained. Node emits 'drain' only once the queue is empty and the codec reports
 * no partial progress, while the codec's WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS close starts only
 * when a frame is refused and ends when any queued write completes. Without the retry, an agent that
 * read part of its queue and then stopped would never be refused again, so it would never be closed
 * and what waits for it would be held until the room ends.
 */
const AGENT_OUTBOX_RETRY_MS = 1_000;

/**
 * What the relay sends one agent WebSocket (`peer`, upgraded from `raw`).
 *
 * A frame the agent asked for (a reply to one of its requests, the provider's or the relay's own;
 * the state of its approval; the refusal of its offer) is never dropped, and never closes the
 * socket, because the agent's outbound queue is full: an agent that pipelines calls may ask for far
 * more than the queue holds (MAX_PENDING_REQUESTS_PER_SOCKET replies of up to the message limit
 * each), and one that reads is not at fault. The frame waits here instead, in order with every frame
 * after it, and goes out as the agent reads. While frames wait:
 * - the relay reads nothing more from the agent, so one that does not read cannot make the relay
 *   answer (and hold) more than it already asked for;
 * - each waiting frame counts toward the agent's MAX_PENDING_REQUESTS_PER_SOCKET, so at most that
 *   many of the provider's replies, each within the message limit, wait for one socket;
 * - the oldest one is offered to the socket again when its queue drains and every
 *   AGENT_OUTBOX_RETRY_MS, so a refusal keeps the codec's stall close armed.
 * The only close a full queue causes is the codec's: an agent that reads nothing for
 * `WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS` is closed with 1013, and what waits for it is dropped.
 *
 * A frame the agent did not ask for is `offer`ed instead, and skipped for an agent that is behind.
 */
class AgentOutbox {
  private readonly waiting: unknown[] = [];
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly peer: PeerSocket, private readonly raw: Duplex) {}

  /** How many frames wait for the agent to read what was sent before them. */
  get size(): number {
    return this.waiting.length;
  }

  /**
   * Sends `frame` if nothing waits and the outbound queue takes it; otherwise queues it behind the
   * frames already waiting (`queued`). `too-large` and `closed` are what `PeerSocket.send` reports
   * for a frame it would never send: nothing is sent or queued, and the caller can still answer it.
   */
  deliver(frame: unknown): AgentDelivery {
    if (this.waiting.length === 0) {
      const sent = this.peer.send(frame);
      if (sent !== 'busy') return sent;
      this.raw.pause();
      this.retryLater();
    } else if (utf8ByteLength(JSON.stringify(frame)) > MAX_WEBSOCKET_MESSAGE_BYTES) {
      return 'too-large';
    }
    this.waiting.push(frame);
    return 'queued';
  }

  /**
   * Sends `frame`, `bytes` of JSON the agent did not ask for, only if nothing waits and the queue
   * keeps room for a reply of the full limit with it (MAX_UNREQUESTED_QUEUE_BYTES). Otherwise the
   * agent is behind: the frame is skipped for it (`busy`) and its socket stays open.
   */
  offer(frame: unknown, bytes: number): PeerSendResult {
    if (this.waiting.length > 0) return 'busy';
    if (this.raw.writableLength + bytes + MAX_MESSAGE_HEADER_BYTES > MAX_UNREQUESTED_QUEUE_BYTES) return 'busy';
    return this.peer.send(frame);
  }

  /** Drops what waits once the socket has stopped, and lets the connection finish closing. */
  discard(): void {
    if (this.waiting.length === 0) return;
    this.waiting.length = 0;
    this.stopRetrying();
    this.raw.resume();
  }

  /** Offers the oldest waiting frame again once the queue has drained, or after AGENT_OUTBOX_RETRY_MS. */
  private retryLater(): void {
    this.raw.once('drain', this.flush);
    this.retryTimer = setTimeout(this.flush, AGENT_OUTBOX_RETRY_MS);
    this.retryTimer.unref?.();
  }

  private stopRetrying(): void {
    this.raw.off('drain', this.flush);
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  /** Sends what waits, in order, until the queue is full again; then reads from the agent again. */
  private readonly flush = (): void => {
    this.stopRetrying();
    while (this.waiting.length > 0) {
      const sent = this.peer.send(this.waiting[0]);
      if (sent === 'busy') {
        this.retryLater();
        return;
      }
      if (sent === 'closed') {
        this.discard();
        return;
      }
      this.waiting.shift();
    }
    this.raw.resume();
  };
}

// Request headers a browser may send cross-origin. The MCP ones are what browser-hosted Streamable
// HTTP clients send after `initialize`; without them every such request fails its CORS preflight.
const BROWSER_ALLOWED_REQUEST_HEADERS = 'Content-Type, Authorization, X-Requested-With, X-Publish-Key, X-Framebook-Owner, X-Owner-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name';

export class WebMcpPeerServer {
  readonly server: Server;
  readonly rooms = new Map<string, RoomEntry>();
  port: number;
  readonly host: string;
  readonly allowedOrigins: string[];
  readonly allowedHosts: string[];
  readonly configPath?: string;
  readonly publishKeyConfigured: boolean;
  readonly publishKeyOwner?: string;
  readonly publishRateLimitWindowMs: number;
  readonly publishRateLimitMax: number;
  readonly publishRateLimitStore: PublishRateLimitStore;
  readonly mcpRequestTimeoutMs: number;
  /** Upper bound applied to every room's `ttlMs` on creation and rotation. */
  readonly maxRoomTtlMs: number;
  readonly deploymentCatalog: DeploymentCatalogSnapshot;
  readonly serverName: string;
  readonly serverVersion: string;
  private mcpWireSequence = 0;
  private readonly publishKeyHash?: string;
  protected readonly roomSweepTimer?: ReturnType<typeof setInterval>;
  private readonly customHttpHandler?: WebMcpPeerServerOptions['customHttpHandler'];
  private readonly customUpgradeHandler?: WebMcpPeerServerOptions['customUpgradeHandler'];
  private readonly formatHttpErrorHook?: WebMcpPeerServerOptions['formatHttpError'];
  /**
   * The provider socket each pending approval request was delivered to: a request goes to each
   * provider socket once (see `deliverApprovalRequest`), however often its agent calls the relay.
   */
  private readonly approvalDeliveries = new WeakMap<PendingApprovalRequest, PeerSocket>();
  /** The outbox of every agent WebSocket the relay accepted (see `replyToAgent`). */
  private readonly agentOutboxes = new WeakMap<PeerSocket, AgentOutbox>();
  /** What the relay keeps about each room's `register` frames (see `receiveRegister`). */
  private readonly registerStates = new WeakMap<RoomEntry, RegisterState>();

  constructor(options: WebMcpPeerServerOptions = {}) {
    // An embedded server never reads the host process's argv or mutates its environment from
    // `.env` files: both are opt-in (`argv`, `loadEnvFiles`) for a real CLI entry point.
    const config = resolvePeerServerConfig(
      options,
      options.argv ?? [],
      options.cwd ?? process.cwd(),
      { loadEnvFiles: options.loadEnvFiles ?? false },
    );
    this.port = config.port;
    this.host = config.host;
    this.allowedOrigins = config.allowedOrigins;
    this.allowedHosts = config.allowedHosts;
    this.configPath = config.configPath;
    this.publishKeyConfigured = Boolean(config.publishKey);
    this.publishKeyOwner = config.publishKeyOwner;
    this.publishRateLimitWindowMs = config.publishRateLimitWindowMs;
    this.publishRateLimitMax = config.publishRateLimitMax;
    this.publishRateLimitStore = options.publishRateLimitStore
      ?? (config.publishRateLimitPath
        ? new FilePublishRateLimitStore(config.publishRateLimitPath)
        : new InMemoryPublishRateLimitStore());
    this.publishKeyHash = config.publishKey
      ? createHash('sha256').update(config.publishKey, 'utf8').digest('hex')
      : undefined;
    this.mcpRequestTimeoutMs = Math.max(1000, options.mcpRequestTimeoutMs ?? 30_000);
    const maxRoomTtlMs = options.maxRoomTtlMs ?? DEFAULT_MAX_ROOM_TTL_MS;
    this.maxRoomTtlMs = Number.isFinite(maxRoomTtlMs)
      ? Math.min(ROOM_TTL_CEILING_MS, Math.max(MIN_ROOM_TTL_MS, maxRoomTtlMs))
      : DEFAULT_MAX_ROOM_TTL_MS;
    this.deploymentCatalog = loadDeploymentCatalog(options.deploymentCatalog);
    this.serverName = options.serverName ?? 'framebook-peer-server';
    this.serverVersion = options.serverVersion ?? '0.4.0';
    this.customHttpHandler = options.customHttpHandler;
    this.customUpgradeHandler = options.customUpgradeHandler;
    this.formatHttpErrorHook = options.formatHttpError;

    const sweepMs = options.roomSweepIntervalMs === 0
      ? 0 : Math.max(1000, options.roomSweepIntervalMs ?? 30_000);
    if (sweepMs > 0) {
      this.roomSweepTimer = setInterval(() => this.cleanupExpiredRooms(), sweepMs);
      this.roomSweepTimer.unref?.();
    }

    this.server = http.createServer((req, res) => {
      void this.handleHttp(req, res).catch(error => {
        if (res.headersSent) { res.destroy(); return; }
        const failure = this.formatHttpError(req, error);
        this.sendJson(
          res,
          failure.status,
          { error: failure.error, ...(failure.requestId ? { requestId: failure.requestId } : {}) },
          typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
        );
      });
    });
    this.server.on('upgrade', (req, socket, head) => {
      void this.handleUpgrade(req, socket, head).catch(() => socket.destroy());
    });
  }

  protected formatHttpError(
    req: IncomingMessage,
    error: unknown,
  ): { status: number; error: string; requestId?: string } {
    if (this.formatHttpErrorHook) {
      return this.formatHttpErrorHook(req, error);
    }
    return { status: 500, error: 'PEER_REQUEST_FAILED' };
  }

  async listen(): Promise<number> {
    return new Promise((resolvePort, reject) => {
      const onError = (err: Error) => {
        this.server.removeListener('error', onError);
        reject(err);
      };
      this.server.once('error', onError);
      this.server.listen(this.port, this.host, () => {
        this.server.removeListener('error', onError);
        const addr = this.server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : this.port;
        this.port = actualPort;
        resolvePort(actualPort);
      });
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolveClose, reject) => {
      if (this.roomSweepTimer) clearInterval(this.roomSweepTimer);
      for (const room of this.rooms.values()) {
        this.failPendingForProvider(room);
        for (const pending of room.mcpPending.values()) clearTimeout(pending.timer);
        room.mcpPending.clear();
        room.providerSocket?.close();
        for (const cs of room.clientSockets) cs.close();
      }
      this.rooms.clear();
      this.server.close((err) => (err ? reject(err) : resolveClose()));
    });
  }

  isOriginAllowed(origin?: string): boolean {
    return isOriginAllowed(origin, this.allowedOrigins);
  }

  isHostAllowed(hostHeader?: string): boolean {
    return isHostAllowed(hostHeader, this.allowedHosts, this.allowedOrigins);
  }

  protected emptyCatalogHash(): string {
    return createHash('sha256').update('[]').digest('hex');
  }

  protected createRoomEntry(
    alias = 'wireframe-local',
    approvalRequired = true,
    ttlMs = 2 * 60 * 60 * 1000,
    roomEpoch = 1,
    capabilities: readonly PeerCapability[] = ['mcp-control'],
    ownerId?: string,
  ): RoomEntry {
    const id = randomBytes(16).toString('hex');
    const providerToken = randomBytes(24).toString('hex');
    const inviteToken = randomBytes(24).toString('hex');
    const reconnectLeaseToken = randomBytes(24).toString('hex');
    const expiresAt = Date.now() + this.clampRoomTtl(ttlMs);
    return {
      id,
      roomEpoch,
      roomState: 'provisioned',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      alias,
      ...(ownerId ? { ownerId } : {}),
      providerToken,
      inviteToken,
      inviteConsumed: false,
      capabilities: [...new Set<PeerCapability>(['mcp-control', ...capabilities])],
      approvalRequired,
      expiresAt,
      reconnectLeaseToken,
      reconnectLeaseHash: createHash('sha256').update(reconnectLeaseToken).digest('hex'),
      reconnectLeaseExpiresAt: Math.min(expiresAt, Date.now() + 15 * 60_000),
      metadataRetainUntil: expiresAt + ROOM_METADATA_RETAIN_MS,
      clientSockets: new Set(),
      clientSocketTickets: new Map(),
      pendingApprovals: new Map(),
      ...(this.deploymentCatalog.tools.length > 0
        ? {
            cachedTools: structuredClone(this.deploymentCatalog.tools) as unknown[],
            catalogUpdatedAt: this.deploymentCatalog.catalogUpdatedAt,
            catalogSource: 'deployment' as const,
          }
        : {}),
      catalogVersion: this.deploymentCatalog.tools.length > 0 ? this.deploymentCatalog.catalogVersion : 0,
      catalogHash: this.deploymentCatalog.tools.length > 0 ? this.deploymentCatalog.catalogHash : this.emptyCatalogHash(),
      mcpPending: new Map(),
      clientTokens: new Map(),
    };
  }

  /** Bounds a requested room TTL to `[60s, maxRoomTtlMs]`, so every room expires and is swept. */
  protected clampRoomTtl(ttlMs: number): number {
    return Math.min(this.maxRoomTtlMs, Math.max(MIN_ROOM_TTL_MS, Number.isFinite(ttlMs) ? ttlMs : MIN_ROOM_TTL_MS));
  }

  public requestOrigin(req: IncomingMessage): string {
    const forwardedProto = (req.headers['x-forwarded-proto'] as string) || (req.socket instanceof TLSSocket && req.socket.encrypted ? 'https' : 'http');
    const addr = this.server.address();
    const currentPort = typeof addr === 'object' && addr ? addr.port : this.port;
    const fallbackHost = `${this.host}:${currentPort}`;
    const rawForwardedHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || fallbackHost;
    const safeHost = this.isHostAllowed(rawForwardedHost) ? rawForwardedHost : fallbackHost;
    return `${forwardedProto}://${safeHost}`;
  }

  protected roomDescriptor(req: IncomingMessage, entry: RoomEntry): Record<string, unknown> {
    const serverUrl = this.requestOrigin(req);
    return {
      id: entry.id,
      roomId: entry.id,
      roomEpoch: entry.roomEpoch,
      providerToken: entry.providerToken,
      inviteToken: entry.inviteToken,
      reconnectToken: entry.reconnectLeaseToken,
      reconnectTokenExpiresAt: entry.reconnectLeaseExpiresAt,
      descriptorUrl: `${serverUrl}/p/${entry.id}/mcp`,
      expiresAt: entry.expiresAt,
      state: entry.roomState,
      createdAt: new Date(entry.createdAt).toISOString(),
      updatedAt: new Date(entry.updatedAt).toISOString(),
      approvalRequired: entry.approvalRequired,
      capabilities: [...entry.capabilities],
      alias: entry.alias,
      ...(entry.ownerId ? { ownerId: entry.ownerId } : {}),
    };
  }

  protected isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  protected parsePeerCapabilities(value: unknown, fallback: readonly PeerCapability[] = ['mcp-control']): PeerCapability[] | null {
    if (value === undefined) return [...fallback];
    if (!Array.isArray(value) || value.length === 0) return null;
    const capabilities = [...new Set(value)];
    if (!capabilities.every(item => item === 'mcp-control' || item === 'mcp-crdt')) return null;
    if (!capabilities.includes('mcp-control')) capabilities.unshift('mcp-control');
    return capabilities as PeerCapability[];
  }

  /**
   * MCP `initialize` version negotiation: answer with the requested version when it is an
   * initialize-era revision the relay supports, otherwise with the newest one (2025-11-25). Standard
   * MCP clients (e.g. the official SDK) abort the handshake when the server answers with a version
   * they do not know, and 2026-07-28 has no `initialize` at all.
   */
  protected negotiateProtocolVersion(params: unknown): string {
    const requested = this.isRecord(params) && typeof params.protocolVersion === 'string' ? params.protocolVersion : undefined;
    return requested && this.isInitializeProtocolVersion(requested) ? requested : MCP_INITIALIZE_PROTOCOL_VERSIONS[0];
  }

  protected isInitializeProtocolVersion(version: string): boolean {
    return (MCP_INITIALIZE_PROTOCOL_VERSIONS as readonly string[]).includes(version);
  }

  /** True for an MCP client asking for an SSE stream (Accept lists text/event-stream but not JSON). */
  protected acceptsOnlyEventStream(req: IncomingMessage): boolean {
    const accept = String(req.headers.accept ?? '').toLowerCase();
    return accept.includes('text/event-stream') && !accept.includes('application/json');
  }

  protected normalizeTools(value: unknown): unknown[] | null {
    return normalizeToolCatalog(value);
  }

  /**
   * The relay's catalog hash is the deployment-catalog hash, so a provider-registered catalog and a
   * static deployment catalog with the same tools always hash identically (and locale-independently).
   */
  protected catalogHash(tools: unknown[]): string {
    return hashDeploymentCatalog(tools);
  }

  /** Validates a parsed MCP HTTP body through the (overridable) `isRpcRequest` predicate. */
  protected readonly rpcRequestSchema: WireSchema<RpcRequest> = {
    parse: (value) => {
      if (this.isRecord(value) && this.isOversizedRpcId(value.id)) throw new TypeError(REQUEST_ID_TOO_LARGE_ERROR.message);
      if (!this.isRpcRequest(value)) throw new TypeError('INVALID_REQUEST');
      return value;
    },
  };

  /** A JSON-RPC request: `jsonrpc: '2.0'`, a string method, and an id (if any) within MAX_RPC_ID_BYTES. */
  protected isRpcRequest(value: unknown): value is RpcRequest {
    if (!this.isRecord(value) || value.jsonrpc !== '2.0' || typeof value.method !== 'string') return false;
    if ('id' in value && value.id !== undefined && value.id !== null
      && typeof value.id !== 'string' && typeof value.id !== 'number') return false;
    return !this.isOversizedRpcId(value.id);
  }

  /** True for a string id whose JSON text is over MAX_RPC_ID_BYTES (a number id never is). */
  protected isOversizedRpcId(id: unknown): boolean {
    return isOversizedEchoedId(id);
  }

  protected isRpcResponse(value: unknown): value is RpcResponse {
    return this.isRecord(value) && value.jsonrpc === '2.0'
      && (typeof value.id === 'string' || typeof value.id === 'number')
      && ('result' in value || 'error' in value);
  }

  protected rpcKey(id: string | number): string {
    return `${typeof id}:${String(id)}`;
  }

  protected allocateWireId(entry: RoomEntry, id: string | number): string | number {
    if (!entry.mcpPending.has(this.rpcKey(id))) return id;
    let wireId: string;
    do {
      wireId = `framebook:${++this.mcpWireSequence}:${typeof id}:${String(id)}`;
    } while (entry.mcpPending.has(this.rpcKey(wireId)));
    return wireId;
  }

  protected hasPendingRequest(entry: RoomEntry, socket: PeerSocket, id: string | number): boolean {
    for (const pending of entry.mcpPending.values()) {
      if (pending.socket === socket && pending.id === id) return true;
    }
    return false;
  }

  /**
   * How many of `socket`'s requests the relay holds: those waiting for the provider, and, for an
   * agent WebSocket, the frames waiting for the agent to read them (see `AgentOutbox`).
   */
  protected pendingRequestCount(entry: RoomEntry, socket: PeerSocket): number {
    let count = this.agentOutboxes.get(socket)?.size ?? 0;
    for (const pending of entry.mcpPending.values()) {
      if (pending.socket === socket) count += 1;
    }
    return count;
  }

  protected sendRpcError(socket: PeerSocket, id: string | number | null | undefined, code: number, message: string, data?: unknown): void {
    if (id === undefined) return;
    const error: Record<string, unknown> = { code, message };
    if (data !== undefined) error.data = data;
    this.replyToAgent(socket, { type: 'mcp', message: { jsonrpc: '2.0', id, error } });
  }

  /**
   * Sends an agent socket `frame`, the answer to something the agent asked for: a reply to its
   * request (the provider's or the relay's own), the state of its approval, or the refusal of its
   * offer. Such a frame is never dropped and never closes the socket for a full outbound queue: an
   * agent WebSocket that is behind gets it, in order, once it has read what was sent before it
   * (see `AgentOutbox`), so a reading agent that pipelines calls gets every reply. The HTTP bridge
   * gets it in its HTTP response.
   */
  protected replyToAgent(socket: PeerSocket, frame: unknown): AgentDelivery {
    const outbox = this.agentOutboxes.get(socket);
    return outbox ? outbox.deliver(frame) : socket.send(frame);
  }

  /**
   * Sends `frame`, which no agent asked for (a catalog announcement, `list_changed`, a provider's
   * notification), to every agent socket of the room that has room for it: an agent that is behind
   * skips it and keeps its socket, and what it skips never takes the room a reply it asked for
   * needs (see `AgentOutbox.offer`).
   */
  protected broadcastToAgents(entry: RoomEntry, frame: unknown): void {
    if (entry.clientSockets.size === 0) return;
    const bytes = utf8ByteLength(JSON.stringify(frame));
    for (const socket of entry.clientSockets) {
      const outbox = this.agentOutboxes.get(socket);
      if (outbox) outbox.offer(frame, bytes);
      else socket.send(frame);
    }
  }

  /**
   * Detaches the room's provider socket and closes it: one the relay can no longer write to (it is
   * closing, e.g. after the relay refused an oversized frame), without waiting for TCP to finish
   * closing, so later requests get PROVIDER_UNAVAILABLE and a reclaim can attach a new provider;
   * or one a new provider socket replaces. Every pending request was sent to that socket, so each
   * fails with PROVIDER_DISCONNECTED.
   */
  protected detachClosedProvider(entry: RoomEntry): void {
    const socket = entry.providerSocket;
    if (!socket) return;
    entry.providerSocket = undefined;
    this.failPendingForProvider(entry);
    socket.close();
  }

  /**
   * Answers an HTTP MCP request the relay could not forward to the provider: 413 for one over the
   * limit, 503 PROVIDER_BUSY (with `Retry-After`) while the provider's outbound queue is full, which
   * leaves the provider attached, and 503 PROVIDER_UNAVAILABLE for a provider socket that is gone.
   */
  protected answerUnforwardedHttp(
    res: ServerResponse,
    entry: RoomEntry,
    id: string | number | null,
    sent: Exclude<PeerSendResult, 'sent'>,
    origin?: string,
  ): void {
    if (sent === 'too-large') {
      this.sendJson(res, 413, { jsonrpc: '2.0', id, error: REQUEST_TOO_LARGE_ERROR }, origin);
      return;
    }
    if (sent === 'busy') {
      this.sendJson(res, 503, { jsonrpc: '2.0', id, error: PROVIDER_BUSY_ERROR }, origin, {
        'Retry-After': String(PROVIDER_BUSY_RETRY_AFTER_SECONDS),
      });
      return;
    }
    this.detachClosedProvider(entry);
    this.sendJson(res, 503, { jsonrpc: '2.0', id, error: PROVIDER_UNAVAILABLE_ERROR }, origin);
  }

  protected replaceCatalog(entry: RoomEntry, value: unknown): boolean {
    const tools = this.normalizeTools(value);
    if (!tools) return false;
    this.replaceNormalizedCatalog(entry, tools, this.catalogHash(tools));
    return true;
  }

  /**
   * Installs a catalog already normalized by `normalizeTools`, whose `catalogHash` is `hash`, and
   * tells the room's agents it changed. The same catalog again changes nothing.
   */
  protected replaceNormalizedCatalog(entry: RoomEntry, tools: unknown[], hash: string): void {
    if (entry.catalogVersion > 0 && hash === entry.catalogHash) return;
    entry.cachedTools = tools;
    entry.catalogSource = 'provider';
    entry.catalogHash = hash;
    entry.catalogVersion += 1;
    entry.catalogUpdatedAt = Date.now();
    // A broadcast no agent asked for: an agent that is behind skips it (its next call with the old
    // catalog metadata gets CATALOG_CHANGED) and keeps its socket.
    this.broadcastToAgents(entry, {
      type: 'mcp',
      message: {
        jsonrpc: '2.0',
        method: 'notifications/tools/list_changed',
        params: { catalogVersion: entry.catalogVersion, catalogHash: entry.catalogHash },
      },
    });
  }

  /**
   * Takes a catalog a provider sent, in a `register` frame or a `tools/list` result, normalizing
   * and hashing its tools once. `fields` are the announcement's other fields: the register frame
   * itself, or `{ type: 'register' }` for a `tools/list` result. A catalog is taken only when it is
   * valid and its announcement (`fields` with the normalized tools and the `catalogVersion`/
   * `catalogHash` stamp) is at most {@link PEER_RELAY_MAX_ANNOUNCEMENT_BYTES}, so every catalog the
   * relay holds can be announced and listed within the relay message limit; otherwise the cached
   * catalog stays. A taken catalog that hashes like the cached one is `unchanged`: nothing is
   * replaced and there is nothing to announce. Any other replaces the cached catalog, and the
   * `announcement` returned is exactly the object that was measured.
   */
  protected acceptProviderCatalog(entry: RoomEntry, value: unknown, fields: Record<string, unknown>): ProviderCatalogOutcome {
    const tools = this.normalizeTools(value);
    if (!tools) return { kind: 'invalid' };
    const hash = this.catalogHash(tools);
    const unchanged = entry.catalogVersion > 0 && hash === entry.catalogHash;
    const announcement = {
      ...fields, tools, catalogVersion: unchanged ? entry.catalogVersion : entry.catalogVersion + 1, catalogHash: hash,
    };
    const announcementBytes = utf8ByteLength(JSON.stringify(announcement));
    if (announcementBytes > PEER_RELAY_MAX_ANNOUNCEMENT_BYTES) return { kind: 'too-large', announcementBytes };
    if (unchanged) return { kind: 'unchanged' };
    this.replaceNormalizedCatalog(entry, tools, hash);
    return { kind: 'accepted', announcement };
  }

  /**
   * Takes a `register` frame (`msg`) from the room's provider socket `sender`. Only a catalog the
   * relay accepts is announced, stamped with the authoritative version/hash so agents never derive a
   * catalog the relay would reject; a refused one is answered with CATALOG_INVALID or
   * CATALOG_TOO_LARGE, echoing the frame's `registerSeq` (which matches the refusal to the frame it
   * answers and is not passed on to agents); a frame with the catalog the room already holds is not
   * announced again (see `acceptProviderCatalog`).
   *
   * Evaluating a frame is what costs, so a provider cannot make the relay spend CPU at the rate it
   * sends frames that change nothing:
   * - a frame that announces exactly what the last evaluated one did (all fields but `registerSeq`),
   *   while the room catalog is still the one that frame left, is not evaluated again: it gets the
   *   same answer, under its own `registerSeq`;
   * - frames that change nothing are evaluated at most REGISTER_EVALUATION_BURST at once, then one
   *   per REGISTER_EVALUATION_INTERVAL_MS. A frame that arrives while none is allowed waits until one
   *   is, and the provider's next frame replaces it unevaluated, so the latest catalog a provider
   *   sends is always evaluated (it only waits longer for the answer) and nothing is refused for it.
   */
  private receiveRegister(entry: RoomEntry, sender: PeerSocket, msg: Record<string, unknown>): void {
    const { registerSeq, ...frame } = msg;
    let state = this.registerStates.get(entry);
    if (!state) {
      state = { tokens: REGISTER_EVALUATION_BURST, updatedAt: performance.now() };
      this.registerStates.set(entry, state);
    }
    this.dropWaitingRegister(entry);
    const fingerprint = createHash('sha256').update(JSON.stringify(frame)).digest('hex');
    this.processRegister(entry, state, { frame, registerSeq, fingerprint, sender });
  }

  /** Drops the `register` frame waiting for an evaluation in `entry`, or only one `sender` sent. */
  private dropWaitingRegister(entry: RoomEntry, sender?: PeerSocket): void {
    const state = this.registerStates.get(entry);
    if (!state?.waiting || (sender && state.waiting.register.sender !== sender)) return;
    clearTimeout(state.waiting.timer);
    state.waiting = undefined;
  }

  /** Answers `register` from the last evaluation, evaluates it, or makes it wait (see `receiveRegister`). */
  private processRegister(entry: RoomEntry, state: RegisterState, register: ProviderRegister): void {
    const last = state.last;
    if (last && last.fingerprint === register.fingerprint
      && last.catalogVersion === entry.catalogVersion && last.catalogHash === entry.catalogHash) {
      this.answerRegister(register, last.outcome);
      return;
    }
    const now = performance.now();
    state.tokens = Math.min(REGISTER_EVALUATION_BURST, state.tokens + (now - state.updatedAt) / REGISTER_EVALUATION_INTERVAL_MS);
    state.updatedAt = now;
    if (state.tokens < 1) {
      const timer = setTimeout(() => {
        state.waiting = undefined;
        // Only the room's attached provider socket speaks for it, as for a frame it sends now.
        if (entry.providerSocket !== register.sender || entry.expiresAt <= Date.now()) return;
        try {
          this.processRegister(entry, state, register);
        } catch { /* a frame the relay cannot evaluate is ignored, as when it arrives */ }
      }, Math.ceil((1 - state.tokens) * REGISTER_EVALUATION_INTERVAL_MS));
      timer.unref?.();
      state.waiting = { register, timer };
      return;
    }
    // A frame that takes a new catalog gives its evaluation back; one that changes nothing, or whose
    // evaluation throws, keeps it used.
    state.tokens -= 1;
    const outcome = this.acceptProviderCatalog(entry, register.frame.tools, register.frame);
    if (outcome.kind === 'accepted') state.tokens += 1;
    const idle: IdleCatalogOutcome = outcome.kind === 'accepted' ? { kind: 'unchanged' } : outcome;
    state.last = { fingerprint: register.fingerprint, catalogVersion: entry.catalogVersion, catalogHash: entry.catalogHash, outcome: idle };
    if (outcome.kind === 'accepted') this.broadcastToAgents(entry, outcome.announcement);
    else this.answerRegister(register, outcome);
  }

  /**
   * Tells the provider why the relay refused its `register` frame; a frame with the catalog the room
   * holds gets no answer. Sent with `send` alone, like the relay's other answers to the provider.
   */
  private answerRegister(register: ProviderRegister, outcome: IdleCatalogOutcome): void {
    const echo = typeof register.registerSeq === 'number' ? { registerSeq: register.registerSeq } : {};
    if (outcome.kind === 'invalid') {
      register.sender.send({ type: 'error', code: -32602, message: 'CATALOG_INVALID', reason: 'register.tools must be at most 128 uniquely named tools with an object inputSchema', ...echo });
    } else if (outcome.kind === 'too-large') {
      register.sender.send({
        type: 'error', code: -32602, message: 'CATALOG_TOO_LARGE', limitBytes: PEER_RELAY_MAX_ANNOUNCEMENT_BYTES,
        reason: `the catalog announcement is ${outcome.announcementBytes} bytes, over the relay's ${PEER_RELAY_MAX_ANNOUNCEMENT_BYTES}-byte announcement limit`,
        ...echo,
      });
    }
  }

  /**
   * The frame that answers an agent's request with the provider's reply `rpc` (from the frame
   * `msg`), under the agent's own id. Only the reply to a whole-catalog listing, a `tools/list`
   * without a cursor or a `server/discover` (see `PendingMcpRequest.listsCatalog`), offers the relay
   * a catalog; any other reply, such as a `tools/call` result that happens to have `tools` or a page
   * of a paginated listing, is forwarded and leaves the room catalog alone. A catalog the relay
   * takes is forwarded, stamped with the relay's `catalogVersion`/`catalogHash` for an agent that
   * sent `_meta`. A listing the relay does not pass on is answered from the catalog the relay holds,
   * which is what an HTTP agent is listed (see `relayCatalogListing`):
   * - a catalog the relay refuses (invalid, or over the announcement limit), since the relay would
   *   not enforce it: an agent that adopted it would have every later call refused
   *   (CATALOG_CHANGED, TOOL_NOT_FOUND);
   * - an error, such as the CATALOG_UNAVAILABLE of a provider whose last catalog the relay refused,
   *   or that has sent none since it reloaded, while the relay still holds (and enforces) one.
   * While the relay holds no catalog, the agent gets the provider's error as it was sent, or the
   * relay's refusal of the catalog as a JSON-RPC error.
   */
  protected agentReplyFrame(entry: RoomEntry, pending: PendingMcpRequest, msg: Record<string, unknown>, rpc: RpcResponse): Record<string, unknown> {
    const message = pending.wireId === pending.id ? rpc : { ...rpc, id: pending.id };
    const forwarded = pending.wireId === pending.id ? msg : { ...msg, message };
    if (!pending.listsCatalog) return forwarded;
    let refusal: RpcErrorBody | undefined;
    if (rpc.error === undefined) {
      const result = this.isRecord(rpc.result) ? rpc.result : undefined;
      // The first page of a paginated listing is not the whole catalog either.
      if (result && result.nextCursor !== undefined && result.nextCursor !== null) return forwarded;
      const outcome = this.acceptProviderCatalog(entry, result?.tools, { type: 'register' });
      if (outcome.kind === 'accepted' || outcome.kind === 'unchanged') {
        if (!pending.includeCatalogMeta) return forwarded;
        const stamp = { catalogVersion: entry.catalogVersion, catalogHash: entry.catalogHash };
        return { ...forwarded, message: { ...message, result: { ...result, ...stamp } } };
      }
      refusal = outcome.kind === 'too-large'
        ? {
            code: -32603,
            message: 'CATALOG_TOO_LARGE',
            data: { limitBytes: PEER_RELAY_MAX_ANNOUNCEMENT_BYTES, announcementBytes: outcome.announcementBytes },
          }
        : { code: -32603, message: 'CATALOG_INVALID' };
    }
    if (entry.cachedTools) {
      return { type: 'mcp', message: { jsonrpc: '2.0', id: pending.id, result: this.relayCatalogListing(entry, entry.cachedTools, pending) } };
    }
    return refusal ? { type: 'mcp', message: { jsonrpc: '2.0', id: pending.id, error: refusal } } : forwarded;
  }

  /**
   * The relay's own answer to an agent's whole-catalog listing (`pending`) from the catalog `tools`
   * it holds: for `server/discover` the result the HTTP route answers (see `mcpDiscoverResult`),
   * for `tools/list` the tools. For an agent that sent `_meta`, either is stamped with the relay's
   * `catalogVersion`/`catalogHash`, as a catalog the relay takes from the provider is.
   */
  protected relayCatalogListing(entry: RoomEntry, tools: unknown[], pending: PendingMcpRequest): Record<string, unknown> {
    const stamp = pending.includeCatalogMeta ? { catalogVersion: entry.catalogVersion, catalogHash: entry.catalogHash } : {};
    if (pending.method !== 'server/discover') return { tools, ...stamp };
    const ticketStatus = entry.clientSocketTickets.get(pending.socket)?.status ?? 'not-joined';
    const catalog = { tools, catalogVersion: entry.catalogVersion, catalogHash: entry.catalogHash };
    return {
      ...this.mcpDiscoverResult(entry, entry.id, pending.protocolVersion ?? this.negotiateProtocolVersion(undefined), catalog, ticketStatus),
      ...stamp,
    };
  }

  protected clearPending(entry: RoomEntry, key: string, error?: RpcErrorBody): void {
    const pending = entry.mcpPending.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    entry.mcpPending.delete(key);
    if (error) {
      this.sendRpcError(pending.socket, pending.id, error.code, error.message, error.data);
    }
  }

  protected failPendingForSocket(entry: RoomEntry, socket: PeerSocket, error?: { code: number; message: string }): void {
    for (const [key, pending] of entry.mcpPending) {
      if (pending.socket === socket) {
        clearTimeout(pending.timer);
        entry.mcpPending.delete(key);
        if (error) this.sendRpcError(pending.socket, pending.id, error.code, error.message);
      }
    }
  }

  protected failPendingForProvider(entry: RoomEntry): void {
    for (const [key, pending] of entry.mcpPending) {
      clearTimeout(pending.timer);
      entry.mcpPending.delete(key);
      this.sendRpcError(pending.socket, pending.id, -32001, 'PROVIDER_DISCONNECTED');
    }
  }

  protected mcpCatalogCacheHeaders(catalogVersion: number, catalogHash: string): Record<string, string> {
    return {
      'Cache-Control': 'public, max-age=30, s-maxage=300, stale-while-revalidate=60, stale-if-error=600',
      ETag: `"mcp-catalog-${catalogVersion}-${catalogHash}"`,
      'X-MCP-Catalog-Version': String(catalogVersion),
      'X-MCP-Catalog-Hash': catalogHash,
      Vary: 'Origin, Accept-Encoding',
    };
  }

  protected mcpDeploymentCatalogCacheHeaders(catalogVersion: number, catalogHash: string): Record<string, string> {
    return {
      'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
      'CDN-Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"mcp-deployment-catalog-${catalogVersion}-${catalogHash}"`,
      'X-MCP-Catalog-Version': String(catalogVersion),
      'X-MCP-Catalog-Hash': catalogHash,
      Vary: 'Origin, Accept-Encoding',
    };
  }

  protected mcpDescriptorCacheHeaders(body: unknown, catalogVersion: number, catalogHash: string): Record<string, string> {
    const digest = createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
    return {
      'Cache-Control': 'public, max-age=5, s-maxage=30, stale-while-revalidate=60, stale-if-error=300',
      ETag: `"mcp-descriptor-${digest}"`,
      'X-MCP-Catalog-Version': String(catalogVersion),
      'X-MCP-Catalog-Hash': catalogHash,
      Vary: 'Origin, Accept-Encoding',
    };
  }

  protected mcpPostMetadataHeaders(catalogVersion: number, catalogHash: string): Record<string, string> {
    return {
      'Cache-Control': 'no-store',
      'X-MCP-Catalog-Version': String(catalogVersion),
      'X-MCP-Catalog-Hash': catalogHash,
      Vary: 'Origin',
    };
  }

  protected sendMcpMetadata(
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    body: unknown,
    origin: string | undefined,
    cacheHeaders: Record<string, string>,
    allowNotModified = false,
  ): void {
    if (allowNotModified) {
      const requested = req.headers['if-none-match'];
      const ifNoneMatch = Array.isArray(requested) ? requested.join(',') : requested;
      const etag = cacheHeaders.ETag;
      const matched = typeof ifNoneMatch === 'string' && etag
        && (ifNoneMatch.split(',').some(token => token.trim() === etag) || ifNoneMatch.trim() === '*');
      if (matched) {
        const isAllowed = this.isOriginAllowed(origin);
        const headers: Record<string, string> = { ...cacheHeaders, 'Content-Length': '0' };
        if (origin && isAllowed) {
          headers['Access-Control-Allow-Origin'] = origin;
          headers['Access-Control-Allow-Headers'] = BROWSER_ALLOWED_REQUEST_HEADERS;
        }
        res.writeHead(304, headers);
        res.end();
        return;
      }
    }
    this.sendJson(res, status, body, origin, cacheHeaders);
  }

  protected mcpRoomState(entry: RoomEntry | undefined, now = Date.now()): 'unknown' | 'expired' | 'rotated' | RoomEntry['roomState'] {
    if (!entry) return 'unknown';
    if (entry.rotatedTo) return 'rotated';
    if (entry.expiresAt <= now || entry.roomState === 'expired') return 'expired';
    return entry.roomState;
  }

  protected mcpCatalogSnapshot(entry: RoomEntry | undefined): { tools: unknown[]; catalogVersion: number; catalogHash: string; catalogUpdatedAt: number | null } {
    const deployment = this.deploymentCatalog;
    const fallback = deployment.tools.length > 0
      ? { tools: structuredClone(deployment.tools) as unknown[], catalogVersion: deployment.catalogVersion, catalogHash: deployment.catalogHash, catalogUpdatedAt: deployment.catalogUpdatedAt }
      : { tools: [] as unknown[], catalogVersion: 0, catalogHash: this.emptyCatalogHash(), catalogUpdatedAt: null };
    return {
      tools: entry?.cachedTools ? structuredClone(entry.cachedTools) : fallback.tools,
      catalogVersion: entry?.cachedTools ? entry.catalogVersion : fallback.catalogVersion,
      catalogHash: entry?.cachedTools ? entry.catalogHash : fallback.catalogHash,
      catalogUpdatedAt: entry?.cachedTools ? entry.catalogUpdatedAt ?? null : fallback.catalogUpdatedAt,
    };
  }

  protected mcpAuthMetadata(entry: RoomEntry | undefined, state: string): Record<string, unknown> {
    return {
      discovery: 'public',
      execution: 'client-ticket-and-approval',
      clientTokenRequired: true,
      approvalRequired: entry?.approvalRequired ?? true,
      state,
    };
  }

  /**
   * The `_meta` of the relay's own `server/discover` and `tools/list` results for the room `roomId`
   * (`entry`, if it exists) listing `catalog`, for an agent whose ticket is in `ticketStatus`.
   */
  protected mcpListingMeta(
    entry: RoomEntry | undefined,
    roomId: string,
    catalog: { catalogVersion: number; catalogHash: string },
    ticketStatus: string,
  ): Record<string, unknown> {
    return {
      roomId,
      roomEpoch: entry?.roomEpoch ?? 0,
      roomState: this.mcpRoomState(entry),
      roomValid: Boolean(entry && !entry.rotatedTo && entry.expiresAt > Date.now()),
      catalogVersion: catalog.catalogVersion,
      catalogHash: catalog.catalogHash,
      auth: this.mcpAuthMetadata(entry, ticketStatus),
    };
  }

  /**
   * The relay's own `server/discover` result listing `catalog`, as the HTTP route answers it and as
   * a WebSocket agent gets it when the provider cannot answer (see `agentReplyFrame`).
   */
  protected mcpDiscoverResult(
    entry: RoomEntry | undefined,
    roomId: string,
    protocolVersion: string,
    catalog: { tools: unknown[]; catalogVersion: number; catalogHash: string },
    ticketStatus: string,
  ): Record<string, unknown> {
    return {
      protocolVersion,
      serverInfo: { name: this.serverName, version: this.serverVersion },
      tools: catalog.tools,
      _meta: this.mcpListingMeta(entry, roomId, catalog, ticketStatus),
    };
  }

  public sendJson(res: ServerResponse, status: number, body: unknown, origin?: string, extraHeaders?: Record<string, string>): void {
    res.writeHead(status, this.responseHeaders(origin, { 'Content-Type': 'application/json', ...extraHeaders }));
    res.end(JSON.stringify(body));
  }

  /** 202 Accepted for a JSON-RPC notification. Streamable HTTP requires an empty body. */
  protected sendAccepted(res: ServerResponse, origin?: string, extraHeaders?: Record<string, string>): void {
    res.writeHead(202, this.responseHeaders(origin, extraHeaders));
    res.end();
  }

  protected responseHeaders(origin: string | undefined, extraHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    if (origin && this.isOriginAllowed(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Headers'] = BROWSER_ALLOWED_REQUEST_HEADERS;
      headers['Vary'] = 'Origin';
    }
    return extraHeaders ? Object.assign(headers, extraHeaders) : headers;
  }

  public constantTimeTokenEqual(left: string, right: string): boolean {
    const leftBytes = Buffer.from(left, 'utf8');
    const rightBytes = Buffer.from(right, 'utf8');
    if (leftBytes.length !== rightBytes.length) return false;
    return timingSafeEqual(leftBytes, rightBytes);
  }

  public bearerToken(req: IncomingMessage): string {
    const authorization = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0] : req.headers.authorization;
    if (typeof authorization === 'string' && /^Bearer\s+/i.test(authorization)) {
      return authorization.replace(/^Bearer\s+/i, '').trim();
    }
    const header = req.headers['x-publish-key'];
    return typeof header === 'string' ? header.trim() : '';
  }

  /**
   * Authorizes `POST /p`. `tokenHash` is the publish rate-limit bucket identity: the hash of the
   * valid publish key, `anonymous` when no key is configured, and the shared constant
   * `unauthenticated` for every failed attempt. A caller-chosen (wrong) token therefore never gets a
   * fresh bucket, so key guessing is throttled at `publishRateLimitMax` attempts per window and
   * address, and failed attempts never consume the valid publisher's quota.
   */
  public authorizePublishRequest(req: IncomingMessage): { ok: true; tokenHash: string } | { ok: false; tokenHash: string; error: 'PUBLISH_KEY_REQUIRED' | 'PUBLISH_KEY_INVALID' } {
    if (!this.publishKeyConfigured || !this.publishKeyHash) {
      return { ok: true, tokenHash: 'anonymous' };
    }
    const token = this.bearerToken(req);
    if (!token) return { ok: false, tokenHash: 'unauthenticated', error: 'PUBLISH_KEY_REQUIRED' };
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    if (!this.constantTimeTokenEqual(tokenHash, this.publishKeyHash)) return { ok: false, tokenHash: 'unauthenticated', error: 'PUBLISH_KEY_INVALID' };
    return { ok: true, tokenHash };
  }

  protected publishRateIdentity(req: IncomingMessage, tokenHash: string): string {
    return `${req.socket.remoteAddress ?? 'unknown'}\u0000${tokenHash}`;
  }

  public async consumePublishRateLimit(req: IncomingMessage, tokenHash: string): Promise<
    { available: true; allowed: boolean; retryAfterMs: number; remaining: number }
    | { available: false; retryAfterMs: number }
  > {
    if (this.publishRateLimitMax === 0) {
      return { available: true, allowed: true, retryAfterMs: 0, remaining: Number.POSITIVE_INFINITY };
    }
    try {
      const decision = validatePublishRateLimitDecision(await this.publishRateLimitStore.consume({
        key: this.publishRateIdentity(req, tokenHash),
        nowMs: Date.now(),
        windowMs: this.publishRateLimitWindowMs,
        max: this.publishRateLimitMax,
      }));
      return { available: true, ...decision };
    } catch {
      return { available: false, retryAfterMs: 1_000 };
    }
  }

  /**
   * Reads a JSON object body of at most `maxBytes`; an empty body is `{}`. An oversized body is
   * drained rather than cut off mid-read, so the caller's BODY_TOO_LARGE response still reaches the
   * client. Throws BODY_TOO_LARGE, BODY_CONSUMED (an earlier reader, such as a hook, took some of
   * the body), a read error (the request was aborted), or a parse error.
   */
  public async readJsonBody(req: IncomingMessage, maxBytes = MAX_JSON_BODY_BYTES): Promise<Record<string, unknown>> {
    const read = await readBoundedBody(req, maxBytes);
    if (read.kind === 'too-large') throw new Error('BODY_TOO_LARGE');
    return this.parseJsonObjectBody(read.body);
  }

  /** Parses a request body that must be a JSON object; an empty (or all-whitespace) body is `{}`. */
  protected parseJsonObjectBody(body: Buffer): Record<string, unknown> {
    const raw = decodeUtf8Body(body).trim();
    if (!raw) return {};
    return JsonObjectBodySchema.parse(JSON.parse(raw));
  }

  /**
   * Reads the JSON object body of a request the endpoint acts on. Returns the body (`{}` only for
   * an empty one), or `null` once it has answered a body the endpoint must not act on: 413
   * BODY_TOO_LARGE for a body over `maxBytes`, 400 INVALID_JSON_BODY for one that is not a JSON
   * object, 500 BODY_CONSUMED for one an earlier reader (a `customHttpHandler` that read it and
   * returned false) took, and no answer for a request that was aborted or cut off mid-body (its
   * connection is gone). A failed or partial read never stands in for `{}`, which would let a
   * state-changing endpoint act on defaults the caller never sent (revoke every session, rotate
   * with the default TTL).
   */
  protected async readJsonBodyOrRespond(
    req: IncomingMessage,
    res: ServerResponse,
    origin?: string,
    maxBytes = MAX_JSON_BODY_BYTES,
  ): Promise<Record<string, unknown> | null> {
    let read: BoundedBody;
    try {
      read = await readBoundedBody(req, maxBytes);
    } catch (error) {
      this.answerUnreadBody(req, res, error, { error: 'BODY_CONSUMED' }, origin);
      return null;
    }
    if (read.kind === 'too-large') {
      if (read.drained) this.sendJson(res, 413, { error: 'BODY_TOO_LARGE' }, origin);
      else res.destroy();
      return null;
    }
    try {
      return this.parseJsonObjectBody(read.body);
    } catch {
      this.sendJson(res, 400, { error: 'INVALID_JSON_BODY' }, origin);
      return null;
    }
  }

  /**
   * Answers a request whose body `readBoundedBody` could not read (`error` is its rejection). A
   * body an earlier reader consumed gets 500 with `consumedBody` once the request has ended, so the
   * response is delivered: the relay is misconfigured, not the caller. Any other failure (the
   * request was aborted or errored, or a consumed body could not be drained) destroys the
   * connection, which is gone or cannot carry a response.
   */
  protected answerUnreadBody(req: IncomingMessage, res: ServerResponse, error: unknown, consumedBody: unknown, origin?: string): void {
    if (isBodyConsumedError(error) && req.readableEnded && !res.headersSent) {
      this.sendJson(res, 500, consumedBody, origin);
      return;
    }
    res.destroy();
  }

  protected resolveClientTicket(entry: RoomEntry, token: string): ClientSessionTicket | null {
    const ticket = entry.clientTokens.get(token);
    if (!ticket) return null;
    if (entry.expiresAt <= Date.now()) {
      entry.roomState = entry.roomState === 'rotated' ? entry.roomState : 'expired';
      entry.updatedAt = Date.now();
    }
    if (ticket.expiresAt <= Date.now()) {
      if (ticket.status !== 'revoked' && ticket.status !== 'rejected' && ticket.status !== 'room-rotated') ticket.status = 'expired';
      return ticket;
    }
    return ticket;
  }

  protected clientTicketError(ticket: ClientSessionTicket | null): { status: number; code: number; message: string } | null {
    if (!ticket) return { status: 401, code: -32003, message: 'CLIENT_TOKEN_REQUIRED' };
    if (ticket.status === 'pending') return { status: 403, code: -32053, message: 'CLIENT_APPROVAL_REQUIRED' };
    if (ticket.status === 'rejected') return { status: 403, code: -32054, message: 'CLIENT_APPROVAL_DENIED' };
    if (ticket.status === 'expired') return { status: 410, code: -32056, message: 'SESSION_EXPIRED' };
    if (ticket.status === 'revoked') return { status: 401, code: -32001, message: 'SESSION_INVALID' };
    return null;
  }

  protected findClientToken(entry: RoomEntry, sessionId: string): { token: string; ticket: ClientSessionTicket } | null {
    for (const [token, ticket] of entry.clientTokens) {
      if (ticket.sessionId === sessionId) return { token, ticket };
    }
    return null;
  }

  /**
   * Makes sure the provider knows `ticket` waits for approval and returns its pending request:
   * the existing one, or a new one (which expires, and the ticket with it, after
   * `mcpRequestTimeoutMs`). The request goes to the room's provider socket only if that socket does
   * not have it yet (see `deliverApprovalRequest`). `socket`, the agent's client socket, if any, is
   * told with `approval.pending`. Returns null when the ticket needs no approval.
   */
  protected sendApprovalRequest(entry: RoomEntry, ticket: ClientSessionTicket, socket?: PeerSocket): PendingApprovalRequest | null {
    if (!entry.approvalRequired || ticket.status === 'approved') return null;
    const request = (ticket.approvalRequestId ? entry.pendingApprovals.get(ticket.approvalRequestId) : undefined)
      ?? this.createApprovalRequest(entry, ticket);
    this.deliverApprovalRequest(entry, ticket, request);
    if (socket) {
      this.replyToAgent(socket, {
        type: 'approval.pending', roomId: entry.id, roomEpoch: entry.roomEpoch, requestId: request.requestId,
        sessionId: ticket.sessionId, capabilities: [...ticket.capabilities], expiresAt: request.expiresAt,
      });
    }
    return request;
  }

  /** Registers a new pending approval request for `ticket`, which expires it if nobody decides in time. */
  protected createApprovalRequest(entry: RoomEntry, ticket: ClientSessionTicket): PendingApprovalRequest {
    const requestId = `approval-${randomBytes(16).toString('hex')}`;
    const request: PendingApprovalRequest = {
      requestId,
      clientToken: [...entry.clientTokens.entries()].find(([, candidate]) => candidate === ticket)?.[0] ?? '',
      sessionId: ticket.sessionId,
      roomId: entry.id,
      roomEpoch: entry.roomEpoch,
      clientLabel: ticket.clientLabel || 'MCP client',
      identity: { sessionId: ticket.sessionId, roomId: entry.id, clientLabel: ticket.clientLabel || 'MCP client' },
      createdAt: Date.now(),
      expiresAt: Math.min(entry.expiresAt, Date.now() + this.mcpRequestTimeoutMs),
    };
    ticket.approvalRequestId = requestId;
    entry.pendingApprovals.set(requestId, request);
    const approvalTimer = setTimeout(() => {
      const current = entry.pendingApprovals.get(requestId);
      if (!current || current.expiresAt > Date.now()) return;
      entry.pendingApprovals.delete(requestId);
      if (ticket.status !== 'pending') return;
      ticket.status = 'expired';
      ticket.revokedAt = Date.now();
      ticket.approvalRequestId = undefined;
      for (const [clientSocket, boundTicket] of entry.clientSocketTickets) {
        if (boundTicket !== ticket) continue;
        clientSocket.send({ protocol: 'webmcp-peer/1', messageId: `approval-expired-${requestId}`, type: 'approval.expired', roomId: entry.id, roomEpoch: entry.roomEpoch, sessionId: ticket.sessionId, requestId, reason: 'APPROVAL_EXPIRED' });
        clientSocket.close();
        entry.clientSocketTickets.delete(clientSocket);
        entry.clientSockets.delete(clientSocket);
      }
    }, Math.max(1, request.expiresAt - Date.now()));
    approvalTimer.unref?.();
    return request;
  }

  /**
   * Sends `request` (for `ticket`) to the room's provider socket, once per provider socket: on its
   * creation, and again only to a provider socket that attaches later, however often the agent
   * calls the relay meanwhile. A request the provider socket did not take, because its outbound
   * queue is full (`busy`) or none is attached, stays undelivered; it goes out with the ticket
   * holder's next call to the relay (an MCP POST, a client socket, a session status poll) or when a
   * provider socket attaches. A provider socket that is already closing is detached.
   */
  protected deliverApprovalRequest(entry: RoomEntry, ticket: ClientSessionTicket, request: PendingApprovalRequest): void {
    const provider = entry.providerSocket;
    if (!provider || this.approvalDeliveries.get(request) === provider) return;
    const requestedAt = new Date(request.createdAt).toISOString();
    const sent = provider.send({
      protocol: 'webmcp-peer/1',
      messageId: `approval-${request.requestId}`,
      type: 'approval.request',
      roomId: entry.id,
      roomEpoch: entry.roomEpoch,
      sessionId: ticket.sessionId,
      requestId: request.requestId,
      sentAt: requestedAt,
      expiresAt: request.expiresAt,
      payload: {
        requestId: request.requestId,
        sessionId: ticket.sessionId,
        roomId: entry.id,
        roomEpoch: entry.roomEpoch,
        clientLabel: request.clientLabel,
        capabilities: [...ticket.capabilities],
        requestedAt,
        expiresAt: request.expiresAt,
      },
    });
    if (sent === 'sent') this.approvalDeliveries.set(request, provider);
    else if (sent === 'closed') this.detachClosedProvider(entry);
  }

  /**
   * `approval.restored`: tells the provider socket that the relay still holds `ticket` approved.
   * A provider that reattaches (lease reclaim, auto-reconnect) starts with no approval state, and
   * only the relay can vouch for a decision made on the previous socket.
   */
  protected sendApprovalRestored(entry: RoomEntry, ticket: ClientSessionTicket): void {
    entry.providerSocket?.send({
      protocol: 'webmcp-peer/1',
      messageId: `approval-restored-${ticket.sessionId}`,
      type: 'approval.restored',
      roomId: entry.id,
      roomEpoch: entry.roomEpoch,
      sessionId: ticket.sessionId,
      sentAt: new Date().toISOString(),
      payload: {
        sessionId: ticket.sessionId,
        roomId: entry.id,
        roomEpoch: entry.roomEpoch,
        clientLabel: ticket.clientLabel || 'MCP client',
        capabilities: [...ticket.capabilities],
        approvedAt: ticket.approvedAt,
        expiresAt: ticket.expiresAt,
      },
    });
  }

  /**
   * Replays the room's client approval state to a provider socket that just (re)attached:
   * approved, unexpired tickets as `approval.restored`, pending ones as their `approval.request`.
   * Frames go out oldest decision/request first, so a provider that keeps one approval slot ends
   * in the state it had before the drop. Rooms without approval (`approvalRequired: false`) have
   * nothing the provider decided, so nothing is replayed. The frames follow `ready` on a socket
   * that has been sent nothing else, and a room has one ticket (its invite is single-use), so they
   * always fit its outbound queue.
   */
  protected replayClientApprovals(entry: RoomEntry): void {
    if (!entry.approvalRequired) return;
    const now = Date.now();
    const replay: Array<{ ticket: ClientSessionTicket; at: number }> = [];
    for (const ticket of entry.clientTokens.values()) {
      if (ticket.status === 'approved' && ticket.expiresAt > now) {
        replay.push({ ticket, at: ticket.approvedAt ?? ticket.issuedAt });
      } else if (ticket.status === 'pending') {
        const request = ticket.approvalRequestId ? entry.pendingApprovals.get(ticket.approvalRequestId) : undefined;
        replay.push({ ticket, at: request?.createdAt ?? now });
      }
    }
    replay.sort((left, right) => left.at - right.at);
    for (const { ticket } of replay) {
      if (ticket.status === 'approved') this.sendApprovalRestored(entry, ticket);
      else this.sendApprovalRequest(entry, ticket);
    }
    // As after the original approval: a room serving an approved client is active again.
    if (replay.some(({ ticket }) => ticket.status === 'approved')) {
      entry.roomState = 'active';
      entry.updatedAt = Date.now();
    }
  }

  protected closeClientTicket(entry: RoomEntry, token: string, status: 'rejected' | 'revoked' | 'room-rotated', reason: string): boolean {
    const ticket = entry.clientTokens.get(token);
    if (!ticket) return false;
    ticket.status = status;
    ticket.revokedAt = Date.now();
    const approvalRequestId = ticket.approvalRequestId;
    if (approvalRequestId) entry.pendingApprovals.delete(approvalRequestId);
    for (const [socket, boundTicket] of entry.clientSocketTickets) {
      if (boundTicket !== ticket) continue;
      try {
        const type = status === 'revoked' ? 'session.revoked' : status === 'room-rotated' ? 'room.rotated' : 'approval.rejected';
        socket.send({
          protocol: 'webmcp-peer/1',
          messageId: `${type}-${ticket.sessionId}-${Date.now()}`,
          type,
          roomId: entry.id,
          roomEpoch: entry.roomEpoch,
          sessionId: ticket.sessionId,
          ...(approvalRequestId ? { requestId: approvalRequestId } : {}),
          sentAt: new Date().toISOString(),
          payload: { ...(approvalRequestId ? { requestId: approvalRequestId } : {}), sessionId: ticket.sessionId, roomId: entry.id, roomEpoch: entry.roomEpoch, reason },
          reason,
        });
      } catch {}
      this.failPendingForSocket(entry, socket, { code: status === 'room-rotated' ? -32057 : status === 'revoked' ? -32001 : -32054, message: status === 'room-rotated' ? 'ROOM_ROTATED' : status === 'revoked' ? 'SESSION_INVALID' : 'CLIENT_APPROVAL_DENIED' });
      socket.close();
      entry.clientSocketTickets.delete(socket);
      entry.clientSockets.delete(socket);
    }
    ticket.approvalRequestId = undefined;
    return true;
  }

  protected approveClientTicket(entry: RoomEntry, requestId: string, allow: boolean, reason?: string): boolean {
    const pending = entry.pendingApprovals.get(requestId);
    if (!pending) return false;
    const ticket = entry.clientTokens.get(pending.clientToken);
    entry.pendingApprovals.delete(requestId);
    if (!ticket || ticket.approvalRequestId !== requestId) return false;
    if (!allow) {
      ticket.status = 'rejected';
      ticket.revokedAt = Date.now();
      this.closeClientTicket(entry, pending.clientToken, 'rejected', reason || 'CLIENT_APPROVAL_DENIED');
      return true;
    }
    ticket.status = 'approved';
    ticket.approvedAt = Date.now();
    entry.roomState = 'active';
    entry.updatedAt = Date.now();
    const sentAt = new Date(ticket.approvedAt).toISOString();
    for (const [socket, boundTicket] of entry.clientSocketTickets) {
      if (boundTicket !== ticket) continue;
      // The agent asked for this decision: a socket that is behind gets it, then `ready`, once it
      // has read what was sent before them (see replyToAgent).
      const approved = this.replyToAgent(socket, {
        protocol: 'webmcp-peer/1',
        messageId: `approval-approved-${requestId}`,
        type: 'approval.approved',
        roomId: entry.id,
        roomEpoch: entry.roomEpoch,
        sessionId: ticket.sessionId,
        requestId,
        sentAt,
        expiresAt: ticket.expiresAt,
        payload: { requestId, sessionId: ticket.sessionId, roomId: entry.id, roomEpoch: entry.roomEpoch, state: 'approved', clientTokenActive: true, decidedAt: sentAt, expiresAt: ticket.expiresAt },
      });
      if (approved !== 'sent' && approved !== 'queued') continue;
      this.replyToAgent(socket, { type: 'ready', role: 'client', roomId: entry.id, roomEpoch: entry.roomEpoch, sessionId: ticket.sessionId, capabilities: [...ticket.capabilities], expiresAt: ticket.expiresAt, approval: 'approved' });
    }
    ticket.approvalRequestId = undefined;
    return true;
  }

  /** The JSON-RPC error an in-flight request receives when its room is rotated, revoked or expired. */
  protected roomClosedRpcError(entry: RoomEntry, reason: string, status: 'revoked' | 'room-rotated'): RpcErrorBody {
    if (status === 'room-rotated') {
      return { code: -32057, message: 'ROOM_ROTATED', data: { replacementRoomId: entry.rotatedTo ?? null, roomId: entry.id, roomEpoch: entry.roomEpoch } };
    }
    if (reason === 'ROOM_EXPIRED') return { code: -32056, message: 'ROOM_EXPIRED', data: { roomId: entry.id, roomEpoch: entry.roomEpoch } };
    return { code: -32001, message: 'SESSION_INVALID' };
  }

  protected revokeAllClientTickets(entry: RoomEntry, reason: string, status: 'revoked' | 'room-rotated' = 'revoked'): void {
    for (const [token] of entry.clientTokens) this.closeClientTicket(entry, token, status, reason);
    // Requests still in flight belong to sockets no ticket is bound to (the HTTP MCP bridge):
    // settle each one with an error so its caller gets a response instead of waiting forever.
    const error = this.roomClosedRpcError(entry, reason, status);
    for (const key of [...entry.mcpPending.keys()]) this.clearPending(entry, key, error);
    entry.pendingApprovals.clear();
  }

  protected resolveBearerClientTicket(entry: RoomEntry, authorization: string | string[] | undefined): ClientSessionTicket | null {
    const header = Array.isArray(authorization) ? authorization[0] : authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    const token = header.slice('Bearer '.length).trim();
    if (!token) return null;
    return this.resolveClientTicket(entry, token);
  }

  protected cleanupExpiredRooms(now = Date.now()): void {
    for (const [roomId, entry] of this.rooms) {
      if (entry.expiresAt > now) continue;
      const retainUntil = Math.max(entry.metadataRetainUntil ?? 0, entry.rotatedRetainUntil ?? 0);
      if (retainUntil > now) {
        if (entry.roomState !== 'expired' && !entry.rotatedTo) {
          entry.roomState = 'expired';
          entry.updatedAt = now;
          this.revokeAllClientTickets(entry, 'ROOM_EXPIRED', 'revoked');
          try { entry.providerSocket?.close(); } catch {}
          for (const socket of entry.clientSockets) {
            try { socket.close(); } catch {}
          }
          entry.providerSocket = undefined;
          entry.clientSockets.clear();
          entry.clientSocketTickets.clear();
        }
        continue;
      }
      this.revokeAllClientTickets(entry, 'ROOM_EXPIRED', 'revoked');
      try { entry.providerSocket?.close(); } catch {}
      for (const socket of entry.clientSockets) {
        try { socket.close(); } catch {}
      }
      entry.providerSocket = undefined;
      entry.clientSockets.clear();
      entry.clientSocketTickets.clear();
      this.rooms.delete(roomId);
    }
  }

  async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    const url = new URL(req.url ?? '/', `http://${this.host}:${this.port}`);
    this.cleanupExpiredRooms();

    // Strict CORS preflight
    if (req.method === 'OPTIONS') {
      if (origin && !this.isOriginAllowed(origin)) {
        res.writeHead(403, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify({ error: 'CORS_ORIGIN_DENIED', origin }));
        return;
      }
      const allowOrigin = origin || `http://${this.host}:${this.port}`;
      res.writeHead(204, {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': BROWSER_ALLOWED_REQUEST_HEADERS,
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      });
      res.end();
      return;
    }

    // Fail-Closed: Deny non-whitelisted browser origins on all HTTP endpoints
    if (origin && !this.isOriginAllowed(origin)) {
      this.sendJson(res, 403, { error: 'ORIGIN_NOT_ALLOWED', origin }, origin);
      return;
    }

    // Health / Status
    if (url.pathname === '/status' || url.pathname === '/health' || url.pathname === '/ping') {
      this.sendJson(res, 200, {
        status: 'healthy',
        activeRooms: this.rooms.size,
        uptimeSec: process.uptime(),
      }, origin);
      return;
    }

    // Public, secret-free profile used by the browser's one-click clone control.
    if (req.method === 'GET' && url.pathname === '/config') {
      const serverUrl = this.requestOrigin(req);
      this.sendJson(res, 200, {
        type: 'framebook.peer.config',
        version: 1,
        serverUrl,
        protocol: 'webmcp-peer/1',
        mcpEndpointTemplate: `${serverUrl}/p/{roomId}/mcp`,
        clientEndpointTemplate: `${serverUrl.replace(/^http/i, 'ws')}/p/{roomId}/client`,
        roomEndpoint: `${serverUrl}/p`,
        defaults: { approvalRequired: true, roomTtlMs: this.clampRoomTtl(2 * 60 * 60 * 1000), maxRoomTtlMs: this.maxRoomTtlMs },
      }, origin);
      return;
    }

    if (this.customHttpHandler) {
      const handled = await this.customHttpHandler(req, res, url, origin, this);
      if (handled) return;
    }

    // 1. Room Creation: POST /p
    if (req.method === 'POST' && url.pathname === '/p') {
      const publishAuth = this.authorizePublishRequest(req);
      const publishRate = await this.consumePublishRateLimit(req, publishAuth.tokenHash);
      if (!publishRate.available) {
        const retryAfterSec = Math.max(1, Math.ceil(publishRate.retryAfterMs / 1000));
        this.sendJson(res, 503, {
          error: 'PUBLISH_RATE_LIMIT_UNAVAILABLE',
          code: -32089,
          retryAfterMs: publishRate.retryAfterMs,
        }, origin, {
          'Retry-After': String(retryAfterSec),
          'X-RateLimit-Limit': String(this.publishRateLimitMax),
          'X-RateLimit-Remaining': '0',
        });
        return;
      }
      if (!publishRate.allowed) {
        const retryAfterSec = Math.max(1, Math.ceil(publishRate.retryAfterMs / 1000));
        this.sendJson(res, 429, {
          error: 'PUBLISH_RATE_LIMITED',
          code: -32088,
          retryAfterMs: publishRate.retryAfterMs,
        }, origin, {
          'Retry-After': String(retryAfterSec),
          'X-RateLimit-Limit': String(this.publishRateLimitMax),
          'X-RateLimit-Remaining': '0',
        });
        return;
      }
      if (!publishAuth.ok) {
        this.sendJson(res, 401, { error: publishAuth.error }, origin);
        return;
      }
      const body = await this.readJsonBodyOrRespond(req, res, origin);
      if (!body) return;
      const rawHeaderOwner = req.headers['x-framebook-owner'] ?? req.headers['x-owner-id'];
      const headerOwner = typeof rawHeaderOwner === 'string' ? rawHeaderOwner.trim() : '';
      const bodyOwner = typeof body.ownerId === 'string' ? body.ownerId.trim()
        : typeof body.owner === 'string' ? body.owner.trim() : '';
      const ownerId = this.publishKeyConfigured ? this.publishKeyOwner ?? 'publish-key-owner' : undefined;
      if ((headerOwner && bodyOwner && headerOwner !== bodyOwner)
        || (ownerId && ((headerOwner && headerOwner !== ownerId)
          || (bodyOwner && bodyOwner !== ownerId)))) {
        this.sendJson(res, 403, { error: 'PUBLISH_OWNER_BINDING_INVALID' }, origin);
        return;
      }
      const alias = typeof body.alias === 'string' && body.alias.trim() ? body.alias.trim() : 'wireframe-local';
      const approvalRequired = body.approvalRequired !== false;
      const ttlMs = typeof body.ttlMs === 'number' && Number.isFinite(body.ttlMs) ? body.ttlMs : 2 * 60 * 60 * 1000;
      const capabilities = this.parsePeerCapabilities(body.capabilities);
      if (!capabilities) {
        this.sendJson(res, 400, { error: 'CAPABILITIES_INVALID' }, origin);
        return;
      }
      const entry = this.createRoomEntry(alias, approvalRequired, ttlMs, 1, capabilities, ownerId);
      this.rooms.set(entry.id, entry);
      const rateHeaders = this.publishRateLimitMax > 0 ? {
        'X-RateLimit-Limit': String(this.publishRateLimitMax),
        'X-RateLimit-Remaining': String(publishRate.remaining),
      } : undefined;
      this.sendJson(res, 201, this.roomDescriptor(req, entry), origin, rateHeaders);
      return;
    }

    // Browser F5 handoff: POST /p/:id/reclaim
    const reclaimMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/reclaim$/);
    if (req.method === 'POST' && reclaimMatch) {
      const roomId = reclaimMatch[1];
      const entry = this.rooms.get(roomId);
      // Checked before the body is read and again after it: the room can be rotated, expire or be
      // reclaimed by another request while the body is in transit.
      const reclaimable = (room: RoomEntry | undefined): room is RoomEntry => {
        if (!room || this.rooms.get(roomId) !== room) {
          this.sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }, origin);
          return false;
        }
        if (room.rotatedTo) {
          this.sendJson(res, 410, {
            error: 'ROOM_ROTATED', code: -32057, roomId, roomEpoch: room.roomEpoch,
            replacementRoomId: room.rotatedTo,
          }, origin);
          return false;
        }
        const checkedAt = Date.now();
        if (room.expiresAt <= checkedAt || room.reconnectLeaseExpiresAt <= checkedAt) {
          this.sendJson(res, 404, { error: 'ROOM_EXPIRED' }, origin);
          return false;
        }
        return true;
      };
      if (!reclaimable(entry)) return;
      const body = await this.readJsonBodyOrRespond(req, res, origin);
      if (!body || !reclaimable(entry)) return;
      const now = Date.now();
      const leaseToken = typeof body.leaseToken === 'string' ? body.leaseToken.trim() : '';
      const requestedEpoch = body.roomEpoch === undefined ? entry.roomEpoch : body.roomEpoch;
      if (!leaseToken || requestedEpoch !== entry.roomEpoch || (body.roomId !== undefined && body.roomId !== roomId)) {
        this.sendJson(res, 409, { error: 'ROOM_LEASE_BINDING_INVALID', code: -32002, roomId, roomEpoch: entry.roomEpoch }, origin);
        return;
      }
      const leaseHash = createHash('sha256').update(leaseToken).digest('hex');
      if (!this.constantTimeTokenEqual(leaseHash, entry.reconnectLeaseHash)) {
        this.sendJson(res, 401, { error: 'ROOM_LEASE_INVALID' }, origin);
        return;
      }
      if (entry.providerSocket) {
        this.sendJson(res, 409, { error: 'ROOM_PROVIDER_ACTIVE', roomId, roomEpoch: entry.roomEpoch }, origin);
        return;
      }

      entry.providerToken = randomBytes(24).toString('hex');
      entry.reconnectLeaseToken = randomBytes(24).toString('hex');
      entry.reconnectLeaseHash = createHash('sha256').update(entry.reconnectLeaseToken).digest('hex');
      entry.reconnectLeaseExpiresAt = Math.min(entry.expiresAt, now + 15 * 60_000);
      entry.updatedAt = now;
      entry.roomState = entry.clientTokens.size ? 'accepting-clients' : 'provisioned';
      this.sendJson(res, 200, {
        ...this.roomDescriptor(req, entry),
        reclaimed: true,
        reclaimedAt: new Date(now).toISOString(),
      }, origin);
      return;
    }

    // Room-independent immutable deployment catalog: GET /mcp/catalog or /mcp/catalog/:hash
    const deploymentCatalogHashMatch = url.pathname.match(/^\/mcp\/catalog\/([a-f0-9]{64})$/);
    if (req.method === 'GET' && (url.pathname === '/mcp/catalog' || deploymentCatalogHashMatch)) {
      const snapshot = this.mcpCatalogSnapshot(undefined);
      if (snapshot.tools.length === 0) {
        this.sendJson(res, 503, { error: 'CATALOG_UNAVAILABLE', catalogVersion: 0, catalogHash: snapshot.catalogHash }, origin);
        return;
      }
      if (deploymentCatalogHashMatch && deploymentCatalogHashMatch[1] !== snapshot.catalogHash) {
        this.sendJson(res, 404, { error: 'CATALOG_HASH_NOT_FOUND', catalogHash: snapshot.catalogHash }, origin);
        return;
      }
      this.sendMcpMetadata(req, res, 200, {
        protocol: 'webmcp-peer.v1',
        source: this.deploymentCatalog.source,
        tools: snapshot.tools,
        catalogVersion: snapshot.catalogVersion,
        catalogHash: snapshot.catalogHash,
        catalogUrl: `/mcp/catalog/${snapshot.catalogHash}`,
        updatedAt: snapshot.catalogUpdatedAt,
        auth: this.mcpAuthMetadata(undefined, 'not-joined'),
      }, origin, deploymentCatalogHashMatch
        ? this.mcpDeploymentCatalogCacheHeaders(snapshot.catalogVersion, snapshot.catalogHash)
        : this.mcpCatalogCacheHeaders(snapshot.catalogVersion, snapshot.catalogHash), true);
      return;
    }

    // MCP Descriptor: GET /p/:id/mcp
    const mcpMatch = url.pathname.match(/^\/p\/([A-Za-z0-9_-]{1,128})\/mcp$/);
    if (req.method === 'GET' && mcpMatch && this.acceptsOnlyEventStream(req)) {
      // Streamable HTTP: the relay offers no server-to-client SSE stream (stateless JSON responses;
      // catalog changes are pushed over the client WebSocket), so the spec requires 405. A 200 JSON
      // descriptor made the official MCP SDK treat it as an ended stream and reconnect about once
      // per second for as long as the MCP host stayed connected.
      this.sendJson(res, 405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'SSE_STREAM_NOT_SUPPORTED' } }, origin, { Allow: 'POST' });
      return;
    }
    if (req.method === 'DELETE' && mcpMatch) {
      // The relay issues no Mcp-Session-Id, so there is no session to terminate (Streamable HTTP: 405).
      this.sendJson(res, 405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'SESSION_TERMINATION_NOT_SUPPORTED' } }, origin, { Allow: 'GET, POST' });
      return;
    }
    if (req.method === 'GET' && mcpMatch) {
      const roomId = mcpMatch[1];
      const entry = this.rooms.get(roomId);
      const now = Date.now();
      const state = this.mcpRoomState(entry, now);
      const snapshot = this.mcpCatalogSnapshot(entry);
      const descriptor = {
        roomId,
        roomEpoch: entry?.roomEpoch ?? 0,
        alias: entry?.alias ?? 'unknown-room',
        protocol: 'webmcp-peer.v1',
        status: state,
        state,
        roomValid: Boolean(entry && !entry.rotatedTo && entry.expiresAt > now),
        expiresAt: entry?.expiresAt ?? null,
        catalogVersion: snapshot.catalogVersion,
        catalogHash: snapshot.catalogHash,
        toolCount: snapshot.tools.length,
        catalogUpdatedAt: snapshot.catalogUpdatedAt,
        providerConnected: Boolean(entry?.providerSocket),
        approvalRequired: entry?.approvalRequired ?? true,
        auth: this.mcpAuthMetadata(entry, 'not-joined'),
        pendingApprovalCount: entry?.pendingApprovals.size ?? 0,
        activeClientCount: entry ? [...entry.clientTokens.values()].filter(ticket => ticket.status === 'approved').length : 0,
        rotatedTo: entry?.rotatedTo ?? null,
      };
      this.sendMcpMetadata(req, res, 200, descriptor, origin,
        this.mcpDescriptorCacheHeaders(descriptor, snapshot.catalogVersion, snapshot.catalogHash), true);
      return;
    }

    // Cached MCP catalog snapshot: GET /p/:id/mcp/tools
    const toolsMatch = url.pathname.match(/^\/p\/([A-Za-z0-9_-]{1,128})\/mcp\/tools$/);
    if (req.method === 'GET' && toolsMatch) {
      const roomId = toolsMatch[1];
      const entry = this.rooms.get(roomId);
      const snapshot = this.mcpCatalogSnapshot(entry);
      const state = this.mcpRoomState(entry);
      const catalog = {
        roomId,
        tools: snapshot.tools,
        catalogVersion: snapshot.catalogVersion,
        catalogHash: snapshot.catalogHash,
        updatedAt: snapshot.catalogUpdatedAt,
        state,
        roomValid: Boolean(entry && !entry.rotatedTo && entry.expiresAt > Date.now()),
        providerConnected: Boolean(entry?.providerSocket),
        auth: this.mcpAuthMetadata(entry, 'not-joined'),
      };
      if (snapshot.tools.length === 0) {
        this.sendJson(res, 503, { error: 'CATALOG_UNAVAILABLE', catalogVersion: 0, catalogHash: snapshot.catalogHash, auth: this.mcpAuthMetadata(entry, 'not-joined') }, origin);
        return;
      }
      this.sendMcpMetadata(req, res, 200, catalog, origin,
        this.mcpDescriptorCacheHeaders(catalog, snapshot.catalogVersion, snapshot.catalogHash), true);
      return;
    }

    // Canonical MCP-over-HTTP JSON-RPC router: POST /p/:id/mcp
    if (req.method === 'POST' && mcpMatch) {
      const roomId = mcpMatch[1];
      const entry = this.rooms.get(roomId);
      // A request is forwarded to the provider as one relay message, so it gets the same limit.
      let read: BoundedBody;
      try {
        read = await readBoundedBody(req, PEER_RELAY_MAX_REQUEST_BYTES);
      } catch (error) {
        this.answerUnreadBody(req, res, error, { jsonrpc: '2.0', id: null, error: BODY_CONSUMED_ERROR }, origin);
        return;
      }
      if (read.kind === 'too-large') {
        if (read.drained) this.sendJson(res, 413, { jsonrpc: '2.0', id: null, error: REQUEST_TOO_LARGE_ERROR }, origin);
        return;
      }
      let rpc: RpcRequest;
      try { rpc = this.rpcRequestSchema.parse(JSON.parse(decodeUtf8Body(read.body))); } catch (error) {
        const refusal: RpcErrorBody = error instanceof SyntaxError
          ? { code: -32700, message: 'PARSE_ERROR' }
          : error instanceof TypeError && error.message === REQUEST_ID_TOO_LARGE_ERROR.message
            ? REQUEST_ID_TOO_LARGE_ERROR
            : { code: -32600, message: 'INVALID_REQUEST' };
        this.sendJson(res, 400, { jsonrpc: '2.0', id: null, error: refusal }, origin);
        return;
      }
      // MCP request ids must be a string or a number; a message without an id is a notification.
      if (rpc.id === null) {
        this.sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'INVALID_REQUEST' } }, origin);
        return;
      }
      // What is forwarded is this request re-serialized, which JSON not written by JSON.stringify
      // (e.g. 1e20, escaped characters) can make longer than the body; the limit applies to both.
      if (utf8ByteLength(JSON.stringify(rpc)) > PEER_RELAY_MAX_REQUEST_BYTES) {
        this.sendJson(res, 413, { jsonrpc: '2.0', id: rpc.id ?? null, error: REQUEST_TOO_LARGE_ERROR }, origin);
        return;
      }
      // After `initialize`, Streamable HTTP clients send the negotiated version on every request.
      // An unsupported one is 400 (2025-11-25); a missing header is accepted. A 2026-07-28 client
      // probing first gets this 400 and falls back to `initialize`.
      const requestedVersion = req.headers['mcp-protocol-version'];
      if (rpc.method !== 'initialize' && requestedVersion !== undefined
        && (typeof requestedVersion !== 'string' || !this.isInitializeProtocolVersion(requestedVersion.trim()))) {
        this.sendJson(res, 400, {
          jsonrpc: '2.0', id: rpc.id ?? null,
          error: { code: -32600, message: 'UNSUPPORTED_PROTOCOL_VERSION', data: { supported: MCP_INITIALIZE_PROTOCOL_VERSIONS, requested: requestedVersion } },
        }, origin);
        return;
      }
      const id = rpc.id ?? null;
      const metadataOnly = rpc.method === 'initialize'
        || rpc.method === 'server/discover'
        || rpc.method === 'tools/list'
        || rpc.method === 'ping'
        || rpc.method === 'notifications/initialized';
      const mcpTicket = entry ? this.resolveBearerClientTicket(entry, req.headers.authorization) : null;
      // A pending ticket's approval request reaches each provider socket once (deliverApprovalRequest):
      // this only sends one the attached provider socket has not taken yet.
      if (entry && mcpTicket?.status === 'pending') this.sendApprovalRequest(entry, mcpTicket);
      const roomState = this.mcpRoomState(entry);
      const snapshot = this.mcpCatalogSnapshot(entry);
      if (!metadataOnly && !entry) {
        this.sendJson(res, 404, { jsonrpc: '2.0', id, error: { code: -32004, message: 'ROOM_NOT_FOUND', data: { roomId } } }, origin);
        return;
      }
      if (!metadataOnly && entry?.rotatedTo) {
        this.sendJson(res, 410, { jsonrpc: '2.0', id, error: { code: -32057, message: 'ROOM_ROTATED', data: { replacementRoomId: entry.rotatedTo, roomId, roomEpoch: entry.roomEpoch } } }, origin);
        return;
      }
      if (!metadataOnly && entry && entry.expiresAt <= Date.now()) {
        this.sendJson(res, 410, { jsonrpc: '2.0', id, error: { code: -32056, message: 'ROOM_EXPIRED', data: { roomId, roomEpoch: entry.roomEpoch } } }, origin);
        return;
      }
      const mcpAuthError = this.clientTicketError(mcpTicket);
      if (mcpAuthError && !metadataOnly) {
        this.sendJson(res, mcpAuthError.status, { jsonrpc: '2.0', id, error: { code: mcpAuthError.code, message: mcpAuthError.message, data: { roomId, sessionId: mcpTicket?.sessionId ?? null, approvalRequired: entry?.approvalRequired ?? true } } }, origin);
        return;
      }
      if (snapshot.tools.length === 0 && (rpc.method === 'tools/list' || rpc.method === 'server/discover')) {
        this.sendJson(res, 503, { jsonrpc: '2.0', id, error: { code: -32090, message: 'CATALOG_UNAVAILABLE', data: { catalogSource: this.deploymentCatalog.source } } }, origin);
        return;
      }
      if (rpc.method === 'initialize') {
        const initialize = {
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: this.negotiateProtocolVersion(rpc.params),
            // This endpoint has no server-to-client stream, so it never sends
            // notifications/tools/list_changed (catalog changes reach WebSocket clients and surface
            // here as CATALOG_CHANGED errors).
            capabilities: { tools: { listChanged: false }, stateless: true },
            serverInfo: { name: this.serverName, version: this.serverVersion },
            tools: snapshot.tools,
            _meta: {
              roomId,
              roomEpoch: entry?.roomEpoch ?? 0,
              roomState,
              roomValid: Boolean(entry && !entry.rotatedTo && entry.expiresAt > Date.now()),
              catalogVersion: snapshot.catalogVersion,
              catalogHash: snapshot.catalogHash,
              toolCount: snapshot.tools.length,
              bootstrapCatalog: {
                tools: snapshot.tools,
                catalogVersion: snapshot.catalogVersion,
                catalogHash: snapshot.catalogHash,
                source: entry?.catalogSource ?? this.deploymentCatalog.source,
              },
              auth: this.mcpAuthMetadata(entry, mcpTicket?.status ?? 'not-joined'),
            },
          },
        };
        this.sendJson(res, 200, initialize, origin,
          this.mcpPostMetadataHeaders(snapshot.catalogVersion, snapshot.catalogHash));
        return;
      }
      if (rpc.method === 'ping') {
        this.sendJson(res, 200, { jsonrpc: '2.0', id, result: {} }, origin,
          this.mcpPostMetadataHeaders(snapshot.catalogVersion, snapshot.catalogHash));
        return;
      }
      if (rpc.method === 'notifications/initialized') {
        this.sendAccepted(res, origin, this.mcpPostMetadataHeaders(snapshot.catalogVersion, snapshot.catalogHash));
        return;
      }
      if (rpc.method === 'server/discover') {
        const discover = {
          jsonrpc: '2.0', id,
          result: this.mcpDiscoverResult(entry, roomId, this.negotiateProtocolVersion(rpc.params), snapshot, mcpTicket?.status ?? 'not-joined'),
        };
        this.sendJson(res, 200, discover, origin,
          this.mcpPostMetadataHeaders(snapshot.catalogVersion, snapshot.catalogHash));
        return;
      }
      if (rpc.method === 'tools/list') {
        const list = {
          jsonrpc: '2.0', id,
          result: {
            tools: snapshot.tools,
            _meta: this.mcpListingMeta(entry, roomId, snapshot, mcpTicket?.status ?? 'not-joined'),
          },
        };
        this.sendJson(res, 200, list, origin,
          this.mcpPostMetadataHeaders(snapshot.catalogVersion, snapshot.catalogHash));
        return;
      }
      if (!entry) {
        this.sendJson(res, 404, { jsonrpc: '2.0', id, error: { code: -32004, message: 'ROOM_NOT_FOUND', data: { roomId } } }, origin);
        return;
      }
      if (rpc.method === 'tools/call') {
        const params = this.isRecord(rpc.params) ? rpc.params : null;
        if (!params || typeof params.name !== 'string' || !params.name) {
          this.sendJson(res, 400, { jsonrpc: '2.0', id, error: { code: -32602, message: 'tools/call params are invalid' } }, origin);
          return;
        }
        const metadata = this.isRecord(params._meta) ? params._meta : null;
        if ((typeof metadata?.catalogVersion === 'number' && metadata.catalogVersion !== entry.catalogVersion)
          || (typeof metadata?.catalogHash === 'string' && metadata.catalogHash !== entry.catalogHash)) {
          this.sendJson(res, 409, {
            jsonrpc: '2.0', id,
            error: {
              code: -32010,
              message: 'CATALOG_CHANGED',
              data: { catalogVersion: entry.catalogVersion, catalogHash: entry.catalogHash },
            },
          }, origin);
          return;
        }
        if (entry.cachedTools && !entry.cachedTools.some(tool => this.isRecord(tool) && tool.name === params.name)) {
          this.sendJson(res, 400, { jsonrpc: '2.0', id, error: { code: -32602, message: 'TOOL_NOT_FOUND' } }, origin);
          return;
        }
      }
      if (!entry.providerSocket) {
        this.sendJson(res, 503, { jsonrpc: '2.0', id, error: { code: -32001, message: 'PROVIDER_UNAVAILABLE' } }, origin);
        return;
      }
      // Like a WebSocket agent's, the request reaches the provider stamped with the relay's own
      // account of who sent it.
      const stamp = { from: 'client', ...(mcpTicket ? { sessionId: mcpTicket.sessionId } : {}) };
      // A null id was rejected above, so here it means the message had no id: a notification.
      if (id === null) {
        const sent = entry.providerSocket.send({ type: 'mcp', ...stamp, message: rpc });
        if (sent !== 'sent') {
          this.answerUnforwardedHttp(res, entry, null, sent, origin);
          return;
        }
        this.sendAccepted(res, origin);
        return;
      }
      const wireId = this.allocateWireId(entry, id);
      const key = this.rpcKey(wireId);
      let resolveResponse!: (value: unknown) => void;
      const responsePromise = new Promise<unknown>(resolveResp => { resolveResponse = resolveResp; });
      const bridgeSocket: PeerSocket = {
        // The reply goes back in an HTTP response, which has no relay message limit.
        send: (value): PeerSendResult => {
          resolveResponse(this.isRecord(value) && value.type === 'mcp' ? value.message : value);
          return 'sent';
        },
        close: () => {},
      };
      // An agent that disconnects mid-call releases its pending slot right away instead of
      // holding it (and the provider's eventual answer) until the request timeout.
      let agentDisconnected = false;
      const releaseOnDisconnect = () => {
        if (res.writableEnded || entry.mcpPending.get(key)?.socket !== bridgeSocket) return;
        agentDisconnected = true;
        this.clearPending(entry, key, { code: -32001, message: 'CLIENT_DISCONNECTED' });
      };
      res.once('close', releaseOnDisconnect);
      const timer = setTimeout(() => this.clearPending(entry, key, { code: -32001, message: 'MCP_REQUEST_TIMEOUT' }), this.mcpRequestTimeoutMs);
      entry.mcpPending.set(key, { socket: bridgeSocket, timer, method: rpc.method, id, wireId });
      const sent = entry.providerSocket.send({ type: 'mcp', ...stamp, message: wireId === id ? rpc : { ...rpc, id: wireId } });
      if (sent !== 'sent') {
        // Nothing reached the provider: the relay envelope pushed the request over the limit, the
        // provider's outbound queue is full, or the provider socket is already closing.
        res.off('close', releaseOnDisconnect);
        this.clearPending(entry, key);
        this.answerUnforwardedHttp(res, entry, id, sent, origin);
        return;
      }
      const response = await responsePromise;
      res.off('close', releaseOnDisconnect);
      if (agentDisconnected) return;
      this.sendJson(res, 200, response, origin);
      return;
    }

    // 2. Client Join: POST /p/:id/join
    const joinMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/join$/);
    if (req.method === 'POST' && joinMatch) {
      const roomId = joinMatch[1];
      const entry = this.rooms.get(roomId);
      // Checked before the body is read and again after it, since the room can be rotated or
      // expire while the body is in transit.
      const joinable = (room: RoomEntry | undefined): room is RoomEntry => {
        if (room?.rotatedTo) {
          this.sendJson(res, 410, { error: 'ROOM_ROTATED', code: -32057, replacementRoomId: room.rotatedTo, roomId, roomEpoch: room.roomEpoch }, origin);
          return false;
        }
        if (!room || this.rooms.get(roomId) !== room || room.expiresAt < Date.now()) {
          this.sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }, origin);
          return false;
        }
        return true;
      };
      if (!joinable(entry)) return;
      const body = await this.readJsonBodyOrRespond(req, res, origin);
      if (!body || !joinable(entry)) return;
      const inviteToken = typeof body.inviteToken === 'string' ? body.inviteToken.trim() : '';
      if (!inviteToken) {
        this.sendJson(res, 401, { error: 'INVITE_TOKEN_REQUIRED' }, origin);
        return;
      }
      if (entry.inviteConsumed) {
        this.sendJson(res, 409, { error: 'INVITE_TOKEN_CONSUMED' }, origin);
        return;
      }
      if (!this.constantTimeTokenEqual(inviteToken, entry.inviteToken)) {
        this.sendJson(res, 403, { error: 'INVITE_TOKEN_INVALID' }, origin);
        return;
      }
      const requestedCapabilities = this.parsePeerCapabilities(body.capabilities);
      if (!requestedCapabilities) {
        this.sendJson(res, 400, { error: 'CAPABILITIES_INVALID' }, origin);
        return;
      }
      if (requestedCapabilities.includes('mcp-crdt') && !entry.capabilities.includes('mcp-crdt')) {
        this.sendJson(res, 403, { error: 'CRDT_CAPABILITY_NOT_GRANTED' }, origin);
        return;
      }

      entry.inviteConsumed = true;
      const clientToken = randomBytes(24).toString('hex');
      const sessionId = `peer-session-${randomBytes(16).toString('hex')}`;
      const issuedAt = Date.now();
      const approvedAt = entry.approvalRequired ? undefined : issuedAt;
      // Trimmed and cut to MAX_CLIENT_LABEL_CODE_POINTS: the label travels in every approval request.
      const clientLabel = typeof body.clientLabel === 'string' && body.clientLabel.trim()
        ? truncateCodePoints(body.clientLabel.trim(), MAX_CLIENT_LABEL_CODE_POINTS) : 'MCP client';
      const ticket: ClientSessionTicket = {
        sessionId,
        issuedAt,
        expiresAt: entry.expiresAt,
        status: entry.approvalRequired ? 'pending' : 'approved',
        ...(approvedAt ? { approvedAt } : {}),
        clientLabel,
        capabilities: requestedCapabilities,
      };
      entry.clientTokens.set(clientToken, ticket);
      entry.roomState = entry.roomState === 'provisioned' || entry.roomState === 'provider-connected'
        ? 'accepting-clients' : entry.roomState;
      entry.updatedAt = Date.now();
      const approval = this.sendApprovalRequest(entry, ticket);

      this.sendJson(res, 201, {
        roomId,
        roomEpoch: entry.roomEpoch,
        clientToken,
        sessionId,
        issuedAt,
        expiresAt: entry.expiresAt,
        approvalRequired: entry.approvalRequired,
        capabilities: [...ticket.capabilities],
        approvalState: ticket.status,
        state: entry.approvalRequired ? 'pending-approval' : 'approved',
        ...(approval ? { approvalRequestId: approval.requestId } : {}),
      }, origin);
      return;
    }

    // 3. HTTP Approval Decision: POST /p/:id/approval/:requestId
    const approvalMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/approval\/([^/]+)$/);
    if (req.method === 'POST' && approvalMatch) {
      const roomId = approvalMatch[1];
      const requestId = decodeURIComponent(approvalMatch[2]);
      const entry = this.rooms.get(roomId);
      const authorization = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
      const bearer = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      // Checked before the body is read and again after it: the room can expire, be rotated, or be
      // reclaimed (a new provider token) while the body is in transit.
      const decidable = (room: RoomEntry | undefined): room is RoomEntry => {
        if (!room || this.rooms.get(roomId) !== room || room.expiresAt <= Date.now()) {
          this.sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }, origin);
          return false;
        }
        if (!bearer || !this.constantTimeTokenEqual(bearer, room.providerToken)) {
          this.sendJson(res, 401, { error: 'PROVIDER_TOKEN_REQUIRED' }, origin);
          return false;
        }
        return true;
      };
      if (!decidable(entry)) return;
      const body = await this.readJsonBodyOrRespond(req, res, origin);
      if (!body || !decidable(entry)) return;
      const pending = entry.pendingApprovals.get(requestId);
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
      const roomEpoch = typeof body.roomEpoch === 'number' ? body.roomEpoch : undefined;
      const decision = body.decision;
      if (!pending || !sessionId || pending.sessionId !== sessionId || body.roomId !== roomId || roomEpoch !== entry.roomEpoch
        || (decision !== 'approved' && decision !== 'rejected')) {
        this.sendJson(res, 409, { error: 'INVALID_APPROVAL', code: -32081 }, origin);
        return;
      }
      const handled = this.approveClientTicket(entry, requestId, decision === 'approved', typeof body.reason === 'string' ? body.reason : undefined);
      if (!handled) {
        this.sendJson(res, 409, { error: 'INVALID_APPROVAL', code: -32081 }, origin);
        return;
      }
      this.sendJson(res, 200, {
        requestId,
        sessionId,
        roomId,
        roomEpoch: entry.roomEpoch,
        state: decision,
        clientTokenActive: decision === 'approved',
        decidedAt: new Date().toISOString(),
        expiresAt: new Date(pending.expiresAt).toISOString(),
      }, origin);
      return;
    }

    // 4. Session Status: GET /p/:id/sessions/:sessionId
    const sessionStatusMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/sessions\/([^/]+)$/);
    if (req.method === 'GET' && sessionStatusMatch) {
      const roomId = sessionStatusMatch[1];
      const sessionId = decodeURIComponent(sessionStatusMatch[2]);
      const entry = this.rooms.get(roomId);
      if (!entry) {
        this.sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }, origin);
        return;
      }
      if (entry.rotatedTo) {
        this.sendJson(res, 410, { error: 'ROOM_ROTATED', code: -32057, replacementRoomId: entry.rotatedTo, roomId, roomEpoch: entry.roomEpoch }, origin);
        return;
      }
      const authorization = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
      const bearer = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      const found = this.findClientToken(entry, sessionId);
      const byClient = Boolean(bearer && found && this.constantTimeTokenEqual(bearer, found.token));
      const authorized = byClient || Boolean(bearer && this.constantTimeTokenEqual(bearer, entry.providerToken));
      if (!authorized || !found) {
        this.sendJson(res, authorized ? 404 : 401, { error: authorized ? 'SESSION_NOT_FOUND' : 'CLIENT_TOKEN_REQUIRED' }, origin);
        return;
      }
      const ticket = found.ticket;
      if (ticket.expiresAt <= Date.now() && ticket.status !== 'revoked' && ticket.status !== 'rejected') ticket.status = 'expired';
      // An agent that waits for approval polls here (waitForPeerApproval): its approval request
      // goes to an attached provider socket that has not taken it yet (deliverApprovalRequest).
      if (byClient && ticket.status === 'pending') this.sendApprovalRequest(entry, ticket);
      const state = ticket.status === 'pending' ? 'pending-approval' : ticket.status === 'rejected' ? 'rejected' : ticket.status;
      this.sendJson(res, 200, {
        roomId,
        roomEpoch: entry.roomEpoch,
        sessionId,
        state,
        clientLabel: ticket.clientLabel ?? 'MCP client',
        approvalRequestId: ticket.approvalRequestId ?? null,
        issuedAt: new Date(ticket.issuedAt).toISOString(),
        expiresAt: new Date(ticket.expiresAt).toISOString(),
        ...(ticket.approvedAt ? { approvedAt: new Date(ticket.approvedAt).toISOString() } : {}),
        ...(ticket.revokedAt ? { revokedAt: new Date(ticket.revokedAt).toISOString() } : {}),
      }, origin);
      return;
    }

    // 5. Session Revocation: POST /p/:id/session/revoke or POST /p/:id/sessions/:sessionId/revoke
    const revokePeerMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/(?:session\/revoke|sessions\/([^/]+)\/revoke)$/);
    if (req.method === 'POST' && revokePeerMatch) {
      const roomId = revokePeerMatch[1];
      const entry = this.rooms.get(roomId);
      // Checked before the body is read and again after it, since the room can expire or be
      // rotated while the body is in transit (the tokens are checked after the read).
      const revocable = (room: RoomEntry | undefined): room is RoomEntry => {
        if (!room || this.rooms.get(roomId) !== room || room.expiresAt <= Date.now()) {
          this.sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }, origin);
          return false;
        }
        return true;
      };
      if (!revocable(entry)) return;
      const authorization = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
      const bearer = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      const body = await this.readJsonBodyOrRespond(req, res, origin);
      if (!body || !revocable(entry)) return;
      const pathSessionId = revokePeerMatch[2] ? decodeURIComponent(revokePeerMatch[2]) : '';
      if (pathSessionId && (body.roomId !== roomId || body.roomEpoch !== entry.roomEpoch)) {
        this.sendJson(res, 409, { error: 'SESSION_BINDING_INVALID', code: -32002 }, origin);
        return;
      }
      if (pathSessionId) body.sessionId = pathSessionId;
      if (bearer && this.constantTimeTokenEqual(bearer, entry.providerToken)) {
        const requestedSessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
        if (!requestedSessionId) {
          this.revokeAllClientTickets(entry, 'ROOM_REVOKED');
          this.sendJson(res, 200, { roomId, revoked: true, revokedSessions: true }, origin);
          return;
        }
        const found = this.findClientToken(entry, requestedSessionId);
        if (!found) {
          this.sendJson(res, 404, { error: 'SESSION_NOT_FOUND' }, origin);
          return;
        }
        // Read before closing: closeClientTicket sets the status to 'revoked'. A repeat revoke is
        // idempotent and reports the original revocation time.
        const alreadyRevoked = found.ticket.status === 'revoked';
        if (!alreadyRevoked) this.closeClientTicket(entry, found.token, 'revoked', 'SESSION_REVOKED');
        this.sendJson(res, 200, { roomId, roomEpoch: entry.roomEpoch, sessionId: requestedSessionId, state: 'revoked', revoked: true, revokedAt: new Date(found.ticket.revokedAt ?? Date.now()).toISOString(), reason: body.reason ?? 'provider-request', alreadyRevoked }, origin);
        return;
      }
      const ticket = bearer ? this.resolveClientTicket(entry, bearer) : null;
      if (!ticket) {
        this.sendJson(res, 401, { error: 'CLIENT_TOKEN_REQUIRED' }, origin);
        return;
      }
      if (typeof body.sessionId === 'string' && body.sessionId && body.sessionId !== ticket.sessionId) {
        this.sendJson(res, 403, { error: 'SESSION_BINDING_INVALID' }, origin);
        return;
      }
      if (body.roomId !== roomId || body.roomEpoch !== entry.roomEpoch) {
        this.sendJson(res, 409, { error: 'SESSION_BINDING_INVALID', code: -32002 }, origin);
        return;
      }
      const alreadyRevoked = ticket.status === 'revoked';
      if (!alreadyRevoked) this.closeClientTicket(entry, bearer, 'revoked', 'CLIENT_REVOKED');
      this.sendJson(res, 200, { roomId, roomEpoch: entry.roomEpoch, sessionId: ticket.sessionId, state: 'revoked', revoked: true, revokedAt: new Date(ticket.revokedAt ?? Date.now()).toISOString(), reason: body.reason ?? 'client-request', alreadyRevoked }, origin);
      return;
    }

    // 6. Room Rotation: POST /p/:id/rotate
    const rotateMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/rotate$/);
    if (req.method === 'POST' && rotateMatch) {
      const roomId = rotateMatch[1];
      const entry = this.rooms.get(roomId);
      const authorization = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
      const bearer = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      // Checked before the body is read and again after it: a concurrent rotation (which would
      // otherwise rotate the room twice and leave two live replacements), an expiry or a reclaim
      // (a new provider token) can happen while the body is in transit.
      const rotatable = (room: RoomEntry | undefined): room is RoomEntry => {
        if (!room || this.rooms.get(roomId) !== room || room.rotatedTo || room.expiresAt <= Date.now()) {
          this.sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }, origin);
          return false;
        }
        if (!bearer || !this.constantTimeTokenEqual(bearer, room.providerToken)) {
          this.sendJson(res, 401, { error: 'PROVIDER_TOKEN_REQUIRED' }, origin);
          return false;
        }
        return true;
      };
      if (!rotatable(entry)) return;
      const body = await this.readJsonBodyOrRespond(req, res, origin);
      if (!body || !rotatable(entry)) return;
      if ((body.roomId !== undefined && body.roomId !== roomId) || (body.roomEpoch !== undefined && body.roomEpoch !== entry.roomEpoch)) {
        this.sendJson(res, 409, { error: 'ROOM_ROTATED', code: -32057, roomId, roomEpoch: entry.roomEpoch, replacementRoomId: entry.rotatedTo ?? null }, origin);
        return;
      }
      const alias = typeof body.alias === 'string' && body.alias.trim() ? body.alias.trim() : entry.alias;
      const ttlMs = typeof body.ttlMs === 'number' && Number.isFinite(body.ttlMs) ? body.ttlMs : 2 * 60 * 60 * 1000;
      const rotatedAt = Date.now();
      entry.roomState = 'rotating';
      entry.updatedAt = rotatedAt;
      const replacement = this.createRoomEntry(alias, entry.approvalRequired, ttlMs, entry.roomEpoch + 1, entry.capabilities, entry.ownerId);
      this.rooms.set(replacement.id, replacement);
      entry.rotatedTo = replacement.id;
      entry.expiresAt = rotatedAt;
      entry.rotatedRetainUntil = rotatedAt + 5 * 60_000;
      entry.roomState = 'rotated';
      entry.updatedAt = rotatedAt;
      this.revokeAllClientTickets(entry, 'ROOM_ROTATED', 'room-rotated');
      entry.providerSocket?.send({
        protocol: 'webmcp-peer/1',
        messageId: `room-rotated-${entry.id}`,
        type: 'room.rotated',
        roomId: entry.id,
        roomEpoch: entry.roomEpoch,
        sentAt: new Date().toISOString(),
        payload: { previousRoomId: entry.id, previousRoomEpoch: entry.roomEpoch, previousState: 'rotated', replacementRoomId: replacement.id, replacementRoomEpoch: replacement.roomEpoch, rotatedAt: new Date().toISOString(), invalidatedSessionCount: entry.clientTokens.size },
        rotatedTo: replacement.id,
      });
      for (const socket of entry.clientSockets) {
        socket.send({
          protocol: 'webmcp-peer/1',
          messageId: `room-rotated-${entry.id}-${entry.clientTokens.size}`,
          type: 'room.rotated',
          roomId: entry.id,
          roomEpoch: entry.roomEpoch,
          sentAt: new Date().toISOString(),
          payload: { previousRoomId: entry.id, previousRoomEpoch: entry.roomEpoch, previousState: 'rotated', replacementRoomId: replacement.id, replacementRoomEpoch: replacement.roomEpoch, rotatedAt: new Date().toISOString(), invalidatedSessionCount: entry.clientTokens.size },
          rotatedTo: replacement.id,
        });
      }
      entry.providerSocket?.close();
      for (const socket of entry.clientSockets) socket.close();
      entry.clientSockets.clear();
      entry.clientSocketTickets.clear();
      entry.providerSocket = undefined;
      this.sendJson(res, 201, {
        ...this.roomDescriptor(req, replacement),
        rotatedFrom: roomId,
        previousRoomId: roomId,
        previousRoomEpoch: entry.roomEpoch,
        previousState: 'rotated',
        replacementRoomId: replacement.id,
        replacementRoomEpoch: replacement.roomEpoch,
        rotatedAt: new Date().toISOString(),
        invalidatedSessionCount: entry.clientTokens.size,
      }, origin);
      return;
    }

    this.sendJson(res, 404, { error: 'NOT_FOUND' }, origin);
  }

  async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    // Node's HTTP server stops listening for errors on the socket it hands to 'upgrade', and the
    // WebSocket codec listens only once it is attached, after any awaiting customUpgradeHandler: a
    // client that resets its connection meanwhile (ECONNRESET) would otherwise raise an 'error'
    // event nobody handles, an uncaught exception that ends the relay process.
    socket.on('error', () => socket.destroy());
    try {
      const origin = req.headers.origin;
      if (origin && !this.isOriginAllowed(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nOrigin not allowed\r\n');
        socket.destroy();
        return;
      }

      const url = new URL(req.url ?? '/', `http://${this.host}:${this.port}`);
      if (this.customUpgradeHandler) {
        const handled = await this.customUpgradeHandler(req, socket, head, url, origin, this);
        if (handled) return;
        // A client that went away while the hook was awaiting has already ended (or closed) its
        // side, and those events do not fire again for the WebSocket attached next: the relay would
        // hold a socket it never sees close (a provider that blocks every reclaim).
        if (socket.destroyed || socket.readableEnded || !socket.writable) {
          socket.destroy();
          return;
        }
      }

      const providerMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/provider$/);
      const clientMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/client$/);

      if (providerMatch) {
        const roomId = providerMatch[1];
        const entry = this.rooms.get(roomId);
        if (!entry || entry.expiresAt <= Date.now()) {
          socket.destroy();
          return;
        }
        const protocols = typeof req.headers['sec-websocket-protocol'] === 'string'
          ? req.headers['sec-websocket-protocol'].split(',').map(value => value.trim()) : [];
        const ticket = protocols.find(value => value.startsWith('ticket.'))?.slice('ticket.'.length);
        if (!ticket || !this.constantTimeTokenEqual(ticket, entry.providerToken)) {
          socket.destroy();
          return;
        }

        const peer = upgradeWebSocket(
          req,
          socket,
          head,
          (text) => {
            try {
              // Only the room's attached provider socket speaks for it: one the relay replaced,
              // detached or never attached is closed instead of acting on the room.
              if (entry.providerSocket !== peer || entry.expiresAt <= Date.now()) {
                peer.close();
                return;
              }
              const msg = PeerFrameSchema.parse(JSON.parse(text));
              // The relay's answers to the provider's own frames (this pong, an approval decision's
              // echo, a register refusal) are sent with `send` alone: a provider whose outbound
              // queue is full skips them and is not closed, since what fills its queue is mostly
              // traffic its agents caused.
              if (msg.type === 'ping') {
                peer.send({ type: 'pong', timestamp: Date.now() });
                return;
              }
              if (msg.type === 'approval.decision') {
                const payload = this.isRecord(msg.payload) ? msg.payload : msg;
                const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
                const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
                const roomEpoch = typeof payload.roomEpoch === 'number' ? payload.roomEpoch : msg.roomEpoch;
                const decision = payload.decision;
                const reason = typeof payload.reason === 'string' ? payload.reason : undefined;
                if (msg.protocol !== 'webmcp-peer/1' || typeof msg.messageId !== 'string'
                  || !requestId || !sessionId || payload.roomId !== roomId || roomEpoch !== entry.roomEpoch
                  || (msg.roomId !== undefined && msg.roomId !== roomId)
                  || (msg.sessionId !== undefined && msg.sessionId !== sessionId)
                  || (decision !== 'approved' && decision !== 'rejected')) {
                  peer.send({ type: 'error', code: -32081, message: 'INVALID_APPROVAL', requestId: requestId || null });
                  return;
                }
                const pending = entry.pendingApprovals.get(requestId);
                if (!pending || pending.sessionId !== sessionId) {
                  peer.send({ type: 'error', code: -32081, message: 'INVALID_APPROVAL', requestId });
                  return;
                }
                const handled = this.approveClientTicket(entry, requestId, decision === 'approved', reason);
                if (!handled) {
                  peer.send({ type: 'error', code: -32081, message: 'INVALID_APPROVAL', requestId });
                  return;
                }
                peer.send({
                  protocol: 'webmcp-peer/1',
                  messageId: `approval-decision-${requestId}`,
                  type: decision === 'approved' ? 'approval.approved' : 'approval.rejected',
                  roomId,
                  roomEpoch: entry.roomEpoch,
                  sessionId,
                  requestId,
                  sentAt: new Date().toISOString(),
                  expiresAt: pending.expiresAt,
                  payload: { requestId, sessionId, roomId, roomEpoch: entry.roomEpoch, state: decision, clientTokenActive: decision === 'approved', decidedAt: new Date().toISOString(), expiresAt: pending.expiresAt },
                  ...(reason ? { reason } : {}),
                });
                return;
              }
              if (msg.type === 'register') {
                this.receiveRegister(entry, peer, msg);
                return;
              }
              if (msg.type === 'mcp' && this.isRpcResponse(msg.message)) {
                const rpc = msg.message;
                const pending = entry.mcpPending.get(this.rpcKey(rpc.id));
                if (!pending) return;
                this.clearPending(entry, this.rpcKey(rpc.id));
                // The relay's catalog metadata can push a reply that fit the provider's limit over
                // it; the agent then gets an error instead of a socket close. An agent that is
                // behind gets the reply once it has read what was sent before it (replyToAgent);
                // neither socket is closed for it.
                if (this.replyToAgent(pending.socket, this.agentReplyFrame(entry, pending, msg, rpc)) === 'too-large') {
                  this.sendRpcError(pending.socket, pending.id, RESULT_TOO_LARGE_ERROR.code, RESULT_TOO_LARGE_ERROR.message, RESULT_TOO_LARGE_ERROR.data);
                }
                return;
              }
              // Everything else the provider sends goes to every agent of the room, which did not ask
              // for it: an agent that is behind skips it.
              this.broadcastToAgents(entry, msg);
            } catch { /* malformed frames ignored */ }
          },
          () => {
            this.dropWaitingRegister(entry, peer);
            if (entry.providerSocket === peer) {
              entry.providerSocket = undefined;
              this.failPendingForProvider(entry);
            }
          },
        );

        // A socket that is already closed when attached never reports its close: it must not
        // become the room's provider (and displace a live one), or the room would report a
        // provider and refuse every reclaim.
        if (peer.send({ type: 'ready', role: 'provider', roomId, roomEpoch: entry.roomEpoch, capabilities: [...entry.capabilities], expiresAt: entry.expiresAt }) !== 'sent') {
          peer.close();
          return;
        }
        // One provider socket per room: a new one with the provider token replaces the attached
        // one, which is detached (failing the requests it was answering) and closed rather than
        // left open to keep acting on the room.
        if (entry.providerSocket && entry.providerSocket !== peer) this.detachClosedProvider(entry);
        entry.providerSocket = peer;
        entry.roomState = entry.clientTokens.size ? 'accepting-clients' : 'provider-connected';
        entry.updatedAt = Date.now();
        this.replayClientApprovals(entry);
        return;
      }

      if (clientMatch) {
        const roomId = clientMatch[1];
        const entry = this.rooms.get(roomId);
        if (!entry || entry.expiresAt <= Date.now()) {
          socket.destroy();
          return;
        }
        const protocols = typeof req.headers['sec-websocket-protocol'] === 'string'
          ? req.headers['sec-websocket-protocol'].split(',').map(value => value.trim()) : [];
        const ticket = protocols.find(value => value.startsWith('ticket.'))?.slice('ticket.'.length);
        const clientTicket = ticket ? this.resolveClientTicket(entry, ticket) : null;
        if (!ticket || !clientTicket || clientTicket.expiresAt <= Date.now() || clientTicket.status === 'revoked' || clientTicket.status === 'rejected' || clientTicket.status === 'expired' || clientTicket.status === 'room-rotated') {
          socket.destroy();
          return;
        }

        const peer = upgradeWebSocket(
          req,
          socket,
          head,
          (text) => {
            try {
              // A socket the relay dropped from the room (revoked, replaced, never attached) is
              // closed instead of acting on it.
              if (!entry.clientSockets.has(peer) || entry.expiresAt <= Date.now() || clientTicket.expiresAt <= Date.now()) {
                peer.close();
                return;
              }
              const msg = PeerFrameSchema.parse(JSON.parse(text));
              if (msg.type === 'ping') {
                peer.send({ type: 'pong', timestamp: Date.now() });
                return;
              }
              if (msg.type === 'mcp') {
                const rpc = msg.message;
                // The request limit, not the stamped envelope's size, decides what is forwarded,
                // so the same request is accepted or refused whatever its id and session id.
                if (this.isRpcRequest(rpc) && exceedsRequestLimit(text, msg)) {
                  if (rpc.id !== undefined && rpc.id !== null) {
                    this.sendRpcError(peer, rpc.id, REQUEST_TOO_LARGE_ERROR.code, REQUEST_TOO_LARGE_ERROR.message, REQUEST_TOO_LARGE_ERROR.data);
                  }
                  return;
                }
                if (!this.isRpcRequest(rpc)) {
                  if (this.isRecord(rpc) && this.isOversizedRpcId(rpc.id)) {
                    // Not echoed: the id is what is too large.
                    this.sendRpcError(peer, null, REQUEST_ID_TOO_LARGE_ERROR.code, REQUEST_ID_TOO_LARGE_ERROR.message, REQUEST_ID_TOO_LARGE_ERROR.data);
                    return;
                  }
                  const invalidId = this.isRecord(rpc) && (typeof rpc.id === 'string' || typeof rpc.id === 'number' || rpc.id === null) ? rpc.id : undefined;
                  this.sendRpcError(peer, invalidId, -32600, 'INVALID_REQUEST');
                  return;
                }
                if (clientTicket.status !== 'approved') {
                  const statusCode = clientTicket.status === 'revoked' || clientTicket.status === 'room-rotated' ? -32001 : clientTicket.status === 'expired' ? -32056 : clientTicket.status === 'rejected' ? -32054 : -32053;
                  const statusMessage = clientTicket.status === 'revoked' || clientTicket.status === 'room-rotated' ? 'SESSION_INVALID' : clientTicket.status === 'expired' ? 'SESSION_EXPIRED' : clientTicket.status === 'rejected' ? 'CLIENT_APPROVAL_DENIED' : 'CLIENT_APPROVAL_REQUIRED';
                  this.sendRpcError(peer, rpc.id, statusCode, statusMessage, {
                    sessionId: clientTicket.sessionId,
                    approvalRequestId: clientTicket.approvalRequestId,
                  });
                  return;
                }
                // What reaches the provider says who sent it in the relay's own words: whatever
                // `from` or `sessionId` the client put on its frame is replaced.
                const stamp = { from: 'client', sessionId: clientTicket.sessionId };
                const id = rpc.id;
                if (id === undefined || id === null) {
                  // A notification has no one to answer, so one the provider cannot take now (its
                  // queue is full, or it is too large) is dropped; a provider socket that is already
                  // closing is still detached, so the next request gets PROVIDER_UNAVAILABLE.
                  if (entry.providerSocket?.send({ ...msg, ...stamp }) === 'closed') this.detachClosedProvider(entry);
                  return;
                }
                if (rpc.method === 'tools/call') {
                  const params = this.isRecord(rpc.params) ? rpc.params : null;
                  if (!params || typeof params.name !== 'string' || !params.name) {
                    this.sendRpcError(peer, id, -32602, 'tools/call params are invalid');
                    return;
                  }
                  const metadata = this.isRecord(params._meta) ? params._meta : null;
                  const version = metadata?.catalogVersion;
                  const hash = metadata?.catalogHash;
                  if ((typeof version === 'number' && version !== entry.catalogVersion)
                    || (typeof hash === 'string' && hash !== entry.catalogHash)) {
                    this.sendRpcError(peer, id, -32010, 'CATALOG_CHANGED', {
                      catalogVersion: entry.catalogVersion,
                      catalogHash: entry.catalogHash,
                    });
                    return;
                  }
                  if (entry.cachedTools && !entry.cachedTools.some(tool => this.isRecord(tool) && tool.name === params.name)) {
                    this.sendRpcError(peer, id, -32602, 'TOOL_NOT_FOUND');
                    return;
                  }
                }
                if (this.hasPendingRequest(entry, peer, id)) {
                  this.sendRpcError(peer, id, -32600, 'DUPLICATE_REQUEST_ID');
                  return;
                }
                if (this.pendingRequestCount(entry, peer) >= MAX_PENDING_REQUESTS_PER_SOCKET) {
                  this.sendRpcError(peer, id, TOO_MANY_PENDING_REQUESTS_ERROR.code, TOO_MANY_PENDING_REQUESTS_ERROR.message, TOO_MANY_PENDING_REQUESTS_ERROR.data);
                  return;
                }
                const wireId = this.allocateWireId(entry, id);
                const key = this.rpcKey(wireId);
                if (!entry.providerSocket) {
                  this.sendRpcError(peer, id, -32001, 'PROVIDER_UNAVAILABLE');
                  return;
                }
                const timer = setTimeout(() => {
                  this.clearPending(entry, key, { code: -32001, message: 'MCP_REQUEST_TIMEOUT' });
                }, this.mcpRequestTimeoutMs);
                const params = this.isRecord(rpc.params) ? rpc.params : undefined;
                const discovers = rpc.method === 'server/discover';
                entry.mcpPending.set(key, {
                  socket: peer,
                  timer,
                  method: rpc.method,
                  id,
                  wireId,
                  includeCatalogMeta: this.isRecord(params?._meta),
                  // A listing with a cursor asks for one page, not the whole catalog.
                  listsCatalog: discovers || (rpc.method === 'tools/list' && (params?.cursor === undefined || params.cursor === null)),
                  ...(discovers ? { protocolVersion: this.negotiateProtocolVersion(params) } : {}),
                });
                const sent = entry.providerSocket.send({ ...msg, ...stamp, message: wireId === id ? rpc : { ...rpc, id: wireId } });
                if (sent !== 'sent') {
                  // Nothing reached the provider: answer the agent instead of closing either socket.
                  // A provider whose queue is full stays attached (PROVIDER_BUSY, retryable).
                  this.clearPending(entry, key, unforwardedRpcError(sent));
                  if (sent === 'closed') this.detachClosedProvider(entry);
                }
                return;
              }
              // Only approved clients relay signaling, and only the allow-listed types. The relay
              // stamps the origin and the authoritative sessionId, so a client cannot forge either.
              if (clientTicket.status !== 'approved' || !CLIENT_SIGNALING_FRAME_TYPES.has(msg.type)) return;
              // The provider answers an offer under its requestId, so one over MAX_RPC_ID_BYTES would
              // be forwarded for an answer the provider cannot fit in a relay message. It is refused
              // as a request with such an id is, without echoing the id.
              if (isOversizedEchoedId(msg.requestId)) {
                this.replyToAgent(peer, { type: `${msg.type}.refused`, error: REQUEST_ID_TOO_LARGE_ERROR });
                return;
              }
              // An offer is forwarded on the agent's behalf like a request, under the same limit.
              const sent = exceedsRequestLimit(text, msg)
                ? 'too-large'
                : entry.providerSocket?.send({ ...msg, from: 'client', sessionId: clientTicket.sessionId }) ?? 'closed';
              if (sent === 'sent') return;
              if (sent === 'closed') this.detachClosedProvider(entry);
              // The offer's sender waits for an answer that will not come: it is told why, under the
              // offer's requestId, with the error a request would get (PROVIDER_BUSY is retryable).
              this.replyToAgent(peer, {
                type: `${msg.type}.refused`,
                ...(typeof msg.requestId === 'string' ? { requestId: msg.requestId } : {}),
                error: unforwardedRpcError(sent),
              });
            } catch { /* malformed frames ignored */ }
          },
          () => {
            this.agentOutboxes.get(peer)?.discard();
            entry.clientSockets.delete(peer);
            entry.clientSocketTickets.delete(peer);
            this.failPendingForSocket(entry, peer);
          },
        );
        this.agentOutboxes.set(peer, new AgentOutbox(peer, socket));

        // A socket that is already closed when attached never reports its close: it is not
        // attached to the room.
        if (peer.send({ type: 'ready', role: 'client', roomId, roomEpoch: entry.roomEpoch, sessionId: clientTicket.sessionId, capabilities: [...clientTicket.capabilities], expiresAt: clientTicket.expiresAt, approval: clientTicket.status }) !== 'sent') {
          peer.close();
          return;
        }
        // At most MAX_CLIENT_SOCKETS_PER_TICKET per ticket: the oldest ones (in attach order) make
        // room, as after a revocation.
        const ticketSockets = [...entry.clientSocketTickets].filter(([, bound]) => bound === clientTicket).map(([bound]) => bound);
        const excess = ticketSockets.length + 1 - MAX_CLIENT_SOCKETS_PER_TICKET;
        for (const stale of ticketSockets.slice(0, Math.max(0, excess))) {
          stale.close();
          entry.clientSockets.delete(stale);
          entry.clientSocketTickets.delete(stale);
          this.failPendingForSocket(entry, stale);
        }
        entry.clientSockets.add(peer);
        entry.clientSocketTickets.set(peer, clientTicket);
        if (clientTicket.status === 'pending') this.sendApprovalRequest(entry, clientTicket, peer);
        return;
      }

      socket.destroy();
    } catch {
      socket.destroy();
    }
  }
}

export function createWebMcpPeerServer(options?: WebMcpPeerServerOptions): WebMcpPeerServer {
  return new WebMcpPeerServer(options);
}
