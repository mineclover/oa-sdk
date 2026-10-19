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
  PeerMcpSessionInfo,
  PeerMcpSessionOptions,
  PeerMcpStore,
} from "./types.js";

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
  ): Promise<PeerMcpCallToolResult> {
    const session = this.getSession(options.sessionId ?? this.activeSessionId);
    if (!session) throw new PeerMcpError("No active peer MCP session", "SESSION_NOT_FOUND");
    await session.connect();
    return session.callTool(name, args, options);
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
