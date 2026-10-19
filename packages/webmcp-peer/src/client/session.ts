import { randomUUID } from "node:crypto";
import {
  isJsonObject,
  JsonObjectSchema,
  parseJsonObject,
  readResponseText,
} from "../config/json.js";
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
  PeerSessionStatusSchema,
} from "./schemas.js";
import {
  asCatalogVersion,
  asNonEmptyString,
  createHttpTransport,
  createWebSocketTransport,
  normalizeServerUrl,
  parseRoomId,
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
  type PeerMcpTransportMessage,
} from "./types.js";

function readEnv(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

function isRpcResponse(value: unknown): value is PeerMcpRpcResponse {
  if (!isJsonObject(value)) return false;
  return value.jsonrpc === "2.0" && (value.id !== undefined || value.result !== undefined || value.error !== undefined);
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

  constructor(options: PeerMcpSessionOptions = {}) {
    this.serverUrl = normalizeServerUrl(
      options.serverUrl ?? readEnv("FRAMEBOOK_PEER_URL") ?? readEnv("WEBMCP_PEER_URL"),
    );
    this.roomId = parseRoomId(
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
   * `request()` calls made while a connect is in flight) share one connect attempt.
   */
  async connect(): Promise<PeerMcpSessionInfo> {
    if (this.state === "connected") return this.getSessionInfo();
    if (this.connectPromise) return this.connectPromise;
    if (!this.roomId && !this.wsUrl && !this.mcpEndpoint && !this.transport && !this.transportFactory) {
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
    this.#connectImpl()
      .then(settle.resolve, settle.reject)
      .finally(() => {
        if (this.connectPromise === attempt) this.connectPromise = null;
      });
    return attempt;
  }

  async #connectImpl(): Promise<PeerMcpSessionInfo> {
    this.state = "connecting";
    this.error = null;
    this.readySeen = false;
    this.notify();
    try {
      const url = (this.wsUrl || (this.roomId ? websocketUrl(this.serverUrl, this.roomId) : this.mcpEndpoint)) ?? "";
      const protocols = ["webmcp-peer.v1"];
      if (this.clientToken) protocols.push(`ticket.${this.clientToken}`);
      const callbacks: PeerMcpTransportCallbacks = {
        onOpen: () => this.#markOpen(),
        onMessage: (message) => this.#handleIncomingSafely(message),
        onClose: () => this.#handleClose(),
        onError: (error) => this.#handleTransportError(error),
      };
      let transport: PeerMcpTransport | undefined;
      if (this.transportFactory) {
        transport = await this.transportFactory(url, protocols, callbacks);
      } else if (this.transport) {
        transport = this.transport;
        if (typeof transport.connect === "function") {
          const connected = await transport.connect(callbacks);
          if (connected && typeof connected === "object") transport = { ...transport, ...connected };
        }
        transport.onMessage = transport.onMessage || callbacks.onMessage;
      } else if (this.mcpEndpoint) {
        transport = createHttpTransport(this.mcpEndpoint, this.fetchImpl ?? globalThis.fetch, callbacks, this.clientToken);
      } else {
        transport = createWebSocketTransport(url, protocols, this.WebSocketImpl, callbacks);
      }
      if (!transport || typeof transport.send !== "function") {
        throw new PeerMcpError("Peer transport must provide send(value)", "INVALID_TRANSPORT");
      }
      this.transport = transport;
      if (transport.readyState === "open" || transport.open === true || transport.connected === true) {
        this.#markOpen();
      }
      await this.#waitForReady();
      this.state = "connected";
      this.connectedAt = this.connectedAt || Date.now();
      this.sessionId = this.sessionId || `peer-session-${randomUUID()}`;
      this.runtimeEpoch = this.runtimeEpoch || randomUUID();
      this.notify();
      return this.getSessionInfo();
    } catch (error) {
      this.state = "error";
      this.error = error instanceof Error ? error.message : String(error);
      this.#rejectPending(error);
      this.notify();
      throw error;
    }
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
    if (
      value.type === "session.revoked" ||
      value.type === "collaboration.revoked" ||
      value.type === "room.rotated" ||
      value.type === "approval.expired" ||
      value.type === "collaboration.expired" ||
      value.type === "approval.rejected"
    ) {
      const code =
        value.type === "room.rotated"
          ? "ROOM_ROTATED"
          : value.type === "approval.expired"
            ? "APPROVAL_EXPIRED"
            : value.type === "collaboration.expired"
              ? "SESSION_EXPIRED"
              : value.type === "approval.rejected"
                ? "CLIENT_APPROVAL_DENIED"
                : "SESSION_REVOKED";
      const defaultMsg =
        code === "ROOM_ROTATED"
          ? "Peer room was rotated"
          : code === "APPROVAL_EXPIRED"
            ? "Peer approval request expired"
            : code === "SESSION_EXPIRED"
              ? "Peer session expired"
              : code === "CLIENT_APPROVAL_DENIED"
                ? "Peer approval request was rejected"
                : "Peer session was revoked";
      const msg = (typeof value.reason === "string" ? value.reason : undefined)
        || (typeof value.message === "string" ? value.message : undefined)
        || defaultMsg;
      const error = new PeerMcpError(msg, code, value);
      this.state = "error";
      this.error = error.message;
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

  #handleClose(): void {
    if (this.state === "disconnecting" || this.state === "idle" || this.state === "error") return;
    this.state = "disconnected";
    const error = new PeerMcpError("Peer transport closed", "TRANSPORT_CLOSED");
    this.#readyReject?.(error);
    this.#rejectPending(error);
    this.notify();
  }

  /** Requests sleeping before a retry: not in `pending`, but ended by the same events. */
  readonly #retryWaits = new Set<{ timer: ReturnType<typeof setTimeout>; reject: (error: unknown) => void }>();

  #rejectPending(error: unknown): void {
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
   * A request the relay refuses as retryable (`data.retryable: true`, e.g. PROVIDER_BUSY while the
   * provider is not reading) reached nobody, so it is sent again with exponential backoff
   * ({@link RETRY_INITIAL_DELAY_MS} doubling up to {@link RETRY_MAX_DELAY_MS}) for as long as the
   * request's own timeout allows; the last refusal is then reported.
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
        if (!isRetryableRpcError(error) || deadline - Date.now() <= delayMs) throw error;
        // disconnect(), a transport error or close rejects this wait like a pending request.
        await this.#waitBeforeRetry(delayMs);
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
    // in-flight attempt) instead of writing to a transport that is not open yet.
    if (this.state !== "connected") await this.connect();
    if (!this.transport || typeof this.transport.send !== "function") {
      throw new PeerMcpError("Peer transport is not connected", "NOT_CONNECTED");
    }
    const rpc = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise<PeerMcpRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new PeerMcpError(`Peer MCP request timed out: ${method}`, "REQUEST_TIMEOUT", { method, id }));
      }, timeoutMs);
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
        options.raw === true || this.transport.raw === true ? rpc : { type: "mcp", message: rpc };
      await this.transport.send(envelope);
    } catch (error) {
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

  async initialize(): Promise<Record<string, unknown>> {
    const response = await this.request("initialize", this.#initializeParams());
    if (!isJsonObject(response.result)) {
      throw new PeerMcpError("Peer initialize response has no result object", "INVALID_RESPONSE", response);
    }
    this.#adoptRoomEpoch(response.result._meta);
    return response.result;
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

  #replaceCatalog(tools: unknown, version?: number | string, hash?: string): void {
    const normalized = normalizeTools({ result: { tools } });
    const nextHash = asNonEmptyString(hash) || hashTools(normalized);
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

  async disconnect(): Promise<PeerMcpSessionInfo> {
    this.state = "disconnecting";
    this.#rejectPending(new PeerMcpError("Peer session disconnected", "SESSION_DISCONNECTED"));
    try {
      await this.transport?.close?.();
    } catch {}
    this.transport = undefined;
    this.state = "idle";
    this.connectedAt = null;
    this.readySeen = false;
    this.notify();
    return this.getSessionInfo();
  }

  /**
   * Revokes this client's ticket on the relay, then disconnects. The relay identifies the ticket by
   * the bearer `clientToken` and accepts the request only when it names the ticket's room
   * (`roomId` + the current `roomEpoch`) and, on the session-scoped route, its session id:
   * - `roomId` comes from the options, the WebSocket `ready` frame, or the `/p/:id/mcp` endpoint;
   * - `roomEpoch` comes from the options, the `ready` frame, or `initialize`/`tools/list` metadata.
   *   When none of those supplied it yet, it is learned before revoking: from the session status
   *   route when the relay's session id is known, otherwise from a metadata-only `initialize` POST
   *   to the room's MCP endpoint, which the relay answers for a ticket in any approval state;
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
    const roomEpoch = this.roomEpoch ?? (await this.#learnRoomEpoch(fetchImpl, roomBase, sessionId));
    const response = await fetchImpl(`${roomBase}${sessionPath}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.clientToken}` },
      body: JSON.stringify({
        ...(sessionId ? { sessionId } : {}),
        roomId,
        roomEpoch,
        reason,
        requestedAt: new Date().toISOString(),
      }),
    });
    const body = parseJsonObject(await readResponseText(response));
    if (!response.ok) {
      throw new PeerMcpError(
        (typeof body.error === "string" ? body.error : undefined) || `HTTP ${response.status}: peer session revoke failed`,
        (typeof body.code === "string" ? body.code : undefined) || "SESSION_REVOKE_FAILED",
        body,
      );
    }
    await this.disconnect();
    return body;
  }

  /**
   * Learns the relay's room epoch for {@link revoke} when no frame or response supplied it yet:
   * from the session status route when the relay's session id is known, otherwise (or when that
   * route cannot be read) from a metadata-only `initialize` POST to the room's MCP endpoint.
   * Undefined when neither answers; the relay then rejects the revoke with its binding error.
   */
  async #learnRoomEpoch(fetchImpl: typeof fetch, roomBase: string, sessionId: string | undefined): Promise<number | undefined> {
    if (sessionId) {
      const fromStatus = await this.#readStatusRoomEpoch(fetchImpl, `${roomBase}/sessions/${encodeURIComponent(sessionId)}`);
      if (fromStatus !== undefined) return fromStatus;
    }
    return this.#readInitializeRoomEpoch(fetchImpl, this.mcpEndpoint ?? `${roomBase}/mcp`);
  }

  /** Reads the room epoch from `GET .../sessions/:sessionId`; undefined when it cannot be read. */
  async #readStatusRoomEpoch(fetchImpl: typeof fetch, statusUrl: string): Promise<number | undefined> {
    try {
      const response = await fetchImpl(statusUrl, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${this.clientToken}` },
      });
      if (!response.ok) return undefined;
      const status = PeerSessionStatusSchema.parse(JSON.parse(await readResponseText(response)));
      if (status.roomEpoch !== undefined) this.roomEpoch = status.roomEpoch;
      return status.roomEpoch;
    } catch {
      return undefined;
    }
  }

  /**
   * Reads the room epoch from the `_meta` of an `initialize` POSTed straight to the room's MCP
   * endpoint (independent of this session's transport); undefined when it cannot be read.
   */
  async #readInitializeRoomEpoch(fetchImpl: typeof fetch, endpoint: string): Promise<number | undefined> {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": `framebook-peer-mcp-client/${PACKAGE_VERSION}`,
          authorization: `Bearer ${this.clientToken}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `${this.sessionId || "peer"}-${++this.nextRequestId}`,
          method: "initialize",
          params: this.#initializeParams(),
        }),
      });
      if (!response.ok) return undefined;
      const body = JsonObjectSchema.parse(JSON.parse(await readResponseText(response)));
      if (isJsonObject(body.result)) this.#adoptRoomEpoch(body.result._meta);
      return this.roomEpoch;
    } catch {
      return undefined;
    }
  }
}

export function createPeerMcpSession(options: PeerMcpSessionOptions = {}): PeerMcpSession {
  return new PeerMcpSession(options);
}
