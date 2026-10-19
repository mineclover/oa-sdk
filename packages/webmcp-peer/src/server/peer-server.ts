import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Duplex } from "node:stream";
import { MCP_INITIALIZE_PROTOCOL_VERSIONS } from "../provider/commit-receipt.js";
import {
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
  MAX_WEBSOCKET_MESSAGE_BYTES,
  upgradeWebSocket,
  type PeerSocket,
} from "./ws-upgrade.js";

// Request headers a browser may send cross-origin. The MCP ones are what browser-hosted Streamable
// HTTP clients send after `initialize`; without them every such request fails its CORS preflight.
const BROWSER_ALLOWED_REQUEST_HEADERS = 'Content-Type, Authorization, X-Requested-With, X-Publish-Key, X-Framebook-Owner, X-Owner-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name';
const MCP_POST_MAX_BYTES = 150_000;

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
  readonly deploymentCatalog: DeploymentCatalogSnapshot;
  readonly serverName: string;
  readonly serverVersion: string;
  private mcpWireSequence = 0;
  private readonly publishKeyHash?: string;
  protected readonly roomSweepTimer?: ReturnType<typeof setInterval>;
  private readonly customHttpHandler?: WebMcpPeerServerOptions['customHttpHandler'];
  private readonly customUpgradeHandler?: WebMcpPeerServerOptions['customUpgradeHandler'];
  private readonly formatHttpErrorHook?: WebMcpPeerServerOptions['formatHttpError'];

  constructor(options: WebMcpPeerServerOptions = {}) {
    const config = resolvePeerServerConfig(options);
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
    const expiresAt = Date.now() + Math.max(60_000, ttlMs);
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
      metadataRetainUntil: expiresAt + 24 * 60 * 60_000,
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

  public requestOrigin(req: IncomingMessage): string {
    const forwardedProto = (req.headers['x-forwarded-proto'] as string) || ((req.socket as any).encrypted ? 'https' : 'http');
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

  protected catalogHash(tools: unknown[]): string {
    const canonicalize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonicalize);
      if (!this.isRecord(value)) return value;
      return Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
    };
    const orderedTools = [...tools].sort((left, right) => {
      const leftName = this.isRecord(left) && typeof left.name === 'string' ? left.name : '';
      const rightName = this.isRecord(right) && typeof right.name === 'string' ? right.name : '';
      return leftName.localeCompare(rightName);
    });
    const canonical = canonicalize(orderedTools);
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  protected isRpcRequest(value: unknown): value is { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: unknown } {
    if (!this.isRecord(value) || value.jsonrpc !== '2.0' || typeof value.method !== 'string') return false;
    if ('id' in value && value.id !== undefined && value.id !== null
      && typeof value.id !== 'string' && typeof value.id !== 'number') return false;
    return true;
  }

  protected isRpcResponse(value: unknown): value is { jsonrpc: '2.0'; id: string | number; result?: unknown; error?: unknown } {
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

  protected sendRpcError(socket: PeerSocket, id: string | number | null | undefined, code: number, message: string, data?: unknown): void {
    if (id === undefined) return;
    const error: Record<string, unknown> = { code, message };
    if (data !== undefined) error.data = data;
    socket.send({ type: 'mcp', message: { jsonrpc: '2.0', id, error } });
  }

  protected replaceCatalog(entry: RoomEntry, value: unknown): boolean {
    const tools = this.normalizeTools(value);
    if (!tools) return false;
    const hash = this.catalogHash(tools);
    if (entry.catalogVersion > 0 && hash === entry.catalogHash) return true;
    entry.cachedTools = tools;
    entry.catalogSource = 'provider';
    entry.catalogHash = hash;
    entry.catalogVersion += 1;
    entry.catalogUpdatedAt = Date.now();
    for (const client of entry.clientSockets) {
      client.send({
        type: 'mcp',
        message: {
          jsonrpc: '2.0',
          method: 'notifications/tools/list_changed',
          params: { catalogVersion: entry.catalogVersion, catalogHash: entry.catalogHash },
        },
      });
    }
    return true;
  }

  protected clearPending(entry: RoomEntry, key: string, error?: { code: number; message: string }): void {
    const pending = entry.mcpPending.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    entry.mcpPending.delete(key);
    if (error) {
      this.sendRpcError(pending.socket, pending.id, error.code, error.message);
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

  public authorizePublishRequest(req: IncomingMessage): { ok: true; tokenHash: string } | { ok: false; tokenHash: string; error: 'PUBLISH_KEY_REQUIRED' | 'PUBLISH_KEY_INVALID' } {
    if (!this.publishKeyConfigured || !this.publishKeyHash) {
      return { ok: true, tokenHash: 'anonymous' };
    }
    const token = this.bearerToken(req);
    if (!token) return { ok: false, tokenHash: 'missing', error: 'PUBLISH_KEY_REQUIRED' };
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    if (!this.constantTimeTokenEqual(tokenHash, this.publishKeyHash)) return { ok: false, tokenHash, error: 'PUBLISH_KEY_INVALID' };
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

  public async readJsonBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) throw new Error('BODY_TOO_LARGE');
      chunks.push(buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!this.isRecord(parsed)) throw new Error('BODY_OBJECT_REQUIRED');
    return parsed;
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

  protected sendApprovalRequest(entry: RoomEntry, ticket: ClientSessionTicket, socket?: PeerSocket): PendingApprovalRequest | null {
    if (!entry.approvalRequired || ticket.status === 'approved') return null;
    const existing = ticket.approvalRequestId ? entry.pendingApprovals.get(ticket.approvalRequestId) : undefined;
    if (existing) {
      entry.providerSocket?.send({
        protocol: 'webmcp-peer/1', messageId: `approval-${existing.requestId}`, type: 'approval.request',
        roomId: entry.id, roomEpoch: entry.roomEpoch, sessionId: ticket.sessionId, requestId: existing.requestId,
        sentAt: new Date(existing.createdAt).toISOString(), expiresAt: existing.expiresAt,
        payload: { requestId: existing.requestId, sessionId: ticket.sessionId, roomId: entry.id, roomEpoch: entry.roomEpoch, clientLabel: existing.clientLabel, capabilities: [...ticket.capabilities], requestedAt: new Date(existing.createdAt).toISOString(), expiresAt: existing.expiresAt },
      });
      if (socket) socket.send({ type: 'approval.pending', roomId: entry.id, roomEpoch: entry.roomEpoch, requestId: existing.requestId, sessionId: ticket.sessionId, capabilities: [...ticket.capabilities], expiresAt: existing.expiresAt });
      return existing;
    }
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
    const sentAt = new Date(request.createdAt).toISOString();
    entry.providerSocket?.send({
      protocol: 'webmcp-peer/1',
      messageId: `approval-${requestId}`,
      type: 'approval.request',
      roomId: entry.id,
      roomEpoch: entry.roomEpoch,
      sessionId: ticket.sessionId,
      requestId,
      sentAt,
      expiresAt: request.expiresAt,
      payload: {
        requestId,
        sessionId: ticket.sessionId,
        roomId: entry.id,
        roomEpoch: entry.roomEpoch,
        clientLabel: request.clientLabel,
        capabilities: [...ticket.capabilities],
        requestedAt: sentAt,
        expiresAt: request.expiresAt,
      },
    });
    if (socket) socket.send({ type: 'approval.pending', roomId: entry.id, roomEpoch: entry.roomEpoch, requestId, sessionId: ticket.sessionId, capabilities: [...ticket.capabilities], expiresAt: request.expiresAt });
    return request;
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
      socket.send({
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
      socket.send({ type: 'ready', role: 'client', roomId: entry.id, roomEpoch: entry.roomEpoch, sessionId: ticket.sessionId, capabilities: [...ticket.capabilities], expiresAt: ticket.expiresAt, approval: 'approved' });
    }
    ticket.approvalRequestId = undefined;
    return true;
  }

  protected revokeAllClientTickets(entry: RoomEntry, reason: string, status: 'revoked' | 'room-rotated' = 'revoked'): void {
    for (const [token] of entry.clientTokens) this.closeClientTicket(entry, token, status, reason);
    for (const pending of entry.mcpPending.values()) clearTimeout(pending.timer);
    entry.mcpPending.clear();
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
        defaults: { approvalRequired: true, roomTtlMs: 2 * 60 * 60 * 1000 },
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
      let body: Record<string, unknown>;
      try { body = await this.readJsonBody(req); } catch {
        this.sendJson(res, 400, { error: 'INVALID_JSON_BODY' }, origin);
        return;
      }
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
      if (!entry) {
        this.sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }, origin);
        return;
      }
      if (entry.rotatedTo) {
        this.sendJson(res, 410, {
          error: 'ROOM_ROTATED', code: -32057, roomId, roomEpoch: entry.roomEpoch,
          replacementRoomId: entry.rotatedTo,
        }, origin);
        return;
      }
      const now = Date.now();
      if (entry.expiresAt <= now || entry.reconnectLeaseExpiresAt <= now) {
        this.sendJson(res, 404, { error: 'ROOM_EXPIRED' }, origin);
        return;
      }
      let body: Record<string, unknown>;
      try { body = await this.readJsonBody(req); } catch {
        this.sendJson(res, 400, { error: 'INVALID_JSON_BODY' }, origin);
        return;
      }
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
      const chunks: Buffer[] = [];
      let received = 0;
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
        received += (chunk as Buffer).length;
        if (received > MCP_POST_MAX_BYTES) break;
      }
      if (received > MCP_POST_MAX_BYTES) {
        // The unread rest of the body leaves the connection unusable, so it must not be kept alive.
        this.sendJson(res, 413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'REQUEST_TOO_LARGE', data: { maxBytes: MCP_POST_MAX_BYTES } } }, origin, { Connection: 'close' });
        return;
      }
      let rpc: unknown;
      try { rpc = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
        this.sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'PARSE_ERROR' } }, origin);
        return;
      }
      // MCP request ids must be a string or a number; a message without an id is a notification.
      if (!this.isRpcRequest(rpc) || rpc.id === null) {
        this.sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'INVALID_REQUEST' } }, origin);
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
          result: {
            protocolVersion: this.negotiateProtocolVersion(rpc.params),
            serverInfo: { name: this.serverName, version: this.serverVersion },
            tools: snapshot.tools,
            _meta: {
              roomId,
              roomEpoch: entry?.roomEpoch ?? 0,
              roomState,
              roomValid: Boolean(entry && !entry.rotatedTo && entry.expiresAt > Date.now()),
              catalogVersion: snapshot.catalogVersion,
              catalogHash: snapshot.catalogHash,
              auth: this.mcpAuthMetadata(entry, mcpTicket?.status ?? 'not-joined'),
            },
          },
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
            _meta: {
              roomId,
              roomEpoch: entry?.roomEpoch ?? 0,
              roomState,
              roomValid: Boolean(entry && !entry.rotatedTo && entry.expiresAt > Date.now()),
              catalogVersion: snapshot.catalogVersion,
              catalogHash: snapshot.catalogHash,
              auth: this.mcpAuthMetadata(entry, mcpTicket?.status ?? 'not-joined'),
            },
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
      // A null id was rejected above, so here it means the message had no id: a notification.
      if (id === null) {
        entry.providerSocket.send({ type: 'mcp', message: rpc });
        this.sendAccepted(res, origin);
        return;
      }
      const wireId = this.allocateWireId(entry, id);
      const key = this.rpcKey(wireId);
      let resolveResponse!: (value: unknown) => void;
      const responsePromise = new Promise<unknown>(resolveResp => { resolveResponse = resolveResp; });
      const bridgeSocket: PeerSocket = {
        send: value => resolveResponse(this.isRecord(value) && value.type === 'mcp' ? value.message : value),
        close: () => {},
      };
      const timer = setTimeout(() => this.clearPending(entry, key, { code: -32001, message: 'MCP_REQUEST_TIMEOUT' }), this.mcpRequestTimeoutMs);
      entry.mcpPending.set(key, { socket: bridgeSocket, timer, method: rpc.method, id, wireId });
      entry.providerSocket.send({ type: 'mcp', message: wireId === id ? rpc : { ...rpc, id: wireId } });
      const response = await responsePromise;
      this.sendJson(res, 200, response, origin);
      return;
    }

    // 2. Client Join: POST /p/:id/join
    const joinMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/join$/);
    if (req.method === 'POST' && joinMatch) {
      const roomId = joinMatch[1];
      const entry = this.rooms.get(roomId);
      if (entry?.rotatedTo) {
        this.sendJson(res, 410, { error: 'ROOM_ROTATED', code: -32057, replacementRoomId: entry.rotatedTo, roomId, roomEpoch: entry.roomEpoch }, origin);
        return;
      }
      if (!entry || entry.expiresAt < Date.now()) {
        this.sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }, origin);
        return;
      }
      let body: Record<string, unknown>;
      try {
        body = await this.readJsonBody(req);
      } catch (error) {
        this.sendJson(res, 400, { error: error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'INVALID_JSON_BODY' }, origin);
        return;
      }
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
      const clientLabel = typeof body.clientLabel === 'string' && body.clientLabel.trim() ? body.clientLabel.trim() : 'MCP client';
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
      if (!entry || entry.expiresAt <= Date.now()) {
        this.sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }, origin);
        return;
      }
      const authorization = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
      const bearer = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      if (!bearer || !this.constantTimeTokenEqual(bearer, entry.providerToken)) {
        this.sendJson(res, 401, { error: 'PROVIDER_TOKEN_REQUIRED' }, origin);
        return;
      }
      const body: Record<string, unknown> = await this.readJsonBody(req).catch(() => ({} as Record<string, unknown>));
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
      const authorized = Boolean(bearer && ((found && this.constantTimeTokenEqual(bearer, found.token)) || this.constantTimeTokenEqual(bearer, entry.providerToken)));
      if (!authorized || !found) {
        this.sendJson(res, authorized ? 404 : 401, { error: authorized ? 'SESSION_NOT_FOUND' : 'CLIENT_TOKEN_REQUIRED' }, origin);
        return;
      }
      const ticket = found.ticket;
      if (ticket.expiresAt <= Date.now() && ticket.status !== 'revoked' && ticket.status !== 'rejected') ticket.status = 'expired';
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
      if (!entry || entry.expiresAt <= Date.now()) {
        this.sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }, origin);
        return;
      }
      const authorization = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
      const bearer = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      const body: Record<string, unknown> = await this.readJsonBody(req).catch(() => ({} as Record<string, unknown>));
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
        this.closeClientTicket(entry, found.token, 'revoked', 'SESSION_REVOKED');
        this.sendJson(res, 200, { roomId, roomEpoch: entry.roomEpoch, sessionId: requestedSessionId, state: 'revoked', revoked: true, revokedAt: new Date().toISOString(), reason: body.reason ?? 'provider-request', alreadyRevoked: found.ticket.status === 'revoked' }, origin);
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
      this.closeClientTicket(entry, bearer, 'revoked', 'CLIENT_REVOKED');
      this.sendJson(res, 200, { roomId, roomEpoch: entry.roomEpoch, sessionId: ticket.sessionId, state: 'revoked', revoked: true, revokedAt: new Date().toISOString(), reason: body.reason ?? 'client-request', alreadyRevoked: ticket.status === 'revoked' }, origin);
      return;
    }

    // 6. Room Rotation: POST /p/:id/rotate
    const rotateMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/rotate$/);
    if (req.method === 'POST' && rotateMatch) {
      const roomId = rotateMatch[1];
      const entry = this.rooms.get(roomId);
      if (!entry || entry.expiresAt <= Date.now()) {
        this.sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }, origin);
        return;
      }
      const authorization = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
      const bearer = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      if (!bearer || !this.constantTimeTokenEqual(bearer, entry.providerToken)) {
        this.sendJson(res, 401, { error: 'PROVIDER_TOKEN_REQUIRED' }, origin);
        return;
      }
      const body: Record<string, unknown> = await this.readJsonBody(req).catch(() => ({} as Record<string, unknown>));
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
              if (entry.expiresAt <= Date.now()) {
                peer.close();
                return;
              }
              const msg = JSON.parse(text);
              if (msg && msg.type === 'ping') {
                peer.send({ type: 'pong', timestamp: Date.now() });
                return;
              }
              if (msg && msg.type === 'approval.decision') {
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
                // Only a catalog the relay accepted is announced, stamped with the authoritative
                // version/hash so clients never derive a catalog the server would reject.
                if (!this.replaceCatalog(entry, msg.tools)) {
                  peer.send({ type: 'error', code: -32602, message: 'CATALOG_INVALID', reason: 'register.tools must be at most 128 uniquely named tools with an object inputSchema' });
                  return;
                }
                const announced = { ...msg, tools: entry.cachedTools, catalogVersion: entry.catalogVersion, catalogHash: entry.catalogHash };
                for (const cs of entry.clientSockets) cs.send(announced);
                return;
              }
              if (msg.type === 'mcp' && this.isRpcResponse(msg.message)) {
                const rpc = msg.message;
                const pending = entry.mcpPending.get(this.rpcKey(rpc.id));
                if (!pending) return;
                this.clearPending(entry, this.rpcKey(rpc.id));
                if (this.isRecord(rpc.result) && 'tools' in rpc.result) {
                  this.replaceCatalog(entry, rpc.result.tools);
                }
                let response = pending.wireId === pending.id
                  ? msg
                  : { ...msg, message: { ...rpc, id: pending.id } };
                if (pending.includeCatalogMeta && this.isRecord(rpc.result) && 'tools' in rpc.result) {
                  const responseMessage = this.isRecord(response) && this.isRecord(response.message) ? response.message : rpc;
                  response = {
                    ...response,
                    message: {
                      ...responseMessage,
                      result: {
                        ...rpc.result,
                        catalogVersion: entry.catalogVersion,
                        catalogHash: entry.catalogHash,
                      },
                    },
                  };
                }
                pending.socket.send(response);
                return;
              }
              if (msg.type === 'mcp' && this.isRpcRequest(msg.message)) {
                for (const cs of entry.clientSockets) cs.send(msg);
                return;
              }
              for (const cs of entry.clientSockets) {
                cs.send(msg);
              }
            } catch { /* malformed frames ignored */ }
          },
          () => {
            if (entry.providerSocket === peer) {
              entry.providerSocket = undefined;
              this.failPendingForProvider(entry);
            }
          },
        );

        entry.providerSocket = peer;
        entry.roomState = entry.clientTokens.size ? 'accepting-clients' : 'provider-connected';
        entry.updatedAt = Date.now();
        peer.send({ type: 'ready', role: 'provider', roomId, roomEpoch: entry.roomEpoch, capabilities: [...entry.capabilities], expiresAt: entry.expiresAt });
        for (const ticket of entry.clientTokens.values()) {
          if (ticket.status === 'pending') this.sendApprovalRequest(entry, ticket);
        }
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
              if (entry.expiresAt <= Date.now() || clientTicket.expiresAt <= Date.now()) {
                peer.close();
                return;
              }
              const msg = JSON.parse(text);
              if (msg && msg.type === 'ping') {
                peer.send({ type: 'pong', timestamp: Date.now() });
                return;
              }
              if (msg?.type === 'mcp') {
                const rpc = msg.message;
                if (!this.isRpcRequest(rpc)) {
                  this.sendRpcError(peer, this.isRecord(rpc) && ('id' in rpc) ? (rpc.id as any) : undefined, -32600, 'INVALID_REQUEST');
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
                const id = rpc.id;
                if (id === undefined || id === null) {
                  entry.providerSocket?.send(msg);
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
                const wireId = this.allocateWireId(entry, id);
                const key = this.rpcKey(wireId);
                if (!entry.providerSocket) {
                  this.sendRpcError(peer, id, -32001, 'PROVIDER_UNAVAILABLE');
                  return;
                }
                const timer = setTimeout(() => {
                  this.clearPending(entry, key, { code: -32001, message: 'MCP_REQUEST_TIMEOUT' });
                }, this.mcpRequestTimeoutMs);
                entry.mcpPending.set(key, {
                  socket: peer,
                  timer,
                  method: rpc.method,
                  id,
                  wireId,
                  includeCatalogMeta: this.isRecord(rpc.params) && this.isRecord(rpc.params._meta),
                });
                const wireMessage = wireId === id ? msg : { ...msg, message: { ...rpc, id: wireId } };
                entry.providerSocket.send(wireMessage);
                return;
              }
              entry.providerSocket?.send(msg);
            } catch { /* malformed frames ignored */ }
          },
          () => {
            entry.clientSockets.delete(peer);
            entry.clientSocketTickets.delete(peer);
            this.failPendingForSocket(entry, peer);
          },
        );

        entry.clientSockets.add(peer);
        entry.clientSocketTickets.set(peer, clientTicket);
        peer.send({ type: 'ready', role: 'client', roomId, roomEpoch: entry.roomEpoch, sessionId: clientTicket.sessionId, capabilities: [...clientTicket.capabilities], expiresAt: clientTicket.expiresAt, approval: clientTicket.status });
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
