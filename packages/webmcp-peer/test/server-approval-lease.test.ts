// Regression tests for the approval request's lifetime and its expiry signal, the reconnect lease's
// grace after the provider socket goes away, the room binding of the state-changing routes, what the
// provider socket is told about decisions and revocations made elsewhere, and the time fields and
// message ids of the frames that carry them.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebMcpPeerServer } from "../src/server.js";
import {
  createRoom,
  flush,
  joinRoom,
  openClient,
  openProvider,
  postJson,
  startRelay,
  until,
  type Frame,
  type JoinedSession,
  type RecordingSocket,
  type Relay,
  type RoomDescriptor,
} from "./server-test-helpers.js";

const servers: WebMcpPeerServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
});

const MINUTE_MS = 60_000;
const GRACE_MS = 15 * MINUTE_MS;

/** The relay's clock moved by `advance(ms)` while real time keeps running under it. */
function offsetClock(): { advance(ms: number): void } {
  const realNow = Date.now.bind(Date);
  let offset = 0;
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
  return { advance: (ms) => void (offset += ms) };
}

const answer = async (response: Response): Promise<[number, Record<string, any>]> => [response.status, (await response.json()) as Record<string, any>];
const asProvider = (room: RoomDescriptor) => ({ authorization: `Bearer ${room.providerToken}` });
const asClient = (joined: JoinedSession) => ({ authorization: `Bearer ${joined.clientToken}` });

async function providerFor(relay: Relay, room: RoomDescriptor): Promise<RecordingSocket> {
  const provider = await openProvider(relay, room, sockets);
  await provider.waitFor((frame) => frame.type === "ready", "provider ready");
  return provider;
}

function framesOf(socket: RecordingSocket, type: string): Frame[] {
  return socket.frames.filter((frame) => frame.type === type);
}

describe("the reconnect lease", () => {
  const reclaim = (relay: Relay, room: RoomDescriptor, leaseToken: string) =>
    postJson(`${relay.base}/p/${room.id}/reclaim`, { roomId: room.id, roomEpoch: room.roomEpoch, leaseToken });

  it("reports the room's expiry and a 15-minute grace in the room descriptor", async () => {
    const relay = await startRelay(servers);
    const room = (await createRoom(relay.base)) as RoomDescriptor & Record<string, unknown>;
    expect(room).toMatchObject({ reconnectTokenExpiresAt: room.expiresAt, reconnectGraceMs: GRACE_MS });
  });

  it("does not expire while a provider socket is attached, and lasts 15 minutes after the socket goes away", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base);
    const entry = relay.server.rooms.get(room.id)!;
    const lease = entry.reconnectLeaseToken;
    const provider = await providerFor(relay, room);
    const clock = offsetClock();

    // The host keeps its socket for longer than the grace: the lease holds, and only the attached
    // provider stands in the way of a reclaim.
    clock.advance(20 * MINUTE_MS);
    expect(await answer(await reclaim(relay, room, lease))).toEqual([409, { error: "ROOM_PROVIDER_ACTIVE", roomId: room.id, roomEpoch: room.roomEpoch }]);

    // A reload drops the socket; the reloaded page reclaims the room within the grace.
    provider.ws.close();
    await until(() => entry.providerSocket, (socket) => socket === undefined, "provider detached");
    clock.advance(GRACE_MS - MINUTE_MS);
    const [status, reclaimed] = await answer(await reclaim(relay, room, lease));
    expect(status).toBe(200);
    expect(reclaimed).toMatchObject({ reclaimed: true, reconnectTokenExpiresAt: entry.expiresAt, reconnectGraceMs: GRACE_MS });

    // The reclaimed lease has a grace of its own until a provider socket attaches with it.
    clock.advance(GRACE_MS);
    expect(await answer(await reclaim(relay, room, reclaimed.reconnectToken))).toEqual([
      410,
      { error: "ROOM_LEASE_EXPIRED", roomId: room.id, roomEpoch: room.roomEpoch },
    ]);
  });

  it("expires 15 minutes after the provider socket went away, however long it was attached", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base);
    const entry = relay.server.rooms.get(room.id)!;
    const provider = await providerFor(relay, room);
    const clock = offsetClock();
    clock.advance(30 * MINUTE_MS);
    provider.ws.close();
    await until(() => entry.providerSocket, (socket) => socket === undefined, "provider detached");

    clock.advance(GRACE_MS);
    expect(await answer(await reclaim(relay, room, entry.reconnectLeaseToken))).toEqual([
      410,
      { error: "ROOM_LEASE_EXPIRED", roomId: room.id, roomEpoch: room.roomEpoch },
    ]);
  });
});

describe("an approval request's lifetime", () => {
  it.each([
    ["by default", {}, 5 * MINUTE_MS],
    ["as configured", { approvalTimeoutMs: 2 * MINUTE_MS }, 2 * MINUTE_MS],
    ["at least 1 s", { approvalTimeoutMs: 10 }, 1_000],
    ["by default for NaN", { approvalTimeoutMs: Number.NaN }, 5 * MINUTE_MS],
  ])("is approvalTimeoutMs %s, not the MCP request timeout", async (_label, options, lifetimeMs) => {
    const relay = await startRelay(servers, { mcpRequestTimeoutMs: 1_000, ...options });
    const room = await createRoom(relay.base, { approvalRequired: true });
    const provider = await providerFor(relay, room);
    const joined = await joinRoom(relay.base, room);
    const request = relay.server.rooms.get(room.id)!.pendingApprovals.get(joined.approvalRequestId!)!;
    expect(request.expiresAt - request.createdAt).toBe(lifetimeMs);
    const delivered = await provider.waitFor((frame) => frame.type === "approval.request", "approval.request");
    expect(delivered.expiresAt).toBe(request.expiresAt);
  });

  it("never outlives the room, which an infinite approvalTimeoutMs waits for", async () => {
    const relay = await startRelay(servers, { approvalTimeoutMs: Number.POSITIVE_INFINITY });
    const room = await createRoom(relay.base, { approvalRequired: true, ttlMs: 60_000 });
    const joined = await joinRoom(relay.base, room);
    expect(relay.server.rooms.get(room.id)!.pendingApprovals.get(joined.approvalRequestId!)!.expiresAt).toBe(room.expiresAt);
  });

  it("ends with approval.expired to the agent and the provider, and a decision after it is refused", async () => {
    const relay = await startRelay(servers, { approvalTimeoutMs: 1_000 });
    const room = await createRoom(relay.base, { approvalRequired: true });
    const provider = await providerFor(relay, room);
    const joined = await joinRoom(relay.base, room);
    const agent = await openClient(relay, room, joined, sockets);
    const pending = await agent.waitFor((frame) => frame.type === "approval.pending", "approval.pending");
    expect(pending).toMatchObject({
      protocol: "webmcp-peer/1",
      messageId: expect.any(String),
      sentAt: expect.any(String),
      requestId: joined.approvalRequestId,
      sessionId: joined.sessionId,
    });

    const expected = {
      protocol: "webmcp-peer/1",
      messageId: expect.any(String),
      type: "approval.expired",
      roomId: room.id,
      roomEpoch: room.roomEpoch,
      sessionId: joined.sessionId,
      requestId: joined.approvalRequestId,
      sentAt: expect.any(String),
      reason: "APPROVAL_EXPIRED",
    };
    expect(await agent.waitFor((frame) => frame.type === "approval.expired", "agent approval.expired")).toEqual(expected);
    expect(await provider.waitFor((frame) => frame.type === "approval.expired", "provider approval.expired")).toEqual(expected);

    const status = await fetch(`${relay.base}/p/${room.id}/sessions/${joined.sessionId}`, { headers: asClient(joined) });
    expect(((await status.json()) as { state: string }).state).toBe("expired");
    const decision = { roomId: room.id, roomEpoch: room.roomEpoch, sessionId: joined.sessionId, decision: "approved" };
    expect(await answer(await postJson(`${relay.base}/p/${room.id}/approval/${joined.approvalRequestId}`, decision, asProvider(room)))).toEqual([
      409,
      { error: "INVALID_APPROVAL", code: -32081 },
    ]);
  });

  it("expires a request whose timer fired before it was due, once it is", async () => {
    const relay = await startRelay(servers, { approvalTimeoutMs: 1_000 });
    const room = await createRoom(relay.base, { approvalRequired: true });
    const joined = await joinRoom(relay.base, room);
    // The relay's clock falls behind the timer's: when the timer fires the request is not yet due.
    offsetClock().advance(-600);
    const ticket = () => [...relay.server.rooms.get(room.id)!.clientTickets.values()][0]!;
    await until(() => ticket().status, (status) => status === "expired", "the request's expiry", 5_000);
    expect(relay.server.rooms.get(room.id)!.pendingApprovals.has(joined.approvalRequestId!)).toBe(false);
  });
});

describe("what the provider socket is told", () => {
  async function pendingSession() {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: true });
    const provider = await providerFor(relay, room);
    const joined = await joinRoom(relay.base, room);
    await provider.waitFor((frame) => frame.type === "approval.request", "approval.request");
    return { relay, room, provider, joined };
  }

  it.each(["approved", "rejected"] as const)("echoes a decision made over HTTP (%s), with both expiries", async (decision) => {
    const { relay, room, provider, joined } = await pendingSession();
    const agent = await openClient(relay, room, joined, sockets);
    const request = relay.server.rooms.get(room.id)!.pendingApprovals.get(joined.approvalRequestId!)!;
    const response = await postJson(
      `${relay.base}/p/${room.id}/approval/${joined.approvalRequestId}`,
      { sessionId: joined.sessionId, decision, reason: "decided over HTTP" },
      asProvider(room),
    );
    const [status, body] = await answer(response);
    const times = { approvalExpiresAt: request.expiresAt, ticketExpiresAt: joined.expiresAt };
    expect(status).toBe(200);
    expect(body).toMatchObject({ state: decision, expiresAt: new Date(request.expiresAt).toISOString(), ...times });

    const echo = await provider.waitFor((frame) => frame.type === `approval.${decision}`, "the decision's echo");
    expect(echo).toMatchObject({
      protocol: "webmcp-peer/1",
      messageId: expect.any(String),
      roomId: room.id,
      roomEpoch: room.roomEpoch,
      sessionId: joined.sessionId,
      requestId: joined.approvalRequestId,
      sentAt: body.decidedAt,
      expiresAt: request.expiresAt,
      ...times,
      payload: { state: decision, decidedAt: body.decidedAt, expiresAt: request.expiresAt, ...times },
      reason: "decided over HTTP",
    });
    if (decision === "approved") {
      // The agent's frame reports the ticket's expiry as `expiresAt`; both are named as well.
      const approved = await agent.waitFor((frame) => frame.type === "approval.approved", "agent approval.approved");
      expect(approved).toMatchObject({ expiresAt: joined.expiresAt, ...times, payload: { expiresAt: joined.expiresAt, ...times } });
    }
  });

  it("echoes a decision made on its own socket once", async () => {
    const { room, provider, joined } = await pendingSession();
    provider.send({
      protocol: "webmcp-peer/1",
      messageId: "decision-1",
      type: "approval.decision",
      payload: { requestId: joined.approvalRequestId, sessionId: joined.sessionId, roomId: room.id, roomEpoch: room.roomEpoch, decision: "approved" },
    });
    await provider.waitFor((frame) => frame.type === "approval.approved", "the decision's echo");
    await flush(provider, "the decision handled");
    expect(framesOf(provider, "approval.approved")).toHaveLength(1);
  });

  it.each([
    ["the agent's own revoke", "session/revoke", "client", "CLIENT_REVOKED", "client-request"],
    ["a session revoke over HTTP", "sessions/:session/revoke", "provider", "SESSION_REVOKED", "provider-request"],
    ["a revoke of every session", "session/revoke", "provider", "ROOM_REVOKED", undefined],
  ] as const)("tells it of %s with session.revoked", async (_label, route, signer, frameReason, defaultReason) => {
    const { relay, room, provider, joined } = await pendingSession();
    const response = await postJson(
      `${relay.base}/p/${room.id}/${route.replace(":session", joined.sessionId)}`,
      {},
      signer === "client" ? asClient(joined) : asProvider(room),
    );
    expect(response.status).toBe(200);
    // The reason the caller gets back is its own (here the default); the frame's is the relay's.
    if (defaultReason) expect(((await response.json()) as { reason: unknown }).reason).toBe(defaultReason);
    const revoked = await provider.waitFor((frame) => frame.type === "session.revoked", "session.revoked");
    expect(revoked).toMatchObject({
      protocol: "webmcp-peer/1",
      roomId: room.id,
      roomEpoch: room.roomEpoch,
      sessionId: joined.sessionId,
      sentAt: expect.any(String),
      reason: frameReason,
      payload: { sessionId: joined.sessionId, reason: frameReason },
    });
  });

  it("gives every message an id of its own, a repeated one included", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: true });
    const joined = await joinRoom(relay.base, room);
    const decision = { sessionId: joined.sessionId, decision: "approved" };
    expect((await postJson(`${relay.base}/p/${room.id}/approval/${joined.approvalRequestId}`, decision, asProvider(room))).status).toBe(200);

    // Every reattach restores the same approval: each time in a message of its own.
    const restored: Frame[] = [];
    for (let attach = 0; attach < 2; attach += 1) {
      const provider = await providerFor(relay, room);
      restored.push(await provider.waitFor((frame) => frame.type === "approval.restored", "approval.restored"));
      provider.ws.close();
      await until(() => relay.server.rooms.get(room.id)!.providerSocket, (socket) => socket === undefined, "provider detached");
    }
    expect(restored[0]!.messageId).toEqual(expect.any(String));
    expect(restored[0]!.messageId).not.toBe(restored[1]!.messageId);
  });
});

describe("the room binding of a state-changing request", () => {
  async function session(approvalRequired: boolean) {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired });
    const joined = await joinRoom(relay.base, room);
    return { relay, room, joined };
  }

  it("is optional on approval and both revoke routes", async () => {
    const pending = await session(true);
    const approval = await postJson(
      `${pending.relay.base}/p/${pending.room.id}/approval/${pending.joined.approvalRequestId}`,
      { sessionId: pending.joined.sessionId, decision: "approved" },
      asProvider(pending.room),
    );
    expect(approval.status).toBe(200);

    const byProvider = await session(false);
    const providerRevoke = await postJson(
      `${byProvider.relay.base}/p/${byProvider.room.id}/sessions/${byProvider.joined.sessionId}/revoke`,
      {},
      asProvider(byProvider.room),
    );
    expect(await answer(providerRevoke)).toEqual([200, expect.objectContaining({ state: "revoked", alreadyRevoked: false })]);

    const byClient = await session(false);
    const clientRevoke = await postJson(`${byClient.relay.base}/p/${byClient.room.id}/session/revoke`, {}, asClient(byClient.joined));
    expect(await answer(clientRevoke)).toEqual([200, expect.objectContaining({ state: "revoked", alreadyRevoked: false })]);
  });

  it("must name the room and its epoch when present, on every route under its own name", async () => {
    const { relay, room, joined } = await session(true);
    const entry = relay.server.rooms.get(room.id)!;
    const stale = { roomId: room.id, roomEpoch: room.roomEpoch + 1 };
    const other = { roomId: "another-room", roomEpoch: room.roomEpoch };
    const refusals: Array<[string, () => Promise<Response>, number, string]> = [
      ["approval", () => postJson(`${relay.base}/p/${room.id}/approval/${joined.approvalRequestId}`, { ...stale, sessionId: joined.sessionId, decision: "approved" }, asProvider(room)), 409, "INVALID_APPROVAL"],
      ["client revoke", () => postJson(`${relay.base}/p/${room.id}/session/revoke`, stale, asClient(joined)), 409, "SESSION_BINDING_INVALID"],
      ["session revoke", () => postJson(`${relay.base}/p/${room.id}/sessions/${joined.sessionId}/revoke`, other, asProvider(room)), 409, "SESSION_BINDING_INVALID"],
      // Not read as a request to revoke every session of the room.
      ["revoke of every session", () => postJson(`${relay.base}/p/${room.id}/session/revoke`, other, asProvider(room)), 409, "SESSION_BINDING_INVALID"],
      ["reclaim", () => postJson(`${relay.base}/p/${room.id}/reclaim`, { ...stale, leaseToken: entry.reconnectLeaseToken }), 409, "ROOM_LEASE_BINDING_INVALID"],
      ["rotate", () => postJson(`${relay.base}/p/${room.id}/rotate`, stale, asProvider(room)), 409, "ROOM_BINDING_INVALID"],
    ];
    for (const [label, request, status, error] of refusals) {
      const [code, body] = await answer(await request());
      expect([code, body.error], label).toEqual([status, error]);
    }
    const ticket = [...entry.clientTickets.values()][0]!;
    expect(ticket.status).toBe("pending");
    expect(entry.rotatedTo).toBeUndefined();
  });

  it("is checked after the request's credential", async () => {
    const { relay, room, joined } = await session(false);
    const entry = relay.server.rooms.get(room.id)!;
    const stale = { roomId: room.id, roomEpoch: room.roomEpoch + 1 };
    const sessionRevoke = await postJson(`${relay.base}/p/${room.id}/sessions/${joined.sessionId}/revoke`, stale, { authorization: "Bearer not-a-token" });
    expect((await answer(sessionRevoke))[1].error).toBe("CLIENT_TOKEN_INVALID");
    const reclaim = await postJson(`${relay.base}/p/${room.id}/reclaim`, { ...stale, leaseToken: "not-the-lease" });
    expect(await answer(reclaim)).toEqual([403, { error: "ROOM_LEASE_INVALID" }]);
    expect(entry.clientTickets.size).toBe(1);
  });
});

describe("owner hints without a publish key", () => {
  it("refuse hints that contradict each other and never become the room's owner", async () => {
    const relay = await startRelay(servers);
    const conflicting = await postJson(`${relay.base}/p`, { ownerId: "alice" }, { "x-framebook-owner": "bob" });
    expect(await answer(conflicting)).toEqual([403, { error: "PUBLISH_OWNER_BINDING_INVALID" }]);

    const agreeing = await postJson(`${relay.base}/p`, { ownerId: "alice" }, { "x-framebook-owner": "alice" });
    const [status, room] = await answer(agreeing);
    expect(status).toBe(201);
    expect(room.ownerId).toBeUndefined();
    expect(relay.server.rooms.get(room.id)?.ownerId).toBeUndefined();
  });
});
