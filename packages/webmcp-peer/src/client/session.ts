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

/** Closes `transport`, dropping whatever its close throws or rejects with; resolves once the close has ended. */
async function closeQuietly(transport: PeerMcpTransport): Promise<void> {
  try {
    await transport.close?.();
  } catch {}
}

/**
 * One connect's connection: from the start of its connect until it ends (see
 * `PeerMcpSession.#endConnection`), when its connect fails, its transport closes, a frame ends its
 * session, `disconnect()` ends it or another connect takes its transport (see {@link transportOwners}).
 * Only a live connection acts for its session: what its transport reports once it has ended is
 * dropped, and the request ids and relay slots it held were given back when it ended.
 */
interface PeerMcpConnection {
  /** The session whose connect made it. */
  readonly session: PeerMcpSession;
  /**
   * The connect attempt that made it, which `connect()` hands out (`connectPromise`) only while the
   * connection is live: once it has ended, that attempt can only fail, so a `connect()` starts another.
   */
  readonly attempt: Promise<PeerMcpSessionInfo>;
  /** The callbacks its transport reports through, which act for the session only while it is live. */
  readonly callbacks: PeerMcpTransportCallbacks;
  /**
   * The transport object it holds (see {@link transportOwners}): the caller's own from the start of
   * its connect, any other once its connect has it.
   */
  key?: PeerMcpTransport;
  /** The transport it sends on: `key`, or what the caller's transport's `connect` merged into it. */
  transport?: PeerMcpTransport;
  /** The error it ended with; undefined while it is live. */
  ended?: { readonly error: unknown };
}

/**
 * The live connection that holds each transport object, of every session: a transport object is held
 * by one live connection at most. A connect takes the caller's own transport (`options.transport`) as
 * it starts and any other once it has it (see `PeerMcpSession.#take`), which ends the connection that
 * held it until then, of the same session or another, with TRANSPORT_SUPERSEDED. A connection that
 * ends closes its transport only while it still holds it, so no connection closes a transport another
 * one uses, and a connect that ended while it was getting its transport closes the one it gets unless
 * a live connection holds it by then.
 */
const transportOwners = new WeakMap<PeerMcpTransport, PeerMcpConnection>();

/**
 * The transports whose send is the whole exchange with the relay, so that the answer to a request
 * sent on one, if any, has arrived once its send has ended: each Streamable HTTP transport a session
 * makes, whose send is the POST (see `createHttpTransport`).
 */
const sendBringsAnswer = new WeakSet<PeerMcpTransport>();

/** The error `disconnect()` ends the connection, its requests and its connect with. */
function sessionDisconnectedError(): PeerMcpError {
  return new PeerMcpError("Peer session disconnected", "SESSION_DISCONNECTED");
}

/** The error a connection ends with when a connect, of its own session or another, takes its transport (see `PeerMcpSession.#take`). */
function transportSupersededError(): PeerMcpError {
  return new PeerMcpError("Peer transport was taken by another connection", "TRANSPORT_SUPERSEDED");
}

/** The error a request is refused with, unsent, under an id still in flight (see `PeerMcpSession.#requests`). */
function duplicateRequestIdError(method: string, id: string | number): PeerMcpError {
  return new PeerMcpError(`Peer MCP request id ${JSON.stringify(id)} is already in flight`, "DUPLICATE_REQUEST_ID", { method, id });
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

/**
 * A `request()` call's hold on its id (see `PeerMcpSession.#requests`): from the call until its
 * answer arrives or its connection ends, whichever comes first.
 */
interface RequestHold {
  /** True until the `request()` call settles. */
  running: boolean;
  /**
   * True from a send until its answer arrives, even after the caller stopped waiting at its timeout,
   * or the send fails. On a transport whose send brings the answer (see `sendBringsAnswer`), until
   * the send ends.
   */
  awaitingAnswer: boolean;
  /**
   * The error its connection's end ended it with (see `PeerMcpSession.#endRequests`), which gave back
   * its id and its slot: the call sends nothing more, and its send, if that still runs, touches
   * nothing a later request under the id holds once it ends.
   */
  ended?: { readonly error: unknown };
}

/** Throws the error `ended` (a request's hold or a connection) ended with, if it has ended. */
function throwIfEnded(ended: { readonly ended?: { readonly error: unknown } }): void {
  if (ended.ended) throw ended.ended.error;
}

/** A request waiting for a relay-socket slot (see `PeerMcpSession.#takeSlot`). */
interface SlotWaiter {
  grant: () => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
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
   * The connection of the latest connect, live or ended, until `disconnect()` lets go of it. A
   * session has one live connection at most: a connect starts only once the last connection has
   * ended.
   */
  #connection: PeerMcpConnection | undefined;
  /**
   * How the relay ended the session, when it ended it for good: the frame that ended it
   * (`TERMINAL_FRAMES`), a close after which a peer must not connect again (TRANSPORT_CLOSED
   * with a code `isReconnectableCloseCode` refuses: 1000 after such a frame, 4001 for a socket
   * another one replaced, 4002, a code refusing a frame the session sent), or a connect that took
   * the transport (TRANSPORT_SUPERSEDED, see `#take`). A request then fails with it instead of
   * connecting again, which would take the transport back; only `connect()` (or `disconnect()`)
   * starts over.
   */
  #ended: PeerMcpError | undefined;
  /**
   * How many times `disconnect()` has been called. A connect notes it when it is asked for, and a
   * disconnect() after that ends it (see `#connectImpl`), whether the connect was running or still
   * waiting for an earlier disconnect() to finish.
   */
  #disconnects = 0;
  /**
   * The `disconnect()` in progress, until it has closed the transport and set the state to `idle`.
   * A connect asked for meanwhile starts once it has finished (see `connect()`).
   */
  #disconnecting: Promise<PeerMcpSessionInfo> | undefined;

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
   * `request()` calls made while a connect is in flight) share one connect attempt, while its
   * connection is live: one whose connection has ended (see `#endConnection`) can only fail, so a
   * call made after that starts another. Each connect opens a new transport, unless the caller gave
   * its own (see `#suppliedTransport`). It connects a session the relay ended for good too, which
   * `request()` does not (see `#ended`).
   *
   * A connect asked for while `disconnect()` runs starts once that has closed the transport and
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
    const start = (): Promise<PeerMcpSessionInfo> => this.#connectImpl(disconnects, attempt);
    (disconnecting ? disconnecting.then(start) : start())
      .then(settle.resolve, settle.reject)
      .finally(() => {
        if (this.connectPromise === attempt) this.connectPromise = null;
      });
    return attempt;
  }

  /**
   * One connect attempt, `attempt`, asked for when `disconnect()` had been called `disconnects` times,
   * on a new connection (see {@link PeerMcpConnection}). Whatever ends that connection before the
   * attempt has connected it (a disconnect() since then, a frame or a close that ends the session,
   * another connect that takes its transport) fails the attempt with the error it ended with. Ended
   * before it gets its transport (by a listener, say, or by the session whose connection it took the
   * transport from, which takes it back), it does not get one. Ended while it gets one, which nothing
   * can cut short, it closes the transport it gets unless a live connection holds it by then (see
   * {@link transportOwners}). An attempt disconnect() ended leaves the session as disconnect() sets
   * it, and one a later connect has replaced leaves it to that connect; any other failure leaves it
   * `error`.
   */
  async #connectImpl(disconnects: number, attempt: Promise<PeerMcpSessionInfo>): Promise<PeerMcpSessionInfo> {
    if (this.#disconnects !== disconnects) throw sessionDisconnectedError();
    this.state = "connecting";
    this.error = null;
    this.readySeen = false;
    // A new connection: neither the time the last one opened, which would let `#waitForReady` take
    // a socket that never opened for an open one, nor how it ended speaks for it.
    this.connectedAt = null;
    this.#ended = undefined;
    this.transport = undefined;
    const live = (): boolean => connection.ended === undefined;
    const connection: PeerMcpConnection = {
      session: this,
      attempt,
      callbacks: {
        onOpen: () => {
          if (live()) this.#markOpen();
        },
        onMessage: (message) => {
          if (live()) this.#handleIncomingSafely(connection, message);
        },
        onClose: (close) => {
          if (live()) this.#handleClose(connection, close);
        },
        onError: (error) => {
          if (live()) this.#handleTransportError(error);
        },
      },
    };
    this.#connection = connection;
    const supplied = this.transportFactory ? undefined : this.#suppliedTransport;
    try {
      // The caller's own transport, which every connect uses again, is this connection's from now on.
      // The `onMessage` the session gives it when it has none is the transport's, not this connect's:
      // it delivers to whichever connection holds the transport, of any session handed it.
      if (supplied) {
        this.#take(connection, supplied);
        supplied.onMessage ??= (message) => transportOwners.get(supplied)?.callbacks.onMessage?.(message);
      }
      this.notify();
      // Taking the transport ended the connection that held it, and the listeners of that session or
      // of this one may have ended this connection meanwhile (a connect that took the transport back,
      // disconnect()): an ended connection gets no transport.
      throwIfEnded(connection);
      const transport = await this.#obtainTransport(supplied, connection.callbacks);
      // Ended meanwhile: the transport it got stays open only for a live connection that holds it.
      if (connection.ended && transport && !transportOwners.has(supplied ?? transport)) void closeQuietly(transport);
      throwIfEnded(connection);
      if (transport && !supplied) {
        this.#take(connection, transport);
        // As for the caller's own transport: taking it may have ended this connection.
        throwIfEnded(connection);
      }
      connection.transport = transport;
      if (!transport || typeof transport.send !== "function") {
        throw new PeerMcpError("Peer transport must provide send(value)", "INVALID_TRANSPORT");
      }
      this.transport = transport;
      if (transport.readyState === "open" || transport.open === true || transport.connected === true) {
        this.#markOpen();
      }
      await this.#waitForReady();
      // The connection may end between the `ready` that settled the wait and this continuation.
      throwIfEnded(connection);
      this.state = "connected";
      this.connectedAt = this.connectedAt || Date.now();
      this.sessionId = this.sessionId || `peer-session-${randomUUID()}`;
      this.runtimeEpoch = this.runtimeEpoch || randomUUID();
      this.notify();
      return this.getSessionInfo();
    } catch (caught) {
      // Ended by disconnect(), which has already ended the requests and owns the state.
      if (this.#disconnects !== disconnects) throw sessionDisconnectedError();
      // A connection that ended first fails its connect with the error it ended with.
      const error = connection.ended ? connection.ended.error : caught;
      // A connect started since this connection ended (see `#endConnection`) owns the state.
      if (this.#connection !== connection) throw error;
      this.state = "error";
      this.error = error instanceof Error ? error.message : String(error);
      this.#endConnection(connection, error);
      this.notify();
      throw error;
    }
  }

  /**
   * Gets a connect's transport, which reports through `callbacks`: the `transportFactory`'s, the
   * caller's own (`supplied`) once its `connect(callbacks)` has run, with what that resolves with
   * merged into it, or one the session makes (Streamable HTTP for an `mcpEndpoint`, else WebSocket).
   */
  async #obtainTransport(
    supplied: PeerMcpTransport | undefined,
    callbacks: PeerMcpTransportCallbacks,
  ): Promise<PeerMcpTransport | undefined> {
    const url = (this.wsUrl || (this.roomId ? websocketUrl(this.serverUrl, this.roomId) : this.mcpEndpoint)) ?? "";
    const protocols: string[] = [WEBMCP_SUBPROTOCOL];
    if (this.clientToken) protocols.push(`ticket.${this.clientToken}`);
    if (this.transportFactory) return this.transportFactory(url, protocols, callbacks);
    if (supplied) {
      const connected = typeof supplied.connect === "function" ? await supplied.connect(callbacks) : undefined;
      return connected && typeof connected === "object" ? { ...supplied, ...connected } : supplied;
    }
    if (this.mcpEndpoint) {
      const transport = createHttpTransport(this.mcpEndpoint, this.fetchImpl ?? globalThis.fetch, callbacks, {
        clientToken: this.clientToken,
        protocolVersion: () => this.#negotiatedProtocolVersion,
      });
      sendBringsAnswer.add(transport);
      return transport;
    }
    return createWebSocketTransport(url, protocols, this.WebSocketImpl, callbacks);
  }

  /**
   * Makes `connection` the live connection that holds `transport` (see {@link transportOwners}). The
   * connection that held it until now, of this session or another, ends at once (see `#supersede`)
   * and leaves the transport open for this one.
   */
  #take(connection: PeerMcpConnection, transport: PeerMcpTransport): void {
    const previous = transportOwners.get(transport);
    connection.key = transport;
    transportOwners.set(transport, connection);
    if (previous && previous !== connection) previous.session.#supersede(previous);
  }

  /**
   * Ends `connection`, whose transport another connect took (see `#take`), with TRANSPORT_SUPERSEDED:
   * the session leaves `connected` with that error, and its requests fail with it, without connecting
   * again to take the transport back, until the caller calls `connect()` (see `#ended`).
   */
  #supersede(connection: PeerMcpConnection): void {
    const error = transportSupersededError();
    this.state = "error";
    this.error = error.message;
    this.#ended = error;
    this.#endConnection(connection, error);
    this.notify();
  }

  /**
   * Ends `connection` with `error`, once (see {@link PeerMcpConnection}). Its connect attempt, if
   * `connect()` still hands it out, no longer is: a `connect()` from now on starts another, as after
   * `disconnect()`, while that attempt fails with `error`. While it is the session's connection, the
   * session no longer uses its transport, a connect waiting for its `ready` fails, and every request
   * of it ends at once, giving back its id and its slot (see `#endRequests`). It closes its transport
   * only while it still holds it (see {@link transportOwners}), and returns that close.
   */
  #endConnection(connection: PeerMcpConnection, error: unknown): Promise<void> | undefined {
    if (connection.ended) return undefined;
    connection.ended = { error };
    if (this.connectPromise === connection.attempt) this.connectPromise = null;
    if (this.#connection === connection) {
      this.transport = undefined;
      this.#readyReject?.(error);
      this.#endRequests(error);
    }
    const key = connection.key;
    if (!key || transportOwners.get(key) !== connection) return undefined;
    transportOwners.delete(key);
    return closeQuietly(connection.transport ?? key);
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
  #handleIncomingSafely(connection: PeerMcpConnection, raw: unknown): void {
    try {
      this.#handleIncoming(connection, raw);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.notify();
    }
  }

  #handleIncoming(connection: PeerMcpConnection, raw: unknown): void {
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
      this.#endConnection(connection, error);
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
      // The connection goes on: the requests sent on it keep their ids and slots (see `#rejectWaiting`).
      this.#readyReject?.(error);
      this.#rejectWaiting(error);
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
      // The relay has answered, so it no longer counts the request, and nothing more comes under its
      // id, whether or not anyone still waits for the answer.
      const key = String(rpc.id);
      this.#releaseSlot(key);
      this.#answered(key);
      const pending = this.pending.get(key);
      if (!pending) return;
      this.pending.delete(key);
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

  /**
   * The transport reported an error, which ends no connection: a transport whose connection it ends
   * reports that with its close (see `#handleClose`). The requests waiting fail with it, and keep their
   * ids and slots until their answers arrive or their sends end (see `#rejectWaiting`); a connect
   * still waiting for `ready` fails, which ends its connection.
   */
  #handleTransportError(error: unknown): void {
    const value = error instanceof Error ? error : new PeerMcpError("Peer transport error", "PEER_TRANSPORT_ERROR", error);
    this.error = value.message;
    this.#readyReject?.(value);
    this.#rejectWaiting(value);
    this.notify();
  }

  /**
   * `connection`'s transport closed, which ends it: every request of it fails with TRANSPORT_CLOSED,
   * whose details are how it closed (`{code, reason}`) when the transport reports it. The session never
   * reconnects on its own. After a close a peer may retry (1001, 1006, 1013, or one that reports no
   * code: a connection lost without a close frame), the next request connects again, on a new socket.
   * After any other (see `isReconnectableCloseCode`, R-WS-030) requests fail with this error until
   * the caller calls `connect()`: a reconnect after 4001 would displace the socket that replaced
   * this one, and one after a refused frame would be refused again.
   */
  #handleClose(connection: PeerMcpConnection, close?: PeerMcpTransportClose): void {
    this.state = "disconnected";
    this.connectedAt = null;
    this.readySeen = false;
    const details = typeof close?.code === "number" ? { code: close.code, reason: close.reason ?? "" } : undefined;
    const error = new PeerMcpError("Peer transport closed", "TRANSPORT_CLOSED", details);
    if (details && !isReconnectableCloseCode(details.code)) this.#ended = error;
    this.#endConnection(connection, error);
    this.notify();
  }

  /**
   * The ends of the requests waiting for a connect (see `#waitForConnect`) or to be sent again after a
   * retryable refusal (see `#waitBeforeRetry`): not in `pending`, but ended by the same events (see
   * `#rejectWaiting`), even while the connect they wait for still gets its transport.
   */
  readonly #waits = new Set<(error: unknown) => void>();
  /**
   * The hold of every request in flight, by `String(id)` (see {@link RequestHold}), one rule for every
   * transport: from its `request()` call until its answer arrives or its connection ends. That covers
   * waiting for a connect, for a slot, for its answer or to be sent again after a retryable refusal,
   * and being sent, and it lasts past the call when the caller stopped waiting at its timeout before
   * the answer came, or a transport error or `{type:'error'}` frame, which leaves the connection open,
   * rejected it (see `#rejectWaiting`). The built-in HTTP transport's send is the whole POST, which
   * brings the answer, so there the id is held until the POST ends. Every hold is of the session's
   * connection, or of the connect it waits for: when that connection ends, `#endRequests` gives back
   * every id at once.
   */
  readonly #requests = new Map<string, RequestHold>();
  /**
   * The ids of the requests holding a slot of the relay socket (see `#takeSlot`): sent on the
   * session's connection and not yet answered by the relay, including requests whose caller stopped
   * waiting at their timeout. The connection's end gives them all back.
   */
  readonly #heldSlots = new Set<string>();
  /** Requests waiting for a slot of the relay socket, oldest first. */
  readonly #slotWaiters: SlotWaiter[] = [];

  /**
   * Ends every request of the connection with `error`: what the connection's end does to them (see
   * `#endConnection`). Each gives back its id and its slot at once, since no answer of the ended
   * connection reaches the session, even while its send still runs, which nothing can cut short:
   * that send touches nothing of a request sent under the id since (see `RequestHold.ended`), and a
   * transport the next connection uses again does not deliver it there (see `PeerMcpTransport`).
   */
  #endRequests(error: unknown): void {
    for (const hold of this.#requests.values()) hold.ended = { error };
    this.#requests.clear();
    this.#heldSlots.clear();
    this.#rejectWaiting(error);
  }

  /**
   * Rejects with `error` every request waiting: for its answer, for a slot, to be sent again after a
   * retryable refusal, or for a connect. A transport error or a `{type:'error'}` frame does only this,
   * as it leaves the connection open: each request sent on it keeps its id and its slot until its
   * answer arrives or its send ends, as after its timeout (see `#requests`), since its send may still
   * run and its answer may still come there. The connection's end does it too (see `#endRequests`).
   */
  #rejectWaiting(error: unknown): void {
    // A request waiting for a slot ends with the same error; the requests holding one keep it.
    for (const waiter of this.#slotWaiters.splice(0)) waiter.reject(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    // So does a request waiting to retry, instead of reconnecting the session, or for a connect.
    for (const end of [...this.#waits]) end(error);
  }

  /**
   * Takes a slot of the relay socket for request `id`, unless `transport` is raw (the Streamable
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
  #takeSlot(transport: PeerMcpTransport, method: string, id: string | number, timeoutMs: number): Promise<void> | undefined {
    if (transport.raw === true) return undefined;
    const key = String(id);
    if (this.#heldSlots.size < PEER_RELAY_MAX_PENDING_REQUESTS && this.#slotWaiters.length === 0) {
      this.#heldSlots.add(key);
      return undefined;
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: SlotWaiter = {
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
   * Notes that the answer under `key` arrived: its request's id is in flight no longer, once its call
   * has settled.
   */
  #answered(key: string): void {
    const hold = this.#requests.get(key);
    if (!hold) return;
    hold.awaitingAnswer = false;
    this.#letGoOfId(key, hold);
  }

  /**
   * Gives back `key`, which `hold` took, once nothing keeps it in flight: its call has settled and no
   * answer is awaited. A hold whose connection ended gave it back already, and leaves alone a later
   * request's hold under it.
   */
  #letGoOfId(key: string, hold: RequestHold): void {
    if (!hold.running && !hold.awaitingAnswer && this.#requests.get(key) === hold) this.#requests.delete(key);
  }

  /** Gives back the slot request `key` holds, if any, and lets the oldest waiting requests take the free ones. */
  #releaseSlot(key: string): void {
    if (!this.#heldSlots.delete(key)) return;
    while (this.#heldSlots.size < PEER_RELAY_MAX_PENDING_REQUESTS && this.#slotWaiters.length > 0) {
      this.#slotWaiters.shift()!.grant();
    }
  }

  /**
   * Waits, for a request, for the session's connect (the one in flight, or a new one: see
   * `connect()`). Settles as that connect does, unless whatever rejects the waiting requests
   * (`disconnect()`, a transport error or close, see `#rejectWaiting`) ends the wait first.
   */
  #waitForConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const end = (error: unknown): void => {
        this.#waits.delete(end);
        reject(error);
      };
      this.#waits.add(end);
      this.connect().then(() => {
        this.#waits.delete(end);
        resolve();
      }, end);
    });
  }

  #waitBeforeRetry(delayMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const end = (error: unknown): void => {
        clearTimeout(timer);
        this.#waits.delete(end);
        reject(error);
      };
      const timer = setTimeout(() => {
        this.#waits.delete(end);
        resolve();
      }, delayMs);
      this.#waits.add(end);
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
   * `String(id)`, so `1` and `"1"` are one id here) is refused with DUPLICATE_REQUEST_ID, unsent: a
   * request is in flight from this call until its answer arrives or its connection ends, the wait
   * before a retry included and even after its timeout, which over the built-in HTTP transport, whose
   * POST brings the answer, is until that POST ends (see `#requests`). MCP forbids reusing a request
   * id within a session, and the session matches a reply to its request by `String(id)`: a second
   * request under that key would take the first one's answer and give back a slot the relay still
   * counts for the other.
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
    const key = String(id);
    if (this.#requests.has(key)) throw duplicateRequestIdError(method, id);
    // Held until its answer arrives or its connection ends (see `#requests`), so no other request
    // takes the id while this one waits, is sent or waits to be sent again: its own retries keep it.
    const hold: RequestHold = { running: true, awaitingAnswer: false };
    this.#requests.set(key, hold);
    try {
      let delayMs = RETRY_INITIAL_DELAY_MS;
      for (;;) {
        try {
          return await this.#requestOnce(method, params, options, id, hold, Math.max(1, deadline - Date.now()));
        } catch (error) {
          if (!isRetryableRpcError(error)) throw error;
          const waitMs = Math.max(delayMs, requestedRetryDelayMs(error));
          if (deadline - Date.now() <= waitMs) throw error;
          // disconnect(), a transport error or close rejects this wait like a pending request.
          await this.#waitBeforeRetry(waitMs);
          delayMs = Math.min(delayMs * 2, RETRY_MAX_DELAY_MS);
        }
      }
    } finally {
      hold.running = false;
      this.#letGoOfId(key, hold);
    }
  }

  /**
   * Sends request `id` once, under `hold`, its call's hold on the id. A request whose connection
   * ended before it was sent (see `RequestHold.ended`), even one whose wait ended just before, is
   * not sent: it fails with the error that ended it.
   */
  async #requestOnce(
    method: string,
    params: Record<string, unknown>,
    options: PeerMcpRequestOptions,
    id: string | number,
    hold: RequestHold,
    timeoutMs: number,
  ): Promise<PeerMcpRpcResponse> {
    const key = String(id);
    throwIfEnded(hold);
    // A request made while a connect is in flight waits for that connect (connect() returns the
    // in-flight attempt) instead of writing to a transport that is not open yet. A session the
    // relay ended for good fails as it ended instead of connecting again (see `#ended`).
    // disconnect() ends the wait at once, so the call settles and gives back its id, even while the
    // connect it waits for is still getting its transport.
    if (this.state !== "connected") {
      const ended = this.#ended;
      if (ended) throw new PeerMcpError(ended.message, ended.code, ended.details);
      await this.#waitForConnect();
      throwIfEnded(hold);
    }
    // The connection's transport: its end would have ended this request, here and after the wait for a slot.
    const transport = this.transport;
    if (!transport || typeof transport.send !== "function") {
      throw new PeerMcpError("Peer transport is not connected", "NOT_CONNECTED");
    }
    const deadline = Date.now() + timeoutMs;
    if (transport.raw !== true) assertWithinRelayIdLimit(id);
    const waitForSlot = this.#takeSlot(transport, method, id, timeoutMs);
    if (waitForSlot) {
      await waitForSlot;
      throwIfEnded(hold);
    }
    const rpc = { jsonrpc: "2.0", id, method, params };
    let entry!: PendingRpcEntry;
    const promise = new Promise<PeerMcpRpcResponse>((resolve, reject) => {
      entry = {
        resolve,
        reject,
        method,
        timer: setTimeout(() => {
          if (this.pending.get(key) === entry) this.pending.delete(key);
          reject(new PeerMcpError(`Peer MCP request timed out: ${method}`, "REQUEST_TIMEOUT", { method, id }));
        }, Math.max(1, deadline - Date.now())),
      };
      this.pending.set(key, entry);
    });
    // The caller only gets this promise once the send below has finished, which for the HTTP
    // transport is the whole POST. A timeout, disconnect() or transport error rejects the pending
    // entry meanwhile, and without a handler that rejection would be reported as unhandled (by
    // default fatal to the agent process). This marks it handled; the promise returned below still
    // rejects for the caller.
    promise.catch(() => {});
    hold.awaitingAnswer = true;
    try {
      const envelope: PeerMcpTransportMessage =
        options.raw === true || transport.raw === true ? rpc : { type: "mcp", message: rpc };
      await transport.send(envelope);
      // The POST has ended: its answer, if it had one, has arrived.
      if (sendBringsAnswer.has(transport)) hold.awaitingAnswer = false;
    } catch (error) {
      // Nothing reached the relay, so it does not count the request and no answer comes. Once the
      // connection's end has given back the id, the slot and pending entry under it are another
      // request's, if any.
      hold.awaitingAnswer = false;
      if (!hold.ended) this.#releaseSlot(key);
      if (this.pending.get(key) === entry) {
        clearTimeout(entry.timer);
        this.pending.delete(key);
        entry.reject(error);
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
   * Ends the session: the session's connection ends with SESSION_DISCONNECTED (see `#endConnection`),
   * so the requests waiting and a connect in flight fail with it at once (a connect still getting its
   * transport once it has it; a request waiting for that connect at once), every request gives back
   * its id and its slot at once, even one whose send still runs, and the connection's transport is
   * closed while it holds it (the caller's own one too, even while a connect is still connecting it),
   * and the state is `idle` once it is. Nothing a transport reports for a connection this ended speaks
   * for the session, while it closes or later. The session starts over: the next `connect()` or
   * request connects again, however the relay ended the session before.
   *
   * Calls made while it runs keep their order. A `connect()` or request starts its connect once the
   * transport is closed, as after an awaited disconnect(); another disconnect() ends such a connect
   * before it starts, and resolves when this one does. A connect this ended while it was getting its
   * transport closes that transport once it has it, unless a live connection holds it by then (see
   * {@link transportOwners}).
   */
  async disconnect(): Promise<PeerMcpSessionInfo> {
    const error = sessionDisconnectedError();
    this.#disconnects += 1;
    // The connect in flight is ended: a connect() from now on starts another.
    this.connectPromise = null;
    this.state = "disconnecting";
    const closed = this.#connection ? this.#endConnection(this.#connection, error) : undefined;
    this.#connection = undefined;
    // So are the requests waiting for a connect that has not started (see connect()).
    this.#endRequests(error);
    this.transport = undefined;
    this.#negotiatedProtocolVersion = undefined;
    this.#ended = undefined;
    this.connectedAt = null;
    this.readySeen = false;
    // A disconnect in progress closes the transport; a connect asked for since has not started (see
    // connect()), so this one only ended it, and resolves once the transport is closed.
    if (this.#disconnecting) return this.#disconnecting;
    const disconnecting = this.#finishDisconnect(closed);
    this.#disconnecting = disconnecting;
    return disconnecting;
  }

  /** The rest of `disconnect()`: waits for the transport's close, if any, then leaves the session `idle`. */
  async #finishDisconnect(closed: Promise<void> | undefined): Promise<PeerMcpSessionInfo> {
    await closed;
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
