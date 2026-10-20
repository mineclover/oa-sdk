// Regression tests for a provider socket that (re)attaches to a room it already served (browser F5
// lease reclaim, auto-reconnect): the relay replays the client approvals it holds, so an approved
// agent keeps working instead of being refused with CLIENT_APPROVAL_REQUIRED, and the end of a
// ticket the provider was away for, so the host takes down a room nobody can join any more.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WEBMCP_CLOSE_CODES } from "../src/config.js";
import { WebMcpPeerClient, type WebMcpHostAdapter } from "../src/provider.js";
import type { ClientSessionTicket, WebMcpPeerServer } from "../src/server.js";
import { MemoryStorage } from "./provider-fakes.js";
import {
  createRoom,
  flush,
  joinRoom,
  openProvider,
  postJson,
  startRelay,
  tool,
  until,
  type Frame,
  type JoinedSession,
  type Relay,
  type RoomDescriptor,
} from "./server-test-helpers.js";

const servers: WebMcpPeerServer[] = [];

/** The key of a client token's ticket in `RoomEntry.clientTickets`: the token's SHA-256 hex. */
const tokenHash = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");
const sockets: WebSocket[] = [];
const providers: WebMcpPeerClient[] = [];

afterEach(async () => {
  for (const provider of providers.splice(0)) provider.disconnect();
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function approveOverHttp(relay: Relay, room: RoomDescriptor, joined: JoinedSession): Promise<void> {
  const response = await postJson(`${relay.base}/p/${room.id}/approval/${encodeURIComponent(joined.approvalRequestId!)}`, {
    roomId: room.id, roomEpoch: room.roomEpoch, sessionId: joined.sessionId, decision: "approved",
  }, { authorization: `Bearer ${room.providerToken}` });
  expect(response.status).toBe(200);
}

/** Closes the room's provider socket from the relay side and waits until the relay detached it. */
async function dropProvider(relay: Relay, roomId: string): Promise<unknown> {
  const dropped = relay.server.rooms.get(roomId)?.providerSocket;
  expect(dropped).toBeDefined();
  // As the relay closes a provider it stopped hearing from: 1001, after which the provider may reconnect.
  dropped?.close(WEBMCP_CLOSE_CODES.GOING_AWAY);
  await until(() => relay.server.rooms.get(roomId)?.providerSocket, (socket) => socket !== dropped, "provider detached");
  return dropped;
}

describe("provider socket reattach", () => {
  /** Drops the room's provider socket, attaches a new one and returns what the relay sent it. */
  async function reattach(relay: Relay, room: RoomDescriptor): Promise<Frame[]> {
    await dropProvider(relay, room.id);
    const next = await openProvider(relay, room, sockets);
    // The replay is written right after `ready`, before the relay reads this ping.
    await flush(next, "replay delivered");
    return next.frames.filter((frame) => frame.type !== "pong");
  }

  async function roomWithProvider(relay: Relay, approvalRequired: boolean): Promise<RoomDescriptor> {
    const room = await createRoom(relay.base, { approvalRequired });
    const provider = await openProvider(relay, room, sockets);
    await provider.waitFor((frame) => frame.type === "ready", "provider ready");
    return room;
  }

  it("restores an approved ticket to the new socket with an approval.restored frame", async () => {
    const relay = await startRelay(servers);
    const room = await roomWithProvider(relay, true);
    const joined = await joinRoom(relay.base, room, { clientLabel: "Approved agent" });
    await approveOverHttp(relay, room, joined);
    const ticket = relay.server.rooms.get(room.id)?.clientTickets.get(tokenHash(joined.clientToken));
    expect(ticket?.approvedAt).toEqual(expect.any(Number));

    const replay = await reattach(relay, room);

    expect(replay.map((frame) => frame.type)).toEqual(["ready", "approval.restored"]);
    expect(relay.server.rooms.get(room.id)?.roomState).toBe("active");
    expect(replay[1]).toEqual({
      protocol: "webmcp-peer/1",
      // Opaque and unique to the message: nothing is to be read from it.
      messageId: expect.any(String),
      type: "approval.restored",
      roomId: room.id,
      roomEpoch: room.roomEpoch,
      sessionId: joined.sessionId,
      sentAt: expect.any(String),
      payload: {
        sessionId: joined.sessionId,
        roomId: room.id,
        roomEpoch: room.roomEpoch,
        clientLabel: "Approved agent",
        capabilities: [...(ticket?.capabilities ?? [])],
        approvedAt: ticket?.approvedAt,
        expiresAt: ticket?.expiresAt,
      },
    });
  });

  it("re-sends a pending request and restores no expired or approval-free ticket", async () => {
    const relay = await startRelay(servers);

    const pendingRoom = await roomWithProvider(relay, true);
    const pending = await joinRoom(relay.base, pendingRoom, { clientLabel: "Pending agent" });
    const pendingReplay = await reattach(relay, pendingRoom);
    expect(pendingReplay.map((frame) => frame.type)).toEqual(["ready", "approval.request"]);
    expect(pendingReplay[1]?.payload).toMatchObject({ requestId: pending.approvalRequestId, sessionId: pending.sessionId, clientLabel: "Pending agent" });
    expect(relay.server.rooms.get(pendingRoom.id)?.roomState).toBe("accepting-clients");

    const expiredRoom = await roomWithProvider(relay, true);
    const expired = await joinRoom(relay.base, expiredRoom);
    await approveOverHttp(relay, expiredRoom, expired);
    const expiredTicket = relay.server.rooms.get(expiredRoom.id)?.clientTickets.get(tokenHash(expired.clientToken));
    expect(expiredTicket?.status).toBe("approved");
    expiredTicket!.expiresAt = Date.now() - 1;
    expect((await reattach(relay, expiredRoom)).map((frame) => frame.type)).toEqual(["ready"]);

    const openRoom = await roomWithProvider(relay, false);
    expect((await joinRoom(relay.base, openRoom)).state).toBe("approved");
    expect((await reattach(relay, openRoom)).map((frame) => frame.type)).toEqual(["ready"]);
  });

  /** How a room's one ticket ends while its provider socket is away, and the frame that tells the provider. */
  const endings: Array<[string, { approvalRequired: boolean; approvalTimeoutMs?: number }, string, (relay: Relay, room: RoomDescriptor, joined: JoinedSession) => Promise<void>, Frame]> = [
    ["its approval request is rejected over HTTP", { approvalRequired: true }, "approval.rejected", async (relay, room, joined) => {
      const response = await postJson(`${relay.base}/p/${room.id}/approval/${encodeURIComponent(joined.approvalRequestId!)}`, {
        roomId: room.id, roomEpoch: room.roomEpoch, sessionId: joined.sessionId, decision: "rejected", reason: "NOT_NOW",
      }, { authorization: `Bearer ${room.providerToken}` });
      expect(response.status).toBe(200);
    }, { reason: "NOT_NOW", payload: expect.objectContaining({ state: "rejected", clientTokenActive: false }) }],
    ["its agent revokes it", { approvalRequired: true }, "session.revoked", async (relay, room, joined) => {
      await approveOverHttp(relay, room, joined);
      const response = await postJson(`${relay.base}/p/${room.id}/session/revoke`, { roomId: room.id, roomEpoch: room.roomEpoch }, {
        authorization: `Bearer ${joined.clientToken}`,
      });
      expect(response.status).toBe(200);
    }, { reason: "CLIENT_REVOKED" }],
    ["its agent revokes it in a room without approval", { approvalRequired: false }, "session.revoked", async (relay, room, joined) => {
      const response = await postJson(`${relay.base}/p/${room.id}/session/revoke`, { roomId: room.id, roomEpoch: room.roomEpoch }, {
        authorization: `Bearer ${joined.clientToken}`,
      });
      expect(response.status).toBe(200);
    }, { reason: "CLIENT_REVOKED" }],
    ["its approval request expires", { approvalRequired: true, approvalTimeoutMs: 1_000 }, "approval.expired", async (relay, room, joined) => {
      await until(() => relay.server.rooms.get(room.id)?.clientTickets.get(tokenHash(joined.clientToken))?.status, (status) => status === "expired", "the approval request expired", 5_000);
    }, { reason: "APPROVAL_EXPIRED", requestId: expect.any(String) }],
  ];

  it.each(endings)("tells a provider socket that attaches after %s how the ticket ended, every time one attaches", async (_label, options, type, end, details) => {
    const relay = await startRelay(servers, options.approvalTimeoutMs ? { approvalTimeoutMs: options.approvalTimeoutMs } : {});
    const room = await roomWithProvider(relay, options.approvalRequired);
    const joined = await joinRoom(relay.base, room);
    await dropProvider(relay, room.id);
    await end(relay, room, joined);

    const replays: Frame[][] = [];
    for (let attach = 0; attach < 2; attach++) {
      const next = await openProvider(relay, room, sockets);
      await flush(next, "replay delivered");
      replays.push(next.frames.filter((frame) => frame.type !== "pong"));
      if (attach === 0) await dropProvider(relay, room.id);
    }

    for (const replay of replays) {
      expect(replay.map((frame) => frame.type)).toEqual(["ready", type]);
      expect(replay[1]).toMatchObject({ protocol: "webmcp-peer/1", type, roomId: room.id, roomEpoch: room.roomEpoch, sessionId: joined.sessionId, ...details });
    }
    // Each attach gets a message of its own.
    expect(replays[0]![1]!.messageId).not.toBe(replays[1]![1]!.messageId);
    // The room takes no other agent.
    const rejoin = await postJson(`${relay.base}/p/${room.id}/join`, { inviteToken: room.inviteToken });
    expect(rejoin.status).toBe(409);
  });

  it("replays several tickets in the order they were requested or approved", async () => {
    const relay = await startRelay(servers);
    const room = await roomWithProvider(relay, true);
    const entry = relay.server.rooms.get(room.id)!;
    const now = Date.now();
    const ticket = (sessionId: string, status: ClientSessionTicket["status"], at: number): ClientSessionTicket => ({
      sessionId, issuedAt: now - 10_000, expiresAt: entry.expiresAt, status, capabilities: ["mcp-control"],
      ...(status === "approved" ? { approvedAt: at } : {}),
    });
    // Tickets issued by an extension, inserted in a different order than they were decided.
    entry.clientTickets.set("token-late-approval", ticket("session-late-approval", "approved", now - 1_000));
    entry.clientTickets.set("token-pending", ticket("session-pending", "pending", 0));
    entry.clientTickets.set("token-early-approval", ticket("session-early-approval", "approved", now - 9_000));
    entry.pendingApprovals.set("approval-pending", {
      requestId: "approval-pending", clientTokenHash: "token-pending", sessionId: "session-pending", roomId: room.id,
      roomEpoch: room.roomEpoch, clientLabel: "MCP client", identity: {}, createdAt: now - 5_000, expiresAt: now + 60_000,
    });
    entry.clientTickets.get("token-pending")!.approvalRequestId = "approval-pending";

    const replay = await reattach(relay, room);

    expect(replay.map((frame) => [frame.type, frame.sessionId])).toEqual([
      ["ready", undefined],
      ["approval.restored", "session-early-approval"],
      ["approval.request", "session-pending"],
      ["approval.restored", "session-late-approval"],
    ]);
  });

  it("keeps an approved agent working after the provider socket drops and the host reclaims the room", async () => {
    // Browser storage, so the host saves its room lease and auto-reconnects with it.
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal("window", { location: { search: "", pathname: "/" }, sessionStorage });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const relay = await startRelay(servers);
    const hostAdapter: WebMcpHostAdapter = {
      listTools: () => [tool("read")],
      invoke: async () => ({ ok: true, value: "read-result" }),
    };
    const host = new WebMcpPeerClient({ hostAdapter, shouldSuppressAutoReconnect: () => false });
    providers.push(host);
    const invitationUrl = await host.connect({ serverUrl: relay.base, alias: "reattach", autoReconnect: true });
    const roomId = host.getSession().roomId!;
    const inviteToken = decodeURIComponent(new URL(invitationUrl).hash.slice("#invite=".length));
    const joined = await joinRoom(relay.base, { id: roomId, inviteToken } as RoomDescriptor, { clientLabel: "Agent" });

    await until(() => host.getSession().approvalState, (state) => state === "pending", "approval request reached the host");
    expect(host.approveClient()).toBe(true);
    await until(() => relay.server.rooms.get(roomId)?.clientTickets.get(tokenHash(joined.clientToken))?.status, (status) => status === "approved", "relay approved the ticket");

    let nextId = 0;
    const callRead = async () => {
      const response = await postJson(`${relay.base}/p/${roomId}/mcp`, {
        jsonrpc: "2.0", id: ++nextId, method: "tools/call", params: { name: "read", arguments: {} },
      }, { authorization: `Bearer ${joined.clientToken}` });
      return (await response.json()) as { result?: { isError?: boolean }; error?: { code: number; message: string } };
    };
    expect(await callRead()).toMatchObject({ result: { isError: false } });

    const dropped = await dropProvider(relay, roomId);
    // The host notices the drop, reclaims its saved lease and attaches a new provider socket.
    await until(() => relay.server.rooms.get(roomId)?.providerSocket, (socket) => socket !== undefined && socket !== dropped, "provider reattached", 15_000);
    await until(() => host.getSession().state, (state) => state === "waiting", "host reattached");

    const reply = await callRead();
    expect(reply.error).toBeUndefined();
    expect(reply).toMatchObject({ result: { isError: false } });
    expect(host.getSession()).toMatchObject({ roomId, approvalState: "approved", clientLabel: "Agent" });
  });

  it.each<[string, string, (relay: Relay, roomId: string, joined: JoinedSession) => Promise<Response>]>([
    ["its approval request was rejected over HTTP", "CLIENT_APPROVAL_DENIED", (relay, roomId, joined) => {
      const entry = relay.server.rooms.get(roomId)!;
      return postJson(`${relay.base}/p/${roomId}/approval/${encodeURIComponent(joined.approvalRequestId!)}`, {
        roomId, roomEpoch: entry.roomEpoch, sessionId: joined.sessionId, decision: "rejected",
      }, { authorization: `Bearer ${entry.providerToken}` });
    }],
    ["its agent revoked it", "SESSION_REVOKED", (relay, roomId, joined) =>
      postJson(`${relay.base}/p/${roomId}/session/revoke`, { roomId }, { authorization: `Bearer ${joined.clientToken}` })],
  ])("takes the room down and forgets its lease when the host reattaches after %s while its socket was away", async (_label, error, end) => {
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal("window", { location: { search: "", pathname: "/" }, sessionStorage });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const relay = await startRelay(servers);
    const hostAdapter: WebMcpHostAdapter = { listTools: () => [tool("read")], invoke: async () => ({ ok: true, value: "read-result" }) };
    const host = new WebMcpPeerClient({ hostAdapter, shouldSuppressAutoReconnect: () => false });
    providers.push(host);
    const invitationUrl = await host.connect({ serverUrl: relay.base, alias: "ended-away", autoReconnect: true });
    const roomId = host.getSession().roomId!;
    const inviteToken = decodeURIComponent(new URL(invitationUrl).hash.slice("#invite=".length));
    const joined = await joinRoom(relay.base, { id: roomId, inviteToken } as RoomDescriptor, { clientLabel: "Agent" });
    await until(() => host.getSession().approvalState, (state) => state === "pending", "approval request reached the host");

    // The ticket ends during the host's reconnect backoff, when no provider socket hears it.
    await dropProvider(relay, roomId);
    expect((await end(relay, roomId, joined)).status).toBe(200);
    // The host reclaims the room and attaches again, and the relay tells it how the ticket ended.
    await until(() => host.getSession().error, (value) => value === error, "the host learned the ticket ended", 15_000);

    expect(host.getSession()).toMatchObject({ roomId, state: "disconnected", approvalState: "revoked", error });
    // A reload reclaims no room nobody can join.
    const reloaded = new WebMcpPeerClient({ hostAdapter, shouldSuppressAutoReconnect: () => false });
    providers.push(reloaded);
    expect(await reloaded.autoReconnectIfSaved()).toBe(false);
    expect(reloaded.getSession().state).toBe("idle");
  });
});
