// Regression tests for the relay's MCP JSON-RPC routing, the same rules on both transports:
//   - an agent WebSocket's initialize and server/discover negotiate the revision the HTTP route
//     does, whether the provider or the relay answers, and every discover result reports the
//     revisions and capabilities,
//   - a null id makes an invalid request on both transports, never a notification, and a provider
//     reply the relay cannot match to a request is dropped instead of broadcast to every agent,
//   - an HTTP notification is answered 202 whatever its method, and a notification method takes no
//     id on either transport,
//   - an agent WebSocket's ping is the relay's to answer, and a ticket waiting for approval gets the
//     relay's public discovery (initialize, tools/list, server/discover) as an HTTP agent does,
//   - every WebSocket listing carries the relay's catalog stamp in result._meta,
//   - only replies count toward an agent socket's 64 pending requests,
//   - a room whose provider registered an empty catalog lists it on every route.
import { afterEach, describe, expect, it, vi } from "vitest";
import { joinPeerRoom, waitForPeerApproval } from "../src/client.js";
import { MCP_INITIALIZE_PROTOCOL_VERSIONS, WebMcpPeerClient } from "../src/provider.js";
import type { PeerSocket, WebMcpPeerServer } from "../src/server.js";
import {
  createRoom,
  flush,
  joinRoom,
  openClient,
  openProvider,
  openRecordingSocket,
  postJson,
  RawPeer,
  startRelay,
  tool,
  until,
  type Frame,
  type JoinedSession,
  type Relay,
  type RecordingSocket,
  type RoomDescriptor,
} from "./server-test-helpers.js";

const servers: WebMcpPeerServer[] = [];
const sockets: WebSocket[] = [];
const rawPeers: RawPeer[] = [];
const providers: WebMcpPeerClient[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const provider of providers.splice(0)) provider.disconnect();
  for (const raw of rawPeers.splice(0)) raw.destroy();
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
});

const INVALID_REQUEST = { code: -32600, message: "INVALID_REQUEST" };
const WS_CAPABILITIES = { tools: { listChanged: true }, stateless: true };
const HTTP_CAPABILITIES = { tools: { listChanged: false }, stateless: true };

/** POSTs `message` to the room's MCP endpoint as `token`, and reads the reply (null for an empty body). */
async function postMcp(relay: Relay, roomId: string, message: unknown, token?: string): Promise<{ status: number; body: Frame | null }> {
  const response = await postJson(`${relay.base}/p/${roomId}/mcp`, message, token ? { authorization: `Bearer ${token}` } : {});
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Frame) : null };
}

/** Sends `message` on an agent socket and waits for the reply under `id`. */
async function ask(agent: RecordingSocket, id: string | number | null, message: Frame): Promise<Frame> {
  const before = agent.frames.length;
  agent.send({ type: "mcp", message: { jsonrpc: "2.0", id, ...message } });
  return until(
    () => agent.frames.slice(before).find((frame) => frame.type === "mcp" && frame.message?.id === id),
    (frame): frame is Frame => frame !== undefined,
    `reply to ${String(id)}`,
    5000,
  ) as Promise<Frame>;
}

/** The `mcp` frames the relay forwarded to a recording provider socket. */
const forwarded = (provider: RecordingSocket) => provider.frames.filter((frame) => frame.type === "mcp");

/** A room served by a WebMcpPeerClient provider (host `routing-host`), with an approved agent WebSocket. */
async function providedRoom(): Promise<{ relay: Relay; roomId: string; clientToken: string; agent: RecordingSocket }> {
  const echo = tool("echo");
  const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
  const provider = new WebMcpPeerClient({
    hostAdapter: {
      listTools: () => [echo],
      getStatus: () => ({ writeEnabled: true }),
      getServerInfo: () => ({ name: "routing-host", version: "9.9.9", instructions: "routing host" }),
      invoke: async () => ({ ok: true }),
    },
  });
  providers.push(provider);
  const invitationUrl = await provider.connect({ serverUrl: relay.base, alias: "routing-host", enableWrite: true });
  const roomId = provider.getSession().roomId!;
  const joined = await joinPeerRoom({ invitationUrl, clientLabel: "routing-agent" });
  await until(() => provider.getSession(), (session) => session.approvalState === "pending", "approval request");
  provider.approveClient(provider.getSession().approvalRequestId!);
  await waitForPeerApproval({ serverUrl: relay.base, roomId, sessionId: joined.sessionId, clientToken: joined.clientToken, pollIntervalMs: 25, timeoutMs: 5000 });
  await until(() => relay.server.rooms.get(roomId)?.cachedTools, Boolean, "registered catalog");
  const agent = await openRecordingSocket(`${relay.wsBase}/p/${roomId}/client`, joined.clientToken, sockets);
  return { relay, roomId, clientToken: joined.clientToken, agent };
}

/** A relay room with a recording provider socket and a joined agent socket. */
async function recordedRoom(options: { approvalRequired?: boolean; tools?: unknown[] } = {}): Promise<{
  relay: Relay;
  room: RoomDescriptor;
  provider: RecordingSocket;
  joined: JoinedSession;
  agent: RecordingSocket;
}> {
  const relay = await startRelay(servers, { deploymentCatalog: { tools: options.tools ?? [tool("echo")] } });
  const room = await createRoom(relay.base, { approvalRequired: options.approvalRequired ?? false });
  const provider = await openProvider(relay, room, sockets);
  const joined = await joinRoom(relay.base, room);
  const agent = await openClient(relay, room, joined, sockets);
  return { relay, room, provider, joined, agent };
}

describe("MCP revision negotiation over the agent WebSocket", { timeout: 20_000 }, () => {
  it("negotiates initialize and server/discover as the HTTP route does, when the provider answers them", async () => {
    const { relay, roomId, clientToken, agent } = await providedRoom();

    for (const [requested, negotiated] of [["2025-06-18", "2025-06-18"], ["2024-11-05", "2024-11-05"], ["2026-07-28", "2025-11-25"], [undefined, "2025-11-25"]] as const) {
      const params = { ...(requested ? { protocolVersion: requested } : {}), capabilities: {}, clientInfo: { name: "ws-agent", version: "1" } };
      const ws = await ask(agent, `init-${requested}`, { method: "initialize", params });
      // The provider's answer: the host's serverInfo, and the WebSocket gets list_changed pushed.
      expect(ws.message.result).toMatchObject({
        protocolVersion: negotiated,
        capabilities: WS_CAPABILITIES,
        serverInfo: { name: "routing-host", version: "9.9.9" },
      });
      const http = await postMcp(relay, roomId, { jsonrpc: "2.0", id: 1, method: "initialize", params }, clientToken);
      expect(http.body?.result).toMatchObject({ protocolVersion: negotiated, capabilities: HTTP_CAPABILITIES });
    }

    const discovered = await ask(agent, "discover", { method: "server/discover", params: { protocolVersion: "2025-03-26" } });
    expect(discovered.message.result).toMatchObject({
      protocolVersion: "2025-03-26",
      supportedProtocolVersions: [...MCP_INITIALIZE_PROTOCOL_VERSIONS],
      capabilities: WS_CAPABILITIES,
      serverInfo: { name: "routing-host", version: "9.9.9" },
      tools: [tool("echo")],
    });
    const http = await postMcp(relay, roomId, { jsonrpc: "2.0", id: 1, method: "server/discover", params: { protocolVersion: "2025-03-26" } }, clientToken);
    expect(http.body?.result).toMatchObject({
      protocolVersion: "2025-03-26",
      supportedProtocolVersions: [...MCP_INITIALIZE_PROTOCOL_VERSIONS],
      capabilities: HTTP_CAPABILITIES,
      tools: [tool("echo")],
    });
  });
});

describe("request ids", { timeout: 20_000 }, () => {
  it("refuses a WebSocket request with id null as an invalid request, for a ticket in any state, and forwards nothing", async () => {
    const { relay, room, provider, joined, agent } = await recordedRoom({ approvalRequired: true });
    const nullCall = { method: "tools/call", params: { name: "echo", arguments: {} } };

    // Waiting for approval: the request is invalid, not one waiting for approval.
    expect((await ask(agent, null, nullCall)).message).toEqual({ jsonrpc: "2.0", id: null, error: INVALID_REQUEST });

    const decided = await postJson(
      `${relay.base}/p/${room.id}/approval/${joined.approvalRequestId}`,
      { sessionId: joined.sessionId, decision: "approved" },
      { authorization: `Bearer ${room.providerToken}` },
    );
    expect(decided.status).toBe(200);
    await agent.waitFor((frame) => frame.type === "ready" && frame.approval === "approved", "approved ready");
    // Approved: not a notification the provider would run without the relay's tools/call checks.
    expect((await ask(agent, null, nullCall)).message).toEqual({ jsonrpc: "2.0", id: null, error: INVALID_REQUEST });
    expect((await ask(agent, null, { method: "tools/call", params: { name: "unknown" } })).message.error).toEqual(INVALID_REQUEST);
    await flush(provider, "provider socket processed");
    expect(forwarded(provider)).toEqual([]);
  });

  it("drops a provider reply it cannot match to a request instead of broadcasting it to every agent", async () => {
    const { provider, agent } = await recordedRoom();
    provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: null, result: { content: [{ type: "text", text: "for nobody" }] } } });
    provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: "never-asked", error: { code: -32603, message: "late" } } });
    // A notification is still for every agent.
    provider.send({ type: "mcp", message: { jsonrpc: "2.0", method: "notifications/message", params: { level: "info" } } });
    await agent.waitFor((frame) => frame.message?.method === "notifications/message", "provider notification");
    expect(agent.frames.filter((frame) => frame.type === "mcp")).toEqual([
      { type: "mcp", message: { jsonrpc: "2.0", method: "notifications/message", params: { level: "info" } } },
    ]);
  });
});

describe("notifications", { timeout: 20_000 }, () => {
  it("answers every HTTP notification 202 with an empty body, also one for a method the relay answers itself", async () => {
    // No catalog and no provider: a listing request would be 503, a relayed one 503.
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    for (const method of ["ping", "initialize", "tools/list", "server/discover", "notifications/initialized"]) {
      const reply = await postMcp(relay, room.id, { jsonrpc: "2.0", method, params: {} });
      expect({ method, ...reply }).toEqual({ method, status: 202, body: null });
    }
    // With an id they are requests, answered as before.
    expect((await postMcp(relay, room.id, { jsonrpc: "2.0", id: 1, method: "ping" })).body).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    expect((await postMcp(relay, room.id, { jsonrpc: "2.0", id: 2, method: "tools/list" })).status).toBe(503);
  });

  it("refuses a notification method sent with an id as an invalid request, over HTTP and WebSocket", async () => {
    const { relay, room, provider, agent, joined } = await recordedRoom();
    expect(await postMcp(relay, room.id, { jsonrpc: "2.0", id: 7, method: "notifications/initialized" })).toEqual({
      status: 400,
      body: { jsonrpc: "2.0", id: 7, error: INVALID_REQUEST },
    });
    expect(await postMcp(relay, room.id, { jsonrpc: "2.0", id: "n", method: "notifications/cancelled", params: { requestId: 1 } }, joined.clientToken)).toEqual({
      status: 400,
      body: { jsonrpc: "2.0", id: "n", error: INVALID_REQUEST },
    });
    expect((await ask(agent, 8, { method: "notifications/initialized" })).message).toEqual({ jsonrpc: "2.0", id: 8, error: INVALID_REQUEST });
    await flush(provider, "provider socket processed");
    expect(forwarded(provider)).toEqual([]);
  });
});

describe("metadata requests over the agent WebSocket", { timeout: 20_000 }, () => {
  it("answers ping itself for a ticket in any state, and never forwards it", async () => {
    const { relay, room, provider, joined, agent } = await recordedRoom({ approvalRequired: true });
    expect((await ask(agent, 1, { method: "ping" })).message).toEqual({ jsonrpc: "2.0", id: 1, result: {} });

    const decided = await postJson(
      `${relay.base}/p/${room.id}/approval/${joined.approvalRequestId}`,
      { sessionId: joined.sessionId, decision: "approved" },
      { authorization: `Bearer ${room.providerToken}` },
    );
    expect(decided.status).toBe(200);
    await agent.waitFor((frame) => frame.type === "ready" && frame.approval === "approved", "approved ready");
    expect((await ask(agent, 2, { method: "ping" })).message).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
    // An approved ticket's other requests still reach the provider.
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: 3, method: "initialize", params: {} } });
    await provider.waitFor((frame) => frame.type === "mcp" && frame.message?.id === 3, "forwarded initialize");
    expect(forwarded(provider).map((frame) => frame.message.method)).toEqual(["initialize"]);
  });

  it("gives a ticket waiting for approval the relay's public discovery, as the HTTP route does", async () => {
    const { relay, room, provider, joined, agent } = await recordedRoom({ approvalRequired: true });
    const http = async (id: number, method: string, params: Record<string, unknown>) =>
      (await postMcp(relay, room.id, { jsonrpc: "2.0", id, method, params }, joined.clientToken)).body!;
    const withWsCapabilities = (body: Frame) => ({ ...body, result: { ...body.result, capabilities: WS_CAPABILITIES } });

    const initializeParams = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ws-agent", version: "1" } };
    const initialized = await ask(agent, 1, { method: "initialize", params: initializeParams });
    expect(initialized.message).toEqual(withWsCapabilities(await http(1, "initialize", initializeParams)));
    expect(initialized.message.result).toMatchObject({
      protocolVersion: "2025-06-18",
      serverInfo: { name: relay.server.serverName },
      tools: [tool("echo")],
      _meta: { roomId: room.id, auth: { state: "pending" } },
    });

    const listed = await ask(agent, 2, { method: "tools/list", params: {} });
    expect(listed.message).toEqual(await http(2, "tools/list", {}));
    const discovered = await ask(agent, 3, { method: "server/discover", params: { protocolVersion: "2025-03-26" } });
    expect(discovered.message).toEqual(withWsCapabilities(await http(3, "server/discover", { protocolVersion: "2025-03-26" })));

    // Anything else still waits for the approval.
    expect((await ask(agent, 4, { method: "tools/call", params: { name: "echo", arguments: {} } })).message.error).toMatchObject({
      code: -32053,
      message: "CLIENT_APPROVAL_REQUIRED",
    });
    await flush(provider, "provider socket processed");
    expect(forwarded(provider)).toEqual([]);
  });

  it("answers a waiting ticket's listing CATALOG_UNAVAILABLE while the room has no catalog", async () => {
    const { agent } = await recordedRoom({ approvalRequired: true, tools: [] });
    for (const method of ["tools/list", "server/discover"]) {
      expect((await ask(agent, method, { method, params: {} })).message.error).toEqual({
        code: -32090,
        message: "CATALOG_UNAVAILABLE",
        data: { catalogSource: "injected" },
      });
    }
  });
});

describe("catalog stamps over the agent WebSocket", { timeout: 20_000 }, () => {
  it("stamps a forwarded listing in result._meta, keeping the provider's own _meta members", async () => {
    const { relay, room, provider, agent } = await recordedRoom({ tools: [] });
    provider.send({ type: "register", tools: [tool("a")] });
    await until(() => relay.server.rooms.get(room.id)?.cachedTools, Boolean, "registered catalog");
    const entry = relay.server.rooms.get(room.id)!;
    const stamp = { catalogVersion: 1, catalogHash: entry.catalogHash };
    provider.ws.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as Frame;
      if (frame.type !== "mcp" || frame.message?.method !== "tools/list") return;
      provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: frame.message.id, result: { tools: [tool("a")], _meta: { page: "all" } } } });
    });

    // Where every HTTP listing has it, whether or not the agent sent _meta.
    expect((await ask(agent, "plain", { method: "tools/list", params: {} })).message.result).toEqual({
      tools: [tool("a")],
      _meta: { page: "all", ...stamp },
    });
    // An agent that sent _meta also gets the stamp at the top of the result (deprecated).
    expect((await ask(agent, "meta", { method: "tools/list", params: { _meta: {} } })).message.result).toEqual({
      tools: [tool("a")],
      ...stamp,
      _meta: { page: "all", ...stamp },
    });
  });
});

describe("pending requests of an agent socket", { timeout: 20_000 }, () => {
  it("counts only replies waiting for the agent, not the other frames it holds for it", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [tool("echo")] } });
    const room = await createRoom(relay.base, { approvalRequired: false });
    const provider = await openProvider(relay, room, sockets);
    const joined = await joinRoom(relay.base, room);
    const agent = await RawPeer.open(relay, `/p/${room.id}/client`, joined.clientToken, rawPeers);
    const entry = relay.server.rooms.get(room.id)!;
    const agentSocket: PeerSocket = [...entry.clientSockets].at(-1)!;

    // The agent's queue is full: what the relay owes it waits in its outbox. In one read, an offer
    // the relay refuses (offer.refused waits, and answers no request), then 65 calls.
    const sent = vi.spyOn(agentSocket, "send").mockReturnValue("busy");
    const call = (id: number) => ({ type: "mcp", message: { jsonrpc: "2.0", id, method: "tools/call", params: { name: "echo", arguments: {} } } });
    agent.sendAll([
      { type: "offer", sdp: "v=0", requestId: "o".repeat(2_000) },
      ...Array.from({ length: 65 }, (_, index) => call(index + 1)),
    ]);
    // The relay handles the whole read at once, so once some calls arrive, a ping's pong comes after
    // every call it forwarded.
    await until(() => forwarded(provider).length, (count) => count > 0, "calls forwarded");
    await flush(provider, "provider socket processed");
    expect(forwarded(provider).map((frame) => frame.message.id)).toEqual(Array.from({ length: 64 }, (_, index) => index + 1));

    // The 65th is refused: the 64 the agent sent are what the relay counts.
    sent.mockRestore();
    const refusal = await agent.waitFor((message) => message.type === "mcp" && message.message?.id === 65, "the 65th call's refusal");
    expect(refusal.message.error).toEqual({ code: -32087, message: "TOO_MANY_PENDING_REQUESTS", data: { limit: 64 } });
    expect(agent.messages.find((message) => message.type === "offer.refused")).toMatchObject({ error: { message: "REQUEST_ID_TOO_LARGE" } });
  });
});

describe("an empty catalog the provider registered", { timeout: 20_000 }, () => {
  it("is listed as tools: [] on every route, not as CATALOG_UNAVAILABLE", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const joined = await joinRoom(relay.base, room);
    const listing = () => postMcp(relay, room.id, { jsonrpc: "2.0", id: 1, method: "tools/list" }, joined.clientToken);
    const catalog = async () => {
      const response = await fetch(`${relay.base}/p/${room.id}/mcp/tools`);
      return { status: response.status, body: (await response.json()) as Frame };
    };
    // No catalog yet: there is nothing to list.
    expect((await listing()).status).toBe(503);
    expect(await catalog()).toMatchObject({ status: 503, body: { error: "CATALOG_UNAVAILABLE", catalogVersion: 0 } });

    const provider = await openProvider(relay, room, sockets);
    provider.send({ type: "register", tools: [] });
    await until(() => relay.server.rooms.get(room.id)?.catalogVersion, (version) => version === 1, "empty catalog registered");
    const hash = relay.server.rooms.get(room.id)!.catalogHash;

    expect(await listing()).toMatchObject({ status: 200, body: { result: { tools: [], _meta: { catalogVersion: 1, catalogHash: hash } } } });
    const discover = await postMcp(relay, room.id, { jsonrpc: "2.0", id: 2, method: "server/discover" }, joined.clientToken);
    expect(discover).toMatchObject({ status: 200, body: { result: { tools: [], _meta: { catalogVersion: 1 } } } });
    expect(await catalog()).toMatchObject({ status: 200, body: { tools: [], catalogVersion: 1, catalogHash: hash } });
    const descriptor = (await (await fetch(`${relay.base}/p/${room.id}/mcp`)).json()) as Frame;
    expect(descriptor).toMatchObject({ catalogVersion: 1, catalogHash: hash, toolCount: 0 });
  });
});
