// Regression tests for the provider's approval state against the relay's: an approval made over
// HTTP that the relay echoes, a decision the relay refuses, an approval request the relay expires,
// and the session revoke that names only the room epoch the provider knows.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeerMcpSession, joinPeerRoom } from "../src/client.js";
import { WebMcpPeerClient, type WebMcpHostAdapter } from "../src/provider.js";
import { createWebMcpPeerServer, type WebMcpPeerServer, type WebMcpPeerServerOptions } from "../src/server.js";
import { FakeRelay, callTool, installRelay, until, type FakeRelaySocket } from "./provider-fakes.js";

const providers: WebMcpPeerClient[] = [];
const servers: WebMcpPeerServer[] = [];
const sessions: PeerMcpSession[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.disconnect().catch(() => {});
  for (const provider of providers.splice(0)) provider.disconnect();
  for (const server of servers.splice(0)) await server.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const hostAdapter: WebMcpHostAdapter = {
  listTools: () => [{ name: "read", description: "read tool", inputSchema: { type: "object", properties: {} } }],
  invoke: async () => ({ ok: true }),
};

function provider(): WebMcpPeerClient {
  const client = new WebMcpPeerClient({ hostAdapter, shouldSuppressAutoReconnect: () => false });
  providers.push(client);
  return client;
}

const SESSION_ID = "peer-session-agent";
const REQUEST_ID = "approval-1";

/** A provider on a FakeRelay with the agent's approval request pending. */
async function pendingProvider(relay = new FakeRelay()): Promise<{ relay: FakeRelay; host: WebMcpPeerClient; socket: FakeRelaySocket }> {
  installRelay(relay);
  const host = provider();
  await host.connect({ serverUrl: relay.base, alias: "approvals" });
  const socket = relay.latest;
  socket.deliver({
    protocol: "webmcp-peer/1",
    type: "approval.request",
    roomId: relay.roomId,
    roomEpoch: 1,
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    payload: { requestId: REQUEST_ID, sessionId: SESSION_ID, roomId: relay.roomId, roomEpoch: 1, clientLabel: "Agent" },
  });
  await until(() => (host.getSession().approvalState === "pending" ? true : undefined), "approval request");
  return { relay, host, socket };
}

/** The relay's echo of an approval of the pending request, made by whoever decided it. */
function approvedEcho(roomId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const ticketExpiresAt = Date.now() + 2 * 60 * 60_000;
  const approvalExpiresAt = Date.now() + 5 * 60_000;
  return {
    protocol: "webmcp-peer/1",
    messageId: "approval.approved-1",
    type: "approval.approved",
    roomId,
    roomEpoch: 1,
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    sentAt: new Date().toISOString(),
    expiresAt: approvalExpiresAt,
    approvalExpiresAt,
    ticketExpiresAt,
    payload: { requestId: REQUEST_ID, sessionId: SESSION_ID, roomId, roomEpoch: 1, state: "approved", expiresAt: approvalExpiresAt, approvalExpiresAt, ticketExpiresAt },
    ...overrides,
  };
}

const refusal = { type: "error", code: -32081, message: "INVALID_APPROVAL", requestId: REQUEST_ID };
const unapproved = { code: -32053, message: "CLIENT_APPROVAL_REQUIRED" };

describe("an approval the relay echoes", () => {
  it("is adopted when it was made over HTTP, so the agent is served", async () => {
    const { relay, host, socket } = await pendingProvider();
    socket.deliver(approvedEcho(relay.roomId));

    expect(host.getSession()).toMatchObject({ approvalState: "approved", approvalRequestId: null });
    expect((await callTool(socket, 1, "read")).result?.isError).toBe(false);
  });

  it.each([
    ["another room epoch", { roomEpoch: 7, payload: { sessionId: SESSION_ID, roomEpoch: 7 } }],
    ["another room", { payload: { sessionId: SESSION_ID, roomId: "another-room", roomEpoch: 1 } }],
    ["an expired ticket", { ticketExpiresAt: Date.now() - 1, payload: { sessionId: SESSION_ID, roomEpoch: 1, ticketExpiresAt: Date.now() - 1 } }],
  ])("is not adopted for %s", async (_label, overrides) => {
    const { relay, host, socket } = await pendingProvider();
    socket.deliver(approvedEcho(relay.roomId, overrides));

    expect(host.getSession().approvalState).toBe("pending");
    expect((await callTool(socket, 1, "read")).error).toEqual(unapproved);
  });
});

describe("a decision the relay refuses", () => {
  it.each([
    ["approval", (host: WebMcpPeerClient) => host.approveClient()],
    ["rejection", (host: WebMcpPeerClient) => host.rejectClient()],
  ])("is undone: the %s did not take effect", async (_label, decide) => {
    const { host, socket } = await pendingProvider();
    expect(decide(host)).toBe(true);
    socket.deliver(refusal);

    expect(host.getSession()).toMatchObject({ approvalState: "pending", approvalRequestId: REQUEST_ID, error: "INVALID_APPROVAL" });
    expect((await callTool(socket, 1, "read")).error).toEqual(unapproved);
  });

  it("stands once the relay has confirmed it, so a refused repeat changes nothing", async () => {
    const { relay, host, socket } = await pendingProvider();
    expect(host.approveClient()).toBe(true);
    socket.deliver(approvedEcho(relay.roomId));
    socket.deliver(refusal);

    expect(host.getSession()).toMatchObject({ approvalState: "approved", error: null });
    expect((await callTool(socket, 1, "read")).result?.isError).toBe(false);
  });
});

describe("a session revoke from the host", () => {
  it.each([
    ["known", true, { roomEpoch: 1 }],
    ["unknown, left out instead of guessing 0", false, {}],
  ])("names the room epoch only when it knows it (%s)", async (_label, reportsRoomEpoch, epoch) => {
    const relay = new FakeRelay();
    relay.reportsRoomEpoch = reportsRoomEpoch;
    const { host } = await pendingProvider(relay);
    expect(host.approveClient()).toBe(true);
    const roomId = relay.roomId;
    host.revokeClient();

    expect(relay.revokeBodies).toHaveLength(1);
    const body = relay.revokeBodies[0]!;
    expect(body).toEqual({ roomId, ...epoch, sessionId: SESSION_ID, requestedAt: expect.any(String), reason: "provider-request" });
  });
});

describe("a provider on the relay", () => {
  const tools = [{ name: "read", description: "read tool", inputSchema: { type: "object", properties: {} } }];

  async function hostedRoom(options: WebMcpPeerServerOptions = {}) {
    const server = createWebMcpPeerServer({ port: 0, host: "127.0.0.1", roomSweepIntervalMs: 0, ...options });
    servers.push(server);
    const serverUrl = `http://127.0.0.1:${await server.listen()}`;
    const host = new WebMcpPeerClient({ hostAdapter: { ...hostAdapter, listTools: () => tools } });
    providers.push(host);
    const invitationUrl = await host.connect({ serverUrl, alias: "relay-host" });
    const roomId = host.getSession().roomId!;
    const joined = await joinPeerRoom({ invitationUrl, clientLabel: "Agent" });
    await until(() => (host.getSession().approvalState === "pending" ? true : undefined), "the approval request");
    return { server, serverUrl, host, roomId, joined };
  }

  it("learns an approval made over HTTP from the relay and serves the agent", async () => {
    const { server, serverUrl, host, roomId, joined } = await hostedRoom();
    const approval = await fetch(`${serverUrl}/p/${roomId}/approval/${joined.approvalRequestId}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${server.rooms.get(roomId)!.providerToken}` },
      body: JSON.stringify({ sessionId: joined.sessionId, decision: "approved" }),
    });
    expect(approval.status).toBe(200);
    await until(() => (host.getSession().approvalState === "approved" ? true : undefined), "the relay's echo");

    const session = new PeerMcpSession({ mcpEndpoint: joined.mcpEndpoint, clientToken: joined.clientToken, sessionId: joined.sessionId });
    sessions.push(session);
    await session.connect();
    expect(await session.callTool("read", {})).toMatchObject({ isError: false });
  });

  it("takes an approval request nobody decided in time down when the relay expires it", async () => {
    const { host } = await hostedRoom({ approvalTimeoutMs: 1_000 });
    await until(() => (host.getSession().approvalState === "expired" ? true : undefined), "approval.expired");
    expect(host.getSession()).toMatchObject({ state: "disconnected", error: "APPROVAL_EXPIRED", approvalRequestId: null });
  });
});
