// Tests for how PeerMcpSession keeps to the relay's limit of PEER_RELAY_MAX_PENDING_REQUESTS (64)
// requests in flight per agent WebSocket, past which the relay refuses a request with
// TOO_MANY_PENDING_REQUESTS:
//   - over a relay socket, a request past 64 unanswered ones waits, in order, and is sent once an
//     earlier one has been answered, so an agent that fans out more calls gets every answer;
//   - a request holds its slot until the relay answers it, even after its caller stopped waiting at
//     a shorter timeout than the relay's, since the relay still counts it until then, and a request
//     of the provider's under its id is no answer;
//   - an id in flight (as a string) is refused for another request, unsent, on any transport, and
//     over HTTP a request stays in flight until its POST ends, even after its timeout;
//   - the wait counts toward the request's timeout (REQUEST_TIMEOUT, never sent), and disconnect()
//     ends waiting requests like pending ones;
//   - an id the relay would answer with id null (over 1 KiB of JSON) is refused before it is sent;
//   - a raw transport (Streamable HTTP, one POST per request) is not bounded.
import { afterEach, describe, expect, it } from "vitest";
import { PEER_RELAY_MAX_PENDING_REQUESTS } from "../src/config.js";
import * as packageRoot from "../src/index.js";
import {
  PeerMcpError,
  PeerMcpSession,
  type PeerMcpTransportCallbacks,
  type PeerMcpTransportMessage,
} from "../src/client.js";
import type { WebMcpPeerServer } from "../src/server.js";
import { createRoom, flush, joinRoom, openClient, RawPeer, startRelay, tool, until } from "./server-test-helpers.js";

const LIMIT = 64;
const TOO_MANY_PENDING_REQUESTS = "TOO_MANY_PENDING_REQUESTS";

const sessions: PeerMcpSession[] = [];
const servers: WebMcpPeerServer[] = [];
const sockets: WebSocket[] = [];
const rawPeers: RawPeer[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.disconnect().catch(() => {});
  for (const raw of rawPeers.splice(0)) raw.destroy();
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
});

/** Records how `promise` settles. */
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

const errorCode = (outcome: { value: unknown } | { error: unknown } | undefined) =>
  outcome && "error" in outcome ? (outcome.error as { code?: unknown }).code : undefined;

/**
 * A room on a real relay whose raw provider answers tools/list at once and holds every tools/call
 * until `answer` is called, and a PeerMcpSession on the room's WebSocket.
 */
async function heldCallRoom(requestTimeoutMs = 20_000) {
  const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
  const room = await createRoom(relay.base, { approvalRequired: false });
  const provider = await RawPeer.open(relay, `/p/${room.id}/provider`, room.providerToken, rawPeers);
  const held: unknown[] = [];
  const received: unknown[] = [];
  provider.onMessage((message) => {
    if (message.type !== "mcp") return;
    const { id, method } = message.message ?? {};
    if (method === "tools/list") provider.send({ type: "mcp", message: { jsonrpc: "2.0", id, result: { tools: [tool("slow")] } } });
    if (method !== "tools/call") return;
    received.push(id);
    held.push(id);
  });
  provider.send({ type: "register", tools: [tool("slow")] });
  await until(() => relay.server.rooms.get(room.id)?.cachedTools, Boolean, "registered catalog");
  const joined = await joinRoom(relay.base, room);
  const session = new PeerMcpSession({ serverUrl: relay.base, roomId: room.id, clientToken: joined.clientToken, requestTimeoutMs });
  sessions.push(session);
  await session.listTools();
  /** Answers the `count` oldest held calls (all of them by default). */
  const answer = (count = held.length) => {
    for (const id of held.splice(0, count)) {
      provider.send({ type: "mcp", message: { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `ok ${String(id)}` }] } } });
    }
  };
  return { relay, room, joined, provider, session, held, received, answer };
}

/** A connected session on a scripted transport that records every request and never answers. */
async function silentSession(options: { raw?: boolean } = {}) {
  const sent: Array<{ id: unknown; method: unknown; name: unknown }> = [];
  let callbacks: PeerMcpTransportCallbacks | undefined;
  const session = new PeerMcpSession({
    roomId: "room1",
    requestTimeoutMs: 10_000,
    transportFactory: (_url, _protocols, transportCallbacks) => {
      callbacks = transportCallbacks;
      transportCallbacks.onMessage?.({ type: "ready", role: "client", roomId: "room1", roomEpoch: 1, sessionId: "relay-session" });
      return {
        readyState: "open",
        ...(options.raw ? { raw: true } : {}),
        send: (value: PeerMcpTransportMessage) => {
          const frame = (typeof value === "string" ? JSON.parse(value) : value) as Record<string, any>;
          const rpc = frame.type === "mcp" ? frame.message : frame;
          sent.push({ id: rpc.id, method: rpc.method, name: rpc.params?.name });
        },
      };
    },
  });
  sessions.push(session);
  await session.connect();
  const reply = (id: unknown) => callbacks?.onMessage?.({ type: "mcp", message: { jsonrpc: "2.0", id, result: {} } });
  return { session, sent, reply };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

describe("PEER_RELAY_MAX_PENDING_REQUESTS", () => {
  it("is the relay's limit of 64, exported from the config tier and the package root", () => {
    expect(PEER_RELAY_MAX_PENDING_REQUESTS).toBe(LIMIT);
    expect(packageRoot.PEER_RELAY_MAX_PENDING_REQUESTS).toBe(LIMIT);
  });
});

describe("a session over a relay socket with 64 requests in flight", { timeout: 30_000 }, () => {
  it("sends a request past them once an earlier one is answered, so 100 concurrent calls all succeed", async () => {
    const { session, received, answer } = await heldCallRoom();
    const calls = Array.from({ length: 100 }, (_, index) => track(session.callTool("slow", { index })));

    // The provider gets the first 64; the rest wait in the session, not at the relay.
    await until(() => received.length, (count) => count === LIMIT, "64 calls forwarded", 5000);
    await settle();
    expect(received).toHaveLength(LIMIT);
    expect(calls.every((call) => call.outcome === undefined)).toBe(true);

    // Each answer lets one waiting call go, oldest first.
    answer(10);
    await until(() => received.length, (count) => count === LIMIT + 10, "10 more calls forwarded", 5000);
    await settle();
    expect(received).toHaveLength(LIMIT + 10);
    expect(calls.slice(0, 10).every((call) => call.outcome && "value" in call.outcome)).toBe(true);
    expect(calls.slice(LIMIT, LIMIT + 10).every((call) => call.outcome === undefined)).toBe(true);

    // Answering as they arrive drains the rest; no call is refused.
    const drain = setInterval(() => answer(), 10);
    try {
      await until(() => calls.filter((call) => call.outcome !== undefined).length, (count) => count === calls.length, "every call settled", 10_000);
    } finally {
      clearInterval(drain);
    }
    expect(calls.map((call) => errorCode(call.outcome))).toEqual(calls.map(() => undefined));
    expect(new Set(received).size).toBe(100);
    expect(session.state).toBe("connected");
  });

  it("keeps a request's slot after its caller timed out, until the relay answers it", async () => {
    const { session, received, answer } = await heldCallRoom(300);
    // 64 calls the provider never answers in time: their callers give up after 300 ms, but the
    // relay (whose own request timeout is 30 s) still counts every one of them.
    const early = Array.from({ length: LIMIT }, (_, index) => track(session.callTool("slow", { index })));
    await until(() => early.filter((call) => call.outcome !== undefined).length, (count) => count === LIMIT, "the early calls time out", 5000);
    expect(early.map((call) => errorCode(call.outcome))).toEqual(early.map(() => "REQUEST_TIMEOUT"));

    // A new call waits for the relay to answer one of them, instead of being refused.
    const late = track(session.callTool("slow", { late: true }, { timeoutMs: 5000 }));
    await settle();
    expect(received).toHaveLength(LIMIT);
    expect(late.outcome).toBeUndefined();

    answer(1);
    await until(() => received.length, (count) => count === LIMIT + 1, "the late call forwarded", 5000);
    answer();
    await until(() => late.outcome, (outcome) => outcome !== undefined, "the late call answered", 5000);
    expect(late.outcome).toMatchObject({ value: { content: [{ type: "text" }] } });
    expect(errorCode(late.outcome)).not.toBe(TOO_MANY_PENDING_REQUESTS);
  });

  it("takes no request of the provider's for the answer to a call in flight under its id, so the call keeps the slot the relay counts", async () => {
    const { provider, session, held, received, answer } = await heldCallRoom();
    const calls = Array.from({ length: LIMIT }, (_, index) => track(session.callTool("slow", { index })));
    await until(() => received.length, (count) => count === LIMIT, "64 calls forwarded", 5000);

    // The relay passes a provider's request to its agents as is, whatever its id: here the id of a
    // call the relay still counts. A request of the provider's is no answer.
    provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: held[0], method: "sampling/createMessage", params: {} } });
    await settle();
    const extra = track(session.callTool("slow", { index: LIMIT }));
    await settle();
    expect(calls[0]!.outcome).toBeUndefined();
    expect(extra.outcome).toBeUndefined();
    expect(received).toHaveLength(LIMIT);

    // Its answer frees the slot.
    answer(1);
    await until(() => received.length, (count) => count === LIMIT + 1, "the call past them forwarded", 5000);
    answer();
    await until(() => [...calls, extra].every((call) => call.outcome !== undefined), Boolean, "every call answered", 5000);
    expect([...calls, extra].map((call) => errorCode(call.outcome))).toEqual([...calls, extra].map(() => undefined));
  });
});

describe("a request id in flight", { timeout: 20_000 }, () => {
  it.each<[string, { raw?: boolean }, string | number, string | number]>([
    ["over a relay socket", {}, "same", "same"],
    ["over a relay socket, under an id that is the same as a string", {}, 1, "1"],
    ["over a raw transport", { raw: true }, "same", "same"],
  ])("is refused DUPLICATE_REQUEST_ID for another request, unsent, until it is answered, %s", async (_label, transport, firstId, secondId) => {
    const { session, sent, reply } = await silentSession(transport);
    const first = track(session.request("tools/call", { name: "a", arguments: {} }, { id: firstId }));
    await expect(session.request("tools/call", { name: "b", arguments: {} }, { id: secondId })).rejects.toMatchObject({
      code: "DUPLICATE_REQUEST_ID",
      details: { method: "tools/call", id: secondId },
    });
    expect(sent.map((request) => request.name)).toEqual(["a"]);

    reply(firstId);
    await until(() => first.outcome, (outcome) => outcome !== undefined, "the first answered", 5000);
    expect(first.outcome).toMatchObject({ value: { id: firstId } });
    void session.request("tools/call", { name: "b", arguments: {} }, { id: secondId }).catch(() => {});
    await settle();
    expect(sent.map((request) => request.name)).toEqual(["a", "b"]);
  });

  it("is refused for another request while its request holds a slot its caller gave up, or waits for one", async () => {
    const { session, sent, reply } = await silentSession();
    // Its caller stops waiting; the relay still counts it until it answers.
    await expect(session.request("tools/call", { name: "a", arguments: {} }, { id: "held", timeoutMs: 20 })).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    await expect(session.request("tools/call", { name: "b", arguments: {} }, { id: "held" })).rejects.toMatchObject({ code: "DUPLICATE_REQUEST_ID" });

    // 63 more fill the slots; one past them waits for a slot under its id.
    for (let index = 1; index < LIMIT; index++) void session.request("tools/call", { name: "slow", arguments: { index } }).catch(() => {});
    const waiting = track(session.request("tools/call", { name: "c", arguments: {} }, { id: "waiting" }));
    await expect(session.request("tools/call", { name: "d", arguments: {} }, { id: "waiting" })).rejects.toMatchObject({ code: "DUPLICATE_REQUEST_ID" });
    expect(sent).toHaveLength(LIMIT);

    reply("held");
    await until(() => sent.length, (count) => count === LIMIT + 1, "the waiting call sent", 5000);
    expect(sent.map((request) => request.name).slice(LIMIT)).toEqual(["c"]);
    expect(waiting.outcome).toBeUndefined();
  });

  it("is refused for another request while the HTTP POST of a request that timed out still runs, so the other does not take its answer", async () => {
    // Each POST runs until it is released, then answers with the name of the call it carries.
    const posted: unknown[] = [];
    const releases: Array<() => void> = [];
    const fetchImpl = (async (_input: string | URL | Request, init: RequestInit = {}) => {
      const rpc = JSON.parse(String(init.body)) as { id: string; params?: { name?: string } };
      posted.push(rpc.params?.name);
      await new Promise<void>((resolve) => releases.push(resolve));
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { answered: rpc.params?.name } });
    }) as typeof fetch;
    const session = new PeerMcpSession({ mcpEndpoint: "http://relay.test/p/room1/mcp", fetchImpl, requestTimeoutMs: 10_000 });
    sessions.push(session);
    await session.connect();

    const first = track(session.request("tools/call", { name: "a", arguments: {} }, { id: "x", timeoutMs: 50 }));
    await until(() => session.pending.size, (size) => size === 0, "the first call's timeout", 5000);
    // Its timeout has passed, but its POST, which brings its answer, has not ended.
    const second = track(session.request("tools/call", { name: "b", arguments: {} }, { id: "x" }));
    await settle();
    expect(second.outcome).toMatchObject({ error: { code: "DUPLICATE_REQUEST_ID", details: { method: "tools/call", id: "x" } } });
    expect(posted).toEqual(["a"]);

    releases.splice(0).forEach((release) => release());
    await until(() => first.outcome, (outcome) => outcome !== undefined, "the first call settles", 5000);
    expect(errorCode(first.outcome)).toBe("REQUEST_TIMEOUT");
    // Once that POST has ended, the id is free, and the next request under it gets its own answer.
    const third = track(session.request("tools/call", { name: "c", arguments: {} }, { id: "x" }));
    await until(() => releases.length, (count) => count === 1, "the third call posted", 5000);
    releases.splice(0).forEach((release) => release());
    await until(() => third.outcome, (outcome) => outcome !== undefined, "the third call answered", 5000);
    expect(third.outcome).toMatchObject({ value: { id: "x", result: { answered: "c" } } });
    expect(posted).toEqual(["a", "c"]);
  });
});

describe("a request waiting for a relay-socket slot", { timeout: 20_000 }, () => {
  it("times out within its own timeout without being sent, and disconnect() ends it", async () => {
    const { session, sent } = await silentSession();
    const inFlight = Array.from({ length: LIMIT }, (_, index) => track(session.request("tools/call", { name: "slow", arguments: { index } })));
    expect(sent).toHaveLength(LIMIT);

    const timedOut = track(session.request("tools/call", { name: "slow", arguments: {} }, { timeoutMs: 200 }));
    const waiting = track(session.request("tools/call", { name: "slow", arguments: {} }));
    await until(() => timedOut.outcome, (outcome) => outcome !== undefined, "the waiting call times out", 5000);
    expect(errorCode(timedOut.outcome)).toBe("REQUEST_TIMEOUT");
    expect(waiting.outcome).toBeUndefined();
    expect(sent).toHaveLength(LIMIT);

    await session.disconnect();
    await settle();
    expect(errorCode(waiting.outcome)).toBe("SESSION_DISCONNECTED");
    expect(inFlight.every((call) => errorCode(call.outcome) === "SESSION_DISCONNECTED")).toBe(true);
    expect(sent).toHaveLength(LIMIT);
  });

  it("is sent in order as answers arrive, and an answer to a request whose caller gave up frees its slot too", async () => {
    const { session, sent, reply } = await silentSession();
    const first = track(session.request("tools/call", { name: "slow", arguments: {} }, { timeoutMs: 100 }));
    for (let index = 1; index < LIMIT; index++) void session.request("tools/call", { name: "slow", arguments: { index } }).catch(() => {});
    const next = [track(session.request("tools/call", { name: "a", arguments: {} })), track(session.request("tools/call", { name: "b", arguments: {} }))];
    await until(() => first.outcome, (outcome) => outcome !== undefined, "the first call times out", 5000);
    expect(errorCode(first.outcome)).toBe("REQUEST_TIMEOUT");
    // Its caller gave up, but nothing answered it yet: no slot is free.
    await settle();
    expect(sent).toHaveLength(LIMIT);

    reply(sent[0]!.id);
    await until(() => sent.length, (count) => count === LIMIT + 1, "one waiting call sent", 5000);
    reply(sent[1]!.id);
    await until(() => sent.length, (count) => count === LIMIT + 2, "the other waiting call sent", 5000);
    expect(sent.slice(LIMIT).map((request) => request.name)).toEqual(["a", "b"]);
    reply(sent[LIMIT]!.id);
    reply(sent[LIMIT + 1]!.id);
    await until(() => next.every((call) => call.outcome !== undefined), Boolean, "both answered", 5000);
    expect(next.map((call) => errorCode(call.outcome))).toEqual([undefined, undefined]);
  });

  it("is refused before it is sent when its id is over 1 KiB of JSON, which the relay would answer with id null", async () => {
    const { session, sent } = await silentSession();
    const oversized = "i".repeat(1023);
    await expect(session.request("ping", {}, { id: oversized })).rejects.toMatchObject({ code: "REQUEST_ID_TOO_LARGE", details: { bytes: 1025, limitBytes: 1024 } });
    await expect(session.request("ping", {}, { id: oversized })).rejects.toBeInstanceOf(PeerMcpError);
    expect(sent).toEqual([]);
    // An id of exactly 1 KiB of JSON is sent.
    void session.request("ping", {}, { id: "i".repeat(1022) }).catch(() => {});
    expect(sent).toHaveLength(1);
  });
});

describe("a raw transport", { timeout: 20_000 }, () => {
  it("is not bounded: each request is answered on its own, so all of them are sent at once", async () => {
    const { session, sent } = await silentSession({ raw: true });
    for (let index = 0; index < 2 * LIMIT; index++) void session.request("tools/call", { name: "slow", arguments: { index } }).catch(() => {});
    await settle();
    expect(sent).toHaveLength(2 * LIMIT);
  });
});

describe("the relay's own limit", { timeout: 20_000 }, () => {
  it("still refuses the 65th request of an agent that does not queue, so the session's queue is what keeps to it", async () => {
    const { relay, room, joined, received } = await heldCallRoom();
    const agent = await openClient(relay, room, joined, sockets);
    for (let id = 1; id <= LIMIT + 1; id++) {
      agent.send({ type: "mcp", message: { jsonrpc: "2.0", id, method: "tools/call", params: { name: "slow", arguments: {} } } });
    }
    const refused = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === LIMIT + 1, "the 65th request", 5000);
    expect(refused.message.error).toMatchObject({ code: -32087, message: TOO_MANY_PENDING_REQUESTS, data: { limit: LIMIT } });
    await flush(agent, "agent socket still open");
    expect(received).toHaveLength(LIMIT);
  });
});
