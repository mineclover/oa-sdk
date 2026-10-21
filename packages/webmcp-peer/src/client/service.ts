import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PeerMcpError } from "./errors.js";
import { PeerMcpCatalogCacheSchema } from "./schemas.js";
import { PeerMcpSession } from "./session.js";
import type {
  PeerMcpCallOptions,
  PeerMcpCallToolResult,
  PeerMcpCatalogCache,
  PeerMcpCatalogSnapshot,
  PeerMcpServiceSessionOptions,
  PeerMcpSessionInfo,
  PeerMcpSessionOptions,
  PeerMcpStore,
} from "./types.js";

/**
 * A registry of peer MCP sessions under keys of the caller's choosing, one of them active. A key
 * names a session in this registry only: the session's `sessionId` stays the relay's own id (or
 * none until the relay supplies it), so revoking a session registered under any key uses the
 * route its relay session id allows.
 */
export class PeerMcpService {
  options: PeerMcpSessionOptions;
  sessions: Map<string, PeerMcpSession>;
  /** The key of the session the methods act on when no key is given. */
  activeKey?: string;

  constructor(options: PeerMcpSessionOptions = {}) {
    this.options = { ...options };
    this.sessions = new Map();
    this.activeKey = undefined;
  }

  /**
   * Creates a session and registers it, as the active one, under `options.key`, else its
   * `sessionId`, else a new `peer-session-<uuid>`. A session already registered under that key is
   * replaced, not disconnected; on the service's own `transport`, which every session it makes is
   * handed, the replacing session's connect ends the replaced one's connection
   * (TRANSPORT_SUPERSEDED), as one transport object has one live connection at most.
   */
  createSession(options: PeerMcpServiceSessionOptions = {}): PeerMcpSession {
    const { key: requestedKey, ...sessionOptions } = options;
    const session = new PeerMcpSession({ ...this.options, ...sessionOptions });
    const key = requestedKey || session.sessionId || `peer-session-${randomUUID()}`;
    this.sessions.set(key, session);
    this.activeKey = key;
    return session;
  }

  getSession(key = this.activeKey): PeerMcpSession | undefined {
    return key ? this.sessions.get(key) : undefined;
  }

  listSessions(): PeerMcpSessionInfo[] {
    return [...this.sessions.values()].map((session) => session.getSessionInfo());
  }

  async connect(options: PeerMcpServiceSessionOptions = {}): Promise<PeerMcpSession> {
    const session = this.createSession(options);
    await session.connect();
    return session;
  }

  async disconnect(key = this.activeKey): Promise<PeerMcpSessionInfo | undefined> {
    const session = this.getSession(key);
    if (!session || !key) return undefined;
    const info = await session.disconnect();
    this.unregister(key);
    return info;
  }

  async revoke(key = this.activeKey, reason = "client-request"): Promise<Record<string, unknown>> {
    const session = this.getSession(key);
    if (!session || !key) throw new PeerMcpError("Peer session is not registered", "SESSION_NOT_FOUND");
    const result = await session.revoke(reason);
    this.unregister(key);
    return result;
  }

  /**
   * Lists the catalog again on the session registered under `key`, or on the active one. Like each
   * of the session's requests, it connects the session when it is not connected, unless the relay
   * ended the session for good (see `PeerMcpSession.request`), which the session's own `connect()`
   * connects again.
   */
  async refreshCatalog(key = this.activeKey): Promise<PeerMcpCatalogSnapshot> {
    const session = this.getSession(key);
    if (!session) throw new PeerMcpError("No active peer MCP session", "SESSION_NOT_FOUND");
    await session.refreshCatalog();
    return session.getCatalogSnapshot();
  }

  /**
   * Calls `name` on the session registered under `options.key`, or on the active one, which
   * connects as `refreshCatalog` does.
   */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    options: PeerMcpCallOptions & { key?: string } = {},
  ): Promise<PeerMcpCallToolResult> {
    const { key = this.activeKey, ...callOptions } = options;
    const session = this.getSession(key);
    if (!session) throw new PeerMcpError("No active peer MCP session", "SESSION_NOT_FOUND");
    return session.callTool(name, args, callOptions);
  }

  /** Drops the session registered under `key`; the first remaining one becomes active if it was. */
  private unregister(key: string): void {
    this.sessions.delete(key);
    if (this.activeKey === key) this.activeKey = this.sessions.keys().next().value;
  }
}

/**
 * Atomic JSON file store for a session's tool catalog cache (`PeerMcpSessionOptions.storage`).
 * `load()` returns the cache only when the file holds a valid catalog; a missing, corrupt or
 * stale-shaped file yields undefined so the session falls back to a live `tools/list`.
 */
export class JsonPeerMcpStore implements PeerMcpStore {
  filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): PeerMcpCatalogCache | undefined {
    if (!this.filePath) return undefined;
    try {
      return PeerMcpCatalogCacheSchema.parse(JSON.parse(fs.readFileSync(this.filePath, "utf8")));
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

export function createPeerMcpService(options: PeerMcpSessionOptions = {}): PeerMcpService {
  return new PeerMcpService(options);
}
