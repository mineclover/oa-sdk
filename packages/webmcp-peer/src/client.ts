/**
 * @oa-sdk/webmcp-peer/client — External Agent & CLI Peer MCP Session Client
 *
 * Speaks the WebMCP peer envelope over a configurable transport (HTTP MCP or WebSocket):
 *   { type: "mcp", message: <JSON-RPC 2.0 request/response> }
 *
 * Canonical MCP operations: initialize, tools/list, tools/call.
 * A peer's tools/list response is the source of truth for cachedTools; the cache
 * carries a monotonically increasing catalogVersion and a deterministic catalogHash
 * so callers can fail closed when a peer changes underneath them.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";
const DEFAULT_TIMEOUT_MS = 10_000;
export const PROTOCOL_VERSION = "2026-07-28";
const PACKAGE_VERSION = "0.1.0";

export type PeerMcpTransportMessage = Record<string, unknown> | string;

export interface PeerMcpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  [key: string]: unknown;
}

export type PeerMcpSessionState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "disconnecting"
  | "error";

export interface PeerMcpCatalogSnapshot {
  cachedTools: PeerMcpTool[];
  catalogVersion: number | string;
  catalogHash: string;
  source: "peer";
  updatedAt: string | null;
  sessionId?: string;
  runtimeEpoch?: string;
  roomId?: string | null;
  roomEpoch?: number | null;
  serverUrl?: string;
  wsUrl?: string | null;
  mcpEndpoint?: string | null;
  state?: PeerMcpSessionState;
}

export interface PeerMcpSessionInfo {
  sessionId?: string;
  runtimeEpoch: string;
  state: PeerMcpSessionState;
  serverUrl: string;
  wsUrl: string | null;
  mcpEndpoint: string | null;
  roomId: string | null;
  roomEpoch: number | null;
  peerAlias: string | null;
  connectedAt: number | null;
  error: string | null;
  catalogVersion: number | string;
  catalogHash: string;
  toolsCount: number;
}

export interface PeerMcpStore {
  load(): unknown;
  save(value: unknown): void;
}

export interface PeerMcpTransportCallbacks {
  onOpen?(): void;
  onMessage?(message: unknown): void;
  onClose?(): void;
  onError?(error: Error): void;
}

export interface PeerMcpTransport {
  raw?: boolean;
  readyState?: string | number;
  open?: boolean;
  connected?: boolean;
  connect?(callbacks?: PeerMcpTransportCallbacks): Promise<PeerMcpTransport | void> | PeerMcpTransport | void;
  send(value: PeerMcpTransportMessage): Promise<void> | void;
  close?(): Promise<void> | void;
  onMessage?: (message: unknown) => void;
  socket?: unknown;
}

export interface PeerMcpSessionOptions {
  serverUrl?: string;
  roomId?: string;
  roomEpoch?: number;
  descriptorUrl?: string;
  wsUrl?: string;
  mcpEndpoint?: string;
  clientToken?: string;
  peerAlias?: string;
  alias?: string;
  sessionId?: string;
  runtimeEpoch?: string;
  protocolVersion?: string;
  requestTimeoutMs?: number;
  WebSocket?: unknown;
  transport?: PeerMcpTransport;
  transportFactory?: (
    url: string,
    protocols: string[],
    callbacks: PeerMcpTransportCallbacks,
  ) => Promise<PeerMcpTransport> | PeerMcpTransport;
  storage?: PeerMcpStore;
}

export interface PeerMcpRequestOptions {
  id?: string | number;
  timeoutMs?: number;
  raw?: boolean;
}

export interface PeerMcpCallOptions extends PeerMcpRequestOptions {
  refresh?: boolean;
  readOnly?: boolean;
  retryOnCatalogChanged?: boolean;
}

export type PeerMcpListener = (info: PeerMcpSessionInfo) => void;
export type PeerMcpCatalogListener = (snapshot: PeerMcpCatalogSnapshot | Record<string, unknown>) => void;

export interface ParsedInvitationUrl {
  descriptorUrl: string;
  serverUrl: string;
  roomId: string;
  inviteToken: string;
  mcpEndpoint: string;
}

export interface PeerConfigProfile {
  type: string;
  version: 1;
  serverUrl: string;
  alias: string;
  protocol: "webmcp-peer/1";
  mcpEndpointTemplate: string;
  clientEndpointTemplate: string;
  roomEndpoint: string;
  roomId?: string;
  invitationUrl?: string;
  defaults: {
    approvalRequired: boolean;
    roomTtlMs: number;
  };
}

export interface CreatePeerConfigProfileOptions {
  serverUrl?: string;
  alias?: string;
  invitationUrl?: string | null;
  roomId?: string | null;
  inviteToken?: string | null;
  profileType?: string;
  defaults?: {
    approvalRequired?: boolean;
    roomTtlMs?: number;
  };
}

export interface ParsedPeerConfig {
  serverUrl: string;
  alias?: string;
  roomId?: string;
  invitationUrl?: string;
  inviteToken?: string;
}

export type ParsePeerConfigResult = ParsedPeerConfig | null;

export interface PeerServerPublicConfig {
  type: string;
  version: number;
  serverUrl: string;
  protocol: string;
  mcpEndpointTemplate: string;
  clientEndpointTemplate: string;
  roomEndpoint: string;
  defaults?: {
    approvalRequired?: boolean;
    roomTtlMs?: number;
  };
  [key: string]: unknown;
}

export interface DiscoverPeerCatalogOptions {
  serverUrl?: string;
  roomId?: string;
  mcpEndpoint?: string;
  invitationUrl?: string;
  clientToken?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  protocolVersion?: string;
}

export interface DiscoveredPeerCatalog {
  serverInfo?: Record<string, unknown>;
  protocolVersion?: string;
  tools: PeerMcpTool[];
  catalogVersion: number | string;
  catalogHash: string;
  _meta?: Record<string, unknown>;
}

export interface JoinPeerRoomOptions {
  serverUrl?: string;
  roomId?: string;
  inviteToken?: string;
  invitationUrl?: string;
  clientLabel?: string;
  capabilities?: string[];
  fetchImpl?: typeof fetch;
}

export interface JoinedPeerRoom {
  roomId: string;
  roomEpoch: number;
  clientToken: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
  approvalRequired: boolean;
  capabilities: string[];
  approvalState: string;
  state: string;
  approvalRequestId?: string;
  serverUrl: string;
  wsUrl: string;
  mcpEndpoint: string;
  [key: string]: unknown;
}

export interface PeerSessionStatusOptions {
  serverUrl?: string;
  roomId?: string;
  sessionId?: string;
  clientToken?: string;
  fetchImpl?: typeof fetch;
}

export interface WaitForPeerApprovalOptions extends PeerSessionStatusOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RotatePeerRoomOptions {
  serverUrl?: string;
  roomId?: string;
  providerToken?: string;
  roomEpoch?: number;
  alias?: string;
  fetchImpl?: typeof fetch;
}

export interface ClientPeerHealthResult {
  ok: boolean;
  state: "healthy" | "unhealthy" | "unreachable";
  status: number | null;
  message: string;
}

export interface ClientPeerHealthProbeOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  messages?: {
    healthy?: string;
    unhealthy?: (detail: string) => string;
    timeout?: string;
    unreachable?: (detail: string) => string;
    fetchUnavailable?: string;
  };
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeServerUrl(value?: string): string {
  const raw = asNonEmptyString(value) || DEFAULT_SERVER_URL;
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, "");
  return `http://${raw.replace(/\/+$/, "")}`;
}

export function websocketUrl(serverUrl: string, roomId: string): string {
  return `${normalizeServerUrl(serverUrl).replace(/^http/i, "ws")}/p/${encodeURIComponent(roomId)}/client`;
}

function stableValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = stableValue(record[key]);
    return result;
  }, {});
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function hashTools(tools: readonly PeerMcpTool[] | unknown): string {
  const canonicalTools = Array.isArray(tools)
    ? tools.slice().sort((left, right) => String(left?.name ?? "").localeCompare(String(right?.name ?? "")))
    : tools;
  return createHash("sha256").update(stableStringify(canonicalTools)).digest("hex");
}

export function parseRoomId(value?: string): string | undefined {
  const raw = asNonEmptyString(value);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    const match = parsed.pathname.match(/\/p\/([^/]+)(?:\/mcp)?\/?$/);
    return match?.[1] || undefined;
  } catch {
    return raw.replace(/^\/p\//, "").replace(/\/mcp\/?$/, "");
  }
}

function readEnv(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

export class PeerMcpError extends Error {
  code: string;
  details?: unknown;

  constructor(message: string, code = "PEER_MCP_ERROR", details: unknown = undefined) {
    super(message);
    this.name = "PeerMcpError";
    this.code = code;
    this.details = details;
  }
}

export class PeerMcpRpcError extends PeerMcpError {
  rpcError?: unknown;
  response?: unknown;

  constructor(
    error: { code?: string | number; message?: string; [key: string]: unknown } | undefined,
    response: unknown = undefined,
  ) {
    const code = typeof error?.code === "string" ? error.code : "MCP_RPC_ERROR";
    const message = error?.message || "Peer MCP request failed";
    super(message, code, error);
    this.name = "PeerMcpRpcError";
    this.rpcError = error;
    this.response = response;
  }
}

export class PeerMcpCatalogChangedError extends PeerMcpError {
  snapshot?: PeerMcpCatalogSnapshot;

  constructor(
    message = "Peer MCP catalog changed; refresh required",
    snapshot: PeerMcpCatalogSnapshot | undefined = undefined,
  ) {
    super(message, "CATALOG_CHANGED", snapshot);
    this.name = "PeerMcpCatalogChangedError";
    this.snapshot = snapshot;
  }
}

function createWebSocketTransport(
  url: string,
  protocols: string[],
  WebSocketImpl: unknown,
  callbacks: PeerMcpTransportCallbacks,
): PeerMcpTransport {
  if (typeof WebSocketImpl !== "function") {
    throw new PeerMcpError("WebSocket is unavailable; provide transportFactory or WebSocket", "TRANSPORT_UNAVAILABLE");
  }
  const Ctor = WebSocketImpl as new (url: string, protocols: string[]) => {
    readyState?: number;
    onopen?: () => void;
    onmessage?: (event: { data?: unknown } | unknown) => void;
    onerror?: (event: unknown) => void;
    onclose?: () => void;
    send: (data: string) => void;
    close?: () => void;
  };
  const socket = new Ctor(url, protocols);
  let opened = false;
  const onOpen = () => {
    opened = true;
    callbacks.onOpen?.();
  };
  const onMessage = (event: unknown) => {
    const ev = event as { data?: unknown } | null;
    callbacks.onMessage?.(ev?.data ?? event);
  };
  const onError = (event: unknown) =>
    callbacks.onError?.(event instanceof Error ? event : new Error("WebSocket transport error"));
  const onClose = () => callbacks.onClose?.();
  socket.onopen = onOpen;
  socket.onmessage = onMessage;
  socket.onerror = onError;
  socket.onclose = onClose;
  return {
    socket,
    send(value: PeerMcpTransportMessage) {
      if (!opened && socket.readyState !== undefined && socket.readyState !== 1) {
        throw new PeerMcpError("WebSocket is not open", "TRANSPORT_NOT_OPEN");
      }
      socket.send(typeof value === "string" ? value : JSON.stringify(value));
    },
    close() {
      try {
        socket.close?.();
      } catch {}
    },
  };
}

function createHttpTransport(
  url: string,
  fetchImpl: typeof fetch | undefined,
  callbacks: PeerMcpTransportCallbacks,
  clientToken?: string,
): PeerMcpTransport {
  if (typeof fetchImpl !== "function") {
    throw new PeerMcpError("fetch is unavailable; provide transportFactory", "TRANSPORT_UNAVAILABLE");
  }
  callbacks.onOpen?.();
  callbacks.onMessage?.({ type: "ready", role: "client", transport: "http" });
  return {
    raw: true,
    async send(value: PeerMcpTransportMessage) {
      const valObj = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
      const rpc = (valObj?.type === "mcp" && valObj.message ? valObj.message : value) as Record<string, unknown>;
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": `framebook-peer-mcp-client/${PACKAGE_VERSION}`,
          ...(clientToken ? { authorization: `Bearer ${clientToken}` } : {}),
        },
        body: JSON.stringify(rpc),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        callbacks.onMessage?.({
          jsonrpc: "2.0",
          id: rpc?.id,
          error: {
            code: `HTTP_${response.status}`,
            message: (typeof body?.error === "string" ? body.error : undefined) || response.statusText || "MCP endpoint failed",
          },
        });
        return;
      }
      callbacks.onMessage?.(body);
    },
    close() {},
  };
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

function extractCatalogVersion(
  response: Record<string, unknown> | undefined,
  previousVersion: number | string | undefined,
  previousHash: string | undefined,
  nextHash: string,
): number | string {
  const result = (response?.result ?? {}) as Record<string, unknown>;
  const resultMeta = (result._meta ?? {}) as Record<string, unknown>;
  const respMeta = (response?._meta ?? {}) as Record<string, unknown>;
  const candidate = result.catalogVersion ?? resultMeta.catalogVersion ?? respMeta.catalogVersion;
  if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  if (typeof candidate === "string" && candidate.trim()) return candidate;
  if (previousHash !== nextHash) {
    return typeof previousVersion === "number" ? previousVersion + 1 : 1;
  }
  return previousVersion ?? 0;
}

function normalizeTools(value: unknown): PeerMcpTool[] {
  const obj = (value ?? {}) as Record<string, unknown>;
  const result = (obj.result ?? value) as Record<string, unknown> | undefined;
  const tools = result?.tools;
  if (!Array.isArray(tools) || tools.length > 128) {
    throw new PeerMcpError("Peer tools/list response did not contain an array", "INVALID_TOOLS_LIST", value);
  }
  const names = new Set<string>();
  return tools.map((tool: unknown) => {
    const t = tool as Record<string, unknown> | null;
    if (!t || typeof t !== "object" || typeof t.name !== "string" || !t.name.trim()) {
      throw new PeerMcpError("Peer tools/list returned an invalid tool descriptor", "INVALID_TOOL_DESCRIPTOR", tool);
    }
    const toolName = t.name.trim();
    if (toolName.length > 256) {
      throw new PeerMcpError(`Peer tool name exceeds 256 characters: ${toolName}`, "TOOL_NAME_TOO_LONG", tool);
    }
    if (names.has(toolName)) {
      throw new PeerMcpError(`Peer tools/list contains duplicate tool name: ${toolName}`, "DUPLICATE_TOOL", tool);
    }
    names.add(toolName);
    const inputSchema = t.inputSchema as Record<string, unknown> | null;
    if (!inputSchema || typeof inputSchema !== "object" || inputSchema.type !== "object") {
      throw new PeerMcpError(`Peer tool inputSchema must be an object: ${toolName}`, "INVALID_TOOL_DESCRIPTOR", tool);
    }
    return {
      ...t,
      name: toolName,
      inputSchema,
    };
  });
}

function isCatalogChangedRpcError(error: unknown): boolean {
  const errObj = error as { code?: unknown; data?: { code?: unknown } } | null;
  const value = errObj?.code ?? errObj?.data?.code;
  return value === "CATALOG_CHANGED" || value === "SOURCE_CHANGED" || value === -32001 || value === -32010;
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
        onMessage: (message) => this.#handleIncoming(message),
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

export class PeerMcpService {
  options: PeerMcpSessionOptions;
  sessions: Map<string, PeerMcpSession>;
  activeSessionId?: string;

  constructor(options: PeerMcpSessionOptions = {}) {
    this.options = { ...options };
    this.sessions = new Map();
    this.activeSessionId = undefined;
  }

  createSession(options: PeerMcpSessionOptions = {}): PeerMcpSession {
    const session = new PeerMcpSession({ ...this.options, ...options });
    const id = options.sessionId || session.sessionId || `peer-session-${randomUUID()}`;
    session.sessionId = id;
    this.sessions.set(id, session);
    this.activeSessionId = id;
    return session;
  }

  getSession(sessionId = this.activeSessionId): PeerMcpSession | undefined {
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  listSessions(): PeerMcpSessionInfo[] {
    return [...this.sessions.values()].map((session) => session.getSessionInfo());
  }

  async connect(options: PeerMcpSessionOptions = {}): Promise<PeerMcpSession> {
    const session = this.createSession(options);
    await session.connect();
    return session;
  }

  async disconnect(sessionId = this.activeSessionId): Promise<PeerMcpSessionInfo | undefined> {
    const session = this.getSession(sessionId);
    if (!session || !sessionId) return undefined;
    const info = await session.disconnect();
    this.sessions.delete(sessionId);
    if (this.activeSessionId === sessionId) this.activeSessionId = this.sessions.keys().next().value;
    return info;
  }

  async revoke(sessionId = this.activeSessionId, reason = "client-request"): Promise<Record<string, unknown>> {
    const session = this.getSession(sessionId);
    if (!session || !sessionId) throw new PeerMcpError("Peer session is not registered", "SESSION_NOT_FOUND");
    const result = await session.revoke(reason);
    this.sessions.delete(sessionId);
    if (this.activeSessionId === sessionId) this.activeSessionId = this.sessions.keys().next().value;
    return result;
  }

  async refreshCatalog(sessionId = this.activeSessionId): Promise<PeerMcpCatalogSnapshot> {
    const session = this.getSession(sessionId);
    if (!session) throw new PeerMcpError("No active peer MCP session", "SESSION_NOT_FOUND");
    await session.connect();
    await session.refreshCatalog();
    return session.getCatalogSnapshot();
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    options: PeerMcpCallOptions & { sessionId?: string } = {},
  ): Promise<any> {
    const session = this.getSession(options.sessionId ?? this.activeSessionId);
    if (!session) throw new PeerMcpError("No active peer MCP session", "SESSION_NOT_FOUND");
    await session.connect();
    return session.callTool(name, args, options);
  }
}

export class JsonPeerMcpStore implements PeerMcpStore {
  filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): unknown {
    if (!this.filePath) return undefined;
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      return undefined;
    }
  }

  save(value: unknown): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tempPath, this.filePath);
  }
}

export function createJsonPeerMcpStore(filePath: string): JsonPeerMcpStore {
  return new JsonPeerMcpStore(filePath);
}

export function createPeerMcpSession(options: PeerMcpSessionOptions = {}): PeerMcpSession {
  return new PeerMcpSession(options);
}

export function createPeerMcpService(options: PeerMcpSessionOptions = {}): PeerMcpService {
  return new PeerMcpService(options);
}

export function normalizePeerUrl(url?: string, fallback = DEFAULT_SERVER_URL): string {
  const trimmed = asNonEmptyString(url) || fallback;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

export function normalizePeerConfigUrl(raw: string): string {
  const trimmed = asNonEmptyString(raw);
  if (!trimmed) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

export function isLocalPeerUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(normalizePeerUrl(rawUrl));
    const host = parsed.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

export function externalConsentKey(rawUrl: string, prefix = "webmcp:external-server-consent"): string {
  return `${prefix}:${normalizePeerUrl(rawUrl)}`;
}

export function parseInvitationUrl(invitationUrl: string): ParsedInvitationUrl | null {
  const trimmed = asNonEmptyString(invitationUrl);
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const match = parsed.pathname.match(/\/p\/([A-Za-z0-9_-]{1,128})(?:\/mcp)?\/?$/);
    if (!match || !match[1]) return null;
    const roomId = match[1];
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    const inviteToken = (hashParams.get("invite") || parsed.searchParams.get("invite") || "").trim();
    if (!inviteToken) return null;
    const serverUrl = `${parsed.protocol}//${parsed.host}`;
    const descriptorUrl = `${serverUrl}/p/${roomId}`;
    return {
      descriptorUrl,
      serverUrl,
      roomId,
      inviteToken,
      mcpEndpoint: `${descriptorUrl}/mcp`,
    };
  } catch {
    return null;
  }
}

export function buildInvitationUrl(
  options: { serverUrl?: string; roomId?: string; inviteToken?: string } = {},
): string {
  const serverUrl = normalizePeerConfigUrl(options.serverUrl ?? "");
  const roomId = asNonEmptyString(options.roomId);
  const inviteToken = asNonEmptyString(options.inviteToken);
  if (!serverUrl || !roomId || !inviteToken) return "";
  return `${serverUrl}/p/${encodeURIComponent(roomId)}#invite=${encodeURIComponent(inviteToken)}`;
}

export function createPeerConfigProfile(
  options: CreatePeerConfigProfileOptions = {},
): PeerConfigProfile {
  const serverUrl = normalizePeerConfigUrl(options.serverUrl ?? "");
  const alias = asNonEmptyString(options.alias) || "wireframe-local";
  const parsedInvite = options.invitationUrl ? parseInvitationUrl(options.invitationUrl) : null;
  const roomId = asNonEmptyString(options.roomId) || parsedInvite?.roomId || "";
  const inviteToken = asNonEmptyString(options.inviteToken) || parsedInvite?.inviteToken || "";
  const invitationUrl =
    asNonEmptyString(options.invitationUrl) ||
    (roomId && inviteToken ? buildInvitationUrl({ serverUrl, roomId, inviteToken }) : "");
  const profileType = asNonEmptyString(options.profileType) || "framebook.peer.config";
  return {
    type: profileType,
    version: 1,
    serverUrl,
    alias,
    protocol: "webmcp-peer/1",
    mcpEndpointTemplate: `${serverUrl}/p/{roomId}/mcp`,
    clientEndpointTemplate: `${serverUrl.replace(/^http/i, "ws")}/p/{roomId}/client`,
    roomEndpoint: `${serverUrl}/p`,
    ...(roomId ? { roomId } : {}),
    ...(invitationUrl ? { invitationUrl } : {}),
    defaults: {
      approvalRequired: options.defaults?.approvalRequired ?? true,
      roomTtlMs: options.defaults?.roomTtlMs ?? 2 * 60 * 60 * 1000,
    },
  };
}

export function stringifyPeerConfigProfile(options: CreatePeerConfigProfileOptions = {}): string {
  return JSON.stringify(createPeerConfigProfile(options), null, 2);
}

export function parsePeerConfig(raw: string): ParsePeerConfigResult {
  const trimmed = asNonEmptyString(raw);
  if (!trimmed) return null;
  if (!trimmed.startsWith("{")) {
    const parsedInvite = parseInvitationUrl(trimmed);
    if (parsedInvite) {
      return {
        serverUrl: parsedInvite.serverUrl,
        roomId: parsedInvite.roomId,
        invitationUrl: `${parsedInvite.descriptorUrl}#invite=${parsedInvite.inviteToken}`,
        inviteToken: parsedInvite.inviteToken,
      };
    }
    const serverUrl = normalizePeerConfigUrl(trimmed);
    if (!serverUrl) return null;
    return { serverUrl, invitationUrl: trimmed };
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const rawUrl =
      typeof parsed.serverUrl === "string"
        ? parsed.serverUrl
        : typeof parsed.url === "string"
          ? parsed.url
          : typeof parsed.origin === "string"
            ? parsed.origin
            : "";
    const parsedInvite =
      typeof parsed.invitationUrl === "string" ? parseInvitationUrl(parsed.invitationUrl) : null;
    const serverUrl = normalizePeerConfigUrl(rawUrl) || parsedInvite?.serverUrl || "";
    if (!serverUrl) return null;
    const alias = typeof parsed.alias === "string" && parsed.alias.trim() ? parsed.alias.trim() : undefined;
    const roomId =
      typeof parsed.roomId === "string" && parsed.roomId.trim() ? parsed.roomId.trim() : parsedInvite?.roomId;
    const invitationUrl =
      typeof parsed.invitationUrl === "string" && parsed.invitationUrl.trim()
        ? parsed.invitationUrl.trim()
        : undefined;
    const inviteToken = parsedInvite?.inviteToken;
    return {
      serverUrl,
      ...(alias ? { alias } : {}),
      ...(roomId ? { roomId } : {}),
      ...(invitationUrl ? { invitationUrl } : {}),
      ...(inviteToken ? { inviteToken } : {}),
    };
  } catch {
    return null;
  }
}

export async function probePeerHealth(
  rawServerUrl: string,
  options: ClientPeerHealthProbeOptions = {},
): Promise<ClientPeerHealthResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const serverUrl = normalizePeerUrl(rawServerUrl);
  const messages = options.messages ?? {};
  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      state: "unreachable",
      status: null,
      message: messages.fetchUnavailable ?? "현재 런타임에서 fetch를 사용할 수 없습니다.",
    };
  }
  const timeoutMs = Math.max(100, options.timeoutMs ?? 5000);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    const response = await fetchImpl(`${serverUrl}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      response.ok &&
      (!body || body.status === undefined || body.status === "healthy" || body.ok === true)
    ) {
      return {
        ok: true,
        state: "healthy",
        status: response.status,
        message: messages.healthy ?? "피어 서버가 정상 응답했습니다.",
      };
    }
    const detail = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
    return {
      ok: false,
      state: "unhealthy",
      status: response.status,
      message: messages.unhealthy ? messages.unhealthy(detail) : `피어 서버 상태 확인 실패 (${detail})`,
    };
  } catch (err: unknown) {
    const errObj = err as { message?: string } | null;
    const aborted = controller.signal.aborted;
    return {
      ok: false,
      state: "unreachable",
      status: null,
      message: aborted
        ? (messages.timeout ?? "피어 서버 상태 확인 시간이 초과되었습니다.")
        : messages.unreachable
          ? messages.unreachable(errObj?.message || "network error")
          : `피어 서버에 연결할 수 없습니다 (${errObj?.message || "network error"})`,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromParent);
  }
}

export async function fetchPeerServerConfig(
  rawServerUrl: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<PeerServerPublicConfig | null> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return null;
  const serverUrl = normalizePeerUrl(rawServerUrl);
  const timeoutMs = Math.max(100, options.timeoutMs ?? 5000);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(`${serverUrl}/config`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as PeerServerPublicConfig | null;
    if (!body || typeof body !== "object" || typeof body.serverUrl !== "string") return null;
    return body;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromParent);
  }
}

export async function discoverPeerCatalog(
  options: DiscoverPeerCatalogOptions = {},
): Promise<DiscoveredPeerCatalog> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new PeerMcpError("fetch is unavailable; provide fetchImpl", "TRANSPORT_UNAVAILABLE");
  }
  const parsedInvite = options.invitationUrl ? parseInvitationUrl(options.invitationUrl) : null;
  const serverUrl = normalizeServerUrl(options.serverUrl ?? parsedInvite?.serverUrl);
  const roomId = parseRoomId(options.roomId ?? parsedInvite?.roomId);
  const endpoint =
    asNonEmptyString(options.mcpEndpoint) ||
    parsedInvite?.mcpEndpoint ||
    (roomId ? `${serverUrl}/p/${encodeURIComponent(roomId)}/mcp` : `${serverUrl}/mcp/catalog`);

  if (endpoint.endsWith("/mcp/catalog")) {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": `framebook-peer-mcp-client/${PACKAGE_VERSION}`,
      },
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const errStr = typeof body?.error === "string" ? body.error : undefined;
      throw new PeerMcpError(
        errStr || `HTTP ${response.status}: catalog discovery failed`,
        errStr || `HTTP_${response.status}`,
        body,
      );
    }
    const tools = normalizeTools({ result: { tools: body.tools } });
    return {
      protocolVersion: (typeof body.protocol === "string" ? body.protocol : undefined) || PROTOCOL_VERSION,
      tools,
      catalogVersion: (body.catalogVersion as number | string | undefined) ?? 1,
      catalogHash: (typeof body.catalogHash === "string" ? body.catalogHash : undefined) || hashTools(tools),
      _meta: body,
    };
  }

  const session = new PeerMcpSession({
    mcpEndpoint: endpoint,
    protocolVersion: options.protocolVersion ?? PROTOCOL_VERSION,
    requestTimeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    transport: createHttpTransport(endpoint, fetchImpl, {}, options.clientToken),
  });
  const initResult = await session.initialize();
  const tools = await session.listTools();
  const snapshot = session.getCatalogSnapshot();
  await session.disconnect();
  return {
    serverInfo: initResult?.serverInfo as Record<string, unknown> | undefined,
    protocolVersion: (initResult?.protocolVersion as string | undefined) ?? PROTOCOL_VERSION,
    tools,
    catalogVersion: snapshot.catalogVersion,
    catalogHash: snapshot.catalogHash,
    _meta: initResult?._meta as Record<string, unknown> | undefined,
  };
}

export async function joinPeerRoom(options: JoinPeerRoomOptions = {}): Promise<JoinedPeerRoom> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new PeerMcpError("fetch is unavailable; provide fetchImpl", "TRANSPORT_UNAVAILABLE");
  }
  const parsedInvite = options.invitationUrl ? parseInvitationUrl(options.invitationUrl) : null;
  const serverUrl = normalizeServerUrl(options.serverUrl ?? parsedInvite?.serverUrl);
  const roomId = parseRoomId(options.roomId ?? parsedInvite?.roomId);
  const inviteToken = asNonEmptyString(options.inviteToken) ?? parsedInvite?.inviteToken;
  if (!roomId) throw new PeerMcpError("A roomId or invitationUrl is required to join a peer room", "ROOM_ID_REQUIRED");
  if (!inviteToken) {
    throw new PeerMcpError("An inviteToken or invitationUrl is required to join a peer room", "INVITE_TOKEN_REQUIRED");
  }

  const capabilities =
    Array.isArray(options.capabilities) && options.capabilities.length > 0
      ? options.capabilities
      : ["mcp-control"];
  const response = await fetchImpl(`${serverUrl}/p/${encodeURIComponent(roomId)}/join`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": `framebook-peer-mcp-client/${PACKAGE_VERSION}`,
    },
    body: JSON.stringify({
      inviteToken,
      clientLabel: asNonEmptyString(options.clientLabel) || "MCP client",
      capabilities,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const errStr = typeof body?.error === "string" ? body.error : undefined;
    throw new PeerMcpError(
      errStr || `HTTP ${response.status}: peer room join failed`,
      errStr || `HTTP_${response.status}`,
      body,
    );
  }
  return {
    ...(body as unknown as JoinedPeerRoom),
    serverUrl,
    wsUrl: websocketUrl(serverUrl, roomId),
    mcpEndpoint: `${serverUrl}/p/${encodeURIComponent(roomId)}/mcp`,
  };
}

export async function getPeerSessionStatus(
  options: PeerSessionStatusOptions = {},
): Promise<Record<string, unknown>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new PeerMcpError("fetch is unavailable; provide fetchImpl", "TRANSPORT_UNAVAILABLE");
  }
  const serverUrl = normalizeServerUrl(options.serverUrl);
  const roomId = parseRoomId(options.roomId);
  const sessionId = asNonEmptyString(options.sessionId);
  const clientToken = asNonEmptyString(options.clientToken);
  if (!roomId) throw new PeerMcpError("roomId is required", "ROOM_ID_REQUIRED");
  if (!sessionId) throw new PeerMcpError("sessionId is required", "SESSION_REQUIRED");
  if (!clientToken) throw new PeerMcpError("clientToken is required", "CLIENT_TOKEN_REQUIRED");

  const response = await fetchImpl(
    `${serverUrl}/p/${encodeURIComponent(roomId)}/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${clientToken}`,
        "user-agent": `framebook-peer-mcp-client/${PACKAGE_VERSION}`,
      },
    },
  );
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const errStr = typeof body?.error === "string" ? body.error : undefined;
    throw new PeerMcpError(
      errStr || `HTTP ${response.status}: failed to read peer session status`,
      errStr || `HTTP_${response.status}`,
      body,
    );
  }
  return body;
}

export async function waitForPeerApproval(
  options: WaitForPeerApprovalOptions = {},
): Promise<Record<string, unknown>> {
  const pollIntervalMs = Math.max(25, options.pollIntervalMs ?? 250);
  const timeoutMs = Math.max(pollIntervalMs, options.timeoutMs ?? 30_000);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    if (options.signal?.aborted) {
      throw new PeerMcpError("Waiting for peer approval was aborted", "APPROVAL_ABORTED");
    }
    const status = await getPeerSessionStatus(options);
    if (status.state === "approved") {
      return status;
    }
    if (status.state === "rejected") {
      throw new PeerMcpError("Peer approval request was rejected", "CLIENT_APPROVAL_DENIED", status);
    }
    if (status.state === "revoked") {
      throw new PeerMcpError("Peer session was revoked", "SESSION_REVOKED", status);
    }
    if (status.state === "expired") {
      throw new PeerMcpError("Peer session expired", "APPROVAL_EXPIRED", status);
    }
    if (status.state === "room-rotated") {
      throw new PeerMcpError("Peer room was rotated", "ROOM_ROTATED", status);
    }
    if (Date.now() >= deadline) {
      throw new PeerMcpError("Timed out waiting for peer approval", "APPROVAL_TIMEOUT", status);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export async function rotatePeerRoom(
  options: RotatePeerRoomOptions = {},
): Promise<Record<string, unknown>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new PeerMcpError("fetch is unavailable; provide fetchImpl", "TRANSPORT_UNAVAILABLE");
  }
  const serverUrl = normalizeServerUrl(options.serverUrl);
  const roomId = parseRoomId(options.roomId);
  const providerToken = asNonEmptyString(options.providerToken);
  if (!roomId) throw new PeerMcpError("roomId is required to rotate a peer room", "ROOM_ID_REQUIRED");
  if (!providerToken) {
    throw new PeerMcpError("providerToken is required to rotate a peer room", "PROVIDER_TOKEN_REQUIRED");
  }

  const response = await fetchImpl(`${serverUrl}/p/${encodeURIComponent(roomId)}/rotate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${providerToken}`,
      "user-agent": `framebook-peer-mcp-client/${PACKAGE_VERSION}`,
    },
    body: JSON.stringify({
      roomId,
      ...(Number.isSafeInteger(options.roomEpoch) ? { roomEpoch: options.roomEpoch } : {}),
      ...(asNonEmptyString(options.alias) ? { alias: asNonEmptyString(options.alias) } : {}),
      requestedAt: new Date().toISOString(),
    }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const errStr = typeof body?.error === "string" ? body.error : undefined;
    throw new PeerMcpError(
      errStr || `HTTP ${response.status}: peer room rotate failed`,
      errStr || `HTTP_${response.status}`,
      body,
    );
  }
  return body;
}
