import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isUtf8 } from "node:buffer";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Duplex } from "node:stream";
import { TLSSocket } from "node:tls";
import {
  isInitializeProtocolVersion,
  MCP_INITIALIZE_PROTOCOL_VERSIONS,
  negotiateInitializeProtocolVersion,
} from "../provider/commit-receipt.js";
import {
  freezeToolCatalog,
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
  createProxyTrust,
  isHostAllowed,
  isOriginAllowed,
  resolvePeerServerConfig,
  type ProxyTrust,
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
  refuseWebSocketUpgrade,
  requestedSubprotocols,
  resolveUpgradeWebSocketOptions,
  upgradeWebSocket,
  webSocketHandshakeRefusal,
  type PeerSendResult,
  type PeerSocket,
  type UpgradeWebSocketOptions,
} from "./ws-upgrade.js";
import { isBodyConsumedError, readBoundedBody, type BoundedBody } from "./http-body.js";
import {
  PEER_RELAY_MAX_ANNOUNCEMENT_BYTES,
  PEER_RELAY_MAX_PENDING_REQUESTS,
  PEER_RELAY_MAX_REQUEST_BYTES,
  PEER_RELAY_MAX_REQUEST_ID_BYTES,
  utf8ByteLength,
} from "../config/limits.js";
import { isJsonObject } from "../config/json.js";
import { PEER_CATALOG_MAX_TOOLS, PEER_CATALOG_MAX_TOOL_NAME_LENGTH } from "../config/catalog.js";
import { isPeerErrorName, PEER_ERROR_CODES, peerRpcError, type PeerErrorName } from "../config/errors.js";
import { WEBMCP_CLOSE_CODES } from "../config/close-codes.js";
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
 * Default bound on the rooms the relay holds at once (see `WebMcpPeerServerOptions.maxRooms`).
 * Retained rooms count, since each keeps its tokens and catalog until it is deleted a day after
 * its expiry: with the default publish rate limit, which room creation and rotation spend alike,
 * one address can fill it in about 5.5 hours.
 */
const DEFAULT_MAX_ROOMS = 10_000;
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
 * client keeps to by queueing its own requests. Only requests count: a frame waiting for the agent
 * that answers no request (its approval state, `ready`, `offer.refused`) does not.
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
 * How many `register` frames the relay evaluates for one room at once, whatever their outcome: a
 * catalog it refuses (CATALOG_INVALID, CATALOG_TOO_LARGE), the catalog the room already holds, or a
 * new one it takes. Evaluating a catalog (normalizing, hashing and measuring it) costs far more than
 * receiving it, and taking one also versions it and broadcasts it to every agent, so a provider that
 * kept sending frames, alternating two catalogs included, would otherwise spend relay CPU at the
 * rate it sends. One more is allowed every REGISTER_EVALUATION_INTERVAL_MS, up to this many (see
 * `receiveRegister`).
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

/**
 * Non-MCP frame types a provider socket may relay to an agent: the answers to an agent's `offer`,
 * which go to the socket that sent it (see `deliverOfferOutcome`). With the provider's JSON-RPC
 * notifications and requests (`mcp`), these are all a provider can pass on: every other type is
 * dropped, so a provider can never inject relay-authored frames (`ready`, `error`, `session.*`,
 * `room.*`, `approval.*`, ...) into an agent's channel either. The relay alone tells an agent the
 * state of its session.
 */
const PROVIDER_SIGNALING_FRAME_TYPES: ReadonlySet<string> = new Set(['answer', 'release']);

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
 * The most offers one agent WebSocket may have waiting for the provider's `answer`. An offer makes
 * the provider negotiate a peer connection (apply the offer, create an answer, gather ICE), so an
 * agent offers again only once the last one was answered or refused.
 */
const MAX_PENDING_OFFERS_PER_SOCKET = 1;
/** An offer from an agent socket whose previous offer still waits for the provider's answer. */
const TOO_MANY_PENDING_OFFERS_ERROR: RpcErrorBody = peerRpcError('TOO_MANY_PENDING_REQUESTS', { limit: MAX_PENDING_OFFERS_PER_SOCKET });

/**
 * The offer an agent WebSocket last had forwarded to the provider (see `forwardOffer`): its
 * `requestId`, which the provider's `answer` and `release` repeat and which routes them to this
 * socket alone, and, while the provider has not answered it, the timer that refuses it after
 * `mcpRequestTimeoutMs`.
 */
interface OfferRoute {
  readonly requestId: string;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * True for a JSON-RPC message that is not a reply: `jsonrpc: '2.0'` with a string `method`, a
 * notification or a request. A provider's such message is news for the room's agents.
 */
function isRpcCallMessage(value: unknown): value is Record<string, unknown> {
  return isJsonObject(value) && value.jsonrpc === '2.0' && typeof value.method === 'string';
}

/**
 * What the relay did with a catalog a provider sent; see `acceptProviderCatalog`. `unchanged` is a
 * valid catalog that fits and hashes like the one the relay already holds, so nothing changed.
 */
type ProviderCatalogOutcome =
  | { kind: 'accepted'; announcement: Record<string, unknown> }
  | { kind: 'unchanged' }
  | { kind: 'invalid' }
  | { kind: 'too-large'; announcementBytes: number };

/**
 * An agent WebSocket's whole-catalog listing (`tools/list` without a cursor, or `server/discover`)
 * the relay answers itself (see `WebMcpPeerServer.relayCatalogListing`).
 */
interface AgentListing {
  readonly method: string;
  /** True when the request had `params._meta` (see `PendingMcpRequest.includeCatalogMeta`). */
  readonly includeCatalogMeta?: boolean;
  /** For `server/discover`, the revision negotiated from the request (`negotiateProtocolVersion`). */
  readonly protocolVersion?: string;
  /** The status of the agent's ticket, reported as `_meta.auth.state`. */
  readonly ticketStatus: string;
}

/** The catalog the relay lists for a room (see `WebMcpPeerServer.mcpCatalogSnapshot`). */
type McpCatalogSnapshot = {
  /** False only when neither the room nor the deployment has a catalog (CATALOG_UNAVAILABLE). */
  available: boolean;
  tools: unknown[];
  catalogVersion: number;
  catalogHash: string;
  catalogUpdatedAt: number | null;
};

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
  /** Evaluations allowed now, refilling continuously (so fractional). */
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

/**
 * True for a JSON-RPC reply: `jsonrpc: '2.0'` with a `result` or `error` member. A reply answers the
 * one request whose id it carries, so it is never news for anyone else.
 */
function isRpcReplyMessage(value: unknown): value is Record<string, unknown> {
  return isJsonObject(value) && value.jsonrpc === '2.0' && ('result' in value || 'error' in value);
}

/**
 * True for a frame that answers an agent's request under an id the agent can match it by: an `mcp`
 * frame whose message is a JSON-RPC reply with a string or number id, from the provider or the
 * relay. The agent counts that request as in flight until this frame reaches it.
 */
function isAgentReplyFrame(frame: unknown): boolean {
  if (!isJsonObject(frame) || frame.type !== 'mcp' || !isRpcReplyMessage(frame.message)) return false;
  const id = frame.message.id;
  return typeof id === 'string' || typeof id === 'number';
}

/**
 * The MCP methods the relay answers itself on the HTTP endpoint, for any room and any ticket (their
 * discovery is public), and never forwards to the provider. Over WebSocket it answers `ping` itself
 * for every ticket and the others for a ticket that is not approved (see `handleUpgrade`).
 */
const RELAY_METADATA_METHODS: ReadonlySet<string> = new Set(['initialize', 'server/discover', 'tools/list', 'ping', 'notifications/initialized']);

/**
 * True for a method of MCP's notification namespace (`notifications/...`). Notifications have no
 * id, so a message with an id and such a method is an invalid request on either transport.
 */
function isNotificationMethod(method: string): boolean {
  return method.startsWith('notifications/');
}

/**
 * The capabilities the relay reports for its own `initialize` and `server/discover` results. The
 * agent WebSocket gets catalog changes pushed (`notifications/tools/list_changed`), so it lists
 * `listChanged: true`, as the provider does; the HTTP endpoint has no server-to-client stream, so it
 * never sends that notification (catalog changes surface there as CATALOG_CHANGED errors).
 */
function relayMcpCapabilities(listChanged: boolean): Record<string, unknown> {
  return { tools: { listChanged }, stateless: true };
}

/**
 * `text` without the byte order mark (U+FEFF) it may start with. A sender must not add one, but a
 * receiver may ignore it (RFC 8259 §8.1), and the relay does wherever it parses JSON: the body of an
 * MCP POST and of a JSON body route, and a text message of a provider or client socket. Only one is
 * dropped: a second is not JSON whitespace, so the text still fails to parse.
 */
function withoutByteOrderMark(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Decodes a request body as UTF-8, refusing ill-formed input (a SyntaxError, so it is answered
 * like malformed JSON) instead of substituting U+FFFD and acting on altered content. A leading byte
 * order mark is dropped (see `withoutByteOrderMark`).
 */
function decodeUtf8Body(body: Buffer): string {
  if (!isUtf8(body)) throw new SyntaxError('Request body is not valid UTF-8');
  return withoutByteOrderMark(body.toString('utf8'));
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
const DEPLOYMENT_CATALOG_HASH_ROUTE = /^\/mcp\/catalog\/([a-f0-9]{64})$/;

/** The methods of the MCP endpoint `/p/:id/mcp`: the descriptor (GET) and JSON-RPC (POST). */
const MCP_ENDPOINT_METHODS = 'GET, POST';

/**
 * The methods the relay route at `pathname` answers, as an `Allow` value, or null for a path that
 * is no relay route. A request of another method to a route is answered 405 with this `Allow`
 * (RFC 9110 §15.5.6), once no `customHttpHandler` took it; a path that is no route is 404.
 */
function routeMethods(pathname: string): string | null {
  if (MCP_ROUTE.test(pathname)) return MCP_ENDPOINT_METHODS;
  if (pathname === '/config' || pathname === '/mcp/catalog' || DEPLOYMENT_CATALOG_HASH_ROUTE.test(pathname)
    || MCP_TOOLS_ROUTE.test(pathname) || SESSION_STATUS_ROUTE.test(pathname)) return 'GET';
  if (pathname === '/p' || RECLAIM_ROUTE.test(pathname) || JOIN_ROUTE.test(pathname) || APPROVAL_ROUTE.test(pathname)
    || REVOKE_ROUTE.test(pathname) || ROTATE_ROUTE.test(pathname)) return 'POST';
  return null;
}

/** The comma-separated values of a request header, trimmed, empty ones dropped, in order. */
function headerValues(value: string | string[] | undefined): string[] {
  const joined = Array.isArray(value) ? value.join(',') : value;
  return typeof joined === 'string' ? joined.split(',').map(entry => entry.trim()).filter(Boolean) : [];
}

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
  | 'BAD_UPGRADE'
  | 'UNSUPPORTED_WEBSOCKET_VERSION'
  | 'SUBPROTOCOL_REQUIRED'
  | 'INVALID_PATH'
  | 'METHOD_NOT_ALLOWED'
  | 'HOST_NOT_ALLOWED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'ROOM_CAPACITY_EXCEEDED'
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
 * How the relay refuses a lifecycle request or a WebSocket upgrade: the HTTP status, the error name
 * of the body (see `lifecycleErrorBody`), the body's other fields and the response's own headers.
 * A lifecycle route sends it as its JSON response (`sendRefusal`), an upgrade as the HTTP response
 * that ends the connection (`refuseUpgrade`), so both answer one condition the same way.
 */
interface LifecycleRefusal {
  readonly status: number;
  readonly name: LifecycleErrorName;
  readonly fields?: Record<string, unknown>;
  readonly headers?: Record<string, string>;
}

/**
 * 401 for a credential the relay refuses: `name` is the `<X>_REQUIRED` of a request that presented
 * none, or the `<X>_INVALID` of one whose credential is wrong, with the matching Bearer challenge.
 */
function unauthorizedRefusal(name: LifecycleErrorName, presented: boolean): LifecycleRefusal {
  return { status: 401, name, headers: bearerChallenge(presented) };
}

/**
 * 403 ORIGIN_NOT_ALLOWED for a request from a browser `origin` the relay does not allow, whichever
 * the request: a preflight, any other HTTP request, a WebSocket upgrade. It names `Vary: Origin`,
 * since the same request from another origin is answered otherwise.
 */
function originRefusal(origin: string): LifecycleRefusal {
  return { status: 403, name: 'ORIGIN_NOT_ALLOWED', fields: { origin }, headers: { Vary: 'Origin' } };
}

/** 410 ROOM_ROTATED for a request to `room`, a rotated room, naming its replacement. */
function roomRotatedRefusal(room: RoomEntry): LifecycleRefusal {
  return { status: 410, name: 'ROOM_ROTATED', fields: { roomId: room.id, roomEpoch: room.roomEpoch, replacementRoomId: room.rotatedTo } };
}

/** 410 ROOM_EXPIRED for a request to `room`, an expired room the relay still retains. */
function roomExpiredRefusal(room: RoomEntry): LifecycleRefusal {
  return { status: 410, name: 'ROOM_EXPIRED', fields: { roomId: room.id, roomEpoch: room.roomEpoch } };
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

/** The error that answers an agent request the relay could not send to the provider (`sent`). */
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
 * the state of its approval; the answer or refusal of its offer) is never dropped, and never
 * closes the socket, because the agent's outbound queue is full: an agent that pipelines calls may
 * ask for far more than the queue holds (MAX_PENDING_REQUESTS_PER_SOCKET replies of up to the
 * message limit each), and one that reads is not at fault. The frame waits here instead, in order
 * with every frame after it, and goes out as the agent reads. While frames wait:
 * - the relay reads, and handles, nothing more from the agent: the socket is paused, and the codec
 *   stops at the frame it was handling even within a read it already took (see `upgradeWebSocket`).
 *   So an agent that does not read cannot make the relay answer, and hold, more than it already
 *   asked for: the replies to its requests in flight (at most MAX_PENDING_REQUESTS_PER_SOCKET), the
 *   answer to the one frame the relay was handling when the first frame had to wait, and the few
 *   frames of its approval, its offer and the end of its session, however many requests one read
 *   of the agent carried;
 * - each waiting reply to one of the agent's requests (`isAgentReplyFrame`) counts toward the
 *   agent's MAX_PENDING_REQUESTS_PER_SOCKET, so at most that many of the provider's replies, each
 *   within the message limit, wait for one socket. The other frames that wait (the state of its
 *   approval, `ready`, the answer or refusal of its offer, the end of its session) answer no request
 *   the agent counts, so they do not count: counted, they would make the relay refuse a request the
 *   agent rightly sent as its 64th;
 * - the oldest one is offered to the socket again when its queue drains and every
 *   AGENT_OUTBOX_RETRY_MS, so a refusal keeps the codec's stall close armed.
 * The only close a full queue causes is the codec's: an agent that reads nothing for
 * `WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS` is closed with 1013, and what waits for it is dropped.
 *
 * The relay ends an agent's session through here too (see `closeAfterFlush`): the frame that tells
 * why (`approval.rejected`, `approval.expired`, `session.revoked`, `room.rotated`, `room.expired`)
 * waits behind what the agent asked for before it, a provider's reply to a call that ran included,
 * and the socket closes once all of it has gone out.
 *
 * A frame the agent did not ask for is `offer`ed instead, and skipped for an agent that is behind.
 */
class AgentOutbox {
  /** The frames waiting, oldest first, each marked when it is a reply (`isAgentReplyFrame`). */
  private readonly waiting: Array<{ frame: unknown; reply: boolean }> = [];
  private waitingReplyCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set by `closeAfterFlush`: the socket closes with `code` once nothing waits. */
  private closing: { readonly code?: number } | undefined;

  constructor(private readonly peer: PeerSocket, private readonly raw: Duplex) {}

  /**
   * How many replies to the agent's requests wait for the agent to read what was sent before them:
   * requests the agent still counts as in flight, so the relay counts them too.
   */
  get waitingReplies(): number {
    return this.waitingReplyCount;
  }

  /**
   * Sends `frame` if nothing waits and the outbound queue takes it; otherwise queues it behind the
   * frames already waiting (`queued`). `too-large` and `closed` are what `PeerSocket.send` reports
   * for a frame it would never send: nothing is sent or queued, and the caller can still answer it.
   * A socket that is closing (see `closeAfterFlush`) takes nothing more: `closed`.
   */
  deliver(frame: unknown): AgentDelivery {
    if (this.closing) return 'closed';
    if (this.waiting.length === 0) {
      const sent = this.peer.send(frame);
      if (sent !== 'busy') return sent;
      this.raw.pause();
      this.retryLater();
    } else if (utf8ByteLength(JSON.stringify(frame)) > MAX_WEBSOCKET_MESSAGE_BYTES) {
      return 'too-large';
    }
    const reply = isAgentReplyFrame(frame);
    this.waiting.push({ frame, reply });
    if (reply) this.waitingReplyCount += 1;
    return 'queued';
  }

  /**
   * Sends `frame`, `bytes` of JSON the agent did not ask for, only if nothing waits and the queue
   * keeps room for a reply of the full limit with it (MAX_UNREQUESTED_QUEUE_BYTES). Otherwise the
   * agent is behind: the frame is skipped for it (`busy`) and its socket stays open.
   */
  offer(frame: unknown, bytes: number): PeerSendResult {
    if (this.closing) return 'closed';
    if (this.waiting.length > 0) return 'busy';
    if (this.raw.writableLength + bytes + MAX_MESSAGE_HEADER_BYTES > MAX_UNREQUESTED_QUEUE_BYTES) return 'busy';
    return this.peer.send(frame);
  }

  /**
   * Closes the socket with `code` (1000 when omitted) once every frame waiting for the agent has
   * gone out, at once when none waits, and takes no frame after it. So the frame that ends the
   * agent's session, delivered just before, reaches the agent after everything it asked for and
   * just before the close, instead of being refused for a full queue or overtaking the replies
   * that wait. An agent that reads nothing meanwhile is closed by the codec after
   * `WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS` as before, and what waits for it is dropped.
   */
  closeAfterFlush(code?: number): void {
    if (this.closing) return;
    this.closing = { code };
    if (this.waiting.length === 0) this.peer.close(code);
  }

  /** Drops what waits once the socket has stopped, and lets the connection finish closing. */
  discard(): void {
    if (this.waiting.length === 0) return;
    this.waiting.length = 0;
    this.waitingReplyCount = 0;
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

  /**
   * Sends what waits, in order, until the queue is full again; then reads from the agent again, or,
   * for a socket that is closing, closes it after the last frame.
   */
  private readonly flush = (): void => {
    this.stopRetrying();
    while (this.waiting.length > 0) {
      const sent = this.peer.send(this.waiting[0]!.frame);
      if (sent === 'busy') {
        this.retryLater();
        return;
      }
      if (sent === 'closed') {
        this.discard();
        return;
      }
      if (this.waiting.shift()!.reply) this.waitingReplyCount -= 1;
    }
    if (this.closing) this.peer.close(this.closing.code);
    // Read again: a closed connection finishes closing once the agent's close frame is read.
    this.raw.resume();
  };
}

// Request headers a browser may send cross-origin. The MCP ones are what browser-hosted Streamable
// HTTP clients send after `initialize`; without them every such request fails its CORS preflight.
const BROWSER_ALLOWED_REQUEST_HEADERS = 'Content-Type, Authorization, X-Requested-With, X-Publish-Key, X-Framebook-Owner, X-Owner-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name';
// The methods a browser may send cross-origin, as a preflight answers them: those of the relay's
// routes, DELETE included, so a browser MCP client's session termination gets the endpoint's 405
// (which MCP clients expect) rather than a CORS failure.
const BROWSER_ALLOWED_METHODS = 'GET, POST, DELETE, OPTIONS';
// Response headers a cross-origin script may read. None is CORS-safelisted, and the relay sends
// each for its client to act on: when to retry, the validator of a conditional GET, the catalog a
// response comes from, the publish quota.
const BROWSER_EXPOSED_RESPONSE_HEADERS = 'Retry-After, ETag, X-MCP-Catalog-Version, X-MCP-Catalog-Hash, X-RateLimit-Limit, X-RateLimit-Remaining';
// The `Vary` of the room descriptor (`GET /p/:id/mcp`): an `Accept` of only text/event-stream gets
// 405 instead of it, so a shared cache must not answer one Accept with the other's response.
const DESCRIPTOR_VARY = 'Origin, Accept, Accept-Encoding';

export class WebMcpPeerServer {
  readonly server: Server;
  readonly rooms = new Map<string, RoomEntry>();
  port: number;
  readonly host: string;
  readonly allowedOrigins: string[];
  readonly allowedHosts: string[];
  /** True when the relay refuses a request addressed to a host outside `allowedHosts` (HOST_NOT_ALLOWED). */
  readonly enforceAllowedHosts: boolean;
  /** Which peers the relay takes `X-Forwarded-*` headers from; see `WebMcpPeerServerOptions.trustProxy`. */
  readonly trustProxy: boolean | readonly string[];
  /** The most rooms the relay holds at once, retained ones included; see `WebMcpPeerServerOptions.maxRooms`. */
  readonly maxRooms: number;
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
  /** The trust `trustProxy` places in the hops in front of the relay (see `clientAddress`). */
  private readonly proxyTrust: ProxyTrust;
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
  /**
   * The frame that told the room's provider socket a ticket ended while its room stays live (see
   * `tellProviderTicketEnded`), sent again to each provider socket that attaches later.
   */
  private readonly ticketEndFrames = new WeakMap<ClientSessionTicket, Readonly<Record<string, unknown>>>();
  /** The outbox of every agent WebSocket the relay accepted (see `replyToAgent`). */
  private readonly agentOutboxes = new WeakMap<PeerSocket, AgentOutbox>();
  /**
   * The agent WebSockets the relay took out of their room and closes once what waits for them has
   * gone out (see `closeAgentSocket`); the relay's own `close` closes them at once.
   */
  private readonly closingAgentSockets = new Set<PeerSocket>();
  /** The offer each agent WebSocket last had forwarded (see `forwardOffer`). */
  private readonly offerRoutes = new WeakMap<PeerSocket, OfferRoute>();
  /** What the relay keeps about each room's `register` frames (see `receiveRegister`). */
  private readonly registerStates = new WeakMap<RoomEntry, RegisterState>();
  /** The codec options of every provider and client socket: the relay's liveness timing. */
  private readonly socketOptions: UpgradeWebSocketOptions;

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
    this.enforceAllowedHosts = config.enforceAllowedHosts;
    this.trustProxy = config.trustProxy;
    this.proxyTrust = createProxyTrust(config.trustProxy);
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
    // `Infinity` holds any number of rooms; NaN is no bound at all, so it is the default.
    const maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS;
    this.maxRooms = Number.isNaN(maxRooms) ? DEFAULT_MAX_ROOMS : Math.max(1, Math.floor(maxRooms));
    // Checked here, so a bad value fails the construction rather than every upgrade.
    this.socketOptions = { pingIntervalMs: options.webSocketPingIntervalMs, idleTimeoutMs: options.webSocketIdleTimeoutMs };
    resolveUpgradeWebSocketOptions(this.socketOptions);
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
        // 1001 (Going Away): the relay is going, not the session, so a peer may connect again.
        room.providerSocket?.close(WEBMCP_CLOSE_CODES.GOING_AWAY);
        for (const cs of room.clientSockets) cs.close(WEBMCP_CLOSE_CODES.GOING_AWAY);
      }
      for (const socket of [...this.closingAgentSockets]) socket.close(WEBMCP_CLOSE_CODES.GOING_AWAY);
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
      // The deployment catalog itself, which is frozen (see `mcpCatalogSnapshot`), not a copy.
      ...(this.deploymentCatalog.tools.length > 0
        ? {
            cachedTools: this.deploymentCatalog.tools as unknown[],
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

  /** True when `req` came from a trusted proxy (see `trustProxy`), whose `X-Forwarded-*` the relay reads. */
  protected fromTrustedProxy(req: IncomingMessage): boolean {
    const peer = req.socket.remoteAddress;
    return typeof peer === 'string' && this.proxyTrust(peer, 0);
  }

  /**
   * The value of the forwarded header `name` the nearest proxy wrote (the last of its values), when
   * the request came from a trusted proxy; otherwise undefined, whatever the request carries.
   */
  protected forwardedHeader(req: IncomingMessage, name: 'x-forwarded-proto' | 'x-forwarded-host'): string | undefined {
    return this.fromTrustedProxy(req) ? headerValues(req.headers[name]).at(-1) : undefined;
  }

  /**
   * The address a request came from, the identity of its publish rate-limit bucket: the socket's
   * remote address, or, through trusted proxies (see `trustProxy`), the `X-Forwarded-For` address
   * the relay reaches reading back from the nearest hop while each hop is trusted, the first
   * outside the trust boundary (the left-most when every hop is trusted). An address a caller
   * wrote ahead of the ones its proxies added is never reached, so it cannot pick its bucket.
   */
  protected clientAddress(req: IncomingMessage): string {
    let address = req.socket.remoteAddress ?? 'unknown';
    const forwardedFor = headerValues(req.headers['x-forwarded-for']);
    for (let hop = 0; hop < forwardedFor.length && this.proxyTrust(address, hop); hop += 1) {
      address = forwardedFor[forwardedFor.length - 1 - hop]!;
    }
    return address;
  }

  /** The host a request is addressed to: `X-Forwarded-Host` from a trusted proxy, otherwise `Host`. */
  protected requestHost(req: IncomingMessage): string | undefined {
    return this.forwardedHeader(req, 'x-forwarded-host') ?? req.headers.host;
  }

  /**
   * Null when the relay serves a request addressed to its host (see `requestHost`) that also came
   * with a `Host` it serves; otherwise 403 HOST_NOT_ALLOWED, naming the first of the two that is
   * not served. Only a relay that `enforceAllowedHosts` refuses one, every HTTP request and upgrade
   * alike, before anything else: a page whose name a DNS rebinding pointed at the relay sends that
   * name as its `Host`, so it reaches none of the relay's routes, its public ones included. The
   * `Host` is checked even when a trusted proxy names the host: a rebound page on the relay's own
   * machine connects from the loopback address a local tunnel does, and could otherwise name an
   * allowed host in `X-Forwarded-Host` (a header a page may set). A proxy that keeps a loopback
   * upstream `Host`, or passes the public one on, is served; one that rewrites it to another name
   * needs that name in `allowedHosts`.
   */
  protected hostRefusal(req: IncomingMessage): LifecycleRefusal | null {
    if (!this.enforceAllowedHosts) return null;
    for (const host of [this.requestHost(req), req.headers.host]) {
      if (!this.isHostAllowed(host)) return { status: 403, name: 'HOST_NOT_ALLOWED', fields: { host } };
    }
    return null;
  }

  /**
   * The base URL the relay's descriptors name for `req`: the scheme `X-Forwarded-Proto` from a
   * trusted proxy names when it is `http` or `https`, else that of the socket, and the request's
   * host (see `requestHost`) when it is allowed, else the relay's own `host:port`.
   */
  public requestOrigin(req: IncomingMessage): string {
    const forwardedProto = this.forwardedHeader(req, 'x-forwarded-proto')?.toLowerCase();
    const proto = forwardedProto === 'http' || forwardedProto === 'https'
      ? forwardedProto
      : req.socket instanceof TLSSocket && req.socket.encrypted ? 'https' : 'http';
    const addr = this.server.address();
    const currentPort = typeof addr === 'object' && addr ? addr.port : this.port;
    const fallbackHost = `${this.host}:${currentPort}`;
    const host = this.requestHost(req) || fallbackHost;
    const safeHost = this.isHostAllowed(host) ? host : fallbackHost;
    return `${proto}://${safeHost}`;
  }

  /** True when `entry` is live: neither rotated nor past its `expiresAt`. */
  protected isLiveRoom(entry: RoomEntry | undefined, now = Date.now()): entry is RoomEntry {
    return Boolean(entry && !entry.rotatedTo && entry.expiresAt > now);
  }

  /**
   * Null when the relay may hold one more room; otherwise 503 ROOM_CAPACITY_EXCEEDED, with the time
   * until the first room it holds is deleted (when its retention ends, see `cleanupExpiredRooms`)
   * as `retryAfterMs` and `Retry-After`. Retained rooms count: each answers for its id until then.
   */
  protected roomCapacityRefusal(now = Date.now()): LifecycleRefusal | null {
    if (this.rooms.size < this.maxRooms) return null;
    let firstDeletion = Number.POSITIVE_INFINITY;
    for (const entry of this.rooms.values()) firstDeletion = Math.min(firstDeletion, entry.metadataRetainUntil ?? now);
    const retryAfterMs = Math.max(1_000, firstDeletion - now);
    return {
      status: 503,
      name: 'ROOM_CAPACITY_EXCEEDED',
      fields: { retryAfterMs },
      headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
    };
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
   * they do not know, and 2026-07-28 has no `initialize` at all. The provider negotiates with the
   * same function (`negotiateInitializeProtocolVersion`), so an agent's `initialize` or
   * `server/discover` gets the same revision over HTTP and WebSocket, whether the relay or the
   * provider answers it.
   */
  protected negotiateProtocolVersion(params: unknown): string {
    return negotiateInitializeProtocolVersion(params);
  }

  protected isInitializeProtocolVersion(version: string): boolean {
    return isInitializeProtocolVersion(version);
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
   * agent WebSocket, those whose replies wait for the agent to read them (see `AgentOutbox`). These
   * are requests the agent has sent and not yet seen answered, so an agent that counts its own
   * requests in flight never counts fewer than the relay does.
   */
  protected pendingRequestCount(entry: RoomEntry, socket: PeerSocket): number {
    let count = this.agentOutboxes.get(socket)?.waitingReplies ?? 0;
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
   * request (the provider's or the relay's own), the state of its approval and the end of its
   * session, the provider's answer to its offer, or the refusal of its offer. Such a frame is never
   * dropped and never closes the socket for a full outbound queue: an agent WebSocket that is behind
   * gets it, in order, once it has read what was sent before it (see `AgentOutbox`), so a reading
   * agent that pipelines calls gets every reply. The HTTP bridge gets it in its HTTP response.
   */
  protected replyToAgent(socket: PeerSocket, frame: unknown): AgentDelivery {
    const outbox = this.agentOutboxes.get(socket);
    return outbox ? outbox.deliver(frame) : socket.send(frame);
  }

  /**
   * Closes an agent WebSocket the relay took out of its room, with `code` (1000 when omitted), once
   * what waits for it has gone out: the frame that ends its session, delivered just before with
   * `replyToAgent`, and the replies it asked for before that (see `AgentOutbox.closeAfterFlush`).
   */
  protected closeAgentSocket(socket: PeerSocket, code?: number): void {
    const outbox = this.agentOutboxes.get(socket);
    if (!outbox) {
      socket.close(code);
      return;
    }
    this.closingAgentSockets.add(socket);
    outbox.closeAfterFlush(code);
  }

  /**
   * Takes the agent WebSocket `socket` out of the room `entry`: it is no longer the room's or its
   * ticket's, gets no broadcast, and the offer it had forwarded is forgotten, so a late `answer` or
   * `release` is dropped.
   */
  protected detachClientSocket(entry: RoomEntry, socket: PeerSocket): void {
    entry.clientSockets.delete(socket);
    entry.clientSocketTickets.delete(socket);
    this.dropOfferRoute(socket);
  }

  /**
   * Sends `frame`, which no agent asked for (a catalog announcement, `list_changed`, a provider's
   * notification), to every agent socket of the room that has room for it, or with `approvedOnly`
   * only to the sockets of an approved ticket: an agent that is behind skips it and keeps its
   * socket, and what it skips never takes the room a reply it asked for needs (see
   * `AgentOutbox.offer`).
   */
  protected broadcastToAgents(entry: RoomEntry, frame: unknown, { approvedOnly = false }: { approvedOnly?: boolean } = {}): void {
    if (entry.clientSockets.size === 0) return;
    const bytes = utf8ByteLength(JSON.stringify(frame));
    for (const socket of entry.clientSockets) {
      if (approvedOnly && entry.clientSocketTickets.get(socket)?.status !== 'approved') continue;
      const outbox = this.agentOutboxes.get(socket);
      if (outbox) outbox.offer(frame, bytes);
      else socket.send(frame);
    }
  }

  /**
   * Forwards the `offer` frame `msg` (received as `text`) of the approved ticket `ticket` from its
   * agent WebSocket `socket` to the room's provider, stamped like a request (R-SIG-005), or refuses
   * it with `offer.refused`. An offer names, as `requestId`, a non-empty string of at most
   * MAX_RPC_ID_BYTES of JSON, which the provider's `answer` and `release` repeat; one without it
   * could not be matched to its answer (INVALID_REQUEST), one longer could not be answered within
   * the relay's message limit (REQUEST_ID_TOO_LARGE), and neither echoes the requestId. A socket has
   * at most MAX_PENDING_OFFERS_PER_SOCKET offer waiting for an answer, and a requestId routes to one
   * socket of the room (DUPLICATE_REQUEST_ID). Like a request, an offer over the request limit, or
   * one the provider cannot take now, is refused with the error a request gets. A forwarded offer
   * the provider has not answered within `mcpRequestTimeoutMs` is refused with MCP_REQUEST_TIMEOUT.
   */
  protected forwardOffer(entry: RoomEntry, socket: PeerSocket, ticket: ClientSessionTicket, text: string, msg: Record<string, unknown>): void {
    const refuse = (error: RpcErrorBody, requestId?: string): void => {
      this.replyToAgent(socket, { type: 'offer.refused', ...(requestId !== undefined ? { requestId } : {}), error });
    };
    const requestId = msg.requestId;
    if (typeof requestId !== 'string' || !requestId) {
      refuse(peerRpcError('INVALID_REQUEST'));
      return;
    }
    if (isOversizedEchoedId(requestId)) {
      refuse(REQUEST_ID_TOO_LARGE_ERROR);
      return;
    }
    if (this.offerRoutes.get(socket)?.timer) {
      refuse(TOO_MANY_PENDING_OFFERS_ERROR, requestId);
      return;
    }
    const routed = this.offerSocket(entry, requestId);
    if (routed && routed !== socket) {
      refuse(peerRpcError('DUPLICATE_REQUEST_ID'), requestId);
      return;
    }
    // An offer is forwarded on the agent's behalf like a request, under the same limit.
    const sent = exceedsRequestLimit(text, msg)
      ? 'too-large'
      : entry.providerSocket?.send({ ...msg, from: 'client', sessionId: ticket.sessionId }) ?? 'closed';
    if (sent !== 'sent') {
      if (sent === 'closed') this.detachClosedProvider(entry);
      // The offer's sender waits for an answer that will not come: it is told why, with the error
      // a request would get (PROVIDER_BUSY is retryable).
      refuse(unforwardedRpcError(sent), requestId);
      return;
    }
    const route: OfferRoute = { requestId };
    route.timer = setTimeout(() => {
      if (this.offerRoutes.get(socket) !== route) return;
      this.offerRoutes.delete(socket);
      refuse(peerRpcError('MCP_REQUEST_TIMEOUT'), requestId);
    }, this.mcpRequestTimeoutMs);
    route.timer.unref?.();
    this.dropOfferRoute(socket);
    this.offerRoutes.set(socket, route);
  }

  /** The agent WebSocket of the room whose last forwarded offer is `requestId`, if any. */
  protected offerSocket(entry: RoomEntry, requestId: string): PeerSocket | undefined {
    for (const socket of entry.clientSocketTickets.keys()) {
      if (this.offerRoutes.get(socket)?.requestId === requestId) return socket;
    }
    return undefined;
  }

  /** Forgets the offer `socket` last had forwarded, and stops its timer. */
  protected dropOfferRoute(socket: PeerSocket): void {
    clearTimeout(this.offerRoutes.get(socket)?.timer);
    this.offerRoutes.delete(socket);
  }

  /**
   * Passes the provider's `answer` or `release` frame `msg` on, unchanged, to the one agent
   * WebSocket whose forwarded offer it names by `requestId` (see `forwardOffer`), as the reply to
   * that offer; a frame that names no such offer (a late one, or one with another requestId) is
   * dropped. The first `answer` settles the offer, so the socket may offer again and a second
   * `answer` is dropped; `release`, sent once the agent took the session over the DataChannel,
   * ends the route.
   *
   * The relay sends the frame as it parsed it, written again, which can take a frame the provider
   * sent within the message limit over it (`1e21` becomes `1e+21`). The offer still ends as it
   * must, with an answer, a refusal or the socket's close: an `answer` that does not fit refuses
   * the offer instead (`offer.refused` RESULT_TOO_LARGE), ending its route, and a `release` that
   * does not fit goes out as `{type:'release', requestId}`, all a release says.
   */
  protected deliverOfferOutcome(entry: RoomEntry, msg: Record<string, unknown>): void {
    if (typeof msg.requestId !== 'string') return;
    const socket = this.offerSocket(entry, msg.requestId);
    const route = socket ? this.offerRoutes.get(socket) : undefined;
    if (!socket || !route) return;
    if (msg.type === 'answer') {
      if (!route.timer) return;
      clearTimeout(route.timer);
      route.timer = undefined;
      if (this.replyToAgent(socket, msg) === 'too-large') {
        this.dropOfferRoute(socket);
        this.replyToAgent(socket, { type: 'offer.refused', requestId: route.requestId, error: RESULT_TOO_LARGE_ERROR });
      }
      return;
    }
    this.dropOfferRoute(socket);
    if (this.replyToAgent(socket, msg) === 'too-large') this.replyToAgent(socket, { type: 'release', requestId: route.requestId });
  }

  /**
   * Refuses, with PROVIDER_DISCONNECTED, every offer of the room still waiting for the answer of
   * the provider socket that went away, and forgets the room's answered offers, whose `release`
   * cannot come any more.
   */
  protected failOffersForProvider(entry: RoomEntry): void {
    for (const socket of entry.clientSocketTickets.keys()) {
      const route = this.offerRoutes.get(socket);
      if (!route) continue;
      this.dropOfferRoute(socket);
      if (route.timer) {
        this.replyToAgent(socket, { type: 'offer.refused', requestId: route.requestId, error: peerRpcError('PROVIDER_DISCONNECTED') });
      }
    }
  }

  /**
   * Detaches the room's provider socket and closes it: one the relay can no longer write to (it is
   * closing, e.g. after the relay refused an oversized frame), without waiting for TCP to finish
   * closing, so later requests get PROVIDER_UNAVAILABLE and a reclaim can attach a new provider;
   * or one a new provider socket replaces. Every pending request was sent to that socket, so each
   * fails with PROVIDER_DISCONNECTED, and the reconnect lease's grace starts (a socket that replaces
   * this one ends it again when it attaches). The socket is closed with 4001 SUPERSEDED, no frame
   * before it, so a replaced provider does not reconnect and displace the socket that replaced it
   * (nothing goes out on a socket that is already closing).
   */
  protected detachClosedProvider(entry: RoomEntry): void {
    const socket = entry.providerSocket;
    if (!socket) return;
    entry.providerSocket = undefined;
    this.startReconnectGrace(entry);
    this.failPendingForProvider(entry);
    socket.close(WEBMCP_CLOSE_CODES.SUPERSEDED);
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
    entry.cachedTools = freezeToolCatalog(tools);
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
   * Evaluating a frame is what costs, and taking a catalog also versions it and broadcasts it to
   * every agent, so a provider cannot make the relay do either at the rate it sends frames:
   * - a frame that announces exactly what the last evaluated one did (all fields but `registerSeq`),
   *   while the room catalog is still the one that frame left, is not evaluated again: it gets the
   *   same answer, under its own `registerSeq`;
   * - every other frame, whether the relay refuses it, finds the catalog unchanged or takes it, is
   *   evaluated at most REGISTER_EVALUATION_BURST at once, then one per
   *   REGISTER_EVALUATION_INTERVAL_MS. A frame that arrives while none is allowed waits until one
   *   is, and the provider's next frame replaces it unevaluated, so the latest catalog a provider
   *   sends is always evaluated and, when valid, announced (it only waits longer), and nothing is
   *   refused for the rate.
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
    // Every evaluation uses one, whatever its outcome (an evaluation that throws included): a frame
    // that takes a new catalog costs the relay more, not less, than one that changes nothing.
    state.tokens -= 1;
    const outcome = this.acceptProviderCatalog(entry, register.frame.tools, register.frame);
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
   * `msg`), under the agent's own id. Any reply but one to a whole-catalog listing, a `tools/list`
   * without a cursor or a `server/discover` (see `PendingMcpRequest.listsCatalog`), is forwarded and
   * leaves the room catalog alone, such as a `tools/call` result that happens to have `tools`.
   *
   * While the relay holds a catalog (the room's, or the deployment's), it answers a whole-catalog
   * listing from it, whatever the provider replied, without evaluating the reply: that is the
   * catalog the relay enforces (CATALOG_CHANGED, TOOL_NOT_FOUND) and lists to an HTTP agent (see
   * `relayCatalogListing`), and a provider changes it with a `register` frame, whose evaluations
   * the relay bounds (see `receiveRegister`), not by answering listings, which the relay could not
   * bound without failing the agent's request.
   *
   * While the relay holds no catalog, the reply offers one: a catalog the relay takes is forwarded
   * stamped with the relay's `catalogVersion`/`catalogHash` in `result._meta`, where every HTTP
   * listing result has them (the provider's own `_meta` members are kept), and, for an agent that
   * sent `_meta`, also at the top of `result` (deprecated, see `catalogStamp`); one it refuses
   * (invalid, or over the announcement limit) is answered with the refusal as a JSON-RPC error, since
   * an agent that adopted it would have every later call refused; a first page of a paginated
   * listing, which is not the whole catalog, and an error are forwarded as they were sent.
   */
  protected agentReplyFrame(entry: RoomEntry, pending: PendingMcpRequest, msg: Record<string, unknown>, rpc: RpcResponse): Record<string, unknown> {
    const message = pending.wireId === pending.id ? rpc : { ...rpc, id: pending.id };
    const forwarded = pending.wireId === pending.id ? msg : { ...msg, message };
    if (!pending.listsCatalog) return forwarded;
    const snapshot = this.mcpCatalogSnapshot(entry);
    if (snapshot.available) {
      const listing = { ...pending, ticketStatus: pending.ticket?.status ?? 'not-joined' };
      return { type: 'mcp', message: { jsonrpc: '2.0', id: pending.id, result: this.relayCatalogListing(entry, listing, snapshot) } };
    }
    if (rpc.error !== undefined) return forwarded;
    const result = this.isRecord(rpc.result) ? rpc.result : undefined;
    if (result && result.nextCursor !== undefined && result.nextCursor !== null) return forwarded;
    const outcome = this.acceptProviderCatalog(entry, result?.tools, { type: 'register' });
    if (result && (outcome.kind === 'accepted' || outcome.kind === 'unchanged')) {
      const stamp = this.catalogStamp(entry);
      const meta = { ...(this.isRecord(result._meta) ? result._meta : {}), ...stamp };
      return {
        ...forwarded,
        message: { ...message, result: { ...result, ...(pending.includeCatalogMeta ? stamp : {}), _meta: meta } },
      };
    }
    const refusal = outcome.kind === 'too-large'
      ? peerRpcError('CATALOG_TOO_LARGE', { limitBytes: PEER_RELAY_MAX_ANNOUNCEMENT_BYTES, announcementBytes: outcome.announcementBytes })
      : peerRpcError('CATALOG_INVALID');
    return { type: 'mcp', message: { jsonrpc: '2.0', id: pending.id, error: refusal } };
  }

  /**
   * The `catalogVersion`/`catalogHash` of `catalog` (the room's, or a listed snapshot's) that a WebSocket
   * listing result carries in `result._meta`. The same members at the top of `result`, for an agent
   * that sent `params._meta`, are deprecated: kept for one minor release for agents that read them
   * there, while `result._meta` is where every listing result, on either transport, has them.
   */
  protected catalogStamp(catalog: { catalogVersion: number; catalogHash: string }): { catalogVersion: number; catalogHash: string } {
    return { catalogVersion: catalog.catalogVersion, catalogHash: catalog.catalogHash };
  }

  /**
   * The relay's own answer to an agent WebSocket's whole-catalog listing (`listing`) from the room's
   * catalog `snapshot` (which must be `available`): the result the HTTP route answers the same
   * request, a `server/discover` with `capabilities.tools.listChanged: true` since this socket gets
   * catalog changes pushed (see `mcpDiscoverResult`, `mcpToolsListResult`). For an agent that sent
   * `_meta`, it also carries the deprecated top-level stamp (see `catalogStamp`), as a catalog the
   * relay takes from the provider does.
   */
  protected relayCatalogListing(entry: RoomEntry, listing: AgentListing, snapshot = this.mcpCatalogSnapshot(entry)): Record<string, unknown> {
    const result = listing.method === 'server/discover'
      ? this.mcpDiscoverResult(entry, entry.id, listing.protocolVersion ?? this.negotiateProtocolVersion(undefined), snapshot, listing.ticketStatus, true)
      : this.mcpToolsListResult(entry, entry.id, snapshot, listing.ticketStatus);
    return listing.includeCatalogMeta ? { ...result, ...this.catalogStamp(snapshot) } : result;
  }

  /**
   * Answers an agent WebSocket's `initialize`, `tools/list` or `server/discover` (`rpc`, with the id
   * `id`) from the relay, as the HTTP route answers the same request of the same `ticket`: the
   * relay's `initialize` result, its listing, or CATALOG_UNAVAILABLE when the room has no catalog.
   * Returns false, answering nothing, for any other method. The relay answers these for a ticket
   * that is not approved, whose requests never reach the provider: their discovery is public, so an
   * agent waiting for approval can read the catalog over either transport. A result over the relay
   * message limit (one whose `serverInfo` the relay's options made long, say) is answered
   * RESULT_TOO_LARGE, as a provider's reply is: an answer the agent asked for is never dropped.
   */
  protected answerAgentMetadata(entry: RoomEntry, socket: PeerSocket, ticket: ClientSessionTicket, rpc: RpcRequest, id: string | number): boolean {
    const params = this.isRecord(rpc.params) ? rpc.params : undefined;
    if (rpc.method !== 'initialize' && rpc.method !== 'tools/list' && rpc.method !== 'server/discover') return false;
    const snapshot = this.mcpCatalogSnapshot(entry);
    let result: Record<string, unknown>;
    if (rpc.method === 'initialize') {
      result = this.mcpInitializeResult(entry, entry.id, this.negotiateProtocolVersion(params), snapshot, ticket.status, 'websocket');
    } else if (!snapshot.available) {
      this.sendPeerRpcError(socket, id, 'CATALOG_UNAVAILABLE', { catalogSource: this.deploymentCatalog.source });
      return true;
    } else {
      result = this.relayCatalogListing(entry, {
        method: rpc.method,
        includeCatalogMeta: this.isRecord(params?._meta),
        protocolVersion: this.negotiateProtocolVersion(params),
        ticketStatus: ticket.status,
      }, snapshot);
    }
    if (this.replyToAgent(socket, { type: 'mcp', message: { jsonrpc: '2.0', id, result } }) === 'too-large') {
      this.sendRpcError(socket, id, RESULT_TOO_LARGE_ERROR.code, RESULT_TOO_LARGE_ERROR.message, RESULT_TOO_LARGE_ERROR.data);
    }
    return true;
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

  /**
   * Ends everything the room's provider socket, which went away, was to answer: every request in
   * flight and every offer waiting for its answer, each with PROVIDER_DISCONNECTED.
   */
  protected failPendingForProvider(entry: RoomEntry): void {
    for (const [key, pending] of entry.mcpPending) {
      clearTimeout(pending.timer);
      entry.mcpPending.delete(key);
      this.sendPeerRpcError(pending.socket, pending.id, 'PROVIDER_DISCONNECTED');
    }
    this.failOffersForProvider(entry);
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

  /**
   * The cache headers of a room's descriptor and its catalog snapshot (`GET /p/:id/mcp`,
   * `GET /p/:id/mcp/tools`), whose ETag is the digest of `body`. `vary` names the request headers
   * the response depends on: the descriptor's also depends on `Accept` (see DESCRIPTOR_VARY).
   */
  protected mcpDescriptorCacheHeaders(
    body: unknown,
    catalogVersion: number,
    catalogHash: string,
    vary = 'Origin, Accept-Encoding',
  ): Record<string, string> {
    const digest = createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
    return {
      'Cache-Control': 'public, max-age=5, s-maxage=30, stale-while-revalidate=60, stale-if-error=300',
      ETag: `"mcp-descriptor-${digest}"`,
      'X-MCP-Catalog-Version': String(catalogVersion),
      'X-MCP-Catalog-Hash': catalogHash,
      Vary: vary,
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
        res.writeHead(304, { ...cacheHeaders, 'Content-Length': '0', ...this.corsHeaders(origin) });
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

  /**
   * The catalog the relay lists for the room `entry` (or for no room): the room's own catalog when
   * it holds one, otherwise the deployment catalog. It is `available` whenever either exists, so a
   * room whose provider registered an empty catalog lists `tools: []` (a valid MCP listing) under
   * that catalog's version, like a WebSocket agent of the room is listed; only a room with neither
   * has no catalog to list (CATALOG_UNAVAILABLE).
   *
   * Its `tools` are the catalog the relay holds, not a copy: every catalog the relay holds is frozen
   * (`freezeToolCatalog`) and replaced, never changed in place, so each listing, and each reply
   * waiting in an agent's outbox, shares the one catalog instead of holding a copy of its own.
   */
  protected mcpCatalogSnapshot(entry: RoomEntry | undefined): McpCatalogSnapshot {
    const deployment = this.deploymentCatalog;
    if (entry?.cachedTools) {
      return {
        available: true,
        tools: entry.cachedTools,
        catalogVersion: entry.catalogVersion,
        catalogHash: entry.catalogHash,
        catalogUpdatedAt: entry.catalogUpdatedAt ?? null,
      };
    }
    return deployment.tools.length > 0
      ? { available: true, tools: deployment.tools as unknown[], catalogVersion: deployment.catalogVersion, catalogHash: deployment.catalogHash, catalogUpdatedAt: deployment.catalogUpdatedAt }
      : { available: false, tools: [], catalogVersion: 0, catalogHash: this.emptyCatalogHash(), catalogUpdatedAt: null };
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
   * a WebSocket agent gets it when the relay answers for the provider (see `relayCatalogListing`).
   * It reports the revisions the relay negotiates within (`supportedProtocolVersions`) and its
   * capabilities (`listChanged` for a transport that pushes catalog changes, see
   * `relayMcpCapabilities`), as the provider's discover result through the relay does, so a
   * WebSocket agent gets the same negotiation and capabilities whichever of them answers.
   */
  protected mcpDiscoverResult(
    entry: RoomEntry | undefined,
    roomId: string,
    protocolVersion: string,
    catalog: { tools: unknown[]; catalogVersion: number; catalogHash: string },
    ticketStatus: string,
    listChanged: boolean,
  ): Record<string, unknown> {
    return {
      protocolVersion,
      supportedProtocolVersions: [...MCP_INITIALIZE_PROTOCOL_VERSIONS],
      capabilities: relayMcpCapabilities(listChanged),
      serverInfo: { name: this.serverName, version: this.serverVersion },
      tools: catalog.tools,
      _meta: this.mcpListingMeta(entry, roomId, catalog, ticketStatus),
    };
  }

  /** The relay's own `tools/list` result listing `catalog`, as the HTTP route answers it (see `mcpDiscoverResult`). */
  protected mcpToolsListResult(
    entry: RoomEntry | undefined,
    roomId: string,
    catalog: { tools: unknown[]; catalogVersion: number; catalogHash: string },
    ticketStatus: string,
  ): Record<string, unknown> {
    return { tools: catalog.tools, _meta: this.mcpListingMeta(entry, roomId, catalog, ticketStatus) };
  }

  /**
   * The relay's own `initialize` result for the room `roomId` (`entry`, if it exists): the
   * negotiated `protocolVersion`, its capabilities (see `relayMcpCapabilities`), its `serverInfo`,
   * and the catalog `snapshot` with the room's metadata, which an agent can read before it joins
   * (discovery is public). The HTTP route answers every `initialize` with it, and an agent WebSocket
   * whose ticket is not approved gets it too (an approved one's `initialize` reaches the provider).
   *
   * On the `transport` it answers on: over WebSocket, which pushes catalog changes, the result
   * reports `tools.listChanged` and must fit the relay message limit, as a listing of the same
   * catalog does (see PEER_RELAY_MAX_ANNOUNCEMENT_BYTES), so it lists the tools once, in `tools`,
   * and its `_meta.bootstrapCatalog` names that catalog without listing it again. Over HTTP, which
   * has no message limit, the bootstrap catalog lists the tools too.
   */
  protected mcpInitializeResult(
    entry: RoomEntry | undefined,
    roomId: string,
    protocolVersion: string,
    snapshot: McpCatalogSnapshot,
    ticketStatus: string,
    transport: 'http' | 'websocket',
  ): Record<string, unknown> {
    return {
      protocolVersion,
      capabilities: relayMcpCapabilities(transport === 'websocket'),
      serverInfo: { name: this.serverName, version: this.serverVersion },
      tools: snapshot.tools,
      _meta: {
        roomId,
        roomEpoch: entry?.roomEpoch ?? 0,
        roomState: this.mcpRoomState(entry),
        roomValid: Boolean(entry && !entry.rotatedTo && entry.expiresAt > Date.now()),
        catalogVersion: snapshot.catalogVersion,
        catalogHash: snapshot.catalogHash,
        toolCount: snapshot.tools.length,
        bootstrapCatalog: {
          ...(transport === 'http' ? { tools: snapshot.tools } : {}),
          catalogVersion: snapshot.catalogVersion,
          catalogHash: snapshot.catalogHash,
          source: entry?.catalogSource ?? this.deploymentCatalog.source,
        },
        auth: this.mcpAuthMetadata(entry, ticketStatus),
      },
    };
  }

  public sendJson(res: ServerResponse, status: number, body: unknown, origin?: string, extraHeaders?: Record<string, string>): void {
    // `undefined` has no JSON text; it is sent as an empty body.
    const payload = JSON.stringify(body) ?? '';
    res.writeHead(status, this.responseHeaders(origin, {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(payload)),
      ...extraHeaders,
    }));
    res.end(payload);
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

  /** Answers a lifecycle route with `refusal` (see `LifecycleRefusal`). */
  protected sendRefusal(res: ServerResponse, refusal: LifecycleRefusal, origin?: string): void {
    this.sendLifecycleError(res, refusal.status, refusal.name, origin, refusal.fields, refusal.headers);
  }

  /**
   * Refuses a WebSocket upgrade with `refusal`, as the HTTP response that ends the connection: its
   * status and lifecycle body, `Connection: close` (see `refuseWebSocketUpgrade`). A browser does
   * not show its WebSocket API the response, but any other client can tell from it a wrong ticket
   * from a room that is gone, rotated or expired, as the lifecycle routes tell them.
   */
  protected refuseUpgrade(socket: Duplex, refusal: LifecycleRefusal): void {
    refuseWebSocketUpgrade(socket, refusal.status, lifecycleErrorBody(refusal.name, refusal.fields), refusal.headers);
  }

  /**
   * Answers 401 for an `Authorization` credential the route refuses: `name` is the `<X>_REQUIRED`
   * of a request that presented none, or the `<X>_INVALID` of one whose credential is wrong, and
   * the response carries the matching Bearer challenge (see `bearerChallenge`).
   */
  protected sendUnauthorized(res: ServerResponse, name: LifecycleErrorName, presented: boolean, origin?: string): void {
    this.sendRefusal(res, unauthorizedRefusal(name, presented), origin);
  }

  /** 410 ROOM_ROTATED for a lifecycle request to `room`, a rotated room, naming its replacement. */
  protected sendRoomRotated(res: ServerResponse, room: RoomEntry, origin?: string): void {
    this.sendRefusal(res, roomRotatedRefusal(room), origin);
  }

  /** 410 ROOM_EXPIRED for a lifecycle request to `room`, an expired room the relay still retains. */
  protected sendRoomExpired(res: ServerResponse, room: RoomEntry, origin?: string): void {
    this.sendRefusal(res, roomExpiredRefusal(room), origin);
  }

  /**
   * The room check of the lifecycle routes and of the WebSocket upgrades: null when `room` is the
   * live room `roomId`; otherwise 404 ROOM_NOT_FOUND for a room that is gone (deleted once its
   * retention ended) or was replaced, 410 ROOM_ROTATED for a rotated one, as session status and the
   * MCP endpoint answer (checked before the expiry, which a rotation sets to the rotation time), or
   * 410 ROOM_EXPIRED for an expired one, whose expiry this carries out if nothing did yet (see
   * `expireRoomIfDue`).
   */
  protected lifecycleRoomRefusal(roomId: string, room: RoomEntry | undefined): LifecycleRefusal | null {
    if (!room || this.rooms.get(roomId) !== room) return { status: 404, name: 'ROOM_NOT_FOUND' };
    if (room.rotatedTo) return roomRotatedRefusal(room);
    if (this.expireRoomIfDue(room)) return roomExpiredRefusal(room);
    return null;
  }

  /**
   * The room check of the join, reclaim, approval, revoke and rotate routes, made before the body
   * is read and again after it: true when `room` is the live room `roomId`, otherwise this answered
   * with the refusal of `lifecycleRoomRefusal`.
   */
  protected checkLifecycleRoom(res: ServerResponse, roomId: string, room: RoomEntry | undefined, origin?: string): room is RoomEntry {
    const refusal = this.lifecycleRoomRefusal(roomId, room);
    if (refusal) this.sendRefusal(res, refusal, origin);
    return refusal === null;
  }

  /** The room check of a WebSocket upgrade: `checkLifecycleRoom`, refusing the upgrade instead. */
  protected checkUpgradeRoom(socket: Duplex, roomId: string, room: RoomEntry | undefined): room is RoomEntry {
    const refusal = this.lifecycleRoomRefusal(roomId, room);
    if (refusal) this.refuseUpgrade(socket, refusal);
    return refusal === null;
  }

  /**
   * Null when `token` is the room's current provider token; otherwise 401 PROVIDER_TOKEN_REQUIRED
   * for a request without one, or PROVIDER_TOKEN_INVALID for another token. The approval and rotate
   * routes take it as a Bearer token, the provider socket upgrade as its `ticket.<token>` entry.
   */
  protected providerTokenRefusal(room: RoomEntry, token: string): LifecycleRefusal | null {
    if (!token) return unauthorizedRefusal('PROVIDER_TOKEN_REQUIRED', false);
    if (!this.constantTimeTokenEqual(token, room.providerToken)) return unauthorizedRefusal('PROVIDER_TOKEN_INVALID', true);
    return null;
  }

  /**
   * The ticket check of a client socket upgrade: true when the socket may attach with `ticket` (the
   * room's ticket for the token the upgrade presented, null when the room issued none), an approved
   * ticket or a pending one, which learns of its approval on the socket. Otherwise this refused the
   * upgrade with the status and name an MCP POST with the same token gets (see `clientTicketError`),
   * and the Bearer challenge of a 401 for a request that `presented` a token or none.
   */
  protected checkUpgradeTicket(socket: Duplex, ticket: ClientSessionTicket | null, presented: boolean): ticket is ClientSessionTicket {
    if (ticket?.status === 'pending') return true;
    const error = this.clientTicketError(ticket, presented);
    if (error) {
      this.refuseUpgrade(socket, error.status === 401
        ? unauthorizedRefusal(error.message, presented)
        : { status: error.status, name: error.message });
    }
    return error === null;
  }

  /** True when `bearer` is the room's current provider token; otherwise this answered `providerTokenRefusal`. */
  protected checkProviderToken(res: ServerResponse, room: RoomEntry, bearer: string, origin?: string): boolean {
    const refusal = this.providerTokenRefusal(room, bearer);
    if (refusal) this.sendRefusal(res, refusal, origin);
    return refusal === null;
  }

  /** 202 Accepted for a JSON-RPC notification. Streamable HTTP requires an empty body. */
  protected sendAccepted(res: ServerResponse, origin?: string, extraHeaders?: Record<string, string>): void {
    res.writeHead(202, this.responseHeaders(origin, extraHeaders));
    res.end();
  }

  /**
   * The CORS headers of a response to a request from `origin`: none unless it is a browser origin
   * the relay allows, which may then read the response, send the request headers the relay takes
   * and read the response headers it sends for its clients.
   */
  protected corsHeaders(origin: string | undefined): Record<string, string> {
    if (!origin || !this.isOriginAllowed(origin)) return {};
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': BROWSER_ALLOWED_REQUEST_HEADERS,
      'Access-Control-Expose-Headers': BROWSER_EXPOSED_RESPONSE_HEADERS,
    };
  }

  /**
   * The headers of a relay response: `Cache-Control: no-store`, `Vary: Origin` (every response
   * depends on the Origin, which may get it refused or the CORS headers) and the CORS headers, then
   * `extraHeaders`, which override them (a cacheable route's own `Cache-Control` and `Vary`).
   */
  protected responseHeaders(origin: string | undefined, extraHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { 'Cache-Control': 'no-store', Vary: 'Origin', ...this.corsHeaders(origin) };
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

  /** The publish rate-limit bucket of `req`: its client address (see `clientAddress`) and `tokenHash`. */
  protected publishRateIdentity(req: IncomingMessage, tokenHash: string): string {
    return `${this.clientAddress(req)}\u0000${tokenHash}`;
  }

  /**
   * The `tokenHash` of a valid publisher's bucket (see `authorizePublishRequest`), the one every
   * room the relay created was spent from: the hash of the configured publish key, or `anonymous`
   * when none is configured. A rotation spends from it too, at the rotating caller's address.
   */
  protected publisherTokenHash(): string {
    return this.publishKeyConfigured && this.publishKeyHash ? this.publishKeyHash : 'anonymous';
  }

  /**
   * Answers a request the publish rate limit granted no unit (see `consumePublishRateLimit`): 503
   * PUBLISH_RATE_LIMIT_UNAVAILABLE when the store could not decide, otherwise 429
   * PUBLISH_RATE_LIMITED, each with `Retry-After` and the quota headers.
   */
  protected sendPublishRateRefusal(res: ServerResponse, publishRate: { available: boolean; retryAfterMs: number }, origin?: string): void {
    const retryAfterSec = Math.max(1, Math.ceil(publishRate.retryAfterMs / 1000));
    this.sendLifecycleError(res, publishRate.available ? 429 : 503, publishRate.available ? 'PUBLISH_RATE_LIMITED' : 'PUBLISH_RATE_LIMIT_UNAVAILABLE', origin, {
      retryAfterMs: publishRate.retryAfterMs,
    }, {
      'Retry-After': String(retryAfterSec),
      'X-RateLimit-Limit': String(this.publishRateLimitMax),
      'X-RateLimit-Remaining': '0',
    });
  }

  /** The quota headers of a room creation the publish rate limit granted (`remaining` units left); none without a limit. */
  protected publishRateHeaders(remaining: number): Record<string, string> | undefined {
    return this.publishRateLimitMax > 0 ? {
      'X-RateLimit-Limit': String(this.publishRateLimitMax),
      'X-RateLimit-Remaining': String(remaining),
    } : undefined;
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

  /**
   * Parses a request body that must be a JSON object, after its leading byte order mark (see
   * `decodeUtf8Body`); an empty body, or one of whitespace only (`String#trim`'s), is `{}`.
   */
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
  protected clientTicketError(ticket: ClientSessionTicket | null, presented = true): { status: number; code: number; message: PeerErrorName } | null {
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
   * it, ends as `expired`. Each client socket of the ticket is taken out of the room and gets
   * `approval.expired`, after what it asked for before (see `closeAgentSocket`), then is closed; the
   * room's provider socket gets the same frame, so the host takes the request down instead of
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
      this.detachClientSocket(entry, clientSocket);
      this.replyToAgent(clientSocket, frame);
      this.closeAgentSocket(clientSocket);
    }
    this.tellProviderTicketEnded(entry, ticket, frame);
  }

  /**
   * Tells the room's provider socket that `ticket` ended in a room that stays live, with `frame` (a
   * rejection's decision echo, a revocation's `session.revoked`, an expired approval request's
   * `approval.expired`), and keeps the frame for every provider socket that attaches later (see
   * `replayClientApprovals`). The ticket's agent spent the room's one invite, so the room serves no
   * other agent: a provider that was away when the ticket ended, or lost the frame (it goes out with
   * `send` alone, like the relay's other frames to the provider), learns it when it attaches again
   * instead of offering an invitation nobody can redeem.
   */
  protected tellProviderTicketEnded(entry: RoomEntry, ticket: ClientSessionTicket, frame: Readonly<Record<string, unknown>>): void {
    this.ticketEndFrames.set(ticket, frame);
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
   * Replays the room's client state to a provider socket that just (re)attached: a ticket that
   * ended while the room stays live as the frame that told the provider so (see
   * `tellProviderTicketEnded`), and, in a room with approval, approved, unexpired tickets as
   * `approval.restored` and pending ones as their `approval.request`. Frames go out oldest end,
   * decision or request first, so a provider that keeps one approval slot ends in the state it
   * would have reached on the socket before. Rooms without approval (`approvalRequired: false`)
   * have nothing the provider decided, so only an ended ticket is replayed there. The frames follow
   * `ready` on a socket that has been sent nothing else, and a room has one ticket (its invite is
   * single-use), so they always fit its outbound queue.
   */
  protected replayClientApprovals(entry: RoomEntry): void {
    const now = Date.now();
    const replay: Array<{ ticket: ClientSessionTicket; at: number; ended?: Readonly<Record<string, unknown>> }> = [];
    for (const ticket of entry.clientTickets.values()) {
      const ended = this.ticketEndFrames.get(ticket);
      if (ended) {
        replay.push({ ticket, at: ticket.revokedAt ?? now, ended });
      } else if (!entry.approvalRequired) {
        continue;
      } else if (ticket.status === 'approved' && ticket.expiresAt > now) {
        replay.push({ ticket, at: ticket.approvedAt ?? ticket.issuedAt });
      } else if (ticket.status === 'pending') {
        const request = ticket.approvalRequestId ? entry.pendingApprovals.get(ticket.approvalRequestId) : undefined;
        replay.push({ ticket, at: request?.createdAt ?? now });
      }
    }
    replay.sort((left, right) => left.at - right.at);
    for (const { ticket, ended } of replay) {
      // A new message: the same frame, under a messageId of its own.
      if (ended) entry.providerSocket?.send({ ...ended, messageId: this.messageId(String(ended.type)) });
      else if (ticket.status === 'approved') this.sendApprovalRestored(entry, ticket);
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
   * expiry (`expired`; see `expireRoom`). Each client socket of the ticket is taken out of the room
   * and told why with the frame of `TICKET_END_FRAMES` (a rotation's names the replacement room),
   * its requests in flight get the same error an HTTP request of the room would (see
   * `ticketClosedRpcError`), and it is closed. All of it goes through the socket's outbox (see
   * `closeAgentSocket`): the replies already waiting for the agent, a result of a call that ran
   * included, go out first, then the frame, then the errors, then the close. The requests the ticket
   * authorized over HTTP end with the same error: they are bound to no socket of the ticket. One the
   * provider already took may still run there; its late answer is dropped.
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
      this.detachClientSocket(entry, socket);
      this.replyToAgent(socket, frame);
      this.failPendingForSocket(entry, socket, error);
      this.closeAgentSocket(socket);
    }
    for (const [key, pending] of entry.mcpPending) {
      if (pending.ticket === ticket) this.clearPending(entry, key, error);
    }
    if (status === 'revoked') this.tellProviderTicketEnded(entry, ticket, frame);
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
   * `reason`), whose echo is kept for the provider sockets that attach later (see
   * `tellProviderTicketEnded`). Sent with `send` alone, like the relay's other answers to the provider.
   */
  protected sendDecisionEcho(entry: RoomEntry, request: PendingApprovalRequest, ticket: ClientSessionTicket, reason?: string): void {
    const decision = ticket.status === 'approved' ? 'approved' : 'rejected';
    const type = decision === 'approved' ? 'approval.approved' : 'approval.rejected';
    const decidedAt = new Date((decision === 'approved' ? ticket.approvedAt : ticket.revokedAt) ?? Date.now()).toISOString();
    const times = this.decisionTimes(request, ticket);
    const echo = {
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
    };
    if (decision === 'rejected') this.tellProviderTicketEnded(entry, ticket, echo);
    else entry.providerSocket?.send(echo);
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
   * HTTP requests in flight get ROOM_EXPIRED too, and the provider socket is closed with 4002
   * ROOM_EXPIRED, which tells it why without a frame and keeps it from reconnecting. The room stays
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
    try { provider?.close(WEBMCP_CLOSE_CODES.ROOM_EXPIRED); } catch {}
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
    // A request addressed to a host the relay does not serve reaches nothing, a preflight included.
    const hostRefusal = this.hostRefusal(req);
    if (hostRefusal) {
      this.sendRefusal(res, hostRefusal, origin);
      return;
    }
    const url = new URL(req.url ?? '/', `http://${this.host}:${this.port}`);
    this.cleanupExpiredRooms();

    // Strict CORS preflight. A request without an Origin is no preflight, so it gets no
    // Access-Control-Allow-Origin.
    if (req.method === 'OPTIONS') {
      if (origin && !this.isOriginAllowed(origin)) {
        this.sendRefusal(res, originRefusal(origin), origin);
        return;
      }
      res.writeHead(204, {
        ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
        'Access-Control-Allow-Methods': BROWSER_ALLOWED_METHODS,
        'Access-Control-Allow-Headers': BROWSER_ALLOWED_REQUEST_HEADERS,
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      });
      res.end();
      return;
    }

    // Fail-Closed: Deny non-whitelisted browser origins on all HTTP endpoints
    if (origin && !this.isOriginAllowed(origin)) {
      this.sendRefusal(res, originRefusal(origin), origin);
      return;
    }

    // Health / Status. Live rooms and the expired or rotated ones the relay still retains (and
    // counts against maxRooms) are told apart.
    if (url.pathname === '/status' || url.pathname === '/health' || url.pathname === '/ping') {
      const now = Date.now();
      let activeRooms = 0;
      for (const entry of this.rooms.values()) if (this.isLiveRoom(entry, now)) activeRooms += 1;
      this.sendJson(res, 200, {
        status: 'healthy',
        activeRooms,
        retainedRooms: this.rooms.size - activeRooms,
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
      if (!publishRate.available || !publishRate.allowed) {
        this.sendPublishRateRefusal(res, publishRate, origin);
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
      // Checked last, after the body arrived, so concurrent creations cannot pass it together.
      const capacityRefusal = this.roomCapacityRefusal();
      if (capacityRefusal) {
        this.sendRefusal(res, capacityRefusal, origin);
        return;
      }
      const entry = this.createRoomEntry(alias, approvalRequired, ttlMs, 1, capabilities, ownerId);
      this.rooms.set(entry.id, entry);
      this.sendJson(res, 201, this.roomDescriptor(req, entry), origin, this.publishRateHeaders(publishRate.remaining));
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
    const deploymentCatalogHashMatch = url.pathname.match(DEPLOYMENT_CATALOG_HASH_ROUTE);
    if (req.method === 'GET' && (url.pathname === '/mcp/catalog' || deploymentCatalogHashMatch)) {
      const snapshot = this.mcpCatalogSnapshot(undefined);
      if (!snapshot.available) {
        this.sendLifecycleError(res, 503, 'CATALOG_UNAVAILABLE', origin, { catalogVersion: snapshot.catalogVersion, catalogHash: snapshot.catalogHash });
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
      // Its Allow names the endpoint's methods, as every 405 of the endpoint does.
      this.sendJson(res, 405, { jsonrpc: '2.0', id: null, error: peerRpcError('SSE_STREAM_NOT_SUPPORTED') }, origin, { Allow: MCP_ENDPOINT_METHODS });
      return;
    }
    if (req.method === 'DELETE' && mcpMatch) {
      // The relay issues no Mcp-Session-Id, so there is no session to terminate (Streamable HTTP: 405).
      this.sendJson(res, 405, { jsonrpc: '2.0', id: null, error: peerRpcError('SESSION_TERMINATION_NOT_SUPPORTED') }, origin, { Allow: MCP_ENDPOINT_METHODS });
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
        roomValid: this.isLiveRoom(entry, now),
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
        this.mcpDescriptorCacheHeaders(descriptor, snapshot.catalogVersion, snapshot.catalogHash, DESCRIPTOR_VARY), true);
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
        roomValid: this.isLiveRoom(entry),
        providerConnected: Boolean(entry?.providerSocket),
        auth: this.mcpAuthMetadata(entry, 'not-joined'),
      };
      // A room whose provider registered an empty catalog has one: 200 with `tools: []`.
      if (!snapshot.available) {
        this.sendLifecycleError(res, 503, 'CATALOG_UNAVAILABLE', origin, {
          catalogVersion: snapshot.catalogVersion, catalogHash: snapshot.catalogHash, auth: this.mcpAuthMetadata(entry, 'not-joined'),
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
      // MCP request ids must be a string or a number, and a message without one is a notification:
      // a null id, or an id on a method of the notification namespace, makes an invalid request.
      if (rpc.id === null) {
        this.sendJson(res, 400, { jsonrpc: '2.0', id: null, error: peerRpcError('INVALID_REQUEST') }, origin);
        return;
      }
      if (rpc.id !== undefined && isNotificationMethod(rpc.method)) {
        this.sendJson(res, 400, { jsonrpc: '2.0', id: rpc.id, error: peerRpcError('INVALID_REQUEST') }, origin);
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
      const metadataOnly = RELAY_METADATA_METHODS.has(rpc.method);
      const mcpTicket = entry ? this.resolveBearerClientTicket(entry, req.headers.authorization) : null;
      // Whether the request presented a client token at all: CLIENT_TOKEN_REQUIRED or _INVALID.
      const presentedToken = Boolean(this.bearerToken(req));
      // A pending ticket's approval request reaches each provider socket once (deliverApprovalRequest):
      // this only sends one the attached provider socket has not taken yet.
      if (entry && mcpTicket?.status === 'pending') this.sendApprovalRequest(entry, mcpTicket);
      const snapshot = this.mcpCatalogSnapshot(entry);
      const ticketStatus = mcpTicket?.status ?? 'not-joined';
      // Streamable HTTP answers every notification it accepts with 202 and an empty body, whatever
      // its method. One for a method the relay answers itself (`notifications/initialized`, or an
      // `initialize`, `ping` or listing without an id) leaves the relay nothing to do.
      if (metadataOnly && rpc.id === undefined) {
        this.sendAccepted(res, origin, this.mcpPostMetadataHeaders(snapshot.catalogVersion, snapshot.catalogHash));
        return;
      }
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
      if (!snapshot.available && (rpc.method === 'tools/list' || rpc.method === 'server/discover')) {
        this.sendJson(res, 503, { jsonrpc: '2.0', id, error: peerRpcError('CATALOG_UNAVAILABLE', { catalogSource: this.deploymentCatalog.source }) }, origin);
        return;
      }
      if (metadataOnly) {
        // This endpoint has no server-to-client stream, so it never sends
        // notifications/tools/list_changed: catalog changes surface here as CATALOG_CHANGED errors.
        let result: Record<string, unknown> = {};
        if (rpc.method === 'initialize') {
          result = this.mcpInitializeResult(entry, roomId, this.negotiateProtocolVersion(rpc.params), snapshot, ticketStatus, 'http');
        } else if (rpc.method === 'server/discover') {
          result = this.mcpDiscoverResult(entry, roomId, this.negotiateProtocolVersion(rpc.params), snapshot, ticketStatus, false);
        } else if (rpc.method === 'tools/list') {
          result = this.mcpToolsListResult(entry, roomId, snapshot, ticketStatus);
        }
        this.sendJson(res, 200, { jsonrpc: '2.0', id, result }, origin,
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
      // The replacement is a new room, so a rotation spends a publish rate-limit unit as `POST /p`
      // does, from the bucket of the room's publisher at the caller's address: a provider that
      // rotates again and again fills the relay's rooms no faster than one that creates them. The
      // unit is spent before the body is read, so the checks after the body also cover the wait for
      // the rate-limit store.
      const publishRate = await this.consumePublishRateLimit(req, this.publisherTokenHash());
      if (!publishRate.available || !publishRate.allowed) {
        this.sendPublishRateRefusal(res, publishRate, origin);
        return;
      }
      const body = await this.readJsonBodyOrRespond(req, res, origin);
      if (!body || !rotatable(entry)) return;
      // The room was not rotated: a body naming another room or epoch is a binding error.
      if (!this.bodyNamesRoom(body, entry)) {
        this.sendLifecycleError(res, 409, 'ROOM_BINDING_INVALID', origin, { roomId, roomEpoch: entry.roomEpoch });
        return;
      }
      // The replacement is one more room (the rotated one is retained), so rotation is bounded
      // like creation, and a refused one leaves the room as it was.
      const capacityRefusal = this.roomCapacityRefusal();
      if (capacityRefusal) {
        this.sendRefusal(res, capacityRefusal, origin);
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
      }, origin, this.publishRateHeaders(publishRate.remaining));
      return;
    }

    // A route asked with a method it does not take is 405 with the methods it does; any other
    // path is no route of the relay.
    const allow = routeMethods(url.pathname);
    if (allow) {
      this.sendLifecycleError(res, 405, 'METHOD_NOT_ALLOWED', origin, undefined, { Allow: allow });
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
      // The host and the Origin are checked before anything else, the hook included, and refused
      // as an HTTP request is (HOST_NOT_ALLOWED, ORIGIN_NOT_ALLOWED).
      const hostRefusal = this.hostRefusal(req);
      if (hostRefusal) {
        this.refuseUpgrade(socket, hostRefusal);
        return;
      }
      const origin = req.headers.origin;
      if (origin && !this.isOriginAllowed(origin)) {
        this.refuseUpgrade(socket, originRefusal(origin));
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

      // Every refusal from here on is an HTTP response (RFC 6455 §4.2.2) that tells the peer why.
      // The opening handshake comes first, so a request that is not one costs no lookup of the path,
      // the room or the ticket.
      const handshakeRefusal = webSocketHandshakeRefusal(req);
      if (handshakeRefusal) {
        this.refuseUpgrade(socket, { status: handshakeRefusal.status, name: handshakeRefusal.error, headers: handshakeRefusal.headers });
        return;
      }
      // The relay speaks one subprotocol: a peer that does not offer it is refused rather than
      // answered with a value it offered that the relay does not speak (its ticket, say).
      const protocols = requestedSubprotocols(req);
      if (!protocols.includes(WEBMCP_SUBPROTOCOL)) {
        this.refuseUpgrade(socket, { status: 400, name: 'SUBPROTOCOL_REQUIRED' });
        return;
      }
      const ticket = protocols.find(value => value.startsWith('ticket.'))?.slice('ticket.'.length) ?? '';

      const providerMatch = url.pathname.match(PROVIDER_SOCKET_ROUTE);
      const clientMatch = url.pathname.match(CLIENT_SOCKET_ROUTE);

      if (providerMatch) {
        const roomId = providerMatch[1];
        const entry = this.rooms.get(roomId);
        if (!this.checkUpgradeRoom(socket, roomId, entry)) return;
        const tokenRefusal = this.providerTokenRefusal(entry, ticket);
        if (tokenRefusal) {
          this.refuseUpgrade(socket, tokenRefusal);
          return;
        }

        const peer = upgradeWebSocket(
          req,
          socket,
          head,
          (received) => {
            try {
              // Only the room's attached provider socket speaks for it: one the relay replaced,
              // detached or never attached is closed instead of acting on the room. A frame that
              // finds the room expired carries out its expiry, which closes this socket too.
              if (entry.providerSocket !== peer) {
                peer.close(WEBMCP_CLOSE_CODES.SUPERSEDED);
                return;
              }
              if (this.expireRoomIfDue(entry)) return;
              const msg = PeerFrameSchema.parse(JSON.parse(withoutByteOrderMark(received)));
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
              if (msg.type === 'mcp' && isRpcReplyMessage(msg.message)) {
                // A reply answers the one request whose id it carries, never every agent: one the
                // relay cannot match to a request it forwarded (a late one, or one whose id is null
                // or not a string or a number) is dropped.
                const rpc = msg.message;
                if (!this.isRpcResponse(rpc)) return;
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
              // A notification or a request to the agents goes to every agent the provider serves,
              // the sockets of an approved ticket, which did not ask for it: an agent that is behind
              // skips it. An `mcp` frame that carries no JSON-RPC message is dropped.
              if (msg.type === 'mcp') {
                if (isRpcCallMessage(msg.message)) this.broadcastToAgents(entry, msg, { approvedOnly: true });
                return;
              }
              // The answer to an offer goes to the socket that sent it.
              if (PROVIDER_SIGNALING_FRAME_TYPES.has(msg.type)) {
                this.deliverOfferOutcome(entry, msg);
                return;
              }
              // Anything else, a frame of the relay's own types included, is dropped: only the relay
              // tells an agent the state of its session.
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
          this.socketOptions,
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
        if (!this.checkUpgradeRoom(socket, roomId, entry)) return;
        const clientTicket = ticket ? this.resolveClientTicket(entry, ticket) : null;
        if (!this.checkUpgradeTicket(socket, clientTicket, ticket !== '')) return;

        const peer = upgradeWebSocket(
          req,
          socket,
          head,
          (received) => {
            try {
              // A socket the relay dropped from the room (revoked, replaced, never attached) is
              // closed instead of acting on it, once what waits for it has gone out (one whose
              // session ended is already closing so). A frame that finds the room expired carries
              // out its expiry, which tells this socket with `room.expired` and closes it.
              if (!entry.clientSockets.has(peer)) {
                this.closeAgentSocket(peer);
                return;
              }
              if (this.expireRoomIfDue(entry)) return;
              // The ticket expires with the room it was issued by (rotation leaves no socket).
              if (clientTicket.expiresAt <= Date.now()) {
                peer.close(WEBMCP_CLOSE_CODES.ROOM_EXPIRED);
                return;
              }
              const text = withoutByteOrderMark(received);
              const msg = PeerFrameSchema.parse(JSON.parse(text));
              if (msg.type === 'ping') {
                peer.send({ type: 'pong', timestamp: Date.now() });
                return;
              }
              if (msg.type === 'mcp') {
                const rpc = msg.message;
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
                // As over HTTP, and whatever the ticket's status: a null id is no id (MCP), so it
                // makes an invalid request, not a notification, and a notification method takes no
                // id. Neither is forwarded.
                if (rpc.id === null || (rpc.id !== undefined && isNotificationMethod(rpc.method))) {
                  this.sendPeerRpcError(peer, rpc.id, 'INVALID_REQUEST');
                  return;
                }
                const id = rpc.id;
                // The request limit, not the stamped envelope's size, decides what is forwarded,
                // so the same request is accepted or refused whatever its id and session id.
                if (exceedsRequestLimit(text, msg)) {
                  if (id !== undefined) this.sendRpcError(peer, id, REQUEST_TOO_LARGE_ERROR.code, REQUEST_TOO_LARGE_ERROR.message, REQUEST_TOO_LARGE_ERROR.data);
                  return;
                }
                // `ping` is the relay's to answer, for a ticket in any state, as over HTTP: what it
                // checks is the agent's connection, which ends at the relay.
                if (rpc.method === 'ping') {
                  if (id !== undefined) this.replyToAgent(peer, { type: 'mcp', message: { jsonrpc: '2.0', id, result: {} } });
                  return;
                }
                const ticketError = this.clientTicketError(clientTicket);
                if (ticketError) {
                  // Discovery is public: the relay answers the metadata requests of a ticket that
                  // is not approved, as its HTTP route does. Anything else gets the same error, with
                  // the same data, as an HTTP request of this ticket gets.
                  if (id !== undefined && this.answerAgentMetadata(entry, peer, clientTicket, rpc, id)) return;
                  this.sendRpcError(peer, id, ticketError.code, ticketError.message, this.clientTicketErrorData(entry, roomId, clientTicket));
                  return;
                }
                // What reaches the provider says who sent it in the relay's own words: whatever
                // `from` or `sessionId` the client put on its frame is replaced.
                const stamp = { from: 'client', sessionId: clientTicket.sessionId };
                if (id === undefined) {
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
              // Only approved clients relay signaling, and only the allow-listed types (an `ice`
              // frame among the rest: the protocol has no trickle ICE). The relay stamps the origin
              // and the authoritative sessionId, so a client cannot forge either.
              if (clientTicket.status !== 'approved' || !CLIENT_SIGNALING_FRAME_TYPES.has(msg.type)) return;
              this.forwardOffer(entry, peer, clientTicket, text, msg);
            } catch { /* malformed frames ignored */ }
          },
          () => {
            this.agentOutboxes.get(peer)?.discard();
            this.closingAgentSockets.delete(peer);
            this.detachClientSocket(entry, peer);
            this.failPendingForSocket(entry, peer);
          },
          this.socketOptions,
        );
        this.agentOutboxes.set(peer, new AgentOutbox(peer, socket));

        // A socket that is already closed when attached never reports its close: it is not
        // attached to the room.
        if (peer.send({ type: 'ready', role: 'client', roomId, roomEpoch: entry.roomEpoch, sessionId: clientTicket.sessionId, capabilities: [...clientTicket.capabilities], expiresAt: clientTicket.expiresAt, approval: clientTicket.status }) !== 'sent') {
          peer.close();
          return;
        }
        // At most MAX_CLIENT_SOCKETS_PER_TICKET per ticket: the oldest ones (in attach order) make
        // room, closed with 4001 SUPERSEDED and no frame: the session goes on, on the newer sockets,
        // so the agent must not reconnect the one it replaced.
        const ticketSockets = [...entry.clientSocketTickets].filter(([, bound]) => bound === clientTicket).map(([bound]) => bound);
        const excess = ticketSockets.length + 1 - MAX_CLIENT_SOCKETS_PER_TICKET;
        for (const stale of ticketSockets.slice(0, Math.max(0, excess))) {
          stale.close(WEBMCP_CLOSE_CODES.SUPERSEDED);
          this.detachClientSocket(entry, stale);
          this.failPendingForSocket(entry, stale);
        }
        entry.clientSockets.add(peer);
        entry.clientSocketTickets.set(peer, clientTicket);
        if (clientTicket.status === 'pending') this.sendApprovalRequest(entry, clientTicket, peer);
        return;
      }

      this.refuseUpgrade(socket, { status: 404, name: 'NOT_FOUND' });
    } catch {
      socket.destroy();
    }
  }
}

export function createWebMcpPeerServer(options?: WebMcpPeerServerOptions): WebMcpPeerServer {
  return new WebMcpPeerServer(options);
}
