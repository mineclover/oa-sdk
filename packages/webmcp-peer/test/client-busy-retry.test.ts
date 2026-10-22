// Tests for PeerMcpSession.request()'s retry of the refusals the relay marks retryable
// (`data.retryable: true`; the relay's PROVIDER_BUSY while a provider is not reading what it was
// sent, which reached nobody):
//   - the same request, under the same id, is sent again after a backoff of 100 ms that doubles up
//     to 2 s, and the call resolves with the answer to the attempt that got through; its id stays in
//     flight during the backoff, so another request under it is refused and its own retry is not,
//   - retries stop once the next backoff would outlast the request's own timeout, and the call then
//     rejects with the last PROVIDER_BUSY (not REQUEST_TIMEOUT), leaving no timer behind,
//   - any other JSON-RPC error, including -32001 without `retryable`, is reported at once,
//   - against a real relay, a callTool issued while the provider is not reading succeeds once the
//     provider reads again, over WebSocket and over HTTP (503 PROVIDER_BUSY).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PeerMcpRpcError,
  PeerMcpSession,
  type PeerMcpTransportCallbacks,
  type PeerMcpTransportMessage,
} from "../src/client.js";
import type { PeerSendResult, PeerSocket, WebMcpPeerServer } from "../src/server.js";
import { PeerFrameSchema } from "../src/server/wire-schemas.js";
import {
  createRoom,
  joinRoom,
  openClient,
  RawPeer,
  startRelay,
  tool,
  until,
  type Frame,
} from "./server-test-helpers.js";

const PROVIDER_BUSY = { code: -32001, message: "PROVIDER_BUSY", data: { retryable: true } };

const sessions: PeerMcpSession[] = [];
const servers: WebMcpPeerServer[] = [];
const sockets: WebSocket[] = [];
const rawPeers: RawPeer[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const session of sessions.splice(0)) await session.disconnect().catch(() => {});
  for (const raw of rawPeers.splice(0)) raw.destroy();
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
});

type WireRpc = { jsonrpc: "2.0"; id: string | number; method: string; params?: Record<string, unknown> };
/** How the scripted transport answers one request: with a result, with an error, or not at all. */
type Answer = { result: unknown } | { error: Record<string, unknown> } | undefined;

/**
 * A connected session on a transportFactory transport that records every request written to it,
 * with the (fake) clock's time, and answers the `attempt`-th one (counting from 0) with `answer`.
 */
async function scriptedSession(answer: (attempt: number) => Answer) {
  const sent: Array<{ at: number; rpc: WireRpc }> = [];
  let callbacks: PeerMcpTransportCallbacks | undefined;
  const session = new PeerMcpSession({
    roomId: "room1",
    requestTimeoutMs: 10_000,
    transportFactory: (_url, _protocols, transportCallbacks) => {
      callbacks = transportCallbacks;
      transportCallbacks.onMessage?.({ type: "ready", role: "client", roomId: "room1", roomEpoch: 1, sessionId: "relay-session" });
      return {
        readyState: "open",
        send: (value: PeerMcpTransportMessage) => {
          const frame = (typeof value === "string" ? JSON.parse(value) : value) as { type?: string; message?: WireRpc };
          if (frame.type !== "mcp" || !frame.message) return;
          const rpc = frame.message;
          sent.push({ at: Date.now(), rpc });
          const reply = answer(sent.length - 1);
          if (reply) queueMicrotask(() => callbacks?.onMessage?.({ type: "mcp", message: { jsonrpc: "2.0", id: rpc.id, ...reply } }));
        },
      };
    },
  });
  sessions.push(session);
  await session.connect();
  return { session, sent };
}

/** Records how `promise` settles, so a test can look at it at a given (fake) time. */
function track<T>(promise: Promise<T>): { outcome?: { value: T } | { error: unknown } } {
  const tracked: { outcome?: { value: T } | { error: unknown } } = {};
  promise.then(
    (value) => {
      tracked.outcome = { value };
    },
    (error: unknown) => {
      tracked.outcome = { error };
    },
  );
  return tracked;
}

/** The time between consecutive attempts. */
const gaps = (sent: ReadonlyArray<{ at: number }>): number[] => sent.slice(1).map(({ at }, index) => at - sent[index]!.at);

const echoCall = { name: "echo", arguments: {} };

describe("a request the relay refuses as retryable", () => {
  it("ends with the disconnect error when disconnect() runs during its backoff, without reconnecting or resending", async () => {
    vi.useFakeTimers();
    let connects = 0;
    const { session, sent } = await scriptedSession(() => ({ error: PROVIDER_BUSY }));
    const connect = session.connect.bind(session);
    vi.spyOn(session, "connect").mockImplementation(() => {
      connects += 1;
      return connect();
    });
    const call = track(session.request("tools/call", echoCall));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);

    // The refused request is now waiting out its 100 ms backoff, outside `pending`.
    await session.disconnect();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(call.outcome).toBeDefined();
    expect(call.outcome && "error" in call.outcome && (call.outcome.error as { code?: string }).code).toBe("SESSION_DISCONNECTED");
    expect(sent).toHaveLength(1);
    expect(connects).toBe(0);
    expect(session.state).toBe("idle");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is sent again under the same id after 100 ms, then 200 ms, and resolves with the answer that got through", async () => {
    vi.useFakeTimers();
    const { session, sent } = await scriptedSession((attempt) => (attempt < 2 ? { error: PROVIDER_BUSY } : { result: { ok: true } }));
    const call = track(session.request("tools/call", echoCall));

    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    // Each retry waits out its whole backoff.
    await vi.advanceTimersByTimeAsync(99);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(sent).toHaveLength(2);
    expect(call.outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(3);

    const id = sent[0]!.rpc.id;
    expect(call.outcome).toEqual({ value: { jsonrpc: "2.0", id, result: { ok: true } } });
    // The same request every time: nothing was forwarded, so it keeps its id.
    expect(sent.map(({ rpc }) => rpc)).toEqual([0, 1, 2].map(() => ({ jsonrpc: "2.0", id, method: "tools/call", params: echoCall })));
    expect(gaps(sent)).toEqual([100, 200]);
    expect(session.pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps its id in flight while it waits to be sent again, so another request under it is refused and its own retry is not", async () => {
    vi.useFakeTimers();
    const { session, sent } = await scriptedSession((attempt) => (attempt === 0 ? { error: PROVIDER_BUSY } : { result: { ok: true } }));
    const call = track(session.request("tools/call", { name: "a", arguments: {} }, { id: "x" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);

    // It is waiting out its 100 ms backoff, neither pending nor holding a slot.
    const other = track(session.request("tools/call", { name: "b", arguments: {} }, { id: "x" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(other.outcome).toMatchObject({ error: { code: "DUPLICATE_REQUEST_ID", details: { method: "tools/call", id: "x" } } });

    await vi.advanceTimersByTimeAsync(100);
    expect(sent.map(({ rpc }) => rpc.params?.name)).toEqual(["a", "a"]);
    expect(call.outcome).toEqual({ value: { jsonrpc: "2.0", id: "x", result: { ok: true } } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("doubles its backoff up to 2 s and no further", async () => {
    vi.useFakeTimers();
    const { session, sent } = await scriptedSession((attempt) => (attempt < 7 ? { error: PROVIDER_BUSY } : { result: { ok: true } }));
    const call = track(session.request("tools/call", echoCall));

    await vi.advanceTimersByTimeAsync(100 + 200 + 400 + 800 + 1600 + 2000 + 2000);
    expect(gaps(sent)).toEqual([100, 200, 400, 800, 1600, 2000, 2000]);
    expect(new Set(sent.map(({ rpc }) => rpc.id)).size).toBe(1);
    expect(call.outcome).toMatchObject({ value: { id: sent[0]!.rpc.id, result: { ok: true } } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    // Shorter than the first backoff: never sent again.
    [50, [0]],
    // The second backoff (200 ms, from 100 ms) would end after the deadline.
    [250, [0, 100]],
    // The fourth backoff (400 ms, from 300 ms) would end after the deadline.
    [650, [0, 100, 300]],
  ])("stops once the next backoff would outlast its %i ms timeout and rejects with the last PROVIDER_BUSY", async (timeoutMs, attemptTimes) => {
    vi.useFakeTimers();
    const { session, sent } = await scriptedSession(() => ({ error: PROVIDER_BUSY }));
    const start = Date.now();
    const call = track(session.request("tools/call", echoCall, { timeoutMs }));

    // Rejected right after the last refusal, without waiting for the timeout.
    await vi.advanceTimersByTimeAsync(attemptTimes.at(-1)!);
    expect(call.outcome).toBeDefined();
    const { error } = call.outcome as { error: unknown };
    expect(error).toBeInstanceOf(PeerMcpRpcError);
    expect(error).toMatchObject({ code: "PROVIDER_BUSY", rpcError: PROVIDER_BUSY });
    expect(sent.map(({ at }) => at - start)).toEqual(attemptTimes);
    expect(new Set(sent.map(({ rpc }) => rpc.id)).size).toBe(1);

    // No retry and no request timer is left, so nothing more is sent and no REQUEST_TIMEOUT follows.
    expect(vi.getTimerCount()).toBe(0);
    expect(session.pending.size).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toHaveLength(attemptTimes.length);
  });

  it.each([
    ["-32602 invalid params", { code: -32602, message: "tools/call params are invalid" }],
    ["-32001 PROVIDER_UNAVAILABLE, which shares PROVIDER_BUSY's code but is not marked retryable", { code: -32001, message: "PROVIDER_UNAVAILABLE" }],
  ])("is the only kind retried: %s is reported at once", async (_label, rpcError) => {
    vi.useFakeTimers();
    const { session, sent } = await scriptedSession(() => ({ error: rpcError }));
    const call = track(session.request("tools/call", echoCall));

    await vi.advanceTimersByTimeAsync(0);
    expect(call.outcome).toBeDefined();
    const { error } = call.outcome as { error: unknown };
    expect(error).toBeInstanceOf(PeerMcpRpcError);
    expect((error as PeerMcpRpcError).rpcError).toEqual(rpcError);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toHaveLength(1);
    expect(session.pending.size).toBe(0);
  });
});

describe("an HTTP PROVIDER_BUSY with Retry-After", () => {
  /**
   * A Streamable HTTP session whose endpoint answers the first `refusals` POSTs 503 PROVIDER_BUSY
   * with `retryAfter` as Retry-After, and the next one with a result, recording when each arrives.
   */
  function busyEndpointSession(refusals: number, retryAfter: () => string, requestTimeoutMs = 10_000) {
    const sent: number[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init: RequestInit = {}) => {
      const rpc = JSON.parse(String(init.body)) as WireRpc;
      sent.push(Date.now());
      if (sent.length <= refusals) {
        return Response.json({ jsonrpc: "2.0", id: rpc.id, error: PROVIDER_BUSY }, { status: 503, headers: { "retry-after": retryAfter() } });
      }
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { ok: true } });
    }) as typeof fetch;
    const session = new PeerMcpSession({ mcpEndpoint: "http://relay.test/p/room1/mcp", clientToken: "tok", requestTimeoutMs, fetchImpl });
    sessions.push(session);
    return { session, sent };
  }

  it("waits at least as long as Retry-After asks before sending the request again", async () => {
    vi.useFakeTimers();
    // On a whole second, since an HTTP-date names whole seconds.
    vi.setSystemTime(new Date("2026-10-20T00:00:00.000Z"));
    // The relay's `Retry-After: 1`, then an HTTP-date three seconds ahead.
    const headers = ["1", () => new Date(Date.now() + 3_000).toUTCString()];
    let refusal = 0;
    const { session, sent } = busyEndpointSession(2, () => {
      const header = headers[refusal++]!;
      return typeof header === "string" ? header : header();
    });
    const call = track(session.request("tools/call", echoCall));

    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    // Not after the 100 ms backoff: after the second Retry-After asks for.
    await vi.advanceTimersByTimeAsync(999);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sent).toHaveLength(3);
    expect(gaps(sent.map((at) => ({ at })))).toEqual([1_000, 3_000]);
    expect(call.outcome).toMatchObject({ value: { result: { ok: true } } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports the refusal at once when Retry-After asks for longer than the request's timeout leaves", async () => {
    vi.useFakeTimers();
    const { session, sent } = busyEndpointSession(1, () => "1", 900);
    const call = track(session.request("tools/call", echoCall));

    await vi.advanceTimersByTimeAsync(0);
    expect(call.outcome).toBeDefined();
    const { error } = call.outcome as { error: unknown };
    expect(error).toBeInstanceOf(PeerMcpRpcError);
    expect(error).toMatchObject({ code: "PROVIDER_BUSY", rpcError: { ...PROVIDER_BUSY, httpStatus: 503, retryAfterMs: 1_000 } });
    expect(sent).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// The real-relay case depends on OS socket backpressure; retry to absorb a slow or busy host.
describe("a call issued while a real relay's provider is not reading", { timeout: 30_000, retry: 2 }, () => {
  /** Records what `socket.send` reported for every frame the relay gave it. */
  function recordSends(socket: PeerSocket): Array<{ frame: Frame; sent: PeerSendResult }> {
    const sends: Array<{ frame: Frame; sent: PeerSendResult }> = [];
    const send = socket.send;
    vi.spyOn(socket, "send").mockImplementation((value: unknown): PeerSendResult => {
      const sent = send(value);
      sends.push({ frame: PeerFrameSchema.parse(value), sent });
      return sent;
    });
    return sends;
  }

  it.each(["ws", "http"] as const)("succeeds over %s once the provider reads again, instead of failing with PROVIDER_BUSY", async (transport) => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base, { approvalRequired: false });
    const entry = () => {
      const found = relay.server.rooms.get(room.id);
      if (!found) throw new Error("room is gone");
      return found;
    };
    // A raw provider that answers every tools/list and tools/call it reads.
    const provider = await RawPeer.open(relay, `/p/${room.id}/provider`, room.providerToken, rawPeers);
    const called: unknown[] = [];
    provider.onMessage((message) => {
      if (message.type !== "mcp") return;
      const { id, method } = message.message ?? {};
      if (method === "tools/list") provider.send({ type: "mcp", message: { jsonrpc: "2.0", id, result: { tools: [tool("echo")] } } });
      if (method !== "tools/call") return;
      called.push(id);
      provider.send({ type: "mcp", message: { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "ok" }] } } });
    });
    provider.send({ type: "register", tools: [tool("echo")] });
    await until(() => entry().cachedTools, Boolean, "registered catalog");
    const providerSocket = entry().providerSocket!;
    const joined = await joinRoom(relay.base, room);
    const session = new PeerMcpSession(
      transport === "ws"
        ? { serverUrl: relay.base, roomId: room.id, clientToken: joined.clientToken, requestTimeoutMs: 20_000 }
        : { mcpEndpoint: `${relay.base}/p/${room.id}/mcp`, clientToken: joined.clientToken, sessionId: joined.sessionId, requestTimeoutMs: 20_000 },
    );
    sessions.push(session);
    await session.listTools();
    const sends = recordSends(providerSocket);

    // The provider stops reading, like a tab busy with a synchronous tool, and another agent's calls
    // (each within every limit, fewer than 64 of them) fill its outbound queue at the relay.
    provider.pause();
    const filler = await openClient(relay, room, joined, sockets);
    const count = 60;
    const fillerBlob = "f".repeat(200_000);
    for (let id = 1; id <= count; id++) {
      filler.send({ type: "mcp", message: { jsonrpc: "2.0", id, method: "tools/call", params: { name: "echo", arguments: { blob: fillerBlob } } } });
    }
    const refusedFillers = () => filler.frames.filter((frame) => frame.type === "mcp" && frame.message?.error !== undefined);
    await until(() => refusedFillers().length + entry().mcpPending.size, (total) => total === count, "every filler call queued or refused");
    expect(refusedFillers().length).toBeGreaterThan(0);
    expect(refusedFillers().map((frame) => frame.message.error)).toEqual(refusedFillers().map(() => PROVIDER_BUSY));

    // The session's call is larger than a refused filler call, so it does not fit the queue either:
    // the relay refuses it PROVIDER_BUSY, and the session keeps trying while the provider is not reading.
    const call = session.callTool("echo", { blob: "s".repeat(250_000) });
    call.catch(() => {}); // awaited below; never an unhandled rejection if the test fails early
    const attempts = () => sends.filter(({ frame }) => frame.type === "mcp" && frame.message?.params?._meta?.runtimeEpoch === session.runtimeEpoch);
    await until(() => attempts().filter(({ sent }) => sent === "busy").length, (refusals) => refusals >= 2, "the session's call refused and retried", 15_000);
    expect(attempts().every(({ sent }) => sent === "busy")).toBe(true);

    provider.resume();
    await expect(call).resolves.toMatchObject({ content: [{ type: "text", text: "ok" }] });

    // Refused until the provider read again, then forwarded once; always the same request and id.
    const sent = attempts().map(({ sent: result }) => result);
    expect(sent.at(-1)).toBe("sent");
    expect(sent.slice(0, -1).every((result) => result === "busy")).toBe(true);
    const ids = new Set(attempts().map(({ frame }) => frame.message.id));
    expect(ids.size).toBe(1);
    expect(called).toContain([...ids][0]);
    expect(session.state).toBe("connected");
    expect(session.pending.size).toBe(0);
    expect(entry().providerSocket).toBe(providerSocket);
    expect(provider.closeCode).toBeUndefined();
  });
});
