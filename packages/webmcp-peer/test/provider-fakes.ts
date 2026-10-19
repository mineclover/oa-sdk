// Test doubles for driving WebMcpPeerClient through its public API without a real relay:
// a scripted relay (HTTP room routes + provider WebSocket) and in-memory browser storage.
import { vi } from "vitest";
import type { WebMcpPeerClient } from "../src/provider.js";

export type Frame = Record<string, unknown>;

/** A provider-side WebSocket whose frames the test reads and writes directly. */
export class FakeRelaySocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => unknown) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: Frame[] = [];

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Frame);
  }

  /** Called by the provider (disconnect, release). */
  close(): void {
    if (this.readyState === FakeRelaySocket.CLOSED) return;
    this.readyState = FakeRelaySocket.CLOSED;
    queueMicrotask(() => this.onclose?.());
  }

  /** The relay delivers a frame to the provider. */
  deliver(frame: Frame): void {
    void this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /** The connection drops from the relay side. */
  drop(): void {
    this.readyState = FakeRelaySocket.CLOSED;
    this.onclose?.();
  }
}

interface IssuedRoom {
  readonly id: string;
  readonly roomEpoch: number;
  leaseToken: string;
}

/**
 * Scripted relay. `POST /p` creates a room, `POST /p/:id/reclaim` re-issues it when the lease
 * token matches, and every provider socket receives `ready` followed (in the same tick, as one
 * network read can deliver them) by whatever `afterReady` sends.
 */
export class FakeRelay {
  readonly base = "http://relay.test";
  readonly sockets: FakeRelaySocket[] = [];
  readonly fetchCalls: Array<{ url: string; method: string }> = [];
  reachable = true;
  afterReady?: (socket: FakeRelaySocket, room: IssuedRoom) => void;
  private room?: IssuedRoom;
  private issued = 0;

  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = init.method ?? "GET";
    this.fetchCalls.push({ url, method });
    if (!this.reachable) throw new TypeError("fetch failed");
    if (method === "POST" && url === `${this.base}/p`) {
      this.room = { id: "abcdef0123456789", roomEpoch: 1, leaseToken: "" };
      return Response.json(this.descriptor(this.room), { status: 201 });
    }
    const reclaim = url.match(/\/p\/([^/]+)\/reclaim$/);
    if (method === "POST" && reclaim) {
      const body = JSON.parse(String(init.body)) as { leaseToken?: string; roomEpoch?: number };
      if (!this.room || reclaim[1] !== this.room.id) return Response.json({ error: "ROOM_NOT_FOUND" }, { status: 404 });
      if (body.leaseToken !== this.room.leaseToken || body.roomEpoch !== this.room.roomEpoch) {
        return Response.json({ error: "ROOM_LEASE_INVALID" }, { status: 401 });
      }
      return Response.json({ ...this.descriptor(this.room), reclaimed: true });
    }
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  };

  readonly WebSocket: typeof FakeRelaySocket;

  constructor() {
    const relay = this;
    this.WebSocket = class extends FakeRelaySocket {
      constructor(url: string, protocols: string[]) {
        super(url, protocols);
        relay.sockets.push(this);
        queueMicrotask(() => relay.open(this));
      }
    };
  }

  get latest(): FakeRelaySocket {
    const socket = this.sockets[this.sockets.length - 1];
    if (!socket) throw new Error("no provider socket was opened");
    return socket;
  }

  get roomId(): string {
    if (!this.room) throw new Error("no room was created");
    return this.room.id;
  }

  private descriptor(room: IssuedRoom): Frame {
    this.issued += 1;
    room.leaseToken = `lease-${this.issued}`;
    const now = Date.now();
    return {
      id: room.id,
      roomId: room.id,
      roomEpoch: room.roomEpoch,
      providerToken: `provider-${this.issued}`,
      inviteToken: "invite-token",
      reconnectToken: room.leaseToken,
      reconnectTokenExpiresAt: now + 15 * 60_000,
      descriptorUrl: `${this.base}/p/${room.id}/mcp`,
      expiresAt: now + 2 * 60 * 60_000,
      capabilities: ["mcp-control"],
      approvalRequired: true,
    };
  }

  private open(socket: FakeRelaySocket): void {
    if (!this.room || socket.readyState !== FakeRelaySocket.CONNECTING) return;
    socket.readyState = FakeRelaySocket.OPEN;
    socket.onopen?.();
    socket.deliver({ type: "ready", role: "provider", roomId: this.room.id, roomEpoch: this.room.roomEpoch });
    this.afterReady?.(socket, this.room);
  }
}

/** In-memory Web Storage. */
export class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

/** Installs the relay's fetch/WebSocket globals, optionally with browser storage. */
export function installRelay(relay: FakeRelay, options: { browser?: boolean } = {}): void {
  vi.stubGlobal("fetch", relay.fetch);
  vi.stubGlobal("WebSocket", relay.WebSocket);
  if (options.browser) {
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal("window", { location: { search: "", pathname: "/" }, sessionStorage });
  }
}

/** Waits (real time) until `read` returns a defined value. */
export async function until<T>(read: () => T | undefined, label: string, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

/** Lets queued microtasks (socket open, ready handling) run. */
export async function flushMicrotasks(rounds = 5): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

export interface RpcReply {
  readonly id: unknown;
  readonly result?: Record<string, unknown> & { content?: Array<Record<string, unknown>> };
  readonly error?: { code: number; message: string };
}

/** The provider's JSON-RPC reply to request `id` on `socket`, once it has been sent. */
export function replyTo(socket: FakeRelaySocket, id: string | number, timeoutMs?: number): Promise<RpcReply> {
  return until(
    () => {
      for (const frame of socket.sent) {
        const message = frame.message as RpcReply | undefined;
        if (frame.type === "mcp" && message && message.id === id) return message;
      }
      return undefined;
    },
    `reply to ${String(id)}`,
    timeoutMs,
  );
}

/** Relays one tools/call to the provider and returns its reply. */
export function callTool(
  socket: FakeRelaySocket,
  id: string | number,
  name: string,
  options: { args?: Record<string, unknown>; runId?: string; phase?: string; timeoutMs?: number } = {},
): Promise<RpcReply> {
  socket.deliver({
    type: "mcp",
    message: {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name,
        arguments: options.args ?? {},
        ...(options.runId
          ? { _meta: { framebook: { aiTrace: { runId: options.runId, ...(options.phase ? { phase: options.phase } : {}) } } } }
          : {}),
      },
    },
  });
  return replyTo(socket, id, options.timeoutMs);
}

/** Delivers an approval request for `sessionId` and approves it from the host side. */
export async function approve(provider: WebMcpPeerClient, socket: FakeRelaySocket, roomId: string, sessionId = "peer-session-agent"): Promise<void> {
  socket.deliver({
    protocol: "webmcp-peer/1",
    type: "approval.request",
    roomId,
    roomEpoch: 1,
    sessionId,
    requestId: `approval-${sessionId}`,
    payload: { requestId: `approval-${sessionId}`, sessionId, roomId, roomEpoch: 1, clientLabel: "Agent" },
  });
  await until(() => (provider.getSession().approvalState === "pending" ? true : undefined), "approval request");
  if (!provider.approveClient()) throw new Error("approveClient() refused");
}
