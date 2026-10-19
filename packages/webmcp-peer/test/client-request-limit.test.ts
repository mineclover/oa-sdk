// Regression tests for the agent-side relay request limit: PeerMcpSession refuses a request whose
// serialized message is over PEER_RELAY_MAX_REQUEST_BYTES (counted in UTF-8 bytes) before it reaches
// the WebSocket or fetch, rejecting only that call with REQUEST_TOO_LARGE; a real relay forwards and
// answers every request within the limit, even one whose duplicate id it rewrites; and the relay's
// HTTP 413 REQUEST_TOO_LARGE surfaces as a JSON-RPC error of that one call.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PEER_RELAY_MAX_MESSAGE_BYTES, PEER_RELAY_MAX_REQUEST_BYTES } from "../src/config.js";
import * as packageRoot from "../src/index.js";
import {
  PeerMcpError,
  PeerMcpRpcError,
  PeerMcpSession,
  type PeerMcpTransportCallbacks,
  type PeerMcpTransportMessage,
} from "../src/client.js";
import { MAX_WEBSOCKET_FRAME_BYTES, MAX_WEBSOCKET_MESSAGE_BYTES, type WebMcpPeerServer } from "../src/server.js";
import {
  createRoom,
  joinRoom,
  openProvider,
  startRelay,
  until,
  type Frame,
  type RecordingSocket,
} from "./server-test-helpers.js";

/** The documented relay message limit, spelled out so the tests do not depend on the export alone. */
const LIMIT = 256 * 1024;
/**
 * The documented agent request limit: 1 KiB under the message limit, the room the relay needs to
 * stamp a forwarded request with `from`/`sessionId` and give a duplicate id a longer wire id.
 */
const REQUEST_LIMIT = LIMIT - 1024;

const servers: WebMcpPeerServer[] = [];
const sockets: WebSocket[] = [];
const sessions: PeerMcpSession[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.disconnect().catch(() => {});
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const echoTool = { name: "echo", description: "Echo tool", inputSchema: { type: "object", properties: {} } };

const utf8Bytes = (text: string): number => Buffer.byteLength(text, "utf8");

type Params = Record<string, unknown>;
type Serialize = (params: Params) => string;
type WireRpc = { jsonrpc: "2.0"; id: string | number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };

/** The WebSocket relay message of a request: the JSON-RPC request inside an `mcp` envelope. */
const wsEnvelope = (id: string, method = "tools/call"): Serialize => (params) =>
  JSON.stringify({ type: "mcp", message: { jsonrpc: "2.0", id, method, params } });

/** The Streamable HTTP body of a request: the bare JSON-RPC request. */
const httpBody = (id: string, method = "tools/call"): Serialize => (params) =>
  JSON.stringify({ jsonrpc: "2.0", id, method, params });

/**
 * tools/call params `{ name: "echo", arguments: { blob } }` whose `serialize`d message is exactly
 * `targetBytes` UTF-8 bytes. `unit` is the character the blob is built from (ASCII padding fills
 * whatever a multi-byte unit cannot), so a multi-byte message has far fewer UTF-16 code units.
 */
function paddedParams(targetBytes: number, serialize: Serialize, unit = "x"): Params {
  const make = (blob: string): Params => ({ name: "echo", arguments: { blob } });
  const room = targetBytes - utf8Bytes(serialize(make("")));
  const unitBytes = utf8Bytes(unit);
  const params = make(unit.repeat(Math.floor(room / unitBytes)) + "x".repeat(room % unitBytes));
  expect(utf8Bytes(serialize(params))).toBe(targetBytes);
  return params;
}

/** Runs `body` with Node's unhandled-rejection reports recorded (and kept from the runner's handler). */
async function recordUnhandledRejections(body: () => Promise<void>): Promise<unknown[]> {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  const runnerListeners = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", record);
  try {
    await body();
  } finally {
    process.off("unhandledRejection", record);
    for (const listener of runnerListeners) process.on("unhandledRejection", listener as (...args: unknown[]) => void);
  }
  return unhandled;
}

/** Settles `promise` into its rejection reason; fails the test if it resolves instead. */
async function rejectionOf(promise: Promise<unknown>): Promise<PeerMcpError> {
  const outcome = await promise.then(
    (value) => ({ resolved: true as const, value }),
    (error: unknown) => ({ resolved: false as const, error }),
  );
  if (outcome.resolved) throw new Error(`expected a rejection, got ${JSON.stringify(outcome.value)?.slice(0, 200)}`);
  expect(outcome.error).toBeInstanceOf(PeerMcpError);
  return outcome.error as PeerMcpError;
}

function expectRequestTooLarge(error: PeerMcpError, bytes: number): void {
  // Refused locally: a plain PeerMcpError, not a JSON-RPC error answered by the relay.
  expect(error).not.toBeInstanceOf(PeerMcpRpcError);
  expect(error.code).toBe("REQUEST_TOO_LARGE");
  expect(error.details).toEqual({ bytes, limitBytes: REQUEST_LIMIT });
}

function toolResult(rpc: WireRpc): Record<string, unknown> {
  return {
    content: [{ type: "text", text: "ok" }],
    structuredContent: { argumentBytes: utf8Bytes(JSON.stringify(rpc.params?.arguments ?? {})) },
  };
}

/**
 * A WebSocket stand-in for a relay client socket: it opens asynchronously, sends `ready`, records
 * every write, and answers requests (tools/list with the echo tool, anything else with a tool
 * result) unless `hold` matches, in which case the answer waits for `release(id)`.
 */
function fakeWebSocket() {
  const instances: FakeRelaySocket[] = [];
  class FakeRelaySocket {
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    readonly writes: string[] = [];
    readonly held = new Map<string, WireRpc>();
    hold: (rpc: WireRpc) => boolean = () => false;
    closeCalls = 0;

    constructor(readonly url: string, readonly protocols: string[]) {
      instances.push(this);
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.();
        this.emit({ type: "ready", role: "client", roomId: "room1", roomEpoch: 1, sessionId: "relay-session" });
      });
    }

    send(data: string): void {
      if (this.readyState !== 1) throw new Error("socket is not open");
      this.writes.push(data);
      const frame = JSON.parse(data) as { type?: string; message?: WireRpc };
      if (frame.type !== "mcp" || !frame.message) return;
      const rpc = frame.message;
      if (this.hold(rpc)) {
        this.held.set(String(rpc.id), rpc);
        return;
      }
      queueMicrotask(() => this.answer(rpc));
    }

    release(id: string): void {
      const rpc = this.held.get(id);
      if (!rpc) throw new Error(`no held request ${id}`);
      this.held.delete(id);
      this.answer(rpc);
    }

    close(): void {
      this.closeCalls += 1;
      this.readyState = 3;
      this.onclose?.();
    }

    private answer(rpc: WireRpc): void {
      const result = rpc.method === "tools/list" ? { tools: [echoTool] } : toolResult(rpc);
      this.emit({ type: "mcp", message: { jsonrpc: "2.0", id: rpc.id, result } });
    }

    private emit(frame: Record<string, unknown>): void {
      this.onmessage?.({ data: JSON.stringify(frame) });
    }
  }
  return { FakeRelaySocket, instances };
}

async function fakeWebSocketSession() {
  const { FakeRelaySocket, instances } = fakeWebSocket();
  const session = new PeerMcpSession({
    serverUrl: "http://relay.test",
    roomId: "room1",
    clientToken: "tok",
    WebSocket: FakeRelaySocket,
    // Short enough that a request the code under test wrongly sends and never gets answered fails
    // the test quickly instead of hanging it.
    requestTimeoutMs: 2_000,
  });
  sessions.push(session);
  await session.connect();
  expect(instances).toHaveLength(1);
  return { session, socket: instances[0]! };
}

function fakeFetch() {
  return vi.fn(async (_input: string | URL | Request, init: RequestInit = {}) => {
    const rpc = JSON.parse(String(init.body)) as WireRpc;
    const result = rpc.method === "tools/list" ? { tools: [echoTool] } : toolResult(rpc);
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
  });
}

async function fakeHttpSession() {
  const fetchImpl = fakeFetch();
  // Also the global fetch, so no request can reach the network whichever fetch the transport uses.
  vi.stubGlobal("fetch", fetchImpl);
  const session = new PeerMcpSession({
    mcpEndpoint: "http://relay.test/p/room1/mcp",
    clientToken: "tok",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    requestTimeoutMs: 2_000,
  });
  sessions.push(session);
  await session.connect();
  return { session, fetchImpl };
}

/**
 * A real relay with a raw provider socket that registers the echo tool and answers every
 * tools/call, except those whose `arguments.hold` is true: those wait for `release(id)`.
 */
async function relayWithProvider() {
  const relay = await startRelay(servers);
  const room = await createRoom(relay.base, { approvalRequired: false });
  const provider: RecordingSocket = await openProvider(relay, room, sockets);
  const held = new Map<string, () => void>();
  provider.ws.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data)) as Frame;
    if (frame.type !== "mcp" || frame.message?.method !== "tools/call") return;
    const rpc = frame.message as WireRpc;
    const reply = () => provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: rpc.id, result: toolResult(rpc) } });
    if (rpc.params?.arguments?.hold === true) held.set(String(rpc.id), reply);
    else reply();
  });
  provider.send({ type: "register", tools: [echoTool] });
  await until(() => relay.server.rooms.get(room.id)?.catalogVersion ?? 0, (version) => version === 1, "provider register");
  const joined = await joinRoom(relay.base, room);
  const toolCalls = () => provider.frames.filter((frame) => frame.type === "mcp" && frame.message?.method === "tools/call");
  const release = (id: string) => {
    const reply = held.get(id);
    if (!reply) throw new Error(`provider holds no request ${id}`);
    held.delete(id);
    reply();
  };
  return { relay, room, provider, joined, held, release, toolCalls };
}

describe("the relay limit constants", () => {
  it("is one 256 KiB limit exported from the config tier and the package root, equal to the relay's limits", () => {
    expect(PEER_RELAY_MAX_MESSAGE_BYTES).toBe(LIMIT);
    expect(packageRoot.PEER_RELAY_MAX_MESSAGE_BYTES).toBe(LIMIT);
    expect(MAX_WEBSOCKET_MESSAGE_BYTES).toBe(LIMIT);
    // A single frame may carry a whole message: WebSocket clients send each message as one frame.
    expect(MAX_WEBSOCKET_FRAME_BYTES).toBe(LIMIT);
  });

  it("has a request limit 1 KiB under the message limit, exported from the config tier and the package root", () => {
    expect(PEER_RELAY_MAX_REQUEST_BYTES).toBe(REQUEST_LIMIT);
    expect(packageRoot.PEER_RELAY_MAX_REQUEST_BYTES).toBe(REQUEST_LIMIT);
  });
});

describe("the WebSocket transport refuses requests over the relay request limit", () => {
  it("rejects only the oversized tools/call, writes nothing, and keeps the session and a concurrent call alive", async () => {
    const { session, socket } = await fakeWebSocketSession();
    await session.listTools();
    socket.hold = (rpc) => rpc.method === "tools/call" && rpc.params?.arguments?.hold === true;

    const concurrent = session.callTool("echo", { hold: true });
    concurrent.catch(() => {}); // awaited below; never an unhandled rejection if the test fails early
    await until(() => socket.held.size, (size) => size === 1, "concurrent call written and held");
    const [concurrentId] = [...socket.held.keys()];
    const writesBefore = socket.writes.length;

    const blob = "x".repeat(REQUEST_LIMIT);
    const error = await rejectionOf(session.callTool("echo", { blob }));
    expect(error.code).toBe("REQUEST_TOO_LARGE");
    expect(error).not.toBeInstanceOf(PeerMcpRpcError);
    const details = error.details as { bytes: number; limitBytes: number };
    expect(details.limitBytes).toBe(REQUEST_LIMIT);
    // The measured size is the whole envelope: the blob plus the tools/call wrapping and _meta.
    expect(details.bytes).toBeGreaterThan(utf8Bytes(blob));
    expect(details.bytes).toBeLessThan(utf8Bytes(blob) + 1_024);
    // The request limit decides, not the message limit: this request would fit one relay message.
    expect(details.bytes).toBeLessThanOrEqual(LIMIT);
    expect(Object.keys(details).sort()).toEqual(["bytes", "limitBytes"]);

    // Nothing was written for the refused call, and no write was ever over the request limit.
    expect(socket.writes).toHaveLength(writesBefore);
    expect(socket.writes.every((write) => utf8Bytes(write) <= REQUEST_LIMIT)).toBe(true);
    // The session and its socket are untouched; only the concurrent call is still pending.
    expect(session.state).toBe("connected");
    expect(session.error).toBeNull();
    expect(socket.closeCalls).toBe(0);
    expect(socket.readyState).toBe(1);
    expect([...session.pending.keys()]).toEqual([concurrentId]);

    socket.release(concurrentId!);
    await expect(concurrent).resolves.toMatchObject({
      structuredContent: { argumentBytes: utf8Bytes(JSON.stringify({ hold: true })) },
    });
    await expect(session.callTool("echo", { after: true })).resolves.toMatchObject({
      structuredContent: { argumentBytes: utf8Bytes(JSON.stringify({ after: true })) },
    });
    expect(session.state).toBe("connected");
  });

  it("sends a request of exactly the limit and refuses one byte more", async () => {
    const { session, socket } = await fakeWebSocketSession();

    const atLimit = paddedParams(REQUEST_LIMIT, wsEnvelope("at-limit"));
    await expect(session.request("tools/call", atLimit, { id: "at-limit" })).resolves.toMatchObject({ id: "at-limit" });
    const written = socket.writes.at(-1)!;
    expect(utf8Bytes(written)).toBe(REQUEST_LIMIT);
    expect(JSON.parse(written)).toEqual({ type: "mcp", message: { jsonrpc: "2.0", id: "at-limit", method: "tools/call", params: atLimit } });

    const writesBefore = socket.writes.length;
    const overLimit = paddedParams(REQUEST_LIMIT + 1, wsEnvelope("over-limit"));
    expectRequestTooLarge(await rejectionOf(session.request("tools/call", overLimit, { id: "over-limit" })), REQUEST_LIMIT + 1);
    expect(socket.writes).toHaveLength(writesBefore);
    expect(session.pending.size).toBe(0);
    expect(session.state).toBe("connected");
  });

  it.each([
    ["Hangul (3 UTF-8 bytes per UTF-16 code unit)", "한"],
    ["emoji (4 UTF-8 bytes per surrogate pair)", "😀"],
  ])("counts the limit in UTF-8 bytes, not UTF-16 code units: %s", async (_label, unit) => {
    const { session, socket } = await fakeWebSocketSession();

    const serializeAtLimit = wsEnvelope("utf8-at-limit");
    const atLimit = paddedParams(REQUEST_LIMIT, serializeAtLimit, unit);
    await expect(session.request("tools/call", atLimit, { id: "utf8-at-limit" })).resolves.toMatchObject({ id: "utf8-at-limit" });
    expect(utf8Bytes(socket.writes.at(-1)!)).toBe(REQUEST_LIMIT);

    const serializeOver = wsEnvelope("utf8-over");
    const overLimit = paddedParams(REQUEST_LIMIT + 1, serializeOver, unit);
    // Well under the limit when measured as a JavaScript string length.
    expect(serializeOver(overLimit).length).toBeLessThan(REQUEST_LIMIT * 0.6);
    const writesBefore = socket.writes.length;
    expectRequestTooLarge(await rejectionOf(session.request("tools/call", overLimit, { id: "utf8-over" })), REQUEST_LIMIT + 1);
    expect(socket.writes).toHaveLength(writesBefore);
    expect(session.state).toBe("connected");
  });
});

describe("the HTTP transport refuses requests over the relay request limit", () => {
  it("posts a body of exactly the limit and refuses a larger one without calling fetchImpl", async () => {
    const { session, fetchImpl } = await fakeHttpSession();

    // The HTTP body is the bare JSON-RPC request: a body of exactly the request limit is posted
    // even though the same request in a WebSocket `mcp` envelope would be over it.
    const atLimit = paddedParams(REQUEST_LIMIT, httpBody("http-at-limit"));
    expect(utf8Bytes(wsEnvelope("http-at-limit")(atLimit))).toBeGreaterThan(REQUEST_LIMIT);
    await expect(session.request("tools/call", atLimit, { id: "http-at-limit" })).resolves.toMatchObject({ id: "http-at-limit" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(utf8Bytes(String(fetchImpl.mock.calls[0]![1]!.body))).toBe(REQUEST_LIMIT);

    const overLimit = paddedParams(REQUEST_LIMIT + 1, httpBody("http-over"));
    expectRequestTooLarge(await rejectionOf(session.request("tools/call", overLimit, { id: "http-over" })), REQUEST_LIMIT + 1);

    const multiByte = paddedParams(REQUEST_LIMIT + 1, httpBody("http-utf8-over"), "한");
    expect(httpBody("http-utf8-over")(multiByte).length).toBeLessThan(REQUEST_LIMIT);
    expectRequestTooLarge(await rejectionOf(session.request("tools/call", multiByte, { id: "http-utf8-over" })), REQUEST_LIMIT + 1);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(session.pending.size).toBe(0);
    expect(session.state).toBe("connected");
  });

  it("rejects an oversized callTool before fetch while other calls on the session still go through", async () => {
    const { session, fetchImpl } = await fakeHttpSession();
    await session.listTools();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const error = await rejectionOf(session.callTool("echo", { blob: "x".repeat(REQUEST_LIMIT) }));
    expect(error.code).toBe("REQUEST_TOO_LARGE");
    expect(error).not.toBeInstanceOf(PeerMcpRpcError);
    expect(error.details).toEqual({ bytes: expect.any(Number), limitBytes: REQUEST_LIMIT });
    expect((error.details as { bytes: number }).bytes).toBeGreaterThan(REQUEST_LIMIT);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await expect(session.callTool("echo", { small: true })).resolves.toMatchObject({
      structuredContent: { argumentBytes: utf8Bytes(JSON.stringify({ small: true })) },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(session.state).toBe("connected");
  });

  // Regression: request() awaits the HTTP send before it returns the promise its pending entry
  // settles, so when that entry is rejected while the POST is still in flight (request timeout,
  // disconnect(), a transport error) the rejection used to have no handler yet. Node then reported
  // an unhandled rejection, which by default terminates the agent process, even though the caller
  // was awaiting the call.
  describe("a call rejected while its HTTP POST is in flight", () => {
    /** An HTTP session whose POSTs stay pending until `releaseFetch()`. */
    async function slowPostSession(requestTimeoutMs: number) {
      const releases: Array<() => void> = [];
      const fetchImpl = vi.fn(async (_input: string | URL | Request, init: RequestInit = {}) => {
        const rpc = JSON.parse(String(init.body)) as WireRpc;
        await new Promise<void>((resolve) => releases.push(resolve));
        return Response.json({ jsonrpc: "2.0", id: rpc.id, result: {} });
      });
      vi.stubGlobal("fetch", fetchImpl);
      const session = new PeerMcpSession({
        mcpEndpoint: "http://relay.test/p/room1/mcp",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        requestTimeoutMs,
      });
      sessions.push(session);
      await session.connect();
      return { session, fetchImpl, releaseFetch: () => releases.splice(0).forEach((release) => release()) };
    }

    it("rejects a call that times out during its HTTP POST without an unhandled rejection", async () => {
      const { session, fetchImpl, releaseFetch } = await slowPostSession(20);
      const unhandled = await recordUnhandledRejections(async () => {
        const call = session.request("tools/call", { name: "echo", arguments: {} }, { id: "slow-post" });
        call.catch(() => {});
        await until(() => fetchImpl.mock.calls.length, (count) => count === 1, "POST in flight");
        // The request timer fires while the POST is still pending...
        await until(() => session.pending.size, (size) => size === 0, "request timeout", 2_000);
        // ...and Node's unhandled-rejection check runs after the next macrotask.
        await new Promise((resolve) => setTimeout(resolve, 10));
        releaseFetch();
        await expect(call).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
      });
      expect(unhandled).toEqual([]);
    });

    it("rejects a call whose session disconnects during its HTTP POST without an unhandled rejection", async () => {
      const { session, fetchImpl, releaseFetch } = await slowPostSession(10_000);
      const unhandled = await recordUnhandledRejections(async () => {
        const call = session.request("tools/call", { name: "echo", arguments: {} }, { id: "disconnected-post" });
        call.catch(() => {});
        await until(() => fetchImpl.mock.calls.length, (count) => count === 1, "POST in flight");
        await session.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 10));
        releaseFetch();
        await expect(call).rejects.toMatchObject({ code: "SESSION_DISCONNECTED" });
      });
      expect(unhandled).toEqual([]);
      expect(session.pending.size).toBe(0);
    });
  });
});

// Regression: the session answers the relay's `ping` with a `pong` nobody awaits. A transport's
// send may be asynchronous (the HTTP transport, a custom transport or transportFactory), and the
// rejection of a failed pong send used to escape as an unhandled rejection, which by default
// terminates the agent process.
describe("a pong the transport fails to send", () => {
  /** A connected session on a transportFactory transport that answers requests; `sendPong` sends its pongs. */
  async function sessionWithPongSender(sendPong: () => Promise<void> | void) {
    const sent: Array<Record<string, unknown>> = [];
    let callbacks: PeerMcpTransportCallbacks | undefined;
    const session = new PeerMcpSession({
      roomId: "room1",
      requestTimeoutMs: 2_000,
      transportFactory: (_url, _protocols, transportCallbacks) => {
        callbacks = transportCallbacks;
        transportCallbacks.onMessage?.({ type: "ready", role: "client", roomId: "room1", roomEpoch: 1, sessionId: "relay-session" });
        return {
          readyState: "open",
          // Synchronous itself, so a pong send can fail either way: `sendPong` throws or rejects.
          send: (value: PeerMcpTransportMessage) => {
            const frame = typeof value === "string" ? (JSON.parse(value) as Record<string, unknown>) : value;
            sent.push(frame);
            if (frame.type === "pong") return sendPong();
            const rpc = frame.message as WireRpc;
            queueMicrotask(() => callbacks?.onMessage?.({ type: "mcp", message: { jsonrpc: "2.0", id: rpc.id, result: { ok: true } } }));
          },
        };
      },
    });
    sessions.push(session);
    await session.connect();
    const ping = () => callbacks?.onMessage?.({ type: "ping", timestamp: Date.now() });
    return { session, sent, ping };
  }

  it("drops an asynchronously failed pong send without an unhandled rejection and keeps the session", async () => {
    const { session, sent, ping } = await sessionWithPongSender(async () => {
      throw new Error("pong send failed");
    });
    const unhandled = await recordUnhandledRejections(async () => {
      ping();
      // Node's unhandled-rejection check runs after the next macrotask.
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(unhandled).toEqual([]);
    expect(sent.filter((frame) => frame.type === "pong")).toHaveLength(1);
    expect(session.state).toBe("connected");
    expect((await session.request("ping", {}, { id: "after-pong" })).result).toEqual({ ok: true });
  });

  it("drops a pong send that throws synchronously", async () => {
    const { session, sent, ping } = await sessionWithPongSender(() => {
      throw new Error("pong send failed");
    });
    const unhandled = await recordUnhandledRejections(async () => {
      expect(ping).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(unhandled).toEqual([]);
    expect(sent.filter((frame) => frame.type === "pong")).toHaveLength(1);
    expect(session.state).toBe("connected");
  });
});

describe("against a real relay", () => {
  /** The size of a frame the provider received, as the relay sent it. */
  const frameBytes = (frame: Frame) => utf8Bytes(JSON.stringify(frame));

  it("forwards and answers an HTTP body of exactly the request limit under a rewritten duplicate id, and refuses one byte more", async () => {
    const { relay, room, joined, held, release, toolCalls } = await relayWithProvider();
    const posted: number[] = [];
    const recordingFetch: typeof fetch = (input, init) => {
      if (typeof init?.body === "string") posted.push(utf8Bytes(init.body));
      return fetch(input, init);
    };
    const ws = new PeerMcpSession({ serverUrl: relay.base, roomId: room.id, clientToken: joined.clientToken, requestTimeoutMs: 10_000 });
    const http = new PeerMcpSession({
      mcpEndpoint: `${relay.base}/p/${room.id}/mcp`,
      clientToken: joined.clientToken,
      sessionId: joined.sessionId,
      fetchImpl: recordingFetch,
      requestTimeoutMs: 10_000,
    });
    sessions.push(ws, http);
    await ws.connect();

    // Another agent's call with the same id is in flight, so the relay forwards the HTTP request
    // under a longer wire id and stamped with from/sessionId; the 1 KiB headroom covers both.
    const inFlight = ws.request("tools/call", { name: "echo", arguments: { hold: true } }, { id: "dup" });
    inFlight.catch(() => {});
    await until(() => held.size, (size) => size === 1, "provider holds the WebSocket call");
    const atLimit = paddedParams(REQUEST_LIMIT, httpBody("dup"));
    await expect(http.request("tools/call", atLimit, { id: "dup" })).resolves.toMatchObject({
      id: "dup",
      result: { structuredContent: { argumentBytes: utf8Bytes(JSON.stringify(atLimit.arguments)) } },
    });
    expect(posted).toEqual([REQUEST_LIMIT]);
    const forwarded = toolCalls()[1]!;
    expect(forwarded).toMatchObject({ from: "client", sessionId: joined.sessionId, message: { params: atLimit } });
    expect(forwarded.message.id).toMatch(/^framebook:\d+:string:dup$/);
    expect(frameBytes(forwarded)).toBeGreaterThan(REQUEST_LIMIT);
    expect(frameBytes(forwarded)).toBeLessThanOrEqual(LIMIT);
    // The answered request released its slot; only the held WebSocket call is still pending.
    expect(relay.server.rooms.get(room.id)?.mcpPending.size).toBe(1);
    expect(http.state).toBe("connected");

    // One byte more is refused before fetch, so the relay never sees it.
    const overLimit = paddedParams(REQUEST_LIMIT + 1, httpBody("dup"));
    expectRequestTooLarge(await rejectionOf(http.request("tools/call", overLimit, { id: "dup" })), REQUEST_LIMIT + 1);
    expect(posted).toEqual([REQUEST_LIMIT]);
    expect(toolCalls()).toHaveLength(2);

    release("dup");
    await expect(inFlight).resolves.toMatchObject({ id: "dup" });
    expect(relay.server.rooms.get(room.id)?.mcpPending.size).toBe(0);
  });

  it("surfaces the relay's HTTP 413 REQUEST_TOO_LARGE as a JSON-RPC error of that call only", async () => {
    const { relay, room, joined, toolCalls } = await relayWithProvider();
    // The client checks the body it hands to fetch. An intermediary that pads that body (a proxy
    // that re-indents JSON, say) can still deliver the relay one over the request limit.
    const paddingFetch: typeof fetch = (input, init) => {
      const body = typeof init?.body === "string" ? init.body : undefined;
      if (body === undefined || (JSON.parse(body) as WireRpc).id !== "unforwardable") return fetch(input, init);
      return fetch(input, { ...init, body: body + " ".repeat(REQUEST_LIMIT + 1 - utf8Bytes(body)) });
    };
    const session = new PeerMcpSession({
      mcpEndpoint: `${relay.base}/p/${room.id}/mcp`,
      clientToken: joined.clientToken,
      sessionId: joined.sessionId,
      fetchImpl: paddingFetch,
      requestTimeoutMs: 10_000,
    });
    sessions.push(session);

    const error = await rejectionOf(session.request("tools/call", { name: "echo", arguments: {} }, { id: "unforwardable" }));
    expect(error).toBeInstanceOf(PeerMcpRpcError);
    expect(error.code).toBe("REQUEST_TOO_LARGE");
    const rpcError = error as PeerMcpRpcError;
    expect(rpcError.rpcError).toEqual({ code: -32600, message: "REQUEST_TOO_LARGE", data: { limitBytes: REQUEST_LIMIT }, httpStatus: 413 });
    // The relay answers a body it did not read with id null; the transport gives it the posted id.
    expect(rpcError.response).toMatchObject({ jsonrpc: "2.0", id: "unforwardable" });
    expect(relay.server.rooms.get(room.id)?.mcpPending.size).toBe(0);
    expect(session.state).toBe("connected");

    // Later calls on the same session go through; the provider only ever saw the later call.
    await session.listTools();
    await expect(session.callTool("echo", { after: true })).resolves.toMatchObject({
      structuredContent: { argumentBytes: utf8Bytes(JSON.stringify({ after: true })) },
    });
    expect(toolCalls().map((frame) => frame.message.params.arguments)).toEqual([{ after: true }]);
  });

  it("delivers a request of exactly the limit over WebSocket and refuses a larger one without dropping the socket", async () => {
    const { relay, room, joined, held, release, toolCalls } = await relayWithProvider();
    const session = new PeerMcpSession({
      serverUrl: relay.base,
      roomId: room.id,
      clientToken: joined.clientToken,
      requestTimeoutMs: 10_000,
    });
    sessions.push(session);
    await session.connect();
    const socket = session.transport?.socket as WebSocket;
    expect(socket.readyState).toBe(WebSocket.OPEN);

    // Sent as one frame of exactly the request limit; the relay accepts it and forwards it to the provider.
    const atLimit = paddedParams(REQUEST_LIMIT, wsEnvelope("edge"));
    const edge = await session.request("tools/call", atLimit, { id: "edge" });
    expect(edge.result).toMatchObject({
      structuredContent: { argumentBytes: utf8Bytes(JSON.stringify(atLimit.arguments)) },
    });
    expect(toolCalls().map((frame) => frame.message.id)).toEqual(["edge"]);

    // A call the provider holds stays pending while an oversized call is refused on the client.
    const concurrent = session.request("tools/call", { name: "echo", arguments: { hold: true } }, { id: "held" });
    concurrent.catch(() => {});
    await until(() => held.size, (size) => size === 1, "provider holds the concurrent call");
    const overLimit = paddedParams(REQUEST_LIMIT + 1, wsEnvelope("over"));
    expectRequestTooLarge(await rejectionOf(session.request("tools/call", overLimit, { id: "over" })), REQUEST_LIMIT + 1);
    expect(session.state).toBe("connected");
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect([...session.pending.keys()]).toEqual(["held"]);

    release("held");
    await expect(concurrent).resolves.toMatchObject({ id: "held" });
    await expect(
      session.request("tools/call", { name: "echo", arguments: { after: true } }, { id: "after" }),
    ).resolves.toMatchObject({ id: "after" });
    expect(toolCalls().map((frame) => frame.message.id)).toEqual(["edge", "held", "after"]);
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it("forwards and answers a WebSocket request of exactly the request limit under a rewritten duplicate id, and refuses one byte more", async () => {
    const { relay, room, joined, held, release, toolCalls } = await relayWithProvider();
    const http = new PeerMcpSession({
      mcpEndpoint: `${relay.base}/p/${room.id}/mcp`,
      clientToken: joined.clientToken,
      sessionId: joined.sessionId,
      requestTimeoutMs: 10_000,
    });
    const ws = new PeerMcpSession({ serverUrl: relay.base, roomId: room.id, clientToken: joined.clientToken, requestTimeoutMs: 10_000 });
    sessions.push(http, ws);
    await ws.connect();
    const socket = ws.transport?.socket as WebSocket;

    // Another agent's call with the same id is in flight, so the relay forwards the WebSocket
    // request (exactly the request limit as sent) under a longer wire id and stamped with
    // from/sessionId; the 1 KiB headroom covers both.
    const inFlight = http.request("tools/call", { name: "echo", arguments: { hold: true } }, { id: "dup" });
    inFlight.catch(() => {});
    await until(() => held.size, (size) => size === 1, "provider holds the HTTP call");
    const atLimit = paddedParams(REQUEST_LIMIT, wsEnvelope("dup"));
    await expect(ws.request("tools/call", atLimit, { id: "dup" })).resolves.toMatchObject({
      id: "dup",
      result: { structuredContent: { argumentBytes: utf8Bytes(JSON.stringify(atLimit.arguments)) } },
    });
    const forwarded = toolCalls()[1]!;
    expect(forwarded).toMatchObject({ from: "client", sessionId: joined.sessionId, message: { params: atLimit } });
    expect(forwarded.message.id).toMatch(/^framebook:\d+:string:dup$/);
    expect(frameBytes(forwarded)).toBeGreaterThan(REQUEST_LIMIT);
    expect(frameBytes(forwarded)).toBeLessThanOrEqual(LIMIT);
    // The answered request released its slot; only the HTTP call is still pending.
    expect(relay.server.rooms.get(room.id)?.mcpPending.size).toBe(1);

    // One byte more is refused by the client, and the socket stays open.
    const overLimit = paddedParams(REQUEST_LIMIT + 1, wsEnvelope("dup"));
    expectRequestTooLarge(await rejectionOf(ws.request("tools/call", overLimit, { id: "dup" })), REQUEST_LIMIT + 1);
    expect(ws.state).toBe("connected");
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(toolCalls()).toHaveLength(2);

    release("dup");
    await expect(inFlight).resolves.toMatchObject({ id: "dup" });
    await expect(
      ws.request("tools/call", { name: "echo", arguments: { after: true } }, { id: "after" }),
    ).resolves.toMatchObject({ id: "after" });
    expect(toolCalls().map((frame) => frame.message.params.arguments)).toEqual([{ hold: true }, atLimit.arguments, { after: true }]);
  });
});
