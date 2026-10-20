// Regression tests: an HTTP `tools/call` in flight when its room is rotated, revoked or expired, or
// its session alone is revoked, must receive a JSON-RPC error (not hang), a WebSocket agent's
// request the same error after the frame that tells it why, and `server.close()` must still resolve.
import { afterEach, describe, expect, it } from "vitest";
import { WebMcpPeerServer, type WebMcpPeerServerOptions } from "../src/server.js";
import {
  createRoom,
  joinRoom,
  openClient,
  openProvider,
  postJson,
  settleWithin,
  startRelay,
  tool,
  until,
  type Relay,
  type RecordingSocket,
  type RoomDescriptor,
} from "./server-test-helpers.js";

class SweepableServer extends WebMcpPeerServer {
  sweep(now: number): void {
    this.cleanupExpiredRooms(now);
  }
}

const servers: WebMcpPeerServer[] = [];
const sockets: WebSocket[] = [];
let closed = new Set<WebMcpPeerServer>();

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) if (!closed.has(server)) await server.close();
  closed = new Set();
});

// Far above every wait below: an error that arrives is the settlement, never the request timeout.
const REQUEST_TIMEOUT_MS = 60_000;
const SETTLE_MS = 8_000;

async function roomWithSilentProvider(options: WebMcpPeerServerOptions = {}) {
  const relay: Relay = await startRelay(servers, { mcpRequestTimeoutMs: REQUEST_TIMEOUT_MS, ...options }, (opts) => new SweepableServer(opts));
  const room: RoomDescriptor = await createRoom(relay.base, { approvalRequired: false });
  const provider = await openProvider(relay, room, sockets);
  provider.send({ type: "register", tools: [tool("slow")] });
  await until(() => relay.server.rooms.get(room.id)?.catalogVersion ?? 0, (version) => version === 1, "register");
  const joined = await joinRoom(relay.base, room);
  return { relay, room, provider, joined };
}

type Setup = Awaited<ReturnType<typeof roomWithSilentProvider>>;

async function callInFlight(setup: Setup, signal?: AbortSignal) {
  const { relay, room, provider, joined } = setup;
  const response = postJson(
    `${relay.base}/p/${room.id}/mcp`,
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "slow", arguments: {} } },
    { authorization: `Bearer ${joined.clientToken}` },
    signal,
  ).then(async (res) => ({ status: res.status, body: (await res.json()) as Record<string, any> }));
  response.catch(() => {});
  await provider.waitFor((frame) => frame.type === "mcp" && frame.message?.method === "tools/call", "provider receives tools/call");
  expect(relay.server.rooms.get(room.id)?.mcpPending.size).toBe(1);
  // Wrapped: returning the bare promise from this async function would make callers await the response.
  return { response };
}

/** The id of the `tools/call` a WebSocket agent has in flight (see `agentCallInFlight`). */
const AGENT_CALL_ID = 9;

/** Opens the joined ticket's client socket and sends a `tools/call` the provider takes and never answers. */
async function agentCallInFlight(setup: Setup): Promise<RecordingSocket> {
  const agent = await openClient(setup.relay, setup.room, setup.joined, sockets);
  agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: AGENT_CALL_ID, method: "tools/call", params: { name: "slow", arguments: {} } } });
  await setup.provider.waitFor((frame) => frame.type === "mcp" && frame.message?.id === AGENT_CALL_ID, "provider receives the agent's tools/call");
  return agent;
}

/** The `ending` frame the agent got, and the error that answered its request, which came after it. */
async function agentEnding(agent: RecordingSocket, ending: string): Promise<{ frame: Record<string, any>; error: unknown }> {
  const frame = await agent.waitFor((candidate) => candidate.type === ending, ending);
  const answer = await agent.waitFor((candidate) => candidate.type === "mcp" && candidate.message?.id === AGENT_CALL_ID, "the agent's answer");
  expect(agent.frames.indexOf(frame)).toBeLessThan(agent.frames.indexOf(answer));
  return { frame, error: answer.message.error };
}

async function expectCloseResolves(server: WebMcpPeerServer): Promise<void> {
  closed.add(server);
  expect((await settleWithin(server.close(), SETTLE_MS)).settled).toBe(true);
}

describe("in-flight MCP requests across room shutdown", () => {
  it("answers ROOM_ROTATED with the replacement room when the provider rotates", async () => {
    const setup = await roomWithSilentProvider();
    const { response: call } = await callInFlight(setup);
    const rotated = await postJson(`${setup.relay.base}/p/${setup.room.id}/rotate`, { roomId: setup.room.id, roomEpoch: setup.room.roomEpoch }, {
      authorization: `Bearer ${setup.room.providerToken}`,
    });
    expect(rotated.status).toBe(201);
    const replacement = (await rotated.json()) as { replacementRoomId: string };

    const outcome = await settleWithin(call, SETTLE_MS);
    expect(outcome.settled).toBe(true);
    if (!outcome.settled) return;
    expect(outcome.value.body).toMatchObject({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32057, message: "ROOM_ROTATED", data: { replacementRoomId: replacement.replacementRoomId, roomId: setup.room.id } },
    });
    expect(setup.relay.server.rooms.get(setup.room.id)?.mcpPending.size).toBe(0);
    await expectCloseResolves(setup.relay.server);
  });

  it("answers SESSION_INVALID when the provider revokes every session", async () => {
    const setup = await roomWithSilentProvider();
    const { response: call } = await callInFlight(setup);
    const revoked = await postJson(`${setup.relay.base}/p/${setup.room.id}/session/revoke`, {}, {
      authorization: `Bearer ${setup.room.providerToken}`,
    });
    expect(revoked.status).toBe(200);

    const outcome = await settleWithin(call, SETTLE_MS);
    expect(outcome.settled).toBe(true);
    if (!outcome.settled) return;
    expect(outcome.value.body).toMatchObject({ id: 7, error: { code: -32001, message: "SESSION_INVALID" } });
    await expectCloseResolves(setup.relay.server);
  });

  it.each([
    ["the provider revokes it", "sessions/:session/revoke", "provider"],
    ["the agent revokes it itself", "session/revoke", "client"],
  ] as const)("answers SESSION_INVALID when %s alone, as a revoke of every session does", async (_label, route, signer) => {
    const setup = await roomWithSilentProvider();
    const { response: call } = await callInFlight(setup);
    const agent = await agentCallInFlight(setup);
    const token = signer === "provider" ? setup.room.providerToken : setup.joined.clientToken;
    const revoked = await postJson(`${setup.relay.base}/p/${setup.room.id}/${route.replace(":session", setup.joined.sessionId)}`, {}, {
      authorization: `Bearer ${token}`,
    });
    expect(revoked.status).toBe(200);
    const error = { code: -32001, message: "SESSION_INVALID" };

    // The HTTP request is the ticket's although no socket of the ticket carries it.
    const outcome = await settleWithin(call, SETTLE_MS);
    expect(outcome).toMatchObject({ settled: true, value: { body: { id: 7, error } } });
    expect((await agentEnding(agent, "session.revoked")).error).toEqual(error);
    expect(setup.relay.server.rooms.get(setup.room.id)?.mcpPending.size).toBe(0);
    await expectCloseResolves(setup.relay.server);
  });

  it.each([
    ["while its metadata is retained", 60 * 60_000],
    ["when it is deleted", 72 * 60 * 60_000],
  ])("answers ROOM_EXPIRED when the sweeper expires the room %s", async (_label, afterExpiryMs) => {
    const setup = await roomWithSilentProvider();
    const { response: call } = await callInFlight(setup);
    const entry = setup.relay.server.rooms.get(setup.room.id)!;
    (setup.relay.server as SweepableServer).sweep(entry.expiresAt + afterExpiryMs);

    const outcome = await settleWithin(call, SETTLE_MS);
    expect(outcome.settled).toBe(true);
    if (!outcome.settled) return;
    expect(outcome.value.body).toMatchObject({ id: 7, error: { code: -32056, message: "ROOM_EXPIRED" } });
    expect(entry.mcpPending.size).toBe(0);
    await expectCloseResolves(setup.relay.server);
  });

  it("names the replacement room to a WebSocket agent, in its room.rotated and its request's error, as to an HTTP one", async () => {
    const setup = await roomWithSilentProvider();
    const { response: call } = await callInFlight(setup);
    const agent = await agentCallInFlight(setup);
    const rotated = await postJson(`${setup.relay.base}/p/${setup.room.id}/rotate`, {}, { authorization: `Bearer ${setup.room.providerToken}` });
    expect(rotated.status).toBe(201);
    const replacement = (await rotated.json()) as { replacementRoomId: string; replacementRoomEpoch: number };
    expect(replacement.replacementRoomEpoch).toBe(setup.room.roomEpoch + 1);
    const error = {
      code: -32057,
      message: "ROOM_ROTATED",
      data: { replacementRoomId: replacement.replacementRoomId, roomId: setup.room.id, roomEpoch: setup.room.roomEpoch },
    };

    const outcome = await settleWithin(call, SETTLE_MS);
    expect(outcome).toMatchObject({ settled: true, value: { body: { id: 7, error } } });
    const ending = await agentEnding(agent, "room.rotated");
    expect(ending.frame).toMatchObject({
      roomId: setup.room.id,
      roomEpoch: setup.room.roomEpoch,
      sessionId: setup.joined.sessionId,
      rotatedTo: replacement.replacementRoomId,
      reason: "ROOM_ROTATED",
      payload: { replacementRoomId: replacement.replacementRoomId, replacementRoomEpoch: replacement.replacementRoomEpoch, reason: "ROOM_ROTATED" },
    });
    expect(ending.error).toEqual(error);
    await expectCloseResolves(setup.relay.server);
  });

  it("ends a WebSocket agent's request with the ROOM_EXPIRED an HTTP one gets, after a room.expired frame", async () => {
    const setup = await roomWithSilentProvider();
    const { response: call } = await callInFlight(setup);
    const agent = await agentCallInFlight(setup);
    const entry = setup.relay.server.rooms.get(setup.room.id)!;
    (setup.relay.server as SweepableServer).sweep(entry.expiresAt);
    const error = { code: -32056, message: "ROOM_EXPIRED", data: { roomId: setup.room.id, roomEpoch: setup.room.roomEpoch } };

    const outcome = await settleWithin(call, SETTLE_MS);
    expect(outcome).toMatchObject({ settled: true, value: { body: { id: 7, error } } });
    const ending = await agentEnding(agent, "room.expired");
    expect(ending.frame).toMatchObject({
      protocol: "webmcp-peer/1",
      roomId: setup.room.id,
      roomEpoch: setup.room.roomEpoch,
      sessionId: setup.joined.sessionId,
      reason: "ROOM_EXPIRED",
      payload: { sessionId: setup.joined.sessionId, roomId: setup.room.id, roomEpoch: setup.room.roomEpoch, reason: "ROOM_EXPIRED" },
    });
    expect(ending.error).toEqual(error);
    expect(agent.frames.some((frame) => frame.type === "session.revoked")).toBe(false);
    // The ticket ended with its room, which a status poll reports (not as a revocation).
    expect([...entry.clientTickets.values()].map((ticket) => ticket.status)).toEqual(["expired"]);
    await expectCloseResolves(setup.relay.server);
  });

  /**
   * Runs after the sweep that starts each HTTP request: the room `x-test-expire-room` names expires
   * as if its time ran out while the request was in transit, so the route finds it expired first.
   */
  const expireDuringRequest: WebMcpPeerServerOptions["customHttpHandler"] = (req, _res, _url, _origin, server) => {
    const roomId = req.headers["x-test-expire-room"];
    if (typeof roomId === "string") server.rooms.get(roomId)!.expiresAt = Date.now() - 1;
    return false;
  };

  /** Each place the relay looks at a room, which may find it expired before any sweep has. */
  const discoveries: Array<[string, (setup: Setup, agent: RecordingSocket) => Promise<void>]> = [
    ["a frame from one of its agent sockets", async ({ relay, room }, agent) => {
      relay.server.rooms.get(room.id)!.expiresAt = Date.now() - 1;
      agent.send({ type: "ping" });
    }],
    ["a frame from its provider socket", async ({ relay, room, provider }) => {
      relay.server.rooms.get(room.id)!.expiresAt = Date.now() - 1;
      provider.send({ type: "ping" });
    }],
    ["a WebSocket upgrade to it", async ({ relay, room, joined }) => {
      relay.server.rooms.get(room.id)!.expiresAt = Date.now() - 1;
      await expect(openClient(relay, room, joined, sockets)).rejects.toThrow();
    }],
    ["the ticket of an MCP request", async ({ relay, room, joined }) => {
      const ping = await postJson(`${relay.base}/p/${room.id}/mcp`, { jsonrpc: "2.0", id: 1, method: "ping" }, {
        authorization: `Bearer ${joined.clientToken}`,
        "x-test-expire-room": room.id,
      });
      expect(ping.status).toBe(200);
    }],
    ["the room check of a lifecycle route", async ({ relay, room }) => {
      const join = await postJson(`${relay.base}/p/${room.id}/join`, { inviteToken: room.inviteToken }, { "x-test-expire-room": room.id });
      expect(join.status).toBe(410);
    }],
  ];

  it.each(discoveries)("carries out the room's expiry where it is found first, not only at the sweep: %s", async (_label, discover) => {
    const setup = await roomWithSilentProvider({ customHttpHandler: expireDuringRequest });
    const { response: call } = await callInFlight(setup);
    const agent = await agentCallInFlight(setup);
    await discover(setup, agent);
    const error = { code: -32056, message: "ROOM_EXPIRED", data: { roomId: setup.room.id, roomEpoch: setup.room.roomEpoch } };

    const outcome = await settleWithin(call, SETTLE_MS);
    expect(outcome).toMatchObject({ settled: true, value: { body: { id: 7, error } } });
    expect((await agentEnding(agent, "room.expired")).error).toEqual(error);
    const entry = setup.relay.server.rooms.get(setup.room.id)!;
    expect(entry.roomState).toBe("expired");
    expect(entry.providerSocket).toBeUndefined();
    await expectCloseResolves(setup.relay.server);
  });

  it("releases the pending slot as soon as the HTTP agent disconnects", async () => {
    const setup = await roomWithSilentProvider();
    const abort = new AbortController();
    await callInFlight(setup, abort.signal);
    abort.abort();
    const entry = setup.relay.server.rooms.get(setup.room.id)!;
    await until(() => entry.mcpPending.size, (size) => size === 0, "pending slot released after disconnect");
    await expectCloseResolves(setup.relay.server);
  });
});
