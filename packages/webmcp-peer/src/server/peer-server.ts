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
  SqlitePublishRateLimitStore,
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
import { PEER_CATALOG_MAX_TOOLS, PEER_CATALOG_MAX_TOOL_NAME_LENGTH } from "../config/catalog.js";
import { isPeerErrorName, PEER_ERROR_CODES, peerRpcError, type PeerErrorName } from "../config/errors.js";
import {
  WEBMCP_PEER_CONFIG_TYPE,
  WEBMCP_PROTOCOL,
  WEBMCP_ROOM_ID_SYNTAX,
  WEBMCP_SUBPROTOCOL,
} from "../config/types.js";

/** Default upper bound for a room's `ttlMs` (24 hours); see `WebMcpPeerServerOptions.maxRoomTtlMs`. */
const DEFAULT_MAX_ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_ROOM_TTL_MS = 60_000;
/** Hard ceiling for `maxRoomTtlMs`, which keeps every room timestamp inside the JS Date range. */
const ROOM_TTL_CEILING_MS = 365 * 24 * 60 * 60 * 1000;
const ROOM_METADATA_RETAIN_MS = 24 * 60 * 60_000;
/**
 * How long a room's reconnect lease outlives its provider socket (15 minutes), reported in every
 * room descriptor as `reconnectGraceMs`. The lease does not expire while a provider socket is
 * attached; once none is, it expires this long after, or with the room. So a host that kept its
 * socket for the room's whole life can still reclaim the room after a reload, while a lease that
 * leaked is usable for at most this long after its provider went away.
 */
const RECONNECT_GRACE_MS = 15 * 60_000;
/** Default lifetime of an approval request (5 minutes); see `WebMcpPeerServerOptions.approvalTimeoutMs`. */
const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60_000;
const MIN_APPROVAL_TIMEOUT_MS = 1_000;
/** The longest delay a Node timer keeps (2^31 − 1 ms); a longer one fires after 1 ms instead. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;
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

/** The status a ticket ends with (see `WebMcpPeerServer.closeClientTicket`). */
type TicketEndStatus = Extract<ClientSessionStatus, 'rejected' | 'revoked' | 'room-rotated' | 'expired'>;
/**
 * The frame each ending of a ticket sends the ticket's client sockets: a rejected approval, a
 * revocation, the room's rotation, or the room's expiry. A ticket is ended as `expired` here only
 * with its room; an approval request that expires sends its own `approval.expired`.
 */
const TICKET_END_FRAMES: Readonly<Record<TicketEndStatus, string>> = {
  rejected: 'approval.rejected',
  revoked: 'session.revoked',
  'room-rotated': 'room.rotated',
  expired: 'room.expired',
};

type RpcRequest = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: unknown };
type RpcErrorBody = { code: number; message: string; data?: unknown };

/** A request over the agent request limit (PEER_RELAY_MAX_REQUEST_BYTES), which the relay does not forward. */
const REQUEST_TOO_LARGE_ERROR: RpcErrorBody = peerRpcError('REQUEST_TOO_LARGE', { limitBytes: PEER_RELAY_MAX_REQUEST_BYTES });
/** A request the relay cannot forward because the provider socket is closing or closed. */
const PROVIDER_UNAVAILABLE_ERROR: RpcErrorBody = peerRpcError('PROVIDER_UNAVAILABLE');
/**
 * A request the relay did not forward because the provider's outbound queue is full: the provider
 * has not yet read what the relay already sent it. Nothing reached the provider and it stays
 * attached, so the agent may send the request again.
 */
const PROVIDER_BUSY_ERROR: RpcErrorBody = peerRpcError('PROVIDER_BUSY', { retryable: true });
/** The `Retry-After` (seconds) of an HTTP agent's PROVIDER_BUSY response. */
const PROVIDER_BUSY_RETRY_AFTER_SECONDS = 1;
/**
 * The longest `clientLabel` a join keeps, in Unicode code points (at most 1 KiB of UTF-8). The label
 * is only shown to the provider's user, in every `approval.request`, so a longer one is truncated
 * rather than refused.
 */
const MAX_CLIENT_LABEL_CODE_POINTS = 256;
/**
 * The longest room `alias` `POST /p` and rotate keep, in Unicode code points (at most 1 KiB of
 * UTF-8). Like a `clientLabel`, the alias is only shown, here in every room descriptor including the
 * public `GET /p/:id/mcp`, so a longer one is truncated rather than refused.
 */
const MAX_ROOM_ALIAS_CODE_POINTS = 256;
/** Why the relay refuses a `register` catalog (CATALOG_INVALID): the contract of `normalizeToolCatalog`. */
const CATALOG_INVALID_REASON = `register.tools must be an array of at most ${PEER_CATALOG_MAX_TOOLS} tools, each with a unique, `
  + `non-empty name of at most ${PEER_CATALOG_MAX_TOOL_NAME_LENGTH} UTF-16 code units without leading or trailing whitespace `
  + 'and an inputSchema object of type "object"';
/** A provider reply the relay cannot deliver to a WebSocket agent because it is over the limit. */
const RESULT_TOO_LARGE_ERROR: RpcErrorBody = peerRpcError('RESULT_TOO_LARGE', { limitBytes: MAX_WEBSOCKET_MESSAGE_BYTES });
/**
 * A request whose id, or an offer whose requestId, is over MAX_RPC_ID_BYTES. The id is not echoed:
 * the request is answered with id null, the offer's `offer.refused` has no requestId.
 */
const REQUEST_ID_TOO_LARGE_ERROR: RpcErrorBody = peerRpcError('REQUEST_ID_TOO_LARGE', { limitBytes: MAX_RPC_ID_BYTES });
/**
 * A request from an agent socket that already has MAX_PENDING_REQUESTS_PER_SOCKET in flight: waiting
 * for the provider, or answered and waiting for the agent to read the answer.
 */
const TOO_MANY_PENDING_REQUESTS_ERROR: RpcErrorBody = peerRpcError('TOO_MANY_PENDING_REQUESTS', { limit: MAX_PENDING_REQUESTS_PER_SOCKET });
/** An MCP request whose body a `customHttpHandler` (or another reader) consumed before the relay. */
const BODY_CONSUMED_ERROR: RpcErrorBody = peerRpcError('BODY_CONSUMED');

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

/**
 * The pattern of the room route `/p/<roomId><rest>`, whose first group is the room id. Every room
 * route and WebSocket upgrade path takes the protocol's room id grammar (`WEBMCP_ROOM_ID_PATTERN`):
 * an id outside it reaches no route (404 NOT_FOUND, or a destroyed upgrade), and an id of the
 * grammar that names no room gets the route's own answer (ROOM_NOT_FOUND for the lifecycle routes).
 */
function roomRoute(rest: string): RegExp {
  return new RegExp(`^/p/(${WEBMCP_ROOM_ID_SYNTAX})${rest}$`);
}
const RECLAIM_ROUTE = roomRoute('/reclaim');
const MCP_ROUTE = roomRoute('/mcp');
const MCP_TOOLS_ROUTE = roomRoute('/mcp/tools');
const JOIN_ROUTE = roomRoute('/join');
const APPROVAL_ROUTE = roomRoute('/approval/([^/]+)');
const SESSION_STATUS_ROUTE = roomRoute('/sessions/([^/]+)');
const REVOKE_ROUTE = roomRoute('/(?:session/revoke|sessions/([^/]+)/revoke)');
const ROTATE_ROUTE = roomRoute('/rotate');
const PROVIDER_SOCKET_ROUTE = roomRoute('/provider');
const CLIENT_SOCKET_ROUTE = roomRoute('/client');

/**
 * The token of an `Authorization: Bearer <token>` header, or undefined when the request has no
 * Bearer authorization (no header, or another scheme). Only the first header value counts; the
 * scheme matches case-insensitively (RFC 9110 §11.1) and is followed by one or more spaces, and the
 * token is trimmed. Every route that takes a provider token, a client token or the publish key reads
 * the header this one way.
 */
function bearerCredential(authorization: string | string[] | undefined): string | undefined {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  if (typeof header !== 'string') return undefined;
  const scheme = /^Bearer\s+/i.exec(header);
  return scheme ? header.slice(scheme[0].length).trim() : undefined;
}

/**
 * The SHA-256 hex of a secret token, as the relay keeps and compares it: a client token is looked up
 * by its hash, and the reconnect lease and publish key are compared as hashes, so a secret is never
 * compared (or looked up) character by character.
 */
function secretHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * The error names of the relay's lifecycle bodies that have no JSON-RPC code. Every other lifecycle
 * error is a name of `PEER_ERROR_CODES` and carries its code (see `lifecycleErrorBody`).
 */
type CodelessLifecycleError =
  | 'NOT_FOUND'
  | 'INVALID_PATH'
  | 'ORIGIN_NOT_ALLOWED'
  | 'BODY_TOO_LARGE'
  | 'INVALID_JSON_BODY'
  | 'PUBLISH_KEY_REQUIRED'
  | 'PUBLISH_KEY_INVALID'
  | 'PUBLISH_OWNER_BINDING_INVALID'
  | 'CAPABILITIES_INVALID'
  | 'ROOM_LEASE_REQUIRED'
  | 'ROOM_LEASE_INVALID'
  | 'ROOM_LEASE_EXPIRED'
  | 'ROOM_PROVIDER_ACTIVE'
  | 'INVITE_TOKEN_REQUIRED'
  | 'INVITE_TOKEN_INVALID'
  | 'INVITE_TOKEN_CONSUMED'
  | 'CRDT_CAPABILITY_NOT_GRANTED'
  | 'PROVIDER_TOKEN_REQUIRED'
  | 'PROVIDER_TOKEN_INVALID'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_NOT_OWNED'
  | 'CATALOG_HASH_NOT_FOUND';

/** The canonical name of an error a relay lifecycle route answers with. */
type LifecycleErrorName = PeerErrorName | CodelessLifecycleError;

/**
 * The body of a lifecycle error: `{error: name, code?, ...fields}`. A name with a JSON-RPC code
 * carries it as `code`, the code an MCP error of the same name has, so one name has one code on
 * every route and transport.
 */
function lifecycleErrorBody(name: LifecycleErrorName, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { error: name, ...(isPeerErrorName(name) ? { code: PEER_ERROR_CODES[name] } : {}), ...fields };
}

/**
 * The `WWW-Authenticate` challenge every 401 carries (RFC 9110 §15.5.2): the Bearer scheme each
 * relay credential is presented with, plus `error="invalid_token"` when the request presented a
 * credential the relay refused rather than none (RFC 6750 §3).
 */
function bearerChallenge(presented: boolean): Record<string, string> {
  return { 'WWW-Authenticate': presented ? 'Bearer error="invalid_token"' : 'Bearer' };
}

/**
 * A path parameter percent-decoded, or null when its encoding is malformed (e.g. `%E0`), which the
 * route answers 400 INVALID_PATH instead of failing the request.
 */
function decodePathParameter(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
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
  /** How long an approval request waits for a decision; see `WebMcpPeerServerOptions.approvalTimeoutMs`. */
  readonly approvalTimeoutMs: number;
  /** Upper bound applied to every room's `ttlMs` on creation and rotation. */
  readonly maxRoomTtlMs: number;
  readonly deploymentCatalog: DeploymentCatalogSnapshot;
  readonly serverName: string;
  readonly serverVersion: string;
  private mcpWireSequence = 0;
  private readonly publishKeyHash?: string;
  /** The SQLite rate-limit store the relay opened from its configuration, closed with the relay. */
  private readonly ownedSqliteRateLimitStore?: SqlitePublishRateLimitStore;
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
    const cwd = options.cwd ?? process.cwd();
    const config = resolvePeerServerConfig(
      options,
      options.argv ?? [],
      cwd,
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
    // A configured SQLite database takes precedence over a configured JSON file; the store the relay
    // opens itself it also closes (see `close`).
    if (options.publishRateLimitStore) {
      this.publishRateLimitStore = options.publishRateLimitStore;
    } else if (config.publishRateLimitSqlitePath) {
      this.ownedSqliteRateLimitStore = new SqlitePublishRateLimitStore(config.publishRateLimitSqlitePath);
      this.publishRateLimitStore = this.ownedSqliteRateLimitStore;
    } else {
      this.publishRateLimitStore = config.publishRateLimitPath
        ? new FilePublishRateLimitStore(config.publishRateLimitPath)
        : new InMemoryPublishRateLimitStore();
    }
    this.publishKeyHash = config.publishKey ? secretHash(config.publishKey) : undefined;
    this.mcpRequestTimeoutMs = Math.max(1000, options.mcpRequestTimeoutMs ?? 30_000);
    // `Infinity` keeps an approval request for the room's lifetime; NaN is no duration at all.
    const approvalTimeoutMs = options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
    this.approvalTimeoutMs = Number.isNaN(approvalTimeoutMs)
      ? DEFAULT_APPROVAL_TIMEOUT_MS
      : Math.max(MIN_APPROVAL_TIMEOUT_MS, approvalTimeoutMs);
    const maxRoomTtlMs = options.maxRoomTtlMs ?? DEFAULT_MAX_ROOM_TTL_MS;
    this.maxRoomTtlMs = Number.isFinite(maxRoomTtlMs)
      ? Math.min(ROOM_TTL_CEILING_MS, Math.max(MIN_ROOM_TTL_MS, maxRoomTtlMs))
      : DEFAULT_MAX_ROOM_TTL_MS;
    this.deploymentCatalog = loadDeploymentCatalog(options.deploymentCatalog, cwd);
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
      try { this.ownedSqliteRateLimitStore?.close(); } catch { /* already closed */ }
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
    const now = Date.now();
    const expiresAt = now + this.clampRoomTtl(ttlMs);
    return {
      id,
      roomEpoch,
      roomState: 'provisioned',
      createdAt: now,
      updatedAt: now,
      alias,
      ...(ownerId ? { ownerId } : {}),
      providerToken,
      inviteToken,
      inviteConsumed: false,
      capabilities: [...new Set<PeerCapability>(['mcp-control', ...capabilities])],
      approvalRequired,
      expiresAt,
      reconnectLeaseToken,
      reconnectLeaseHash: secretHash(reconnectLeaseToken),
      // No provider socket is attached yet, so the lease's grace runs from now (see `startReconnectGrace`).
      reconnectLeaseExpiresAt: Math.min(expiresAt, now + RECONNECT_GRACE_MS),
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
      clientTickets: new Map(),
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

  /**
   * The room descriptor `POST /p`, reclaim and rotate answer with. Its reconnect lease is reported as
   * the latest time it can be used, the room's expiry (`reconnectTokenExpiresAt`), and the grace it
   * has once no provider socket is attached (`reconnectGraceMs`): a provider keeps a saved lease
   * until `reconnectTokenExpiresAt`, and the relay tells it with 410 ROOM_LEASE_EXPIRED when the
   * grace ran out first.
   */
  protected roomDescriptor(req: IncomingMessage, entry: RoomEntry): Record<string, unknown> {
    const serverUrl = this.requestOrigin(req);
    return {
      id: entry.id,
      roomId: entry.id,
      roomEpoch: entry.roomEpoch,
      providerToken: entry.providerToken,
      inviteToken: entry.inviteToken,
      reconnectToken: entry.reconnectLeaseToken,
      reconnectTokenExpiresAt: entry.expiresAt,
      reconnectGraceMs: RECONNECT_GRACE_MS,
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

  /** `sendRpcError` for the canonical error `name`, with the code `PEER_ERROR_CODES` gives it. */
  protected sendPeerRpcError(socket: PeerSocket, id: string | number | null | undefined, name: PeerErrorName, data?: unknown): void {
    const error = peerRpcError(name, data);
    this.sendRpcError(socket, id, error.code, error.message, error.data);
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
   * fails with PROVIDER_DISCONNECTED, and the reconnect lease's grace starts (a socket that replaces
   * this one ends it again when it attaches).
   */
  protected detachClosedProvider(entry: RoomEntry): void {
    const socket = entry.providerSocket;
    if (!socket) return;
    entry.providerSocket = undefined;
    this.startReconnectGrace(entry);
    this.failPendingForProvider(entry);
    socket.close();
  }

  /**
   * Starts the reconnect lease's grace: the room has no provider socket (any more), so its lease,
   * which does not expire while one is attached, now expires RECONNECT_GRACE_MS from `now`, or with
   * the room. A reclaim after that is 410 ROOM_LEASE_EXPIRED.
   */
  protected startReconnectGrace(entry: RoomEntry, now = Date.now()): void {
    entry.reconnectLeaseExpiresAt = Math.min(entry.expiresAt, now + RECONNECT_GRACE_MS);
  }

  /**
   * A new `messageId` for a relay control frame of `type`: an opaque string no other message of the
   * relay has (one frame sent to several sockets is one message). A receiver may compare it, never
   * read anything from it.
   */
  protected messageId(type: string): string {
    return `${type}-${randomBytes(16).toString('hex')}`;
  }

  /**
   * True when `body` names no other room than `room`. `roomId` and `roomEpoch` are optional on every
   * route that changes a room, and each one present must be the room's own, strictly. A room id fixes
   * its epoch (a rotation makes a new id), so this is the caller's consistency check, not a credential:
   * each route checks it after the request's credential, and answers a mismatch 409 under its own name.
   */
  protected bodyNamesRoom(body: Record<string, unknown>, room: RoomEntry): boolean {
    return (body.roomId === undefined || body.roomId === room.id)
      && (body.roomEpoch === undefined || body.roomEpoch === room.roomEpoch);
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
        if (entry.providerSocket !== register.sender || this.expireRoomIfDue(entry)) return;
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
      register.sender.send({ type: 'error', code: -32602, message: 'CATALOG_INVALID', reason: CATALOG_INVALID_REASON, ...echo });
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
        ? peerRpcError('CATALOG_TOO_LARGE', { limitBytes: PEER_RELAY_MAX_ANNOUNCEMENT_BYTES, announcementBytes: outcome.announcementBytes })
        : peerRpcError('CATALOG_INVALID');
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

  protected failPendingForSocket(entry: RoomEntry, socket: PeerSocket, error?: RpcErrorBody): void {
    for (const [key, pending] of entry.mcpPending) {
      if (pending.socket === socket) {
        clearTimeout(pending.timer);
        entry.mcpPending.delete(key);
        if (error) this.sendRpcError(pending.socket, pending.id, error.code, error.message, error.data);
      }
    }
  }

  protected failPendingForProvider(entry: RoomEntry): void {
    for (const [key, pending] of entry.mcpPending) {
      clearTimeout(pending.timer);
      entry.mcpPending.delete(key);
      this.sendPeerRpcError(pending.socket, pending.id, 'PROVIDER_DISCONNECTED');
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

  /** Answers a lifecycle route with the error `name` (see `lifecycleErrorBody`) and its `fields`. */
  protected sendLifecycleError(
    res: ServerResponse,
    status: number,
    name: LifecycleErrorName,
    origin?: string,
    fields?: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
  ): void {
    this.sendJson(res, status, lifecycleErrorBody(name, fields), origin, extraHeaders);
  }

  /**
   * Answers 401 for an `Authorization` credential the route refuses: `name` is the `<X>_REQUIRED`
   * of a request that presented none, or the `<X>_INVALID` of one whose credential is wrong, and
   * the response carries the matching Bearer challenge (see `bearerChallenge`).
   */
  protected sendUnauthorized(res: ServerResponse, name: LifecycleErrorName, presented: boolean, origin?: string): void {
    this.sendLifecycleError(res, 401, name, origin, undefined, bearerChallenge(presented));
  }

  /** 410 ROOM_ROTATED for a lifecycle request to `room`, a rotated room, naming its replacement. */
  protected sendRoomRotated(res: ServerResponse, room: RoomEntry, origin?: string): void {
    this.sendLifecycleError(res, 410, 'ROOM_ROTATED', origin, {
      roomId: room.id,
      roomEpoch: room.roomEpoch,
      replacementRoomId: room.rotatedTo,
    });
  }

  /** 410 ROOM_EXPIRED for a lifecycle request to `room`, an expired room the relay still retains. */
  protected sendRoomExpired(res: ServerResponse, room: RoomEntry, origin?: string): void {
    this.sendLifecycleError(res, 410, 'ROOM_EXPIRED', origin, { roomId: room.id, roomEpoch: room.roomEpoch });
  }

  /**
   * The room check of the join, reclaim, approval, revoke and rotate routes, made before the body
   * is read and again after it. True when `room` is the live room `roomId`; otherwise this answered
   * 404 ROOM_NOT_FOUND for a room that is gone (deleted once its retention ended) or was replaced,
   * 410 ROOM_ROTATED for a rotated one, as session status and the MCP endpoint do (checked before
   * the expiry, which a rotation sets to the rotation time), or 410 ROOM_EXPIRED for an expired one,
   * whose expiry this carries out if nothing did yet (see `expireRoomIfDue`).
   */
  protected checkLifecycleRoom(res: ServerResponse, roomId: string, room: RoomEntry | undefined, origin?: string): room is RoomEntry {
    if (!room || this.rooms.get(roomId) !== room) {
      this.sendLifecycleError(res, 404, 'ROOM_NOT_FOUND', origin);
      return false;
    }
    if (room.rotatedTo) {
      this.sendRoomRotated(res, room, origin);
      return false;
    }
    if (this.expireRoomIfDue(room)) {
      this.sendRoomExpired(res, room, origin);
      return false;
    }
    return true;
  }

  /**
   * True when `bearer` is the room's current provider token; otherwise this answered 401
   * PROVIDER_TOKEN_REQUIRED for a request without one, or PROVIDER_TOKEN_INVALID for another token.
   */
  protected checkProviderToken(res: ServerResponse, room: RoomEntry, bearer: string, origin?: string): boolean {
    if (!bearer) {
      this.sendUnauthorized(res, 'PROVIDER_TOKEN_REQUIRED', false, origin);
      return false;
    }
    if (!this.constantTimeTokenEqual(bearer, room.providerToken)) {
      this.sendUnauthorized(res, 'PROVIDER_TOKEN_INVALID', true, origin);
      return false;
    }
    return true;
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

  /**
   * The request's `Authorization: Bearer` token (see `bearerCredential`), or `''` without one. Every
   * route that takes a provider or client token reads it this way.
   */
  public bearerToken(req: IncomingMessage): string {
    return bearerCredential(req.headers.authorization) ?? '';
  }

  /**
   * The publish key a `POST /p` presents: its Bearer token, or, only when the request has no Bearer
   * authorization, the trimmed `X-Publish-Key` header. No other route reads `X-Publish-Key`.
   */
  protected publishKeyToken(req: IncomingMessage): string {
    const bearer = bearerCredential(req.headers.authorization);
    if (bearer !== undefined) return bearer;
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
    const token = this.publishKeyToken(req);
    if (!token) return { ok: false, tokenHash: 'unauthenticated', error: 'PUBLISH_KEY_REQUIRED' };
    const tokenHash = secretHash(token);
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
      this.answerUnreadBody(req, res, error, lifecycleErrorBody('BODY_CONSUMED'), origin);
      return null;
    }
    if (read.kind === 'too-large') {
      if (read.drained) this.sendLifecycleError(res, 413, 'BODY_TOO_LARGE', origin);
      else res.destroy();
      return null;
    }
    try {
      return this.parseJsonObjectBody(read.body);
    } catch {
      this.sendLifecycleError(res, 400, 'INVALID_JSON_BODY', origin);
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

  /**
   * The room's ticket for the client token `token`, looked up by the token's hash (see `secretHash`),
   * or null when the room issued no such token. A room found expired here has its expiry carried
   * out first (see `expireRoomIfDue`), which ends the ticket as `expired`.
   */
  protected resolveClientTicket(entry: RoomEntry, token: string): ClientSessionTicket | null {
    const ticket = entry.clientTickets.get(secretHash(token));
    if (!ticket) return null;
    this.expireRoomIfDue(entry);
    if (ticket.expiresAt <= Date.now()) {
      if (ticket.status !== 'revoked' && ticket.status !== 'rejected' && ticket.status !== 'room-rotated') ticket.status = 'expired';
      return ticket;
    }
    return ticket;
  }

  /**
   * The error an MCP request authorized by `ticket` gets, on either transport, unless the ticket is
   * approved: without a ticket CLIENT_TOKEN_REQUIRED, or CLIENT_TOKEN_INVALID when the request
   * `presented` a client token the room did not issue; CLIENT_APPROVAL_REQUIRED for a pending
   * ticket, CLIENT_APPROVAL_DENIED for a rejected one, SESSION_EXPIRED for an expired one and
   * SESSION_INVALID for one revoked or ended by a rotation. `status` is the HTTP status.
   */
  protected clientTicketError(ticket: ClientSessionTicket | null, presented = true): { status: number; code: number; message: string } | null {
    const refusal = (status: number, name: PeerErrorName) => ({ status, ...peerRpcError(name) });
    if (!ticket) return refusal(401, presented ? 'CLIENT_TOKEN_INVALID' : 'CLIENT_TOKEN_REQUIRED');
    if (ticket.status === 'pending') return refusal(403, 'CLIENT_APPROVAL_REQUIRED');
    if (ticket.status === 'rejected') return refusal(403, 'CLIENT_APPROVAL_DENIED');
    if (ticket.status === 'expired') return refusal(410, 'SESSION_EXPIRED');
    if (ticket.status === 'revoked' || ticket.status === 'room-rotated') return refusal(401, 'SESSION_INVALID');
    return null;
  }

  /**
   * The data of a `clientTicketError`, the same on both transports: the room, the ticket's session
   * and approval request (null when there is none), and whether the room requires approval.
   */
  protected clientTicketErrorData(entry: RoomEntry | undefined, roomId: string, ticket: ClientSessionTicket | null): Record<string, unknown> {
    return {
      roomId,
      sessionId: ticket?.sessionId ?? null,
      approvalRequestId: ticket?.approvalRequestId ?? null,
      approvalRequired: entry?.approvalRequired ?? true,
    };
  }

  /** The ticket of session `sessionId`, with the hash of its client token (its key in `clientTickets`). */
  protected findClientTicket(entry: RoomEntry, sessionId: string): { tokenHash: string; ticket: ClientSessionTicket } | null {
    for (const [tokenHash, ticket] of entry.clientTickets) {
      if (ticket.sessionId === sessionId) return { tokenHash, ticket };
    }
    return null;
  }

  /**
   * Makes sure the provider knows `ticket` waits for approval and returns its pending request:
   * the existing one, or a new one (which expires, and the ticket with it, after
   * `approvalTimeoutMs`). The request goes to the room's provider socket only if that socket does
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
        protocol: WEBMCP_PROTOCOL,
        messageId: this.messageId('approval.pending'),
        type: 'approval.pending',
        roomId: entry.id,
        roomEpoch: entry.roomEpoch,
        requestId: request.requestId,
        sessionId: ticket.sessionId,
        capabilities: [...ticket.capabilities],
        sentAt: new Date().toISOString(),
        expiresAt: request.expiresAt,
      });
    }
    return request;
  }

  /**
   * Registers a new pending approval request for `ticket`, which expires `approvalTimeoutMs` from
   * now, or with the room (see `scheduleApprovalExpiry`), unless somebody decides it first.
   */
  protected createApprovalRequest(entry: RoomEntry, ticket: ClientSessionTicket): PendingApprovalRequest {
    const requestId = `approval-${randomBytes(16).toString('hex')}`;
    const now = Date.now();
    const request: PendingApprovalRequest = {
      requestId,
      clientTokenHash: [...entry.clientTickets.entries()].find(([, candidate]) => candidate === ticket)?.[0] ?? '',
      sessionId: ticket.sessionId,
      roomId: entry.id,
      roomEpoch: entry.roomEpoch,
      clientLabel: ticket.clientLabel || 'MCP client',
      identity: { sessionId: ticket.sessionId, roomId: entry.id, clientLabel: ticket.clientLabel || 'MCP client' },
      createdAt: now,
      expiresAt: Math.min(entry.expiresAt, now + this.approvalTimeoutMs),
    };
    ticket.approvalRequestId = requestId;
    entry.pendingApprovals.set(requestId, request);
    this.scheduleApprovalExpiry(entry, ticket, request);
    return request;
  }

  /**
   * Expires `request` (of `ticket`) at its `expiresAt` unless it was decided or ended first (see
   * `expireApprovalRequest`). A Node timer can fire a little before `Date.now()` reaches the time it
   * was set for, and one set past MAX_TIMER_DELAY_MS fires at once, so a timer that finds the request
   * not yet due is set again for the time left. A room that expired meanwhile is expired instead,
   * which ends the ticket with it (see `expireRoomIfDue`).
   */
  protected scheduleApprovalExpiry(entry: RoomEntry, ticket: ClientSessionTicket, request: PendingApprovalRequest): void {
    const timer = setTimeout(() => {
      if (entry.pendingApprovals.get(request.requestId) !== request || this.expireRoomIfDue(entry)) return;
      if (request.expiresAt > Date.now()) this.scheduleApprovalExpiry(entry, ticket, request);
      else this.expireApprovalRequest(entry, ticket, request);
    }, Math.min(MAX_TIMER_DELAY_MS, Math.max(1, request.expiresAt - Date.now())));
    timer.unref?.();
  }

  /**
   * Ends `request`, which nobody decided in time: it is removed, and `ticket`, if it still waits for
   * it, ends as `expired`. Each client socket of the ticket gets `approval.expired` and is closed,
   * and the room's provider socket gets the same frame, so the host takes the request down instead of
   * offering a decision the relay would refuse. The invite stays used: the room serves no other agent
   * until it is rotated.
   */
  protected expireApprovalRequest(entry: RoomEntry, ticket: ClientSessionTicket, request: PendingApprovalRequest): void {
    entry.pendingApprovals.delete(request.requestId);
    if (ticket.status !== 'pending') return;
    ticket.status = 'expired';
    ticket.revokedAt = Date.now();
    ticket.approvalRequestId = undefined;
    const frame = {
      protocol: WEBMCP_PROTOCOL,
      messageId: this.messageId('approval.expired'),
      type: 'approval.expired',
      roomId: entry.id,
      roomEpoch: entry.roomEpoch,
      sessionId: ticket.sessionId,
      requestId: request.requestId,
      sentAt: new Date(ticket.revokedAt).toISOString(),
      reason: 'APPROVAL_EXPIRED',
    };
    for (const [clientSocket, boundTicket] of entry.clientSocketTickets) {
      if (boundTicket !== ticket) continue;
      clientSocket.send(frame);
      clientSocket.close();
      entry.clientSocketTickets.delete(clientSocket);
      entry.clientSockets.delete(clientSocket);
    }
    entry.providerSocket?.send(frame);
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
      protocol: WEBMCP_PROTOCOL,
      messageId: this.messageId('approval.request'),
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
      protocol: WEBMCP_PROTOCOL,
      messageId: this.messageId('approval.restored'),
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
    for (const ticket of entry.clientTickets.values()) {
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

  /**
   * Ends the ticket whose client token hashes to `tokenHash` (its key in `clientTickets`) as
   * `status`: rejected by the provider, revoked, or ended with its room by a rotation or the room's
   * expiry (`expired`; see `expireRoom`). Each client socket of the ticket is told why with the frame
   * of `TICKET_END_FRAMES` (a rotation's names the replacement room), its requests in flight get the
   * same error an HTTP request of the room would (see `ticketClosedRpcError`), and it is closed. The
   * requests the ticket authorized over HTTP end with the same error: they are bound to no socket of
   * the ticket. One the provider already took may still run there; its late answer is dropped.
   *
   * A revocation is also told to the room's provider socket, with the same `session.revoked`: every
   * revocation is an HTTP request (the agent's own, or the host's made outside its socket), and a room
   * has one ticket, so its end is the end of the room's agent side. A rejection reaches the provider
   * as its decision's echo (see `sendDecisionEcho`); a rotation and the room's expiry tell the provider
   * socket themselves.
   */
  protected closeClientTicket(entry: RoomEntry, tokenHash: string, status: TicketEndStatus, reason: string): boolean {
    const ticket = entry.clientTickets.get(tokenHash);
    if (!ticket) return false;
    ticket.status = status;
    ticket.revokedAt = Date.now();
    const approvalRequestId = ticket.approvalRequestId;
    if (approvalRequestId) entry.pendingApprovals.delete(approvalRequestId);
    const type = TICKET_END_FRAMES[status];
    // The replacement of a rotated room, which the rotation registered before ending its tickets.
    const replacement = status === 'room-rotated' && entry.rotatedTo
      ? { replacementRoomId: entry.rotatedTo, replacementRoomEpoch: this.rooms.get(entry.rotatedTo)?.roomEpoch ?? null }
      : undefined;
    const frame = {
      protocol: WEBMCP_PROTOCOL,
      messageId: this.messageId(type),
      type,
      roomId: entry.id,
      roomEpoch: entry.roomEpoch,
      sessionId: ticket.sessionId,
      ...(approvalRequestId ? { requestId: approvalRequestId } : {}),
      sentAt: new Date(ticket.revokedAt).toISOString(),
      payload: {
        ...(approvalRequestId ? { requestId: approvalRequestId } : {}),
        sessionId: ticket.sessionId,
        roomId: entry.id,
        roomEpoch: entry.roomEpoch,
        ...replacement,
        reason,
      },
      ...(replacement ? { rotatedTo: replacement.replacementRoomId } : {}),
      reason,
    };
    const error = this.ticketClosedRpcError(entry, status);
    for (const [socket, boundTicket] of entry.clientSocketTickets) {
      if (boundTicket !== ticket) continue;
      try {
        socket.send(frame);
      } catch {}
      this.failPendingForSocket(entry, socket, error);
      socket.close();
      entry.clientSocketTickets.delete(socket);
      entry.clientSockets.delete(socket);
    }
    for (const [key, pending] of entry.mcpPending) {
      if (pending.ticket === ticket) this.clearPending(entry, key, error);
    }
    if (status === 'revoked') entry.providerSocket?.send(frame);
    ticket.approvalRequestId = undefined;
    return true;
  }

  /**
   * Decides the pending approval request `requestId`, from the provider socket's `approval.decision`
   * or the HTTP approval route: false when there is no such request, or its ticket no longer waits
   * for it (the request is removed either way). An approval makes the ticket `approved` and tells each
   * of its client sockets (`approval.approved`, then `ready`); a rejection ends the ticket (see
   * `closeClientTicket`). Either way the room's provider socket gets the decision's echo.
   */
  protected approveClientTicket(entry: RoomEntry, requestId: string, allow: boolean, reason?: string): boolean {
    const pending = entry.pendingApprovals.get(requestId);
    if (!pending) return false;
    const ticket = entry.clientTickets.get(pending.clientTokenHash);
    entry.pendingApprovals.delete(requestId);
    if (!ticket || ticket.approvalRequestId !== requestId) return false;
    if (!allow) {
      this.closeClientTicket(entry, pending.clientTokenHash, 'rejected', reason || 'CLIENT_APPROVAL_DENIED');
      this.sendDecisionEcho(entry, pending, ticket, reason);
      return true;
    }
    ticket.status = 'approved';
    ticket.approvedAt = Date.now();
    entry.roomState = 'active';
    entry.updatedAt = ticket.approvedAt;
    const sentAt = new Date(ticket.approvedAt).toISOString();
    const times = this.decisionTimes(pending, ticket);
    const frame = {
      protocol: WEBMCP_PROTOCOL,
      messageId: this.messageId('approval.approved'),
      type: 'approval.approved',
      roomId: entry.id,
      roomEpoch: entry.roomEpoch,
      sessionId: ticket.sessionId,
      requestId,
      sentAt,
      expiresAt: ticket.expiresAt,
      ...times,
      payload: {
        requestId, sessionId: ticket.sessionId, roomId: entry.id, roomEpoch: entry.roomEpoch, state: 'approved',
        clientTokenActive: true, decidedAt: sentAt, expiresAt: ticket.expiresAt, ...times,
      },
    };
    for (const [socket, boundTicket] of entry.clientSocketTickets) {
      if (boundTicket !== ticket) continue;
      // The agent asked for this decision: a socket that is behind gets it, then `ready`, once it
      // has read what was sent before them (see replyToAgent).
      const approved = this.replyToAgent(socket, frame);
      if (approved !== 'sent' && approved !== 'queued') continue;
      this.replyToAgent(socket, { type: 'ready', role: 'client', roomId: entry.id, roomEpoch: entry.roomEpoch, sessionId: ticket.sessionId, capabilities: [...ticket.capabilities], expiresAt: ticket.expiresAt, approval: 'approved' });
    }
    ticket.approvalRequestId = undefined;
    this.sendDecisionEcho(entry, pending, ticket, reason);
    return true;
  }

  /**
   * The two expiries a decision on `request` (of `ticket`) reports, each under its own name and in
   * epoch ms: the approval request's (`approvalExpiresAt`) and the ticket's (`ticketExpiresAt`). The
   * older `expiresAt` of the same messages means one or the other depending on the message.
   */
  protected decisionTimes(request: PendingApprovalRequest, ticket: ClientSessionTicket): { approvalExpiresAt: number; ticketExpiresAt: number } {
    return { approvalExpiresAt: request.expiresAt, ticketExpiresAt: ticket.expiresAt };
  }

  /**
   * Tells the room's provider socket how `request` was decided, whoever decided it: the echo of the
   * host's own `approval.decision`, or of a decision made over HTTP, which the host would not learn
   * otherwise. `ticket` was just decided: `approved`, or ended as `rejected` (with the decision's
   * `reason`). Sent with `send` alone, like the relay's other answers to the provider.
   */
  protected sendDecisionEcho(entry: RoomEntry, request: PendingApprovalRequest, ticket: ClientSessionTicket, reason?: string): void {
    const decision = ticket.status === 'approved' ? 'approved' : 'rejected';
    const type = decision === 'approved' ? 'approval.approved' : 'approval.rejected';
    const decidedAt = new Date((decision === 'approved' ? ticket.approvedAt : ticket.revokedAt) ?? Date.now()).toISOString();
    const times = this.decisionTimes(request, ticket);
    entry.providerSocket?.send({
      protocol: WEBMCP_PROTOCOL,
      messageId: this.messageId(type),
      type,
      roomId: entry.id,
      roomEpoch: entry.roomEpoch,
      sessionId: ticket.sessionId,
      requestId: request.requestId,
      sentAt: decidedAt,
      expiresAt: request.expiresAt,
      ...times,
      payload: {
        requestId: request.requestId, sessionId: ticket.sessionId, roomId: entry.id, roomEpoch: entry.roomEpoch, state: decision,
        clientTokenActive: decision === 'approved', decidedAt, expiresAt: request.expiresAt, ...times,
      },
      ...(reason ? { reason } : {}),
    });
  }

  /**
   * The JSON-RPC error a request in flight receives when its ticket ends as `status`, the same over
   * WebSocket and HTTP: ROOM_ROTATED naming the replacement room, ROOM_EXPIRED, SESSION_INVALID for
   * a revocation, CLIENT_APPROVAL_DENIED for a rejection.
   */
  protected ticketClosedRpcError(entry: RoomEntry, status: TicketEndStatus): RpcErrorBody {
    if (status === 'room-rotated') {
      return peerRpcError('ROOM_ROTATED', { replacementRoomId: entry.rotatedTo ?? null, roomId: entry.id, roomEpoch: entry.roomEpoch });
    }
    if (status === 'expired') return peerRpcError('ROOM_EXPIRED', { roomId: entry.id, roomEpoch: entry.roomEpoch });
    if (status === 'rejected') return peerRpcError('CLIENT_APPROVAL_DENIED');
    return peerRpcError('SESSION_INVALID');
  }

  /** Ends every ticket of the room as `status` (see `closeClientTicket`) and every request in flight. */
  protected revokeAllClientTickets(entry: RoomEntry, reason: string, status: Exclude<TicketEndStatus, 'rejected'> = 'revoked'): void {
    for (const [tokenHash] of entry.clientTickets) this.closeClientTicket(entry, tokenHash, status, reason);
    // Ending a ticket settles every request it authorized (see `closeClientTicket`). Any request
    // still in flight is settled too, so no caller waits for an answer from a room that is done.
    const error = this.ticketClosedRpcError(entry, status);
    for (const key of [...entry.mcpPending.keys()]) this.clearPending(entry, key, error);
    entry.pendingApprovals.clear();
  }

  protected resolveBearerClientTicket(entry: RoomEntry, authorization: string | string[] | undefined): ClientSessionTicket | null {
    const token = bearerCredential(authorization);
    return token ? this.resolveClientTicket(entry, token) : null;
  }

  /**
   * Carries out the expiry of the room `entry`, once: every ticket ends as `expired` (its client
   * sockets get `room.expired` and are closed, and their requests in flight get ROOM_EXPIRED), the
   * HTTP requests in flight get ROOM_EXPIRED too, and the provider socket is closed. The room stays
   * until its retention ends (see `cleanupExpiredRooms`), and its lifecycle routes answer 410
   * ROOM_EXPIRED meanwhile. A rotated room is left alone: its rotation already ended its tickets
   * and sockets.
   */
  protected expireRoom(entry: RoomEntry, now = Date.now()): void {
    if (entry.rotatedTo || entry.roomState === 'expired') return;
    entry.roomState = 'expired';
    entry.updatedAt = now;
    // Every client socket is bound to a ticket, so ending the tickets closes and detaches them all.
    this.revokeAllClientTickets(entry, 'ROOM_EXPIRED', 'expired');
    const provider = entry.providerSocket;
    entry.providerSocket = undefined;
    try { provider?.close(); } catch {}
  }

  /**
   * True when the room `entry` is past its `expiresAt`, whose expiry this then carries out unless
   * that was done (see `expireRoom`). Besides the sweep, every place that finds a room expired goes
   * through here — the lifecycle and MCP route checks, ticket resolution, an upgrade, a frame from
   * one of the room's sockets — so the expiry is told the same way, once, whoever finds it first.
   */
  protected expireRoomIfDue(entry: RoomEntry, now = Date.now()): boolean {
    if (entry.expiresAt > now) return false;
    this.expireRoom(entry, now);
    return true;
  }

  /**
   * The sweep: expires every room past its `expiresAt` (see `expireRoom`) and deletes those whose
   * retention, `metadataRetainUntil`, has ended; a deleted room's id is answered 404 ROOM_NOT_FOUND.
   * A rotated room is retained exactly as long as an expired one, so it answers 410 ROOM_ROTATED
   * (naming its replacement) until its original `expiresAt` plus ROOM_METADATA_RETAIN_MS.
   */
  protected cleanupExpiredRooms(now = Date.now()): void {
    for (const [roomId, entry] of this.rooms) {
      if (entry.expiresAt > now) continue;
      this.expireRoom(entry, now);
      if ((entry.metadataRetainUntil ?? 0) <= now) this.rooms.delete(roomId);
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
      this.sendLifecycleError(res, 403, 'ORIGIN_NOT_ALLOWED', origin, { origin });
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
        type: WEBMCP_PEER_CONFIG_TYPE,
        version: 1,
        serverUrl,
        protocol: WEBMCP_PROTOCOL,
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
        this.sendLifecycleError(res, 503, 'PUBLISH_RATE_LIMIT_UNAVAILABLE', origin, {
          retryAfterMs: publishRate.retryAfterMs,
        }, {
          'Retry-After': String(retryAfterSec),
          'X-RateLimit-Limit': String(this.publishRateLimitMax),
          'X-RateLimit-Remaining': '0',
        });
        return;
      }
      if (!publishRate.allowed) {
        const retryAfterSec = Math.max(1, Math.ceil(publishRate.retryAfterMs / 1000));
        this.sendLifecycleError(res, 429, 'PUBLISH_RATE_LIMITED', origin, {
          retryAfterMs: publishRate.retryAfterMs,
        }, {
          'Retry-After': String(retryAfterSec),
          'X-RateLimit-Limit': String(this.publishRateLimitMax),
          'X-RateLimit-Remaining': '0',
        });
        return;
      }
      if (!publishAuth.ok) {
        this.sendUnauthorized(res, publishAuth.error, publishAuth.error === 'PUBLISH_KEY_INVALID', origin);
        return;
      }
      const body = await this.readJsonBodyOrRespond(req, res, origin);
      if (!body) return;
      const rawHeaderOwner = req.headers['x-framebook-owner'] ?? req.headers['x-owner-id'];
      const headerOwner = typeof rawHeaderOwner === 'string' ? rawHeaderOwner.trim() : '';
      const bodyOwner = typeof body.ownerId === 'string' ? body.ownerId.trim()
        : typeof body.owner === 'string' ? body.owner.trim() : '';
      // The owner comes from the publish key alone: without a key the header and body owners are
      // claims nothing authenticated, so they are never the room's owner. Two claims that
      // contradict each other are still refused, as they would be with a key.
      const ownerId = this.publishKeyConfigured ? this.publishKeyOwner ?? 'publish-key-owner' : undefined;
      if ((headerOwner && bodyOwner && headerOwner !== bodyOwner)
        || (ownerId && ((headerOwner && headerOwner !== ownerId)
          || (bodyOwner && bodyOwner !== ownerId)))) {
        this.sendLifecycleError(res, 403, 'PUBLISH_OWNER_BINDING_INVALID', origin);
        return;
      }
      // Trimmed and cut to MAX_ROOM_ALIAS_CODE_POINTS: the alias is in every room descriptor.
      const alias = typeof body.alias === 'string' && body.alias.trim()
        ? truncateCodePoints(body.alias.trim(), MAX_ROOM_ALIAS_CODE_POINTS) : 'wireframe-local';
      const approvalRequired = body.approvalRequired !== false;
      const ttlMs = typeof body.ttlMs === 'number' && Number.isFinite(body.ttlMs) ? body.ttlMs : 2 * 60 * 60 * 1000;
      const capabilities = this.parsePeerCapabilities(body.capabilities);
      if (!capabilities) {
        this.sendLifecycleError(res, 400, 'CAPABILITIES_INVALID', origin);
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
    const reclaimMatch = url.pathname.match(RECLAIM_ROUTE);
    if (req.method === 'POST' && reclaimMatch) {
      const roomId = reclaimMatch[1];
      const entry = this.rooms.get(roomId);
      // Checked before the body is read and again after it: the room can be rotated, expire or be
      // reclaimed by another request while the body is in transit. The lease of a live room can
      // expire on its own, once its grace after the provider socket went away has run out
      // (see `startReconnectGrace`): ROOM_LEASE_EXPIRED, not the room's ROOM_EXPIRED.
      const reclaimable = (room: RoomEntry | undefined): room is RoomEntry => {
        if (!this.checkLifecycleRoom(res, roomId, room, origin)) return false;
        if (room.reconnectLeaseExpiresAt <= Date.now()) {
          this.sendLifecycleError(res, 410, 'ROOM_LEASE_EXPIRED', origin, { roomId, roomEpoch: room.roomEpoch });
          return false;
        }
        return true;
      };
      if (!reclaimable(entry)) return;
      const body = await this.readJsonBodyOrRespond(req, res, origin);
      if (!body || !reclaimable(entry)) return;
      const now = Date.now();
      // The lease is a body credential, not an `Authorization` one: none is 400, a wrong one 403.
      const leaseToken = typeof body.leaseToken === 'string' ? body.leaseToken.trim() : '';
      if (!leaseToken) {
        this.sendLifecycleError(res, 400, 'ROOM_LEASE_REQUIRED', origin);
        return;
      }
      const leaseHash = secretHash(leaseToken);
      if (!this.constantTimeTokenEqual(leaseHash, entry.reconnectLeaseHash)) {
        this.sendLifecycleError(res, 403, 'ROOM_LEASE_INVALID', origin);
        return;
      }
      // Checked after the lease, like every route's binding: only the lease's holder learns it.
      if (!this.bodyNamesRoom(body, entry)) {
        this.sendLifecycleError(res, 409, 'ROOM_LEASE_BINDING_INVALID', origin, { roomId, roomEpoch: entry.roomEpoch });
        return;
      }
      if (entry.providerSocket) {
        this.sendLifecycleError(res, 409, 'ROOM_PROVIDER_ACTIVE', origin, { roomId, roomEpoch: entry.roomEpoch });
        return;
      }

      entry.providerToken = randomBytes(24).toString('hex');
      entry.reconnectLeaseToken = randomBytes(24).toString('hex');
      entry.reconnectLeaseHash = secretHash(entry.reconnectLeaseToken);
      // The new lease's grace runs until a provider socket attaches with the new token.
      this.startReconnectGrace(entry, now);
      entry.updatedAt = now;
      entry.roomState = entry.clientTickets.size ? 'accepting-clients' : 'provisioned';
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
        this.sendLifecycleError(res, 503, 'CATALOG_UNAVAILABLE', origin, { catalogVersion: 0, catalogHash: snapshot.catalogHash });
        return;
      }
      if (deploymentCatalogHashMatch && deploymentCatalogHashMatch[1] !== snapshot.catalogHash) {
        this.sendLifecycleError(res, 404, 'CATALOG_HASH_NOT_FOUND', origin, { catalogHash: snapshot.catalogHash });
        return;
      }
      this.sendMcpMetadata(req, res, 200, {
        protocol: WEBMCP_SUBPROTOCOL,
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
    const mcpMatch = url.pathname.match(MCP_ROUTE);
    if (req.method === 'GET' && mcpMatch && this.acceptsOnlyEventStream(req)) {
      // Streamable HTTP: the relay offers no server-to-client SSE stream (stateless JSON responses;
      // catalog changes are pushed over the client WebSocket), so the spec requires 405. A 200 JSON
      // descriptor made the official MCP SDK treat it as an ended stream and reconnect about once
      // per second for as long as the MCP host stayed connected.
      this.sendJson(res, 405, { jsonrpc: '2.0', id: null, error: peerRpcError('SSE_STREAM_NOT_SUPPORTED') }, origin, { Allow: 'POST' });
      return;
    }
    if (req.method === 'DELETE' && mcpMatch) {
      // The relay issues no Mcp-Session-Id, so there is no session to terminate (Streamable HTTP: 405).
      this.sendJson(res, 405, { jsonrpc: '2.0', id: null, error: peerRpcError('SESSION_TERMINATION_NOT_SUPPORTED') }, origin, { Allow: 'GET, POST' });
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
        protocol: WEBMCP_SUBPROTOCOL,
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
        activeClientCount: entry ? [...entry.clientTickets.values()].filter(ticket => ticket.status === 'approved').length : 0,
        rotatedTo: entry?.rotatedTo ?? null,
      };
      this.sendMcpMetadata(req, res, 200, descriptor, origin,
        this.mcpDescriptorCacheHeaders(descriptor, snapshot.catalogVersion, snapshot.catalogHash), true);
      return;
    }

    // Cached MCP catalog snapshot: GET /p/:id/mcp/tools
    const toolsMatch = url.pathname.match(MCP_TOOLS_ROUTE);
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
        this.sendLifecycleError(res, 503, 'CATALOG_UNAVAILABLE', origin, {
          catalogVersion: 0, catalogHash: snapshot.catalogHash, auth: this.mcpAuthMetadata(entry, 'not-joined'),
        });
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
        // Past the drain limit the request is destroyed; the response is destroyed with it, as for
        // a JSON body route (readJsonBodyOrRespond), rather than left to the socket teardown.
        if (read.drained) this.sendJson(res, 413, { jsonrpc: '2.0', id: null, error: REQUEST_TOO_LARGE_ERROR }, origin);
        else res.destroy();
        return;
      }
      let rpc: RpcRequest;
      try { rpc = this.rpcRequestSchema.parse(JSON.parse(decodeUtf8Body(read.body))); } catch (error) {
        const refusal: RpcErrorBody = error instanceof SyntaxError
          ? peerRpcError('PARSE_ERROR')
          : error instanceof TypeError && error.message === REQUEST_ID_TOO_LARGE_ERROR.message
            ? REQUEST_ID_TOO_LARGE_ERROR
            : peerRpcError('INVALID_REQUEST');
        this.sendJson(res, 400, { jsonrpc: '2.0', id: null, error: refusal }, origin);
        return;
      }
      // MCP request ids must be a string or a number; a message without an id is a notification.
      if (rpc.id === null) {
        this.sendJson(res, 400, { jsonrpc: '2.0', id: null, error: peerRpcError('INVALID_REQUEST') }, origin);
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
          error: peerRpcError('UNSUPPORTED_PROTOCOL_VERSION', { supported: MCP_INITIALIZE_PROTOCOL_VERSIONS, requested: requestedVersion }),
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
      // Whether the request presented a client token at all: CLIENT_TOKEN_REQUIRED or _INVALID.
      const presentedToken = Boolean(this.bearerToken(req));
      // A pending ticket's approval request reaches each provider socket once (deliverApprovalRequest):
      // this only sends one the attached provider socket has not taken yet.
      if (entry && mcpTicket?.status === 'pending') this.sendApprovalRequest(entry, mcpTicket);
      const roomState = this.mcpRoomState(entry);
      const snapshot = this.mcpCatalogSnapshot(entry);
      if (!metadataOnly && !entry) {
        this.sendJson(res, 404, { jsonrpc: '2.0', id, error: peerRpcError('ROOM_NOT_FOUND', { roomId }) }, origin);
        return;
      }
      if (!metadataOnly && entry?.rotatedTo) {
        this.sendJson(res, 410, { jsonrpc: '2.0', id, error: peerRpcError('ROOM_ROTATED', { replacementRoomId: entry.rotatedTo, roomId, roomEpoch: entry.roomEpoch }) }, origin);
        return;
      }
      if (!metadataOnly && entry && this.expireRoomIfDue(entry)) {
        this.sendJson(res, 410, { jsonrpc: '2.0', id, error: peerRpcError('ROOM_EXPIRED', { roomId, roomEpoch: entry.roomEpoch }) }, origin);
        return;
      }
      const mcpAuthError = this.clientTicketError(mcpTicket, presentedToken);
      if (mcpAuthError && !metadataOnly) {
        this.sendJson(res, mcpAuthError.status, {
          jsonrpc: '2.0', id,
          error: { code: mcpAuthError.code, message: mcpAuthError.message, data: this.clientTicketErrorData(entry, roomId, mcpTicket) },
        }, origin, mcpAuthError.status === 401 ? bearerChallenge(presentedToken) : undefined);
        return;
      }
      if (snapshot.tools.length === 0 && (rpc.method === 'tools/list' || rpc.method === 'server/discover')) {
        this.sendJson(res, 503, { jsonrpc: '2.0', id, error: peerRpcError('CATALOG_UNAVAILABLE', { catalogSource: this.deploymentCatalog.source }) }, origin);
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
        this.sendJson(res, 404, { jsonrpc: '2.0', id, error: peerRpcError('ROOM_NOT_FOUND', { roomId }) }, origin);
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
            error: peerRpcError('CATALOG_CHANGED', { catalogVersion: entry.catalogVersion, catalogHash: entry.catalogHash }),
          }, origin);
          return;
        }
        if (entry.cachedTools && !entry.cachedTools.some(tool => this.isRecord(tool) && tool.name === params.name)) {
          this.sendJson(res, 400, { jsonrpc: '2.0', id, error: peerRpcError('TOOL_NOT_FOUND') }, origin);
          return;
        }
      }
      if (!entry.providerSocket) {
        this.sendJson(res, 503, { jsonrpc: '2.0', id, error: PROVIDER_UNAVAILABLE_ERROR }, origin);
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
        this.clearPending(entry, key, peerRpcError('CLIENT_DISCONNECTED'));
      };
      res.once('close', releaseOnDisconnect);
      const timer = setTimeout(() => this.clearPending(entry, key, peerRpcError('MCP_REQUEST_TIMEOUT')), this.mcpRequestTimeoutMs);
      // Bound to the ticket that authorized it, so the ticket's end ends it too (see `closeClientTicket`).
      entry.mcpPending.set(key, { socket: bridgeSocket, timer, method: rpc.method, id, wireId, ...(mcpTicket ? { ticket: mcpTicket } : {}) });
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
    const joinMatch = url.pathname.match(JOIN_ROUTE);
    if (req.method === 'POST' && joinMatch) {
      const roomId = joinMatch[1];
      const entry = this.rooms.get(roomId);
      // Checked before the body is read and again after it, since the room can be rotated or
      // expire while the body is in transit. A room whose `expiresAt` is now has expired, as for
      // every other route and the sweep, so no join takes an invite for a ticket already expired.
      const joinable = (room: RoomEntry | undefined): room is RoomEntry => this.checkLifecycleRoom(res, roomId, room, origin);
      if (!joinable(entry)) return;
      const body = await this.readJsonBodyOrRespond(req, res, origin);
      if (!body || !joinable(entry)) return;
      // The invite is a body credential, not an `Authorization` one: none is 400, a wrong one 403.
      // Only the right invite learns that it was already used.
      const inviteToken = typeof body.inviteToken === 'string' ? body.inviteToken.trim() : '';
      if (!inviteToken) {
        this.sendLifecycleError(res, 400, 'INVITE_TOKEN_REQUIRED', origin);
        return;
      }
      if (!this.constantTimeTokenEqual(inviteToken, entry.inviteToken)) {
        this.sendLifecycleError(res, 403, 'INVITE_TOKEN_INVALID', origin);
        return;
      }
      if (entry.inviteConsumed) {
        this.sendLifecycleError(res, 409, 'INVITE_TOKEN_CONSUMED', origin);
        return;
      }
      const requestedCapabilities = this.parsePeerCapabilities(body.capabilities);
      if (!requestedCapabilities) {
        this.sendLifecycleError(res, 400, 'CAPABILITIES_INVALID', origin);
        return;
      }
      if (requestedCapabilities.includes('mcp-crdt') && !entry.capabilities.includes('mcp-crdt')) {
        this.sendLifecycleError(res, 403, 'CRDT_CAPABILITY_NOT_GRANTED', origin);
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
      // Kept by its hash only: the token itself is in the join response alone.
      entry.clientTickets.set(secretHash(clientToken), ticket);
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
    const approvalMatch = url.pathname.match(APPROVAL_ROUTE);
    if (req.method === 'POST' && approvalMatch) {
      const roomId = approvalMatch[1];
      const requestId = decodePathParameter(approvalMatch[2]);
      if (requestId === null) {
        this.sendLifecycleError(res, 400, 'INVALID_PATH', origin);
        return;
      }
      const entry = this.rooms.get(roomId);
      const bearer = this.bearerToken(req);
      // Checked before the body is read and again after it: the room can expire, be rotated, or be
      // reclaimed (a new provider token) while the body is in transit.
      const decidable = (room: RoomEntry | undefined): room is RoomEntry => (
        this.checkLifecycleRoom(res, roomId, room, origin) && this.checkProviderToken(res, room, bearer, origin)
      );
      if (!decidable(entry)) return;
      const body = await this.readJsonBodyOrRespond(req, res, origin);
      if (!body || !decidable(entry)) return;
      // A decision names its request's session; `roomId` and `roomEpoch` are optional, like on every
      // route that changes a room (see `bodyNamesRoom`). A request decided once is gone, so a repeated
      // decision is refused like a stale one.
      const pending = entry.pendingApprovals.get(requestId);
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
      const decision = body.decision;
      if (!pending || !sessionId || pending.sessionId !== sessionId || !this.bodyNamesRoom(body, entry)
        || (decision !== 'approved' && decision !== 'rejected')) {
        this.sendLifecycleError(res, 409, 'INVALID_APPROVAL', origin);
        return;
      }
      const ticket = entry.clientTickets.get(pending.clientTokenHash);
      const handled = this.approveClientTicket(entry, requestId, decision === 'approved', typeof body.reason === 'string' ? body.reason : undefined);
      if (!handled || !ticket) {
        this.sendLifecycleError(res, 409, 'INVALID_APPROVAL', origin);
        return;
      }
      // The decision's time, as the ticket recorded it and its echo to the provider reports it.
      const decidedAt = (decision === 'approved' ? ticket.approvedAt : ticket.revokedAt) ?? Date.now();
      this.sendJson(res, 200, {
        requestId,
        sessionId,
        roomId,
        roomEpoch: entry.roomEpoch,
        state: decision,
        clientTokenActive: decision === 'approved',
        decidedAt: new Date(decidedAt).toISOString(),
        expiresAt: new Date(pending.expiresAt).toISOString(),
        ...this.decisionTimes(pending, ticket),
      }, origin);
      return;
    }

    // 4. Session Status: GET /p/:id/sessions/:sessionId
    const sessionStatusMatch = url.pathname.match(SESSION_STATUS_ROUTE);
    if (req.method === 'GET' && sessionStatusMatch) {
      const roomId = sessionStatusMatch[1];
      const sessionId = decodePathParameter(sessionStatusMatch[2]);
      if (sessionId === null) {
        this.sendLifecycleError(res, 400, 'INVALID_PATH', origin);
        return;
      }
      const entry = this.rooms.get(roomId);
      if (!entry) {
        this.sendLifecycleError(res, 404, 'ROOM_NOT_FOUND', origin);
        return;
      }
      if (entry.rotatedTo) {
        this.sendRoomRotated(res, entry, origin);
        return;
      }
      // The provider token reads any session of the room; a client token only its own.
      const bearer = this.bearerToken(req);
      const byProvider = Boolean(bearer) && this.constantTimeTokenEqual(bearer, entry.providerToken);
      const found = this.findClientTicket(entry, sessionId);
      if (!byProvider) {
        if (!bearer) {
          this.sendUnauthorized(res, 'CLIENT_TOKEN_REQUIRED', false, origin);
          return;
        }
        const own = entry.clientTickets.get(secretHash(bearer));
        if (!own) {
          this.sendUnauthorized(res, 'CLIENT_TOKEN_INVALID', true, origin);
          return;
        }
        if (own !== found?.ticket) {
          this.sendLifecycleError(res, 403, 'SESSION_NOT_OWNED', origin);
          return;
        }
      }
      if (!found) {
        this.sendLifecycleError(res, 404, 'SESSION_NOT_FOUND', origin);
        return;
      }
      const byClient = !byProvider;
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
    const revokePeerMatch = url.pathname.match(REVOKE_ROUTE);
    if (req.method === 'POST' && revokePeerMatch) {
      const roomId = revokePeerMatch[1];
      const pathSessionId = revokePeerMatch[2] ? decodePathParameter(revokePeerMatch[2]) : '';
      if (pathSessionId === null) {
        this.sendLifecycleError(res, 400, 'INVALID_PATH', origin);
        return;
      }
      const entry = this.rooms.get(roomId);
      // Checked before the body is read and again after it, since the room can expire or be
      // rotated while the body is in transit (the tokens are checked after the read).
      const revocable = (room: RoomEntry | undefined): room is RoomEntry => this.checkLifecycleRoom(res, roomId, room, origin);
      if (!revocable(entry)) return;
      const bearer = this.bearerToken(req);
      const body = await this.readJsonBodyOrRespond(req, res, origin);
      if (!body || !revocable(entry)) return;
      if (pathSessionId) body.sessionId = pathSessionId;
      // The body's `roomId` and `roomEpoch` are optional (see `bodyNamesRoom`) and checked after the
      // credential, so a caller without one learns nothing from a mismatch.
      if (bearer && this.constantTimeTokenEqual(bearer, entry.providerToken)) {
        if (!this.bodyNamesRoom(body, entry)) {
          this.sendLifecycleError(res, 409, 'SESSION_BINDING_INVALID', origin);
          return;
        }
        const requestedSessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
        // No session named: an explicit request to revoke every session of the room, an empty body
        // included. The revoke routes take no other scope.
        if (!requestedSessionId) {
          this.revokeAllClientTickets(entry, 'ROOM_REVOKED');
          this.sendJson(res, 200, { roomId, revoked: true, revokedSessions: true }, origin);
          return;
        }
        const found = this.findClientTicket(entry, requestedSessionId);
        if (!found) {
          this.sendLifecycleError(res, 404, 'SESSION_NOT_FOUND', origin);
          return;
        }
        // Read before closing: closeClientTicket sets the status to 'revoked'. A repeat revoke is
        // idempotent and reports the original revocation time. The response's `reason` echoes the
        // caller's own, which is kept nowhere and sent to nobody else: the `session.revoked` frames
        // carry the relay's fixed reason, so no caller puts text of its choice in front of the agent.
        const alreadyRevoked = found.ticket.status === 'revoked';
        if (!alreadyRevoked) this.closeClientTicket(entry, found.tokenHash, 'revoked', 'SESSION_REVOKED');
        this.sendJson(res, 200, { roomId, roomEpoch: entry.roomEpoch, sessionId: requestedSessionId, state: 'revoked', revoked: true, revokedAt: new Date(found.ticket.revokedAt ?? Date.now()).toISOString(), reason: body.reason ?? 'provider-request', alreadyRevoked }, origin);
        return;
      }
      if (!bearer) {
        this.sendUnauthorized(res, 'CLIENT_TOKEN_REQUIRED', false, origin);
        return;
      }
      const ticket = this.resolveClientTicket(entry, bearer);
      if (!ticket) {
        this.sendUnauthorized(res, 'CLIENT_TOKEN_INVALID', true, origin);
        return;
      }
      // A client revokes only its own ticket: naming another session is not a binding mismatch
      // (SESSION_BINDING_INVALID, 409) but a session the token does not own.
      if (typeof body.sessionId === 'string' && body.sessionId && body.sessionId !== ticket.sessionId) {
        this.sendLifecycleError(res, 403, 'SESSION_NOT_OWNED', origin);
        return;
      }
      if (!this.bodyNamesRoom(body, entry)) {
        this.sendLifecycleError(res, 409, 'SESSION_BINDING_INVALID', origin);
        return;
      }
      const alreadyRevoked = ticket.status === 'revoked';
      if (!alreadyRevoked) this.closeClientTicket(entry, secretHash(bearer), 'revoked', 'CLIENT_REVOKED');
      this.sendJson(res, 200, { roomId, roomEpoch: entry.roomEpoch, sessionId: ticket.sessionId, state: 'revoked', revoked: true, revokedAt: new Date(ticket.revokedAt ?? Date.now()).toISOString(), reason: body.reason ?? 'client-request', alreadyRevoked }, origin);
      return;
    }

    // 6. Room Rotation: POST /p/:id/rotate
    const rotateMatch = url.pathname.match(ROTATE_ROUTE);
    if (req.method === 'POST' && rotateMatch) {
      const roomId = rotateMatch[1];
      const entry = this.rooms.get(roomId);
      const bearer = this.bearerToken(req);
      // Checked before the body is read and again after it: a concurrent rotation, an expiry or a
      // reclaim (a new provider token) can happen while the body is in transit. A rotated room
      // answers 410 ROOM_ROTATED naming its replacement, so a second rotation (concurrent or late)
      // learns it instead of rotating the room twice and leaving two live replacements.
      const rotatable = (room: RoomEntry | undefined): room is RoomEntry => (
        this.checkLifecycleRoom(res, roomId, room, origin) && this.checkProviderToken(res, room, bearer, origin)
      );
      if (!rotatable(entry)) return;
      const body = await this.readJsonBodyOrRespond(req, res, origin);
      if (!body || !rotatable(entry)) return;
      // The room was not rotated: a body naming another room or epoch is a binding error.
      if (!this.bodyNamesRoom(body, entry)) {
        this.sendLifecycleError(res, 409, 'ROOM_BINDING_INVALID', origin, { roomId, roomEpoch: entry.roomEpoch });
        return;
      }
      const alias = typeof body.alias === 'string' && body.alias.trim()
        ? truncateCodePoints(body.alias.trim(), MAX_ROOM_ALIAS_CODE_POINTS) : entry.alias;
      const ttlMs = typeof body.ttlMs === 'number' && Number.isFinite(body.ttlMs) ? body.ttlMs : 2 * 60 * 60 * 1000;
      const rotatedAt = Date.now();
      entry.roomState = 'rotating';
      entry.updatedAt = rotatedAt;
      const replacement = this.createRoomEntry(alias, entry.approvalRequired, ttlMs, entry.roomEpoch + 1, entry.capabilities, entry.ownerId);
      this.rooms.set(replacement.id, replacement);
      // Retained like an expired room, until its original expiry plus ROOM_METADATA_RETAIN_MS
      // (`metadataRetainUntil`), answering ROOM_ROTATED with its replacement meanwhile.
      entry.rotatedTo = replacement.id;
      entry.expiresAt = rotatedAt;
      entry.roomState = 'rotated';
      entry.updatedAt = rotatedAt;
      // Each client socket gets `room.rotated` naming the replacement and is closed, and every
      // request in flight gets ROOM_ROTATED with it (see `closeClientTicket`); every client socket
      // is bound to a ticket, so none is left after this.
      this.revokeAllClientTickets(entry, 'ROOM_ROTATED', 'room-rotated');
      entry.providerSocket?.send({
        protocol: WEBMCP_PROTOCOL,
        messageId: this.messageId('room.rotated'),
        type: 'room.rotated',
        roomId: entry.id,
        roomEpoch: entry.roomEpoch,
        sentAt: new Date().toISOString(),
        payload: { previousRoomId: entry.id, previousRoomEpoch: entry.roomEpoch, previousState: 'rotated', replacementRoomId: replacement.id, replacementRoomEpoch: replacement.roomEpoch, rotatedAt: new Date().toISOString(), invalidatedSessionCount: entry.clientTickets.size },
        rotatedTo: replacement.id,
      });
      entry.providerSocket?.close();
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
        invalidatedSessionCount: entry.clientTickets.size,
      }, origin);
      return;
    }

    this.sendLifecycleError(res, 404, 'NOT_FOUND', origin);
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

      const providerMatch = url.pathname.match(PROVIDER_SOCKET_ROUTE);
      const clientMatch = url.pathname.match(CLIENT_SOCKET_ROUTE);

      if (providerMatch) {
        const roomId = providerMatch[1];
        const entry = this.rooms.get(roomId);
        if (!entry || this.expireRoomIfDue(entry)) {
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
              // detached or never attached is closed instead of acting on the room. A frame that
              // finds the room expired carries out its expiry, which closes this socket too.
              if (entry.providerSocket !== peer) {
                peer.close();
                return;
              }
              if (this.expireRoomIfDue(entry)) return;
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
                if (msg.protocol !== WEBMCP_PROTOCOL || typeof msg.messageId !== 'string'
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
                // A decision taken is echoed to this socket, the room's provider socket, as one made
                // over HTTP is (see `sendDecisionEcho`).
                if (!this.approveClientTicket(entry, requestId, decision === 'approved', reason)) {
                  peer.send({ type: 'error', code: -32081, message: 'INVALID_APPROVAL', requestId });
                }
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
              this.startReconnectGrace(entry);
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
        // While a provider socket is attached the reconnect lease lasts as long as the room; its
        // grace starts again when the socket goes away (see `startReconnectGrace`).
        entry.reconnectLeaseExpiresAt = entry.expiresAt;
        entry.roomState = entry.clientTickets.size ? 'accepting-clients' : 'provider-connected';
        entry.updatedAt = Date.now();
        this.replayClientApprovals(entry);
        return;
      }

      if (clientMatch) {
        const roomId = clientMatch[1];
        const entry = this.rooms.get(roomId);
        if (!entry || this.expireRoomIfDue(entry)) {
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
              // closed instead of acting on it. A frame that finds the room expired carries out its
              // expiry, which tells this socket with `room.expired` and closes it.
              if (!entry.clientSockets.has(peer)) {
                peer.close();
                return;
              }
              if (this.expireRoomIfDue(entry)) return;
              if (clientTicket.expiresAt <= Date.now()) {
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
                  this.sendPeerRpcError(peer, invalidId, 'INVALID_REQUEST');
                  return;
                }
                // The same error, with the same data, as an HTTP request of this ticket gets.
                const ticketError = this.clientTicketError(clientTicket);
                if (ticketError) {
                  this.sendRpcError(peer, rpc.id, ticketError.code, ticketError.message, this.clientTicketErrorData(entry, roomId, clientTicket));
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
                    this.sendPeerRpcError(peer, id, 'CATALOG_CHANGED', {
                      catalogVersion: entry.catalogVersion,
                      catalogHash: entry.catalogHash,
                    });
                    return;
                  }
                  if (entry.cachedTools && !entry.cachedTools.some(tool => this.isRecord(tool) && tool.name === params.name)) {
                    this.sendPeerRpcError(peer, id, 'TOOL_NOT_FOUND');
                    return;
                  }
                }
                if (this.hasPendingRequest(entry, peer, id)) {
                  this.sendPeerRpcError(peer, id, 'DUPLICATE_REQUEST_ID');
                  return;
                }
                if (this.pendingRequestCount(entry, peer) >= MAX_PENDING_REQUESTS_PER_SOCKET) {
                  this.sendRpcError(peer, id, TOO_MANY_PENDING_REQUESTS_ERROR.code, TOO_MANY_PENDING_REQUESTS_ERROR.message, TOO_MANY_PENDING_REQUESTS_ERROR.data);
                  return;
                }
                const wireId = this.allocateWireId(entry, id);
                const key = this.rpcKey(wireId);
                if (!entry.providerSocket) {
                  this.sendPeerRpcError(peer, id, 'PROVIDER_UNAVAILABLE');
                  return;
                }
                const timer = setTimeout(() => {
                  this.clearPending(entry, key, peerRpcError('MCP_REQUEST_TIMEOUT'));
                }, this.mcpRequestTimeoutMs);
                const params = this.isRecord(rpc.params) ? rpc.params : undefined;
                const discovers = rpc.method === 'server/discover';
                entry.mcpPending.set(key, {
                  socket: peer,
                  timer,
                  method: rpc.method,
                  id,
                  wireId,
                  ticket: clientTicket,
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
