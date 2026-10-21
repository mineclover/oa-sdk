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

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => unknown) | null = null;
  onclose: ((event?: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: Frame[] = [];
  /** The socket's own state, which {@link readyState} reports unless the socket is held open. */
  private state = FakeRelaySocket.CONNECTING;
  private heldOpen = false;

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}

  /** The state the provider reads: OPEN once the socket opened while it is held open (see {@link holdOpen}). */
  get readyState(): number {
    return this.heldOpen && this.state !== FakeRelaySocket.CONNECTING ? FakeRelaySocket.OPEN : this.state;
  }

  set readyState(state: number) {
    this.state = state;
  }

  /**
   * Keeps the socket OPEN to the provider from now on, even once the provider closed it or the relay
   * dropped it, so `sent` records every frame the provider still tries to send on it. The provider
   * writes a reply only to an OPEN socket, which would otherwise hide a reply it must not give.
   */
  holdOpen(): void {
    this.heldOpen = true;
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Frame);
  }

  /** Called by the provider (disconnect, release). */
  close(): void {
    if (this.state === FakeRelaySocket.CLOSED) return;
    this.state = FakeRelaySocket.CLOSED;
    queueMicrotask(() => this.onclose?.());
  }

  /** The relay delivers a frame to the provider. */
  deliver(frame: Frame): void {
    void this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /**
   * The connection ends from the relay side: with the relay's close `code`, or, without one, dropped
   * without a close event code (a provider reads that as 1006, a connection lost).
   */
  drop(code?: number): void {
    this.state = FakeRelaySocket.CLOSED;
    this.onclose?.(code === undefined ? undefined : { code, reason: "" });
  }
}

interface IssuedRoom {
  readonly id: string;
  readonly roomEpoch: number;
  leaseToken: string;
}

/**
 * Scripted relay. `POST /p` creates a room, `POST /p/:id/reclaim` re-issues it when the lease
 * token matches, `POST /p/:id/rotate` replaces it, `POST /p/:id/sessions/:sessionId/revoke` revokes
 * the session, and every provider socket receives `ready`
 * followed (in the same tick, as one network read can deliver them) by whatever `afterReady` sends.
 * Refusals use the relay's statuses and error names.
 */
export class FakeRelay {
  readonly base = "http://relay.test";
  readonly sockets: FakeRelaySocket[] = [];
  readonly fetchCalls: Array<{ url: string; method: string }> = [];
  /** The body of every `POST /p/:id/rotate`, in order. */
  readonly rotateBodies: Frame[] = [];
  /** The body of every `POST /p/:id/sessions/:sessionId/revoke`, in order. */
  readonly revokeBodies: Frame[] = [];
  reachable = true;
  /** Whether `POST /p` creates a room; while false it answers 503, as a relay that cannot. */
  creatable = true;
  /** Whether room descriptors report `roomEpoch`, which a relay is not required to. */
  reportsRoomEpoch = true;
  /** When set, every `POST /p/:id/reclaim` is answered with this status and body instead. */
  reclaimAnswer?: { status: number; body: Frame };
  /** Whether a provider socket that opens gets `ready`; while false it hears nothing, as from a relay that never answers. */
  sendsReady = true;
  afterReady?: (socket: FakeRelaySocket, room: IssuedRoom) => void;
  private room?: IssuedRoom;
  private issued = 0;

  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    // Normalized as a server sees the request: the scheme and host of a URL are case-insensitive.
    const url = new URL(String(input)).href;
    const method = init.method ?? "GET";
    this.fetchCalls.push({ url, method });
    if (!this.reachable) throw new TypeError("fetch failed");
    if (method === "POST" && url === `${this.base}/p`) {
      if (!this.creatable) return Response.json({ error: "PUBLISH_RATE_LIMIT_UNAVAILABLE", code: -32089 }, { status: 503 });
      this.room = { id: "abcdef0123456789", roomEpoch: 1, leaseToken: "" };
      return Response.json(this.descriptor(this.room), { status: 201 });
    }
    const reclaim = url.match(/\/p\/([^/]+)\/reclaim$/);
    if (method === "POST" && reclaim && this.reclaimAnswer) return Response.json(this.reclaimAnswer.body, { status: this.reclaimAnswer.status });
    if (method === "POST" && reclaim) {
      const body = JSON.parse(String(init.body)) as { leaseToken?: string; roomEpoch?: number };
      if (!this.room || reclaim[1] !== this.room.id) return Response.json({ error: "ROOM_NOT_FOUND", code: -32004 }, { status: 404 });
      if (!body.leaseToken) return Response.json({ error: "ROOM_LEASE_REQUIRED" }, { status: 400 });
      if (body.roomEpoch !== undefined && body.roomEpoch !== this.room.roomEpoch) {
        return Response.json({ error: "ROOM_LEASE_BINDING_INVALID", code: -32002 }, { status: 409 });
      }
      if (body.leaseToken !== this.room.leaseToken) return Response.json({ error: "ROOM_LEASE_INVALID" }, { status: 403 });
      return Response.json({ ...this.descriptor(this.room), reclaimed: true });
    }
    const rotate = url.match(/\/p\/([^/]+)\/rotate$/);
    if (method === "POST" && rotate) {
      const body = JSON.parse(String(init.body)) as Frame;
      this.rotateBodies.push(body);
      if (!this.room || rotate[1] !== this.room.id) return Response.json({ error: "ROOM_NOT_FOUND", code: -32004 }, { status: 404 });
      if (body.roomEpoch !== undefined && body.roomEpoch !== this.room.roomEpoch) {
        const binding = { roomId: this.room.id, roomEpoch: this.room.roomEpoch };
        return Response.json({ error: "ROOM_BINDING_INVALID", code: -32002, ...binding }, { status: 409 });
      }
      this.room = { id: "fedcba9876543210", roomEpoch: this.room.roomEpoch + 1, leaseToken: "" };
      return Response.json(this.descriptor(this.room), { status: 201 });
    }
    const revoke = url.match(/\/p\/([^/]+)\/sessions\/([^/]+)\/revoke$/);
    if (method === "POST" && revoke) {
      const body = JSON.parse(String(init.body)) as Frame;
      this.revokeBodies.push(body);
      if (!this.room || revoke[1] !== this.room.id) return Response.json({ error: "ROOM_NOT_FOUND", code: -32004 }, { status: 404 });
      if (body.roomEpoch !== undefined && body.roomEpoch !== this.room.roomEpoch) {
        return Response.json({ error: "SESSION_BINDING_INVALID", code: -32002 }, { status: 409 });
      }
      return Response.json({ roomId: this.room.id, sessionId: decodeURIComponent(revoke[2]!), state: "revoked", revoked: true });
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

  /** Replaces the room's lease token, so the lease a provider saved is refused (403). */
  replaceLease(): void {
    if (this.room) this.room.leaseToken = `lease-replaced-${++this.issued}`;
  }

  private descriptor(room: IssuedRoom): Frame {
    this.issued += 1;
    room.leaseToken = `lease-${this.issued}`;
    const now = Date.now();
    return {
      id: room.id,
      roomId: room.id,
      ...(this.reportsRoomEpoch ? { roomEpoch: room.roomEpoch } : {}),
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
    if (!this.sendsReady) return;
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

/** The session `approve` approves by default, which the relayed requests below come from. */
export const AGENT_SESSION_ID = "peer-session-agent";

/**
 * The stamp the relay puts on every request it forwards to the provider: who sent it, and the session
 * of the ticket that did (R-SIG-005).
 */
export function relayStamp(sessionId = AGENT_SESSION_ID): { from: "client"; sessionId: string } {
  return { from: "client", sessionId };
}

/** What a relayed tools/call carries besides its name: its arguments, its AI trace and the session that sent it. */
export interface ToolCallOptions {
  readonly args?: Record<string, unknown>;
  readonly runId?: string;
  readonly phase?: string;
  readonly sessionId?: string;
}

/** Relays one tools/call, stamped for the session `sessionId`, to the provider and returns its reply. */
export function callTool(
  socket: FakeRelaySocket,
  id: string | number,
  name: string,
  options: ToolCallOptions & { timeoutMs?: number } = {},
): Promise<RpcReply> {
  deliverToolCall(socket, id, name, options);
  return replyTo(socket, id, options.timeoutMs);
}

/** Relays one tools/call, stamped for the session `sessionId`, to the provider, without waiting for a reply. */
export function deliverToolCall(socket: FakeRelaySocket, id: string | number, name: string, options: ToolCallOptions = {}): void {
  socket.deliver({
    type: "mcp",
    ...relayStamp(options.sessionId),
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
}

/** Delivers an approval request for `sessionId` and approves it from the host side. */
export async function approve(provider: WebMcpPeerClient, socket: FakeRelaySocket, roomId: string, sessionId = AGENT_SESSION_ID): Promise<void> {
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

/** One chunk of a framed DataChannel message, as the provider sends it. */
export interface DataChannelChunkFrame {
  readonly v: number;
  readonly id: number;
  readonly index: number;
  readonly total: number;
  readonly data: string;
}

/** An agent's end of the provider's `mcp` DataChannel. */
export class FakeDataChannel {
  readonly label = "mcp";
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  /** The chunks the provider sent. */
  readonly sent: string[] = [];
  /** send() throws, as a channel that is closing does, once this many chunks were sent. */
  failAfter = Number.POSITIVE_INFINITY;
  private chunkId = 0;
  /** The channel's own state, which {@link readyState} reports unless the channel is held open. */
  private state: "open" | "closed" = "open";
  private heldOpen = false;

  /** The state the provider reads: "open" while the channel is held open (see {@link holdOpen}). */
  get readyState(): "open" | "closed" {
    return this.heldOpen ? "open" : this.state;
  }

  set readyState(state: "open" | "closed") {
    this.state = state;
  }

  /**
   * Keeps the channel open to the provider from now on, even once the provider closed it, so `sent`
   * records every chunk the provider still tries to send on it. The provider sends only on an open
   * channel, which would otherwise hide a reply it must not give.
   */
  holdOpen(): void {
    this.heldOpen = true;
  }

  send(data: string): void {
    if (this.sent.length >= this.failAfter) throw new DOMException("The DataChannel is closing", "InvalidStateError");
    this.sent.push(data);
  }

  close(): void {
    this.state = "closed";
  }

  /** The agent sends one frame, as a single chunk. */
  deliver(frame: Frame): void {
    this.onmessage?.({ data: JSON.stringify({ v: 1, id: ++this.chunkId, index: 0, total: 1, data: JSON.stringify(frame) }) });
  }

  /** The chunks the provider sent, parsed. */
  chunks(): DataChannelChunkFrame[] {
    return this.sent.map((text) => JSON.parse(text) as DataChannelChunkFrame);
  }

  /** The frames the provider sent, reassembled from their chunks. */
  frames(): Frame[] {
    const parts = new Map<number, string[]>();
    const frames: Frame[] = [];
    for (const chunk of this.chunks()) {
      const received = parts.get(chunk.id) ?? [];
      received[chunk.index] = chunk.data;
      parts.set(chunk.id, received);
      if (received.filter((part) => part !== undefined).length === chunk.total) frames.push(JSON.parse(received.join("")) as Frame);
    }
    return frames;
  }

  /** The provider's reply to request `id`, once it was sent. */
  replyTo(id: number): Promise<RpcReply> {
    return until(
      () => this.frames().find((frame) => frame.type === "mcp" && (frame.message as RpcReply | undefined)?.id === id)?.message as RpcReply | undefined,
      `DataChannel reply to ${id}`,
    );
  }
}
