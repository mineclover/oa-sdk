import { randomUUID } from "node:crypto";
import {
  isJsonObject,
  JsonObjectSchema,
  parseJsonObject,
  readResponseText,
} from "../config/json.js";
import { isReconnectableCloseCode } from "../config/close-codes.js";
import { PEER_RELAY_MAX_PENDING_REQUESTS } from "../config/limits.js";
import { WEBMCP_SUBPROTOCOL } from "../config/types.js";
import {
  extractCatalogVersion,
  hashTools,
  normalizeTools,
  stableStringify,
} from "./catalog-hash.js";
import {
  isCatalogChangedRpcError,
  PeerMcpCatalogChangedError,
  PeerMcpError,
  PeerMcpRpcError,
} from "./errors.js";
import {
  PeerMcpCallToolResultSchema,
  PeerMcpCatalogCacheSchema,
} from "./schemas.js";
import {
  asCatalogVersion,
  asNonEmptyString,
  assertWithinRelayIdLimit,
  createHttpTransport,
  createWebSocketTransport,
  normalizeServerUrl,
  parseRoomId,
  roomIdOption,
  websocketUrl,
} from "./transport.js";
import {
  DEFAULT_TIMEOUT_MS,
  PACKAGE_VERSION,
  PROTOCOL_VERSION,
  type PeerMcpCallOptions,
  type PeerMcpCallToolResult,
  type PeerMcpCatalogListener,
  type PeerMcpCatalogSnapshot,
  type PeerMcpListener,
  type PeerMcpRequestOptions,
  type PeerMcpRpcResponse,
  type PeerMcpSessionInfo,
  type PeerMcpSessionOptions,
  type PeerMcpSessionState,
  type PeerMcpStore,
  type PeerMcpTool,
  type PeerMcpTransport,
  type PeerMcpTransportCallbacks,
  type PeerMcpTransportClose,
  type PeerMcpTransportMessage,
} from "./types.js";

/** Closes `transport`, which the session no longer uses, dropping whatever its close throws or rejects with. */
function closeQuietly(transport: PeerMcpTransport): void {
  try {
    const closed = transport.close?.();
    if (closed !== undefined) void Promise.resolve(closed).catch(() => {});
  } catch {}
}

/**
 * The `onMessage` a session gives a caller's transport that has none (see
 * `PeerMcpSession.#connectImpl`), and where it delivers now. The transport keeps it after the session
 * that gave it is done with the transport, and every session handed that transport object (say, each
 * session of one `PeerMcpService({ transport })`) uses the same one: it delivers to the session
 * whose connect took the transport last (`holder`), and to nothing once that session has let go.
 */
interface SuppliedTransportRoute {
  readonly dispatch: (message: unknown) => void;
  holder: ((message: unknown) => void) | undefined;
}

/** The {@link SuppliedTransportRoute} of each transport that has one, by transport object. */
const suppliedTransportRoutes = new WeakMap<PeerMcpTransport, SuppliedTransportRoute>();

/** The {@link SuppliedTransportRoute} of `transport`, made on first use. */
function suppliedTransportRoute(transport: PeerMcpTransport): SuppliedTransportRoute {
  let route = suppliedTransportRoutes.get(transport);
  if (!route) {
    const created: SuppliedTransportRoute = { dispatch: (message) => created.holder?.(message), holder: undefined };
    suppliedTransportRoutes.set(transport, created);
    route = created;
  }
  return route;
}

/** The error `disconnect()` ends the requests and the connect it finds with. */
function sessionDisconnectedError(): PeerMcpError {
  return new PeerMcpError("Peer session disconnected", "SESSION_DISCONNECTED");
}

function readEnv(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

/**
 * True for a reply to one of this session's requests, as the relay tells one (R-MCP-002):
 * `jsonrpc: '2.0'`, a string or number id, and a `result` or `error` member. A message with a
 * `method` is a notification or a request of the provider's, never a reply, whatever its id; taking
 * it for one would end a request the relay still counts as in flight.
 */
function isRpcResponse(value: unknown): value is PeerMcpRpcResponse & { id: string | number } {
  if (!isJsonObject(value) || value.jsonrpc !== "2.0") return false;
  return (typeof value.id === "string" || typeof value.id === "number") && ("result" in value || "error" in value);
}

function unwrapMessage(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      return JsonObjectSchema.parse(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (isJsonObject(value)) {
    if ("data" in value && !value.jsonrpc && !value.type) {
      return unwrapMessage(value.data);
    }
    return value;
  }
  return undefined;
}

interface PendingRpcEntry {
  resolve: (value: PeerMcpRpcResponse) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

/** A request waiting for a relay-socket slot (see `PeerMcpSession.#takeSlot`). */
interface SlotWaiter {
  /** `String(id)` of the request. */
  key: string;
  grant: () => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * One connect's hold on a transport (see `PeerMcpSession.#connection`), from the start of the
 * connect until the next connect or `disconnect()` lets go of it.
 */
interface PeerMcpConnection {
  /**
   * Whether it uses the caller's own transport (`options.transport`), the one transport every
   * connect uses again, instead of one the session made for it.
   */
  readonly shared: boolean;
  /** True until it has its transport: while a factory makes it, or the caller's own transport's `connect` runs. */
  obtaining: boolean;
  /**
   * The transport it uses: the caller's own from the moment it asks that to connect, so that
   * `disconnect()` can close it meanwhile, and a transport the session made once it is made.
   */
  transport?: PeerMcpTransport;
  /**
   * Transports the session no longer uses, closed once this connection has its own unless that is
   * one of them (a factory may hand one out again): the last connection's, and one that a connect
   * `disconnect()` ended got while this connection was still getting its own. `disconnect()` closes
   * them with the connection's transport.
   */
  readonly replaced: Set<PeerMcpTransport>;
}

/**
 * The frames that end the session, with the PeerMcpError code each is reported as and the message
 * used when the frame has neither `reason` nor `message`. The relay ends a ticket with
 * `approval.rejected`, `session.revoked`, `room.rotated` or `room.expired`, and an expired approval
 * request with `approval.expired`.
 */
const TERMINAL_FRAMES: ReadonlyMap<string, { readonly code: string; readonly message: string }> = new Map([
  ["session.revoked", { code: "SESSION_REVOKED", message: "Peer session was revoked" }],
  ["collaboration.revoked", { code: "SESSION_REVOKED", message: "Peer session was revoked" }],
  ["room.rotated", { code: "ROOM_ROTATED", message: "Peer room was rotated" }],
  ["room.expired", { code: "ROOM_EXPIRED", message: "Peer room expired" }],
  ["approval.expired", { code: "APPROVAL_EXPIRED", message: "Peer approval request expired" }],
  ["collaboration.expired", { code: "SESSION_EXPIRED", message: "Peer session expired" }],
  ["approval.rejected", { code: "CLIENT_APPROVAL_DENIED", message: "Peer approval request was rejected" }],
]);

/** First delay before a retryable refusal (e.g. PROVIDER_BUSY) is retried. */
const RETRY_INITIAL_DELAY_MS = 100;
/** Longest delay between retries of a retryable refusal. */
const RETRY_MAX_DELAY_MS = 2_000;

/** True for a JSON-RPC error the relay marks retryable (`data.retryable: true`): nothing was forwarded. */
function isRetryableRpcError(error: unknown): boolean {
  if (!(error instanceof PeerMcpRpcError) || !isJsonObject(error.rpcError)) return false;
  const data = error.rpcError.data;
  return isJsonObject(data) && data.retryable === true;
}

/**
 * The least delay before a retry that a refusal asks for: the `retryAfterMs` the HTTP transport
 * reads from the response's `Retry-After` (the relay's 503 PROVIDER_BUSY sends 1 second), or 0.
 */
function requestedRetryDelayMs(error: unknown): number {
  const delay = error instanceof PeerMcpRpcError && isJsonObject(error.rpcError) ? error.rpcError.retryAfterMs : undefined;
  return typeof delay === "number" && Number.isFinite(delay) && delay > 0 ? delay : 0;
}

export class PeerMcpSession {
  serverUrl: string;
  roomId?: string;
  wsUrl?: string;
  mcpEndpoint?: string;
  clientToken?: string;
  peerAlias?: string;
  requestTimeoutMs: number;
  protocolVersion: string;
  WebSocketImpl: unknown;
  transportFactory?: PeerMcpSessionOptions["transportFactory"];
  transport?: PeerMcpTransport;
  fetchImpl?: typeof fetch;
  state: PeerMcpSessionState;
  sessionId?: string;
  roomEpoch?: number;
  runtimeEpoch: string;
  connectedAt: number | null;
  readySeen: boolean;
  error: string | null;
  nextRequestId: number;
  pending: Map<string, PendingRpcEntry>;
  connectPromise: Promise<PeerMcpSessionInfo> | null;
  readyPromise: Promise<void> | null;
  catalog: {
    cachedTools: PeerMcpTool[];
    catalogVersion: number | string;
    catalogHash: string;
    source: "peer";
    updatedAt: string | null;
  };
  listeners: Set<PeerMcpListener>;
  catalogListeners: Set<PeerMcpCatalogListener>;
  storage?: PeerMcpStore;
  #readyResolve?: () => void;
  #readyReject?: (error: unknown) => void;
  /**
   * True when `sessionId` names the relay's session for this client ticket: it came from the
   * caller (the `sessionId` returned by `joinPeerRoom`) or from the relay's WebSocket `ready` frame.
   * A session id the client invented for itself is not known to the relay.
   */
  #sessionBound: boolean;
  /**
   * The MCP revision the last successful `initialize` negotiated (its `result.protocolVersion`),
   * which the Streamable HTTP transport sends as `MCP-Protocol-Version` on every later request.
   * Cleared by `disconnect()`: a session that connects again starts uninitialized.
   */
  #negotiatedProtocolVersion: string | undefined;
  /**
   * The transport the caller gave (`options.transport`), the one transport every connect uses
   * again. Every other transport (the WebSocket, the Streamable HTTP one, a `transportFactory`'s) is
   * made anew for each connect, since a closed WebSocket cannot be opened again.
   */
  readonly #suppliedTransport: PeerMcpTransport | undefined;
  /**
   * The connection of the latest connect, until the next connect or `disconnect()` lets go of it
   * (see `#letGoOfTransport`). Only the callbacks given for it speak for the session, so a late event
   * of a transport let go of (its close, a `ready`, a frame that ends a session) neither ends nor
   * answers the connection after it, nor changes a session `disconnect()` left idle. That holds for
   * the caller's own transport too, which every connect hands callbacks of its own: what it reports
   * through an earlier connect's callbacks, such as a close event that arrives after `close()`
   * returned, speaks for nothing. The `onMessage` that transport keeps across connects and sessions
   * reaches the session through `#dispatchSuppliedMessage` instead.
   */
  #connection: PeerMcpConnection | undefined;
  /**
   * How the relay ended the session, when it ended it for good: the frame that ended it
   * (`TERMINAL_FRAMES`), or a close after which a peer must not connect again (TRANSPORT_CLOSED
   * with a code `isReconnectableCloseCode` refuses: 1000 after such a frame, 4001 for a socket
   * another one replaced, 4002, a code refusing a frame the session sent). A request then fails
   * with it instead of connecting again; only `connect()` (or `disconnect()`) starts over.
   */
  #ended: PeerMcpError | undefined;
  /**
   * How many times `disconnect()` has been called. A connect notes it when it is asked for, and a
   * disconnect() after that ends it (see `#connectImpl`), whether the connect was running or still
   * waiting for an earlier disconnect() to finish.
   */
  #disconnects = 0;
  /**
   * The `disconnect()` in progress, until it has closed the transports and set the state to `idle`.
   * A connect asked for meanwhile starts once it has finished (see `connect()`).
   */
  #disconnecting: Promise<PeerMcpSessionInfo> | undefined;
  /**
   * Where the `onMessage` of the caller's own transport delivers while this session holds it, when
   * the transport has no `onMessage` of its own (see {@link SuppliedTransportRoute}). The transport
   * keeps that `onMessage` across connects and sessions, so it belongs to no connect: through this it
   * delivers for the connection that holds the transport now, this session's latest connect's, and
   * for nothing once `disconnect()` let go of it. It cannot tell an earlier connection's frame from
   * the current one's, so a transport that has `connect(callbacks)` should report through those
   * callbacks instead.
   */
  readonly #dispatchSuppliedMessage = (message: unknown): void => {
    if (this.#connection?.shared === true) this.#handleIncomingSafely(message);
  };

  constructor(options: PeerMcpSessionOptions = {}) {
    this.serverUrl = normalizeServerUrl(
      options.serverUrl ?? readEnv("FRAMEBOOK_PEER_URL") ?? readEnv("WEBMCP_PEER_URL"),
    );
    // A room id outside the protocol's grammar is refused here (ROOM_ID_INVALID): no relay route
    // would take it.
    this.roomId = roomIdOption(
      options.roomId ??
        options.descriptorUrl ??
        readEnv("FRAMEBOOK_PEER_ROOM_ID") ??
        readEnv("WEBMCP_PEER_ROOM_ID") ??
        readEnv("FRAMEBOOK_PEER_DESCRIPTOR"),
    );
    this.wsUrl = asNonEmptyString(options.wsUrl);
    this.mcpEndpoint = asNonEmptyString(options.mcpEndpoint ?? readEnv("FRAMEBOOK_PEER_MCP_URL"));
    this.clientToken = asNonEmptyString(options.clientToken);
    this.peerAlias = asNonEmptyString(options.peerAlias ?? options.alias ?? readEnv("FRAMEBOOK_PEER_ALIAS"));
    this.requestTimeoutMs = Number.isFinite(options.requestTimeoutMs)
      ? Math.max(1, options.requestTimeoutMs!)
      : DEFAULT_TIMEOUT_MS;
    this.protocolVersion = options.protocolVersion ?? PROTOCOL_VERSION;
    this.WebSocketImpl = options.WebSocket ?? globalThis.WebSocket;
    this.transportFactory = options.transportFactory;
    this.#suppliedTransport = options.transport;
    this.transport = options.transport;
    this.fetchImpl = options.fetchImpl;
    this.state = "idle";
    this.sessionId = asNonEmptyString(options.sessionId);
    this.#sessionBound = this.sessionId !== undefined;
    this.roomEpoch = Number.isSafeInteger(options.roomEpoch) ? options.roomEpoch : undefined;
    this.runtimeEpoch = asNonEmptyString(options.runtimeEpoch) || randomUUID();
    this.connectedAt = null;
    this.readySeen = false;
    this.error = null;
    this.nextRequestId = 0;
    this.pending = new Map();
    this.connectPromise = null;
    this.readyPromise = null;
    this.catalog = {
      cachedTools: [],
      catalogVersion: 0,
      catalogHash: hashTools([]),
      source: "peer",
      updatedAt: null,
    };
    this.listeners = new Set();
    this.catalogListeners = new Set();
    this.storage = options.storage;
    if (this.storage) this.restoreCatalog();
  }

  get sessionState(): PeerMcpSessionState {
    return this.state;
  }

  get cachedTools(): PeerMcpTool[] {
    return this.getCachedTools();
  }

  get catalogVersion(): number | string {
    return this.catalog.catalogVersion;
  }

  get catalogHash(): string {
    return this.catalog.catalogHash;
  }

  getCachedTools(): PeerMcpTool[] {
    return this.catalog.cachedTools.map((tool) => ({ ...tool }));
  }

  getCatalogSnapshot(): PeerMcpCatalogSnapshot {
    return {
      ...this.catalog,
      cachedTools: this.getCachedTools(),
      sessionId: this.sessionId,
      runtimeEpoch: this.runtimeEpoch,
      roomId: this.roomId ?? null,
      roomEpoch: this.roomEpoch ?? null,
      serverUrl: this.serverUrl,
      wsUrl: this.wsUrl ?? (this.roomId ? websocketUrl(this.serverUrl, this.roomId) : null),
      mcpEndpoint: this.mcpEndpoint ?? null,
      state: this.state,
    };
  }

  getSessionInfo(): PeerMcpSessionInfo {
    return {
      sessionId: this.sessionId,
      runtimeEpoch: this.runtimeEpoch,
      state: this.state,
      serverUrl: this.serverUrl,
      wsUrl: this.wsUrl ?? (this.roomId ? websocketUrl(this.serverUrl, this.roomId) : null),
      mcpEndpoint: this.mcpEndpoint ?? null,
      roomId: this.roomId ?? null,
      roomEpoch: this.roomEpoch ?? null,
      peerAlias: this.peerAlias ?? null,
      connectedAt: this.connectedAt,
      error: this.error,
      catalogVersion: this.catalog.catalogVersion,
      catalogHash: this.catalog.catalogHash,
      toolsCount: this.catalog.cachedTools.length,
    };
  }

  subscribe(listener: PeerMcpListener): () => void {
    if (typeof listener !== "function") return () => {};
    this.listeners.add(listener);
    listener(this.getSessionInfo());
    return () => this.listeners.delete(listener);
  }

  onCatalogChanged(listener: PeerMcpCatalogListener): () => void {
    if (typeof listener !== "function") return () => {};
    this.catalogListeners.add(listener);
    return () => this.catalogListeners.delete(listener);
  }

  notify(): void {
    const snapshot = this.getSessionInfo();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {}
    }
  }

  restoreCatalog(): void {
    try {
      if (typeof this.storage?.load !== "function") return;
      const value = PeerMcpCatalogCacheSchema.parse(this.storage.load());
      // The hash is always recomputed: a cache cannot vouch for a catalog it did not hash correctly.
      this.catalog = {
        cachedTools: value.cachedTools,
        catalogVersion: value.catalogVersion,
        catalogHash: hashTools(value.cachedTools),
        source: "peer",
        updatedAt: value.updatedAt,
      };
    } catch {
      // A stale cache must never prevent a fresh peer session from connecting.
    }
  }

  persistCatalog(): void {
    try {
      if (typeof this.storage?.save === "function") {
        this.storage.save({
          cachedTools: this.catalog.cachedTools,
          catalogVersion: this.catalog.catalogVersion,
          catalogHash: this.catalog.catalogHash,
          updatedAt: this.catalog.updatedAt,
        });
      }
    } catch {}
  }

  /**
   * Connects the transport and waits for the peer's `ready` frame. Concurrent callers (including
   * `request()` calls made while a connect is in flight) share one connect attempt. Each connect
   * opens a new transport, unless the caller gave its own (see `#suppliedTransport`). It connects a
   * session the relay ended for good too, which `request()` does not (see `#ended`).
   *
   * A connect asked for while `disconnect()` runs starts once that has closed the transports and
   * set the state to `idle`, as it would after an awaited disconnect(), so the transport it opens is
   * the only one. A disconnect() asked for after it ends it with SESSION_DISCONNECTED (see
   * `#connectImpl`).
   */
  async connect(): Promise<PeerMcpSessionInfo> {
    if (this.state === "connected") return this.getSessionInfo();
    if (this.connectPromise) return this.connectPromise;
    if (!this.roomId && !this.wsUrl && !this.mcpEndpoint && !this.#suppliedTransport && !this.transportFactory) {
      throw new PeerMcpError("A peer roomId, wsUrl, mcpEndpoint, or transport is required", "ROOM_ID_REQUIRED");
    }
    // Publish the in-flight promise before the connect starts: transports deliver `ready` (and
    // listeners run) synchronously inside #connectImpl, and a request issued from there must join
    // this attempt instead of starting a second one.
    let settle!: { resolve: (info: PeerMcpSessionInfo) => void; reject: (error: unknown) => void };
    const attempt = new Promise<PeerMcpSessionInfo>((resolve, reject) => {
      settle = { resolve, reject };
    });
    this.connectPromise = attempt;
    const disconnects = this.#disconnects;
    const disconnecting = this.#disconnecting;
    (disconnecting ? disconnecting.then(() => this.#connectImpl(disconnects)) : this.#connectImpl(disconnects))
      .then(settle.resolve, settle.reject)
      .finally(() => {
        if (this.connectPromise === attempt) this.connectPromise = null;
      });
    return attempt;
  }

  /**
   * One connect attempt, asked for when `disconnect()` had been called `disconnects` times. A
   * disconnect() since then ends it with SESSION_DISCONNECTED and leaves the session as disconnect()
   * sets it: an attempt that had not started does not start, one waiting for `ready` ends at once,
   * and one that was getting its transport closes the transport it gets, which disconnect() could
   * not close, unless the connection the session holds by then uses it (see `#closeUnlessInUse`).
   */
  async #connectImpl(disconnects: number): Promise<PeerMcpSessionInfo> {
    if (this.#disconnects !== disconnects) throw sessionDisconnectedError();
    this.state = "connecting";
    this.error = null;
    this.readySeen = false;
    // A new connection: neither the time the last one opened, which would let `#waitForReady` take
    // a socket that never opened for an open one, nor how it ended speaks for it.
    this.connectedAt = null;
    this.#ended = undefined;
    const shared = !this.transportFactory && this.#suppliedTransport !== undefined;
    const previous = this.#letGoOfTransport();
    const connection: PeerMcpConnection = {
      shared,
      obtaining: true,
      // The caller's own transport is the one this connect uses again: it replaces nothing.
      transport: shared ? this.#suppliedTransport : undefined,
      replaced: shared ? new Set() : previous,
    };
    this.#connection = connection;
    this.notify();
    // Only while this is the session's connection: a transport used again (the caller's own) speaks
    // for this connect through these callbacks, and for a later one through that connect's.
    const speaks = (): boolean => this.#connection === connection;
    try {
      const url = (this.wsUrl || (this.roomId ? websocketUrl(this.serverUrl, this.roomId) : this.mcpEndpoint)) ?? "";
      const protocols: string[] = [WEBMCP_SUBPROTOCOL];
      if (this.clientToken) protocols.push(`ticket.${this.clientToken}`);
      const callbacks: PeerMcpTransportCallbacks = {
        onOpen: () => {
          if (speaks()) this.#markOpen();
        },
        onMessage: (message) => {
          if (speaks()) this.#handleIncomingSafely(message);
        },
        onClose: (close) => {
          if (speaks()) this.#handleClose(close);
        },
        onError: (error) => {
          if (speaks()) this.#handleTransportError(error);
        },
      };
      let transport: PeerMcpTransport | undefined;
      try {
        if (this.transportFactory) {
          transport = await this.transportFactory(url, protocols, callbacks);
        } else if (this.#suppliedTransport) {
          transport = this.#suppliedTransport;
          if (typeof transport.connect === "function") {
            const connected = await transport.connect(callbacks);
            if (connected && typeof connected === "object") transport = { ...transport, ...connected };
          }
          // The transport's, not this connect's or this session's: the transport keeps it for the
          // connects after this one, of this session or of another handed the same transport, and
          // it delivers for the latest of them. An `onMessage` of the caller's own stays.
          const route = suppliedTransportRoute(transport);
          if (!transport.onMessage || transport.onMessage === route.dispatch) {
            transport.onMessage = route.dispatch;
            route.holder = this.#dispatchSuppliedMessage;
          }
        } else if (this.mcpEndpoint) {
          transport = createHttpTransport(this.mcpEndpoint, this.fetchImpl ?? globalThis.fetch, callbacks, {
            clientToken: this.clientToken,
            protocolVersion: () => this.#negotiatedProtocolVersion,
          });
        } else {
          transport = createWebSocketTransport(url, protocols, this.WebSocketImpl, callbacks);
        }
      } finally {
        this.#settleTransport(connection, transport);
      }
      if (this.#disconnects !== disconnects) throw sessionDisconnectedError();
      if (!transport || typeof transport.send !== "function") {
        throw new PeerMcpError("Peer transport must provide send(value)", "INVALID_TRANSPORT");
      }
      this.transport = transport;
      if (transport.readyState === "open" || transport.open === true || transport.connected === true) {
        this.#markOpen();
      }
      await this.#waitForReady();
      // disconnect() may run between the `ready` that settled the wait and this continuation.
      if (this.#disconnects !== disconnects) throw sessionDisconnectedError();
      this.state = "connected";
      this.connectedAt = this.connectedAt || Date.now();
      this.sessionId = this.sessionId || `peer-session-${randomUUID()}`;
      this.runtimeEpoch = this.runtimeEpoch || randomUUID();
      this.notify();
      return this.getSessionInfo();
    } catch (error) {
      // Ended by disconnect(), which has already ended the requests and owns the state.
      if (this.#disconnects !== disconnects) throw sessionDisconnectedError();
      this.state = "error";
      this.error = error instanceof Error ? error.message : String(error);
      this.#rejectPending(error);
      this.notify();
      throw error;
    }
  }

  /**
   * Lets go of the session's connection: the callbacks given for it stop speaking for the session
   * (see `#connection`), and the transports it held, its own and those it was replacing, are
   * returned for the caller to close or to have the next connection replace.
   */
  #letGoOfTransport(): Set<PeerMcpTransport> {
    const connection = this.#connection;
    this.#connection = undefined;
    this.transport = undefined;
    const held = new Set<PeerMcpTransport>();
    if (!connection) return held;
    if (connection.transport) held.add(connection.transport);
    // The caller's transport's dispatcher delivers to no session until a connect takes it again.
    const route = connection.shared && connection.transport ? suppliedTransportRoutes.get(connection.transport) : undefined;
    if (route?.holder === this.#dispatchSuppliedMessage) route.holder = undefined;
    for (const replaced of connection.replaced) held.add(replaced);
    connection.replaced.clear();
    return held;
  }

  /**
   * Called once `connection` has got its transport (`transport`, undefined when getting it failed).
   * A connection the session still holds closes the transports it replaced, except the one it got
   * (a factory may hand the last one out again). One that `disconnect()` let go of meanwhile, which
   * closed what it replaced, has its transport closed unless the session's connection uses it.
   */
  #settleTransport(connection: PeerMcpConnection, transport: PeerMcpTransport | undefined): void {
    connection.obtaining = false;
    if (transport) connection.transport = transport;
    const replaced = [...connection.replaced];
    connection.replaced.clear();
    if (this.#connection === connection) {
      for (const unused of replaced) if (unused !== transport) closeQuietly(unused);
    } else if (transport) {
      this.#closeUnlessInUse(transport, connection.shared);
    }
  }

  /**
   * Closes `transport`, which a connect that `disconnect()` ended got after disconnect() let go of
   * it (so disconnect() could not close it, or closed it while its connect was still running),
   * unless the connection the session holds now uses it: the caller's own transport (`shared`),
   * which every connect uses again, or a transport a factory handed out again. While that connection
   * is still getting its transport, which may be this one, it closes this one once it has its own
   * (see `PeerMcpConnection.replaced`).
   */
  #closeUnlessInUse(transport: PeerMcpTransport, shared: boolean): void {
    const current = this.#connection;
    if (current && shared && current.shared) return;
    if (current && !current.shared && current.obtaining) {
      current.replaced.add(transport);
      return;
    }
    if (current?.transport === transport) return;
    closeQuietly(transport);
  }

  #markOpen(): void {
    if (this.connectedAt === null) this.connectedAt = Date.now();
  }

  #waitForReady(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    if (this.readySeen) return Promise.resolve();
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.connectedAt !== null) resolve();
        else reject(new PeerMcpError("Peer transport ready timeout", "TRANSPORT_TIMEOUT"));
      }, this.requestTimeoutMs);
      this.#readyResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      this.#readyReject = (error) => {
        clearTimeout(timer);
        reject(error);
      };
    }).finally(() => {
      this.readyPromise = null;
      this.#readyResolve = undefined;
      this.#readyReject = undefined;
    });
    return this.readyPromise;
  }

  /**
   * Transport callbacks run inside socket event handlers, where a throw would escape as an
   * uncaught exception and take the agent process down. A frame that cannot be handled is
   * dropped and recorded instead; the last validated catalog stays in effect.
   */
  #handleIncomingSafely(raw: unknown): void {
    try {
      this.#handleIncoming(raw);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.notify();
    }
  }

  #handleIncoming(raw: unknown): void {
    const value = unwrapMessage(raw);
    if (!value) return;
    if (value.type === "ready") {
      if (!this.roomId && typeof value.roomId === "string" && value.roomId.trim()) {
        this.roomId = value.roomId.trim();
      }
      if (typeof value.roomEpoch === "number" && Number.isSafeInteger(value.roomEpoch)) {
        this.roomEpoch = value.roomEpoch;
      }
      // The relay names the session its client ticket belongs to; that id (not one the client
      // invented) is what session-scoped routes such as revoke bind to.
      const readySessionId = asNonEmptyString(value.sessionId);
      if (readySessionId) {
        this.sessionId = readySessionId;
        this.#sessionBound = true;
      }
      this.#markOpen();
      this.readySeen = true;
      this.#readyResolve?.();
      this.notify();
      return;
    }
    if (value.type === "ping") {
      this.#sendUnawaited({ type: "pong", timestamp: Date.now() });
      return;
    }
    if (value.type === "pong") {
      return;
    }
    const terminal = typeof value.type === "string" ? TERMINAL_FRAMES.get(value.type) : undefined;
    if (terminal) {
      const msg = (typeof value.reason === "string" ? value.reason : undefined)
        || (typeof value.message === "string" ? value.message : undefined)
        || terminal.message;
      const error = new PeerMcpError(msg, terminal.code, value);
      this.state = "error";
      this.error = error.message;
      // The relay ended the session: a request fails with this instead of connecting again.
      this.#ended = error;
      this.#readyReject?.(error);
      this.#rejectPending(error);
      this.notify();
      return;
    }
    if (value.type === "register" && Array.isArray(value.tools)) {
      this.#replaceCatalog(value.tools, asCatalogVersion(value.catalogVersion), asNonEmptyString(value.catalogHash));
      return;
    }
    if (value.type === "catalogChanged" || value.type === "catalog.changed") {
      this.catalogListeners.forEach((listener) => {
        try {
          listener({ ...value, snapshot: this.getCatalogSnapshot() });
        } catch {}
      });
      return;
    }
    if (value.type === "error") {
      const msg = (typeof value.message === "string" ? value.message : undefined)
        || (typeof value.error === "string" ? value.error : undefined)
        || "Peer transport error";
      const code = typeof value.code === "string" ? value.code : "PEER_TRANSPORT_ERROR";
      const error = new PeerMcpError(msg, code, value);
      this.#readyReject?.(error);
      this.#rejectPending(error);
      return;
    }
    const rpc = value.type === "mcp" && value.message ? unwrapMessage(value.message) : value;
    if (rpc?.method === "notifications/tools/list_changed") {
      const params = isJsonObject(rpc.params) ? rpc.params : {};
      for (const listener of this.catalogListeners) {
        try {
          listener({ type: "catalogChanged", ...params, snapshot: this.getCatalogSnapshot() });
        } catch {}
      }
      return;
    }
    if (isRpcResponse(rpc)) {
      // The relay has answered, so it no longer counts the request, whether or not anyone still
      // waits for the answer.
      this.#releaseSlot(String(rpc.id));
      const pending = this.pending.get(String(rpc.id));
      if (!pending) return;
      this.pending.delete(String(rpc.id));
      clearTimeout(pending.timer);
      if (rpc.error) pending.reject(new PeerMcpRpcError(isJsonObject(rpc.error) ? rpc.error : undefined, rpc));
      else pending.resolve(rpc);
    }
  }

  /**
   * Sends a frame no call waits for (a pong). A transport's send may fail by throwing or, when it
   * is asynchronous (the HTTP transport, a custom transport or transportFactory), by rejecting;
   * either failure is dropped, as an unhandled rejection would by default terminate the agent
   * process. A transport that is really broken reports it through onError or onClose.
   */
  #sendUnawaited(message: PeerMcpTransportMessage): void {
    try {
      const sent = this.transport?.send?.(message);
      if (sent !== undefined) void Promise.resolve(sent).catch(() => {});
    } catch {}
  }

  #handleTransportError(error: unknown): void {
    const value = error instanceof Error ? error : new PeerMcpError("Peer transport error", "PEER_TRANSPORT_ERROR", error);
    this.error = value.message;
    this.#readyReject?.(value);
    this.#rejectPending(value);
    this.notify();
  }

  /**
   * The transport closed: every request waiting on it fails with TRANSPORT_CLOSED, whose details are
   * how it closed (`{code, reason}`) when the transport reports it. The session never reconnects on
   * its own. After a close a peer may retry (1001, 1006, 1013, or one that reports no code: a
   * connection lost without a close frame), the next request connects again, on a new socket.
   * After any other (see `isReconnectableCloseCode`, R-WS-030) requests fail with this error until
   * the caller calls `connect()`: a reconnect after 4001 would displace the socket that replaced
   * this one, and one after a refused frame would be refused again.
   */
  #handleClose(close?: PeerMcpTransportClose): void {
    if (this.state === "disconnecting" || this.state === "idle" || this.state === "error") return;
    this.state = "disconnected";
    this.connectedAt = null;
    this.readySeen = false;
    const details = typeof close?.code === "number" ? { code: close.code, reason: close.reason ?? "" } : undefined;
    const error = new PeerMcpError("Peer transport closed", "TRANSPORT_CLOSED", details);
    if (details && !isReconnectableCloseCode(details.code)) this.#ended = error;
    this.#readyReject?.(error);
    this.#rejectPending(error);
    this.notify();
  }

  /** Requests sleeping before a retry: not in `pending`, but ended by the same events. */
  readonly #retryWaits = new Set<{ timer: ReturnType<typeof setTimeout>; reject: (error: unknown) => void }>();
  /**
   * The ids of the requests holding a slot of the relay socket (see `#takeSlot`): sent and not yet
   * answered by the relay, including requests whose caller stopped waiting at their timeout.
   */
  readonly #heldSlots = new Set<string>();
  /** Requests waiting for a slot of the relay socket, oldest first. */
  readonly #slotWaiters: SlotWaiter[] = [];

  #rejectPending(error: unknown): void {
    // A request waiting for a slot ends with the same error; the requests holding one are ended
    // below, with the connection that counted them.
    for (const waiter of this.#slotWaiters.splice(0)) waiter.reject(error);
    this.#heldSlots.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    // A request waiting to retry ends with the same error instead of reconnecting the session.
    for (const wait of this.#retryWaits) {
      clearTimeout(wait.timer);
      wait.reject(error);
    }
    this.#retryWaits.clear();
  }

  /**
   * Takes a slot of the relay socket for request `id`, unless the transport is `raw` (the Streamable
   * HTTP one, which answers each request on its own POST, so the relay bounds nothing per socket).
   *
   * The relay refuses a request past PEER_RELAY_MAX_PENDING_REQUESTS in flight on one agent
   * WebSocket (TOO_MANY_PENDING_REQUESTS). It counts a request until it has answered it, which it
   * always does (with the provider's reply or its own error, at the latest when its own request
   * timeout passes), so a slot is held until the answer arrives: even after the caller stopped
   * waiting at a shorter timeout, the relay may still count the request. Past that many, a request
   * waits for a slot, behind every request already waiting, and is sent once an earlier one has been
   * answered. The wait counts toward its timeout (`timeoutMs`), which ends it with REQUEST_TIMEOUT
   * as for a request that was sent; whatever ends the pending requests (`disconnect()`, a transport
   * error or close) ends it too. Returns a promise only when the request has to wait.
   */
  #takeSlot(method: string, id: string | number, timeoutMs: number): Promise<void> | undefined {
    if (this.transport?.raw === true) return undefined;
    const key = String(id);
    if (this.#heldSlots.size < PEER_RELAY_MAX_PENDING_REQUESTS && this.#slotWaiters.length === 0) {
      this.#heldSlots.add(key);
      return undefined;
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: SlotWaiter = {
        key,
        grant: () => {
          clearTimeout(waiter.timer);
          this.#heldSlots.add(key);
          resolve();
        },
        reject: (error) => {
          clearTimeout(waiter.timer);
          reject(error);
        },
        timer: setTimeout(() => {
          const index = this.#slotWaiters.indexOf(waiter);
          if (index >= 0) this.#slotWaiters.splice(index, 1);
          reject(new PeerMcpError(`Peer MCP request timed out: ${method}`, "REQUEST_TIMEOUT", { method, id }));
        }, timeoutMs),
      };
      this.#slotWaiters.push(waiter);
    });
  }

  /**
   * Refuses request `id` (DUPLICATE_REQUEST_ID, nothing sent) while a request of this session under
   * the same `String(id)` is in flight: waiting for a slot, waiting for its answer, or holding a slot
   * after its caller stopped waiting. MCP forbids reusing a request id within a session, and the
   * session matches a reply to its request by `String(id)`: a second request under that key would
   * take the first one's answer and give back a slot the relay still counts for the other.
   */
  #assertIdNotInFlight(method: string, id: string | number): void {
    const key = String(id);
    if (this.pending.has(key) || this.#heldSlots.has(key) || this.#slotWaiters.some((waiter) => waiter.key === key)) {
      throw new PeerMcpError(`Peer MCP request id ${JSON.stringify(id)} is already in flight`, "DUPLICATE_REQUEST_ID", { method, id });
    }
  }

  /** Gives back the slot request `key` holds, if any, and lets the oldest waiting requests take the free ones. */
  #releaseSlot(key: string): void {
    if (!this.#heldSlots.delete(key)) return;
    while (this.#heldSlots.size < PEER_RELAY_MAX_PENDING_REQUESTS && this.#slotWaiters.length > 0) {
      this.#slotWaiters.shift()!.grant();
    }
  }

  #waitBeforeRetry(delayMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const wait = {
        timer: setTimeout(() => {
          this.#retryWaits.delete(wait);
          resolve();
        }, delayMs),
        reject,
      };
      this.#retryWaits.add(wait);
    });
  }

  /**
   * Sends one JSON-RPC request and resolves with its response.
   *
   * Over a relay socket at most PEER_RELAY_MAX_PENDING_REQUESTS requests are in flight at once, the
   * relay's limit per agent WebSocket: a request past them waits, in order, until an earlier one has
   * been answered, within its own timeout (see `#takeSlot`). Its id must be at most
   * `PEER_RELAY_MAX_REQUEST_ID_BYTES` of JSON there (REQUEST_ID_TOO_LARGE), since the relay answers a
   * longer one without it. On any transport an id the session's request in flight has (as
   * `String(id)`, so `1` and `"1"` are one id here) is refused with DUPLICATE_REQUEST_ID, unsent (see
   * `#assertIdNotInFlight`).
   *
   * A request the relay refuses as retryable (`data.retryable: true`, e.g. PROVIDER_BUSY while the
   * provider is not reading) reached nobody, so it is sent again with exponential backoff
   * ({@link RETRY_INITIAL_DELAY_MS} doubling up to {@link RETRY_MAX_DELAY_MS}) for as long as the
   * request's own timeout allows; the last refusal is then reported. A refusal that asks for a
   * longer wait (an HTTP `Retry-After`, see `requestedRetryDelayMs`) is waited out instead.
   */
  async request(
    method: string,
    params: Record<string, unknown> = {},
    options: PeerMcpRequestOptions = {},
  ): Promise<PeerMcpRpcResponse> {
    const id = options.id ?? `${this.sessionId || "peer"}-${++this.nextRequestId}`;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, options.timeoutMs!) : this.requestTimeoutMs;
    const deadline = Date.now() + timeoutMs;
    let delayMs = RETRY_INITIAL_DELAY_MS;
    for (;;) {
      try {
        return await this.#requestOnce(method, params, options, id, Math.max(1, deadline - Date.now()));
      } catch (error) {
        if (!isRetryableRpcError(error)) throw error;
        const waitMs = Math.max(delayMs, requestedRetryDelayMs(error));
        if (deadline - Date.now() <= waitMs) throw error;
        // disconnect(), a transport error or close rejects this wait like a pending request.
        await this.#waitBeforeRetry(waitMs);
        delayMs = Math.min(delayMs * 2, RETRY_MAX_DELAY_MS);
      }
    }
  }

  async #requestOnce(
    method: string,
    params: Record<string, unknown>,
    options: PeerMcpRequestOptions,
    id: string | number,
    timeoutMs: number,
  ): Promise<PeerMcpRpcResponse> {
    // A request made while a connect is in flight waits for that connect (connect() returns the
    // in-flight attempt) instead of writing to a transport that is not open yet. A session the
    // relay ended for good fails as it ended instead of connecting again (see `#ended`).
    if (this.state !== "connected") {
      const ended = this.#ended;
      if (ended) throw new PeerMcpError(ended.message, ended.code, ended.details);
      await this.connect();
    }
    if (!this.transport || typeof this.transport.send !== "function") {
      throw new PeerMcpError("Peer transport is not connected", "NOT_CONNECTED");
    }
    const deadline = Date.now() + timeoutMs;
    if (this.transport.raw !== true) assertWithinRelayIdLimit(id);
    this.#assertIdNotInFlight(method, id);
    const waitForSlot = this.#takeSlot(method, id, timeoutMs);
    if (waitForSlot) {
      await waitForSlot;
      if (!this.transport || typeof this.transport.send !== "function") {
        this.#releaseSlot(String(id));
        throw new PeerMcpError("Peer transport is not connected", "NOT_CONNECTED");
      }
    }
    const transport = this.transport;
    const rpc = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise<PeerMcpRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new PeerMcpError(`Peer MCP request timed out: ${method}`, "REQUEST_TIMEOUT", { method, id }));
      }, Math.max(1, deadline - Date.now()));
      this.pending.set(String(id), { resolve, reject, timer, method });
    });
    // The caller only gets this promise once the send below has finished, which for the HTTP
    // transport is the whole POST. A timeout, disconnect() or transport error rejects the pending
    // entry meanwhile, and without a handler that rejection would be reported as unhandled (by
    // default fatal to the agent process). This marks it handled; the promise returned below still
    // rejects for the caller.
    promise.catch(() => {});
    try {
      const envelope: PeerMcpTransportMessage =
        options.raw === true || transport.raw === true ? rpc : { type: "mcp", message: rpc };
      await transport.send(envelope);
    } catch (error) {
      // Nothing reached the relay, so it does not count the request.
      this.#releaseSlot(String(id));
      const pending = this.pending.get(String(id));
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(String(id));
        pending.reject(error);
      }
    }
    return promise;
  }

  #initializeParams(): Record<string, unknown> {
    return {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: "framebook-cli", version: PACKAGE_VERSION },
    };
  }

  /**
   * Opens the MCP session: `initialize`, then the `notifications/initialized` that ends the
   * initialization (MCP lifecycle). From then on the Streamable HTTP transport names the negotiated
   * revision (`result.protocolVersion`) in the `MCP-Protocol-Version` of every request. Rejects
   * when the notification cannot be sent, since the initialization did not complete.
   */
  async initialize(): Promise<Record<string, unknown>> {
    const response = await this.request("initialize", this.#initializeParams());
    if (!isJsonObject(response.result)) {
      throw new PeerMcpError("Peer initialize response has no result object", "INVALID_RESPONSE", response);
    }
    this.#adoptRoomEpoch(response.result._meta);
    this.#negotiatedProtocolVersion = asNonEmptyString(response.result.protocolVersion);
    await this.#sendNotification("notifications/initialized");
    return response.result;
  }

  /** Sends the JSON-RPC notification `method`: a message without an id, which nothing answers. */
  async #sendNotification(method: string, params?: Record<string, unknown>): Promise<void> {
    const transport = this.transport;
    if (!transport || typeof transport.send !== "function") {
      throw new PeerMcpError("Peer transport is not connected", "NOT_CONNECTED");
    }
    const message = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
    await transport.send(transport.raw === true ? message : { type: "mcp", message });
  }

  /**
   * Adopts the relay's `roomEpoch` from response metadata. The Streamable HTTP transport has no
   * `ready` frame carrying it, and session-scoped routes (revoke) must echo the epoch.
   */
  #adoptRoomEpoch(meta: unknown): void {
    if (!isJsonObject(meta)) return;
    const roomId = this.roomId ?? parseRoomId(this.mcpEndpoint);
    if (typeof meta.roomId === "string" && roomId !== undefined && meta.roomId !== roomId) return;
    if (typeof meta.roomEpoch === "number" && Number.isSafeInteger(meta.roomEpoch) && meta.roomEpoch >= 0) {
      this.roomEpoch = meta.roomEpoch;
    }
  }

  async listTools(options: { cursor?: string } = {}): Promise<PeerMcpTool[]> {
    const response = await this.request("tools/list", {
      ...(options.cursor ? { cursor: options.cursor } : {}),
      _meta: {
        sessionId: this.sessionId,
        runtimeEpoch: this.runtimeEpoch,
        catalogVersion: this.catalog.catalogVersion,
        catalogHash: this.catalog.catalogHash,
      },
    });
    const tools = normalizeTools(response);
    const result = isJsonObject(response.result) ? response.result : {};
    const metadata = isJsonObject(result._meta) ? result._meta : isJsonObject(response._meta) ? response._meta : {};
    this.#adoptRoomEpoch(metadata);
    this.#replaceCatalog(
      tools,
      asCatalogVersion(result.catalogVersion ?? metadata.catalogVersion),
      asNonEmptyString(result.catalogHash ?? metadata.catalogHash),
    );
    return this.getCachedTools();
  }

  async refreshCatalog(options: { cursor?: string } = {}): Promise<PeerMcpTool[]> {
    return this.listTools(options);
  }

  async refresh(options: { cursor?: string } = {}): Promise<PeerMcpTool[]> {
    return this.refreshCatalog(options);
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    options: PeerMcpCallOptions = {},
  ): Promise<PeerMcpCallToolResult> {
    const toolName = asNonEmptyString(name);
    if (!toolName) throw new PeerMcpError("Tool name is required", "TOOL_NAME_REQUIRED");
    if (!this.catalog.cachedTools.length && options.refresh !== false) await this.refreshCatalog();
    const tool = this.catalog.cachedTools.find((candidate) => candidate.name === toolName);
    if (!tool) {
      throw new PeerMcpError(`Tool is not present in cached peer catalog: ${toolName}`, "TOOL_NOT_FOUND", {
        name: toolName,
        catalog: this.getCatalogSnapshot(),
      });
    }
    const params = {
      name: toolName,
      arguments: args && typeof args === "object" ? args : {},
      _meta: {
        sessionId: this.sessionId,
        runtimeEpoch: this.runtimeEpoch,
        catalogVersion: this.catalog.catalogVersion,
        catalogHash: this.catalog.catalogHash,
      },
    };
    let response: PeerMcpRpcResponse;
    try {
      response = await this.request("tools/call", params, options);
    } catch (error) {
      if (error instanceof PeerMcpRpcError && isCatalogChangedRpcError(error.rpcError)) {
        await this.refreshCatalog();
        const changed = new PeerMcpCatalogChangedError(undefined, this.getCatalogSnapshot());
        if (options.retryOnCatalogChanged === true && options.readOnly === true) {
          return this.callTool(toolName, args, { ...options, refresh: false, retryOnCatalogChanged: false });
        }
        throw changed;
      }
      throw error;
    }
    try {
      return PeerMcpCallToolResultSchema.parse(response.result);
    } catch (error) {
      throw new PeerMcpError(
        `Peer tools/call returned an invalid result: ${error instanceof Error ? error.message : String(error)}`,
        "INVALID_TOOL_RESULT",
        response,
      );
    }
  }

  /**
   * Takes a catalog the relay listed or announced, after checking it against the catalog contract
   * (`normalizeTools`) and against the relay's `catalogHash`: the hash is computed again from the
   * tools, which the relay hashes with the same function, and a catalog whose hash differs is
   * refused with CATALOG_INTEGRITY_UNVERIFIED. Either refusal leaves the cached catalog in place, so
   * a call is never stamped with metadata that does not describe the catalog it was checked against.
   */
  #replaceCatalog(tools: unknown, version?: number | string, hash?: string): void {
    const normalized = normalizeTools({ result: { tools } });
    const nextHash = hashTools(normalized);
    const reportedHash = asNonEmptyString(hash);
    if (reportedHash !== undefined && reportedHash !== nextHash) {
      throw new PeerMcpError(
        `Peer catalog hash ${reportedHash} does not match its tools, which hash to ${nextHash}`,
        "CATALOG_INTEGRITY_UNVERIFIED",
        { catalogHash: reportedHash, computedHash: nextHash },
      );
    }
    const nextVersion =
      version ??
      extractCatalogVersion(
        { result: { tools, catalogVersion: version } },
        this.catalog.catalogVersion,
        this.catalog.catalogHash,
        nextHash,
      );
    const changed =
      nextHash !== this.catalog.catalogHash ||
      stableStringify(normalized) !== stableStringify(this.catalog.cachedTools);
    this.catalog = {
      cachedTools: normalized,
      catalogVersion: nextVersion,
      catalogHash: nextHash,
      source: "peer",
      updatedAt: new Date().toISOString(),
    };
    this.persistCatalog();
    if (changed) {
      const snapshot = this.getCatalogSnapshot();
      for (const listener of this.catalogListeners) {
        try {
          listener(snapshot);
        } catch {}
      }
    }
    this.notify();
  }

  /**
   * Ends the session: the requests waiting and a connect in flight fail with SESSION_DISCONNECTED,
   * the transports the session holds are closed (the caller's own one too, even while a connect is
   * still connecting it, and one a connect was replacing), and the state is `idle` once they are.
   * Nothing a transport reports through the callbacks of a connect this ended speaks for the session,
   * while it closes or after the next connect (see `#connection`); what reaches the `onMessage` the
   * session gave the caller's own transport speaks for nothing until a connect holds that transport
   * again (see `#dispatchSuppliedMessage`). The session starts over: the next `connect()` or request
   * connects again, however the relay ended the session before.
   *
   * Calls made while it runs keep their order. A `connect()` or request starts its connect once the
   * transports are closed, as after an awaited disconnect(); another disconnect() ends such a connect
   * before it starts, and resolves when this one does. A connect this ended while it was getting its
   * transport closes that transport once it has it (see `#closeUnlessInUse`).
   */
  async disconnect(): Promise<PeerMcpSessionInfo> {
    const error = sessionDisconnectedError();
    this.#disconnects += 1;
    // The connect in flight is ended: a connect() from now on starts another.
    this.connectPromise = null;
    this.state = "disconnecting";
    // A connect waiting for `ready` ends now, not at its timeout, and leaves no wait for the next one.
    this.#readyReject?.(error);
    this.#rejectPending(error);
    // Let go of first, so nothing the transports report while they close speaks for the session.
    const transport = this.transport;
    const held = this.#letGoOfTransport();
    if (transport) held.add(transport);
    this.#negotiatedProtocolVersion = undefined;
    this.#ended = undefined;
    this.connectedAt = null;
    this.readySeen = false;
    // A disconnect in progress closes what the session held; a connect asked for since has not
    // started (see connect()), so this one only ended it, and resolves once the transports are closed.
    if (this.#disconnecting) return this.#disconnecting;
    const disconnecting = this.#closeTransports(held);
    this.#disconnecting = disconnecting;
    return disconnecting;
  }

  /** The rest of `disconnect()`: closes `transports`, then leaves the session `idle`. */
  async #closeTransports(transports: ReadonlySet<PeerMcpTransport>): Promise<PeerMcpSessionInfo> {
    await Promise.all(
      [...transports].map(async (transport) => {
        try {
          await transport.close?.();
        } catch {}
      }),
    );
    this.#disconnecting = undefined;
    this.state = "idle";
    const info = this.getSessionInfo();
    this.notify();
    return info;
  }

  /**
   * Revokes this client's ticket on the relay with one POST, then disconnects. The relay identifies
   * the ticket by the bearer `clientToken`. The body names what the session knows of the ticket's
   * room, which the relay checks against the room when it is sent and does not need otherwise
   * (R-ROOM-071), and, on the session-scoped route, its session id:
   * - `roomId` comes from the options, the WebSocket `ready` frame, or the `/p/:id/mcp` endpoint;
   * - `roomEpoch` comes from the options, the `ready` frame, or `initialize`/`tools/list` metadata,
   *   and is left out while none of those has supplied it;
   * - a session id the relay never issued (one the client invented for itself) is not sent; the
   *   bearer-only route `/p/:id/session/revoke` is used instead.
   */
  async revoke(reason = "client-request"): Promise<Record<string, unknown>> {
    if (!this.clientToken) {
      throw new PeerMcpError("A client ticket is required to revoke the peer session", "CLIENT_TOKEN_REQUIRED");
    }
    const fetchImpl = this.fetchImpl ?? globalThis.fetch;
    const roomId = this.roomId ?? parseRoomId(this.mcpEndpoint);
    const sessionId = this.#sessionBound ? this.sessionId : undefined;
    const sessionPath = sessionId ? `/sessions/${encodeURIComponent(sessionId)}` : "/session";
    const roomBase = this.mcpEndpoint
      ? this.mcpEndpoint.replace(/\/mcp\/?$/, "")
      : roomId
        ? `${this.serverUrl.replace(/\/+$/, "")}/p/${encodeURIComponent(roomId)}`
        : undefined;
    if (!roomBase || typeof fetchImpl !== "function") {
      throw new PeerMcpError("A server URL or MCP endpoint is required to revoke the peer session", "TRANSPORT_UNAVAILABLE");
    }
    const response = await fetchImpl(`${roomBase}${sessionPath}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.clientToken}` },
      body: JSON.stringify({
        ...(sessionId ? { sessionId } : {}),
        ...(roomId !== undefined ? { roomId } : {}),
        ...(this.roomEpoch !== undefined ? { roomEpoch: this.roomEpoch } : {}),
        reason,
        requestedAt: new Date().toISOString(),
      }),
    });
    const body = parseJsonObject(await readResponseText(response));
    if (!response.ok) {
      // The relay names the failure in `error`, as for every other lifecycle helper; its `code`
      // member is the numeric JSON-RPC class.
      const errStr = typeof body.error === "string" && body.error ? body.error : undefined;
      throw new PeerMcpError(errStr || `HTTP ${response.status}: peer session revoke failed`, errStr || "SESSION_REVOKE_FAILED", body);
    }
    await this.disconnect();
    return body;
  }
}

export function createPeerMcpSession(options: PeerMcpSessionOptions = {}): PeerMcpSession {
  return new PeerMcpSession(options);
}
