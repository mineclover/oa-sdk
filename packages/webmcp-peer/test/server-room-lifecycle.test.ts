// Regression tests for room TTL bounds, room expiry and retention, idempotent session revocation
// responses, the room id grammar of the routes, and how every route reads its Authorization header;
// the formats of the ids and tokens the relay issues, and the expiry sweep, from its timer and at the
// start of every HTTP request.
import { createHash } from "node:crypto";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebMcpPeerServer, type RoomEntry } from "../src/server.js";
import { createRoom, joinRoom, openClient, postJson, startRelay, type JoinedSession, type RoomDescriptor } from "./server-test-helpers.js";

const servers: WebMcpPeerServer[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** A relay whose sweep a test can run as of any time. */
class SweepableServer extends WebMcpPeerServer {
  sweep(now: number): void {
    this.cleanupExpiredRooms(now);
  }
}

describe("room TTL bounds", () => {
  it("clamps a huge ttlMs on creation and rotation so the room expires and session status stays readable", async () => {
    const relay = await startRelay(servers);
    const before = Date.now();
    const room = await createRoom(relay.base, { approvalRequired: false, ttlMs: 1e16 });
    expect(room.expiresAt).toBeGreaterThan(before);
    expect(room.expiresAt).toBeLessThanOrEqual(Date.now() + DAY_MS);

    const joined = await joinRoom(relay.base, room);
    const status = await fetch(`${relay.base}/p/${room.id}/sessions/${joined.sessionId}`, { headers: { authorization: `Bearer ${joined.clientToken}` } });
    expect(status.status).toBe(200);
    expect(((await status.json()) as { expiresAt: string }).expiresAt).toBe(new Date(room.expiresAt).toISOString());

    const rotated = await postJson(`${relay.base}/p/${room.id}/rotate`, { ttlMs: 1e16 }, { authorization: `Bearer ${room.providerToken}` });
    expect(rotated.status).toBe(201);
    expect(((await rotated.json()) as { expiresAt: number }).expiresAt).toBeLessThanOrEqual(Date.now() + DAY_MS);
  });

  it("honours a configured maxRoomTtlMs and advertises it in /config", async () => {
    const relay = await startRelay(servers, { maxRoomTtlMs: 10 * 60_000 });
    const room = await createRoom(relay.base, { approvalRequired: false, ttlMs: 60 * 60_000 });
    expect(room.expiresAt).toBeLessThanOrEqual(Date.now() + 10 * 60_000);
    const config = (await (await fetch(`${relay.base}/config`)).json()) as { defaults: Record<string, number> };
    expect(config.defaults).toMatchObject({ roomTtlMs: 10 * 60_000, maxRoomTtlMs: 10 * 60_000 });
  });
});

describe("room expiry and retention", () => {
  /** Each lifecycle route of `room` but session status, signed as its provider or its agent signs it. */
  const lifecycleRequests = (base: string, room: RoomDescriptor, joined: JoinedSession, entry: RoomEntry): Array<[string, () => Promise<Response>]> => {
    const provider = { authorization: `Bearer ${room.providerToken}` };
    const binding = { roomId: room.id, roomEpoch: room.roomEpoch };
    return [
      ["join", () => postJson(`${base}/p/${room.id}/join`, { inviteToken: room.inviteToken })],
      ["reclaim", () => postJson(`${base}/p/${room.id}/reclaim`, { ...binding, leaseToken: entry.reconnectLeaseToken })],
      ["approval", () => postJson(`${base}/p/${room.id}/approval/${joined.approvalRequestId}`, { ...binding, sessionId: joined.sessionId, decision: "approved" }, provider)],
      ["revoke", () => postJson(`${base}/p/${room.id}/session/revoke`, binding, { authorization: `Bearer ${joined.clientToken}` })],
      ["session revoke", () => postJson(`${base}/p/${room.id}/sessions/${joined.sessionId}/revoke`, binding, provider)],
      ["rotate", () => postJson(`${base}/p/${room.id}/rotate`, binding, provider)],
    ];
  };
  const answer = async (response: Response) => [response.status, await response.json()];

  it("answers every lifecycle route of an expired room 410 ROOM_EXPIRED while it is retained, and 404 once it is deleted", async () => {
    const relay = await startRelay(servers, {}, (options) => new SweepableServer(options));
    const room = await createRoom(relay.base, { approvalRequired: true });
    const joined = await joinRoom(relay.base, room);
    const entry = relay.server.rooms.get(room.id)!;
    entry.expiresAt = Date.now() - 1;
    const requests = lifecycleRequests(relay.base, room, joined, entry);
    const status = () => fetch(`${relay.base}/p/${room.id}/sessions/${joined.sessionId}`, { headers: { authorization: `Bearer ${joined.clientToken}` } });

    const expired = { error: "ROOM_EXPIRED", code: -32056, roomId: room.id, roomEpoch: room.roomEpoch };
    for (const [label, request] of requests) {
      expect(await answer(await request()), label).toEqual([410, expired]);
    }
    // Session status still answers, and tells the room's expiry from a revocation.
    const ended = await status();
    expect(ended.status).toBe(200);
    expect(await ended.json()).toMatchObject({ sessionId: joined.sessionId, state: "expired", revokedAt: expect.any(String) });
    expect(entry.roomState).toBe("expired");
    expect(entry.inviteConsumed).toBe(true);

    (relay.server as SweepableServer).sweep(entry.metadataRetainUntil!);
    expect(relay.server.rooms.has(room.id)).toBe(false);
    for (const [label, request] of [...requests, ["session status", status] as const]) {
      const [code, body] = await answer(await request());
      expect([code, (body as { error?: string }).error], label).toEqual([404, "ROOM_NOT_FOUND"]);
    }
  });

  it("refuses a reclaim of a live room whose lease expired with 410 ROOM_LEASE_EXPIRED, not the room's ROOM_EXPIRED", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base);
    const entry = relay.server.rooms.get(room.id)!;
    entry.reconnectLeaseExpiresAt = Date.now() - 1;
    const reclaim = await postJson(`${relay.base}/p/${room.id}/reclaim`, { leaseToken: entry.reconnectLeaseToken });
    expect(await answer(reclaim)).toEqual([410, { error: "ROOM_LEASE_EXPIRED", roomId: room.id, roomEpoch: room.roomEpoch }]);
    expect(entry.roomState).toBe("provisioned");
  });

  it("refuses a join in the millisecond its room expires, as every other route does, and keeps the invite", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base);
    const entry = relay.server.rooms.get(room.id)!;
    // The clock stands at the room's expiry while the join is served.
    const clock = vi.spyOn(Date, "now").mockReturnValue(entry.expiresAt);
    let join: unknown[];
    try {
      join = await answer(await postJson(`${relay.base}/p/${room.id}/join`, { inviteToken: room.inviteToken }));
    } finally {
      clock.mockRestore();
    }
    expect(join).toEqual([410, { error: "ROOM_EXPIRED", code: -32056, roomId: room.id, roomEpoch: room.roomEpoch }]);
    expect(entry.inviteConsumed).toBe(false);
    expect(entry.clientTickets.size).toBe(0);
  });

  it("retains a rotated room, answering 410 ROOM_ROTATED with its replacement, until a day after its original expiry", async () => {
    const relay = await startRelay(servers, {}, (options) => new SweepableServer(options));
    const room = await createRoom(relay.base);
    const originalExpiry = room.expiresAt;
    const rotated = await postJson(`${relay.base}/p/${room.id}/rotate`, {}, { authorization: `Bearer ${room.providerToken}` });
    const replacement = (await rotated.json()) as { replacementRoomId: string };
    const join = () => postJson(`${relay.base}/p/${room.id}/join`, { inviteToken: room.inviteToken });

    // Long after the rotation, still within the retention an expired room has.
    (relay.server as SweepableServer).sweep(originalExpiry + DAY_MS - 1);
    expect(await answer(await join())).toEqual([
      410,
      { error: "ROOM_ROTATED", code: -32057, roomId: room.id, roomEpoch: room.roomEpoch, replacementRoomId: replacement.replacementRoomId },
    ]);
    (relay.server as SweepableServer).sweep(originalExpiry + DAY_MS);
    const [code, body] = await answer(await join());
    expect([code, (body as { error?: string }).error]).toEqual([404, "ROOM_NOT_FOUND"]);
  });
});

describe("session revocation responses", () => {
  async function approvedSession() {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const joined = await joinRoom(relay.base, room);
    return { relay, room, joined };
  }

  type RevokeBody = { alreadyRevoked: boolean; revokedAt: string; state: string };

  it("reports alreadyRevoked false then true for a provider revocation", async () => {
    const { relay, room, joined } = await approvedSession();
    const revoke = async () => {
      const response = await postJson(`${relay.base}/p/${room.id}/sessions/${joined.sessionId}/revoke`, { roomId: room.id, roomEpoch: room.roomEpoch }, {
        authorization: `Bearer ${room.providerToken}`,
      });
      expect(response.status).toBe(200);
      return (await response.json()) as RevokeBody;
    };
    const first = await revoke();
    const second = await revoke();
    expect(first).toMatchObject({ state: "revoked", alreadyRevoked: false });
    expect(second).toMatchObject({ state: "revoked", alreadyRevoked: true, revokedAt: first.revokedAt });
  });

  it("reports alreadyRevoked false then true for a client revocation", async () => {
    const { relay, room, joined } = await approvedSession();
    const revoke = async () => {
      const response = await postJson(`${relay.base}/p/${room.id}/session/revoke`, { roomId: room.id, roomEpoch: room.roomEpoch }, {
        authorization: `Bearer ${joined.clientToken}`,
      });
      expect(response.status).toBe(200);
      return (await response.json()) as RevokeBody;
    };
    const first = await revoke();
    const second = await revoke();
    expect(first).toMatchObject({ state: "revoked", alreadyRevoked: false });
    expect(second).toMatchObject({ state: "revoked", alreadyRevoked: true, revokedAt: first.revokedAt });
  });
});

describe("room ids", () => {
  /** Every room lifecycle route for room `roomId`, as [label, request]. */
  const lifecycleRoutes = (base: string, roomId: string): Array<[string, () => Promise<Response>]> => [
    ["reclaim", () => postJson(`${base}/p/${roomId}/reclaim`, {})],
    ["join", () => postJson(`${base}/p/${roomId}/join`, { inviteToken: "invite" })],
    ["approval", () => postJson(`${base}/p/${roomId}/approval/approval-x`, {}, { authorization: "Bearer token" })],
    ["session status", () => fetch(`${base}/p/${roomId}/sessions/peer-session-x`, { headers: { authorization: "Bearer token" } })],
    ["revoke", () => postJson(`${base}/p/${roomId}/session/revoke`, {}, { authorization: "Bearer token" })],
    ["session revoke", () => postJson(`${base}/p/${roomId}/sessions/peer-session-x/revoke`, {}, { authorization: "Bearer token" })],
    ["rotate", () => postJson(`${base}/p/${roomId}/rotate`, {}, { authorization: "Bearer token" })],
  ];
  const errorOf = async (response: Response) => [response.status, ((await response.json()) as { error?: string }).error];

  it("answers ROOM_NOT_FOUND for an unknown id of the protocol's grammar on every lifecycle route", async () => {
    const relay = await startRelay(servers);
    // Not lowercase hex like the ids this relay issues, but an id another relay may issue.
    for (const roomId of ["Room_Unknown-1", "x", "A".repeat(128)]) {
      for (const [label, request] of lifecycleRoutes(relay.base, roomId)) {
        expect(await errorOf(await request()), `${label} ${roomId}`).toEqual([404, "ROOM_NOT_FOUND"]);
      }
    }
  });

  it("answers NOT_FOUND for an id outside the grammar on every room route, the MCP routes included", async () => {
    const relay = await startRelay(servers);
    for (const roomId of ["a".repeat(129), "a.b", "a%20b"]) {
      const routes: Array<[string, () => Promise<Response>]> = [
        ...lifecycleRoutes(relay.base, roomId),
        ["descriptor", () => fetch(`${relay.base}/p/${roomId}/mcp`)],
        ["tools", () => fetch(`${relay.base}/p/${roomId}/mcp/tools`)],
        ["mcp", () => postJson(`${relay.base}/p/${roomId}/mcp`, { jsonrpc: "2.0", id: 1, method: "ping" })],
      ];
      for (const [label, request] of routes) {
        expect(await errorOf(await request()), `${label} ${roomId}`).toEqual([404, "NOT_FOUND"]);
      }
    }
  });
});

describe("Authorization", () => {
  it("takes a Bearer token with a scheme of any case and one or more spaces on every route", async () => {
    const relay = await startRelay(servers, { publishKey: "publish-secret" });
    const created = await postJson(`${relay.base}/p`, { approvalRequired: true }, { authorization: "bearer   publish-secret" });
    expect(created.status).toBe(201);
    const room = (await created.json()) as RoomDescriptor;
    const joined = await joinRoom(relay.base, room);

    const status = await fetch(`${relay.base}/p/${room.id}/sessions/${joined.sessionId}`, { headers: { authorization: `BEARER ${joined.clientToken}` } });
    expect(status.status).toBe(200);
    const approval = await postJson(
      `${relay.base}/p/${room.id}/approval/${joined.approvalRequestId}`,
      { sessionId: joined.sessionId, roomId: room.id, roomEpoch: room.roomEpoch, decision: "approved" },
      { authorization: `bearer  ${room.providerToken}` },
    );
    expect(approval.status).toBe(200);
    const initialize = await postJson(
      `${relay.base}/p/${room.id}/mcp`,
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } },
      { authorization: `bEaReR ${joined.clientToken}` },
    );
    expect(((await initialize.json()) as { result: { _meta: { auth: { state: string } } } }).result._meta.auth.state).toBe("approved");
    const revoked = await postJson(
      `${relay.base}/p/${room.id}/session/revoke`,
      { roomId: room.id, roomEpoch: room.roomEpoch },
      { authorization: `bearer ${joined.clientToken}` },
    );
    expect(revoked.status).toBe(200);
    const rotated = await postJson(`${relay.base}/p/${room.id}/rotate`, {}, { authorization: `Bearer    ${room.providerToken}` });
    expect(rotated.status).toBe(201);
  });

  it("reads X-Publish-Key for the publish key only", async () => {
    const relay = await startRelay(servers, { publishKey: "publish-secret" });
    expect((await postJson(`${relay.base}/p`, {}, { "x-publish-key": "publish-secret" })).status).toBe(201);
    const room = await createRoom(relay.base, {}, { authorization: "Bearer publish-secret" });
    const rotated = await postJson(`${relay.base}/p/${room.id}/rotate`, {}, { "x-publish-key": room.providerToken });
    expect(await rotated.json()).toEqual({ error: "PROVIDER_TOKEN_REQUIRED" });

    const request = (headers: Record<string, string>) => {
      const message = new IncomingMessage(new Socket());
      message.headers = headers;
      return message;
    };
    expect(relay.server.bearerToken(request({ "x-publish-key": "publish-secret" }))).toBe("");
    expect(relay.server.bearerToken(request({ authorization: "Basic dXNlcjpwYXNz" }))).toBe("");
    expect(relay.server.bearerToken(request({ authorization: "bearer\t token " }))).toBe("token");
  });

  it("keeps a client token only as its SHA-256 hash, the key its ticket is found by", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const joined = await joinRoom(relay.base, room);
    const entry = relay.server.rooms.get(room.id)!;
    expect([...entry.clientTickets.keys()]).toEqual([createHash("sha256").update(joined.clientToken, "utf8").digest("hex")]);
    expect(JSON.stringify([...entry.clientTickets])).not.toContain(joined.clientToken);
  });
});

describe("identifiers and tokens", () => {
  it("issues room ids, tokens, session ids and approval request ids of the protocol's formats, fresh each time", async () => {
    const relay = await startRelay(servers);
    const hex = (bytes: number) => new RegExp(`^[0-9a-f]{${bytes * 2}}$`);
    const rooms = [await createRoom(relay.base, { approvalRequired: true }), await createRoom(relay.base, { approvalRequired: true })];
    const issued: string[] = [];
    for (const room of rooms) {
      const { reconnectToken } = room as RoomDescriptor & { reconnectToken: string };
      expect(room.id).toMatch(hex(16));
      for (const token of [room.providerToken, room.inviteToken, reconnectToken]) expect(token).toMatch(hex(24));
      const joined = await joinRoom(relay.base, room);
      expect(joined.clientToken).toMatch(hex(24));
      expect(joined.sessionId).toMatch(/^peer-session-[0-9a-f]{32}$/);
      expect(joined.approvalRequestId).toMatch(/^approval-[0-9a-f]{32}$/);
      // A reclaim issues a new provider token and lease of the same formats.
      const reclaimed = await postJson(`${relay.base}/p/${room.id}/reclaim`, { leaseToken: reconnectToken });
      const lease = (await reclaimed.json()) as { providerToken: string; reconnectToken: string };
      expect([lease.providerToken, lease.reconnectToken]).toEqual([expect.stringMatching(hex(24)), expect.stringMatching(hex(24))]);
      issued.push(room.id, room.providerToken, room.inviteToken, reconnectToken, joined.clientToken, joined.sessionId, joined.approvalRequestId!, lease.providerToken, lease.reconnectToken);
    }
    expect(new Set(issued).size).toBe(issued.length);
  });
});

describe("the expiry sweep", { timeout: 20_000 }, () => {
  it("arms one timer of max(1000, roomSweepIntervalMs ?? 30000) ms, and none for 0 or NaN", async () => {
    const intervals = vi.spyOn(globalThis, "setInterval");
    const armed: Array<[number | undefined, unknown[]]> = [];
    for (const roomSweepIntervalMs of [undefined, 200, 5000, Number.POSITIVE_INFINITY, 0, Number.NaN]) {
      intervals.mockClear();
      await startRelay(servers, { roomSweepIntervalMs });
      armed.push([roomSweepIntervalMs, intervals.mock.calls.map((call) => call[1])]);
    }
    expect(armed).toEqual([
      [undefined, [30_000]],
      [200, [1000]],
      [5000, [5000]],
      // Node runs a delay it cannot hold after 1 ms, so this relay sweeps about every millisecond.
      [Number.POSITIVE_INFINITY, [Number.POSITIVE_INFINITY]],
      [0, []],
      [Number.NaN, []],
    ]);
  });

  it("expires a room from its timer without any request, and at the start of an HTTP request without a timer", async () => {
    // Node reports the infinite interval with a process warning; it is one of the cases under test.
    vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    const real = Date.now.bind(Date);
    let offset = 0;
    vi.spyOn(Date, "now").mockImplementation(() => real() + offset);
    const relays = await Promise.all([1000, Number.POSITIVE_INFINITY, Number.NaN, 0].map((roomSweepIntervalMs) => startRelay(servers, { roomSweepIntervalMs })));
    const agents = [];
    for (const relay of relays) {
      const room = await createRoom(relay.base, { approvalRequired: false, ttlMs: 60_000 });
      agents.push(await openClient(relay, room, await joinRoom(relay.base, room), sockets));
    }
    const [timed, everyMillisecond, notANumber, none] = agents;

    // Every room is past its expiry; no relay gets a request from now on until the last step.
    offset = 61_000;
    await timed!.waitFor((frame) => frame.type === "room.expired", "the expiry the 1000 ms timer finds", 5000);
    await everyMillisecond!.waitFor((frame) => frame.type === "room.expired", "the expiry the 1 ms timer finds", 5000);
    for (const agent of [notANumber!, none!]) expect(agent.frames.some((frame) => frame.type === "room.expired")).toBe(false);

    // A relay without a timer sweeps at the start of every HTTP request, whatever its route.
    for (const relay of relays.slice(2)) await (await fetch(`${relay.base}/health`)).arrayBuffer();
    for (const agent of [notANumber!, none!]) await agent.waitFor((frame) => frame.type === "room.expired", "the expiry a request finds", 5000);
  });
});
