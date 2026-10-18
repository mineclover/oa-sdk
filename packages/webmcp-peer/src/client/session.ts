import { randomUUID } from "node:crypto";
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
  type PeerMcpCatalogListener,
  type PeerMcpCatalogSnapshot,
  type PeerMcpListener,
  type PeerMcpRequestOptions,
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

function isRpcResponse(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return obj.jsonrpc === "2.0" && (obj.id !== undefined || obj.result !== undefined || obj.error !== undefined);
}

function unwrapMessage(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("data" in obj && !obj.jsonrpc && !obj.type) {
      return unwrapMessage(obj.data);
    }
    return obj;
  }
  return undefined;
}

interface PendingRpcEntry {
  resolve: (value: any) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
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
    this.state = "idle";
    this.sessionId = asNonEmptyString(options.sessionId);
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
      const value = (typeof this.storage?.load === "function" ? this.storage.load() : undefined) as
        | Record<string, unknown>
        | undefined;
      if (!value || !Array.isArray(value.cachedTools)) return;
      const cachedTools = normalizeTools({ result: { tools: value.cachedTools } });
      const computedHash = hashTools(cachedTools);
      const hash = value.catalogHash === computedHash ? (value.catalogHash as string) : computedHash;
      this.catalog = {
        cachedTools,
        catalogVersion: (value.catalogVersion as number | string) ?? 0,
        catalogHash: hash,
        source: "peer",
        updatedAt: (value.updatedAt as string | null) ?? null,
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

  async connect(): Promise<PeerMcpSessionInfo> {
    if (this.state === "connected") return this.getSessionInfo();
    if (this.connectPromise) return this.connectPromise;
    if (!this.roomId && !this.wsUrl && !this.mcpEndpoint && !this.transport && !this.transportFactory) {
      throw new PeerMcpError("A peer roomId, wsUrl, mcpEndpoint, or transport is required", "ROOM_ID_REQUIRED");
    }
    this.connectPromise = this.#connectImpl().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
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
        transport = createHttpTransport(this.mcpEndpoint, globalThis.fetch, callbacks, this.clientToken);
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
      if (Number.isSafeInteger(value.roomEpoch)) {
        this.roomEpoch = value.roomEpoch as number;
      }
      this.#markOpen();
      this.readySeen = true;
      this.#readyResolve?.();
      this.notify();
      return;
    }
    if (value.type === "ping") {
      try {
        this.transport?.send?.({ type: "pong", timestamp: Date.now() });
      } catch {}
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
      this.#replaceCatalog(
        value.tools,
        value.catalogVersion as number | string | undefined,
        value.catalogHash as string | undefined,
      );
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
      const params = (rpc.params ?? {}) as Record<string, unknown>;
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
      if (rpc.error) pending.reject(new PeerMcpRpcError(rpc.error as Record<string, unknown>, rpc));
      else pending.resolve(rpc);
    }
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

  #rejectPending(error: unknown): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async request(
    method: string,
    params: Record<string, unknown> = {},
    options: PeerMcpRequestOptions = {},
  ): Promise<any> {
    if (this.state !== "connected" && this.state !== "connecting") await this.connect();
    if (!this.transport || typeof this.transport.send !== "function") {
      throw new PeerMcpError("Peer transport is not connected", "NOT_CONNECTED");
    }
    const id = options.id ?? `${this.sessionId || "peer"}-${++this.nextRequestId}`;
    const rpc = { jsonrpc: "2.0", id, method, params };
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, options.timeoutMs!) : this.requestTimeoutMs;
    const promise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new PeerMcpError(`Peer MCP request timed out: ${method}`, "REQUEST_TIMEOUT", { method, id }));
      }, timeoutMs);
      this.pending.set(String(id), { resolve, reject, timer, method });
    });
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

  async initialize(): Promise<Record<string, unknown>> {
    const response = await this.request("initialize", {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: "framebook-cli", version: PACKAGE_VERSION },
    });
    return response.result;
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
    const metadata = response.result?._meta ?? response._meta ?? {};
    this.#replaceCatalog(
      tools,
      response.result?.catalogVersion ?? metadata.catalogVersion,
      response.result?.catalogHash ?? metadata.catalogHash,
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
  ): Promise<any> {
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
    try {
      const response = await this.request("tools/call", params, options);
      return response.result;
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

  async revoke(reason = "client-request"): Promise<Record<string, unknown>> {
    if (!this.clientToken) {
      throw new PeerMcpError("A client ticket is required to revoke the peer session", "CLIENT_TOKEN_REQUIRED");
    }
    if (!this.sessionId) {
      throw new PeerMcpError("A session id is required to revoke the peer session", "SESSION_REQUIRED");
    }
    const endpoint = this.mcpEndpoint
      ? this.mcpEndpoint.replace(/\/mcp\/?$/, `/sessions/${encodeURIComponent(this.sessionId || "")}/revoke`)
      : this.roomId
        ? `${this.serverUrl.replace(/\/+$/, "")}/p/${encodeURIComponent(this.roomId)}/sessions/${encodeURIComponent(this.sessionId || "")}/revoke`
        : undefined;
    if (!endpoint || typeof globalThis.fetch !== "function") {
      throw new PeerMcpError("A server URL or MCP endpoint is required to revoke the peer session", "TRANSPORT_UNAVAILABLE");
    }
    const response = await globalThis.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.clientToken}` },
      body: JSON.stringify({
        sessionId: this.sessionId,
        roomId: this.roomId,
        roomEpoch: this.roomEpoch,
        reason,
        requestedAt: new Date().toISOString(),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new PeerMcpError(
        (typeof body?.error === "string" ? body.error : undefined) || `HTTP ${response.status}: peer session revoke failed`,
        (typeof body?.code === "string" ? body.code : undefined) || "SESSION_REVOKE_FAILED",
        body,
      );
    }
    await this.disconnect();
    return body;
  }
}

export function createPeerMcpSession(options: PeerMcpSessionOptions = {}): PeerMcpSession {
  return new PeerMcpSession(options);
}
