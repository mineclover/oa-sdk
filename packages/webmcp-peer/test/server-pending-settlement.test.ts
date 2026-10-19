// Regression tests: an HTTP `tools/call` in flight when its room is rotated, revoked or expired
// must receive a JSON-RPC error (not hang), and `server.close()` must still resolve.
import { afterEach, describe, expect, it } from "vitest";
import { WebMcpPeerServer, type WebMcpPeerServerOptions } from "../src/server.js";
import {
  createRoom,
  joinRoom,
  openProvider,
  postJson,
  settleWithin,
  startRelay,
  tool,
  until,
  type Relay,
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

async function callInFlight(setup: Awaited<ReturnType<typeof roomWithSilentProvider>>, signal?: AbortSignal) {
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

async function expectCloseResolves(server: WebMcpPeerServer): Promise<void> {
  closed.add(server);
  expect((await settleWithin(server.close(), SETTLE_MS)).settled).toBe(true);
}

describe("in-flight HTTP MCP requests across room shutdown", () => {
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
