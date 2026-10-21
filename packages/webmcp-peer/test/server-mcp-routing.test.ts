// Regression tests for the relay's MCP JSON-RPC routing, the same rules on both transports:
//   - an agent WebSocket's initialize and server/discover negotiate the revision the HTTP route
//     does, whether the provider or the relay answers, and every discover result reports the
//     revisions and capabilities,
//   - a null id makes an invalid request on both transports, never a notification, and a provider
//     reply the relay cannot match to a request is dropped instead of broadcast to every agent,
//   - an HTTP notification of a method the relay answers itself is answered 202 without the room
//     and ticket checks, any other is checked as a request and answered 202 once the provider takes
//     it, and a notification method takes no id on either transport,
//   - an agent WebSocket's ping is the relay's to answer, and a ticket waiting for approval gets the
//     relay's public discovery (initialize, tools/list, server/discover) as an HTTP agent does,
//   - every WebSocket listing carries the relay's catalog stamp in result._meta,
//   - the relay handles nothing more of an agent behind on what it asked for, the rest of a read it
//     already took included, and then counts the agent's requests toward its 64,
//   - a room whose provider registered an empty catalog lists it on every route,
//   - an agent WebSocket's request id is pending once per socket, a message that is not a request is
//     refused under its id, and an id JSON.parse reads as Infinity reaches the wire as null,
//   - the relay checks a WebSocket tools/call as it checks an HTTP one before the provider sees it,
//   - a forwarded request is timed out after mcpRequestTimeoutMs, at least 1 s, and a value Node's
//     timer cannot hold times every request out at once.
import { afterEach, describe, expect, it, vi } from "vitest";
import { joinPeerRoom, waitForPeerApproval } from "../src/client.js";
import { MCP_INITIALIZE_PROTOCOL_VERSIONS, WebMcpPeerClient } from "../src/provider.js";
import type { PeerSocket, WebMcpPeerServer, WebMcpPeerServerOptions } from "../src/server.js";
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
async function recordedRoom(options: { approvalRequired?: boolean; tools?: unknown[]; relay?: WebMcpPeerServerOptions } = {}): Promise<{
  relay: Relay;
  room: RoomDescriptor;
  provider: RecordingSocket;
  joined: JoinedSession;
  agent: RecordingSocket;
}> {
  const relay = await startRelay(servers, { deploymentCatalog: { tools: options.tools ?? [tool("echo")] }, ...options.relay });
  const room = await createRoom(relay.base, { approvalRequired: options.approvalRequired ?? false });
  const provider = await openProvider(relay, room, sockets);
  const joined = await joinRoom(relay.base, room);
  const agent = await openClient(relay, room, joined, sockets);
  return { relay, room, provider, joined, agent };
}

describe("MCP revision negotiation over the agent WebSocket", { timeout: 20_000 }, () => {
  it("negotiates initialize and server/discover as the HTTP route does in a provider's room, whichever answers them", async () => {
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

    // The relay holds the catalog the provider registered, so it answers server/discover itself.
    const discovered = await ask(agent, "discover", { method: "server/discover", params: { protocolVersion: "2025-03-26" } });
    expect(discovered.message.result).toMatchObject({
      protocolVersion: "2025-03-26",
      supportedProtocolVersions: [...MCP_INITIALIZE_PROTOCOL_VERSIONS],
      capabilities: WS_CAPABILITIES,
      serverInfo: { name: relay.server.serverName, version: relay.server.serverVersion },
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

  it("refuses a WebSocket request whose id is still pending on its socket, and forwards the same id over HTTP under a wire id", async () => {
    const { relay, room, provider, joined, agent } = await recordedRoom();
    const call = { method: "tools/call", params: { name: "echo", arguments: {} } };
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: "dup", ...call } });
    await provider.waitFor((frame) => frame.type === "mcp" && frame.message?.id === "dup", "the first call");

    // The same socket asks again before the provider answered: refused, and not forwarded.
    expect((await ask(agent, "dup", call)).message).toEqual({ jsonrpc: "2.0", id: "dup", error: { code: -32600, message: "DUPLICATE_REQUEST_ID" } });
    // An HTTP request is answered on its own response, so the same id is forwarded under a wire id.
    const http = postMcp(relay, room.id, { jsonrpc: "2.0", id: "dup", ...call }, joined.clientToken);
    const rewritten = await provider.waitFor((frame) => frame.type === "mcp" && /^framebook:\d+:string:dup$/.test(String(frame.message?.id)), "the HTTP call");
    provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: rewritten.message.id, result: { content: [], isError: false } } });
    expect(await http).toEqual({ status: 200, body: { jsonrpc: "2.0", id: "dup", result: { content: [], isError: false } } });
    expect(forwarded(provider).map((frame) => frame.message.id)).toEqual(["dup", rewritten.message.id]);

    // Once the provider answered it, the socket may send the id again.
    provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: "dup", result: { content: [], isError: false } } });
    await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === "dup" && frame.message.result, "the first call's answer");
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: "dup", ...call } });
    await until(() => forwarded(provider).length, (count) => count === 3, "the id forwarded again");
  });

  it("answers a WebSocket message that is not a request INVALID_REQUEST under its id, and nothing without one", async () => {
    const { provider, agent } = await recordedRoom();
    agent.send({ type: "mcp", message: { jsonrpc: "1.0", id: "version", method: "ping" } });
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: 5 } });
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", method: 7 } });
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: { not: "an id" }, method: "ping" } });
    agent.send({ type: "mcp", message: "ping" });
    // The relay answers in order, so the reply to this ping comes after every reply to the messages above.
    await ask(agent, "after", { method: "ping" });

    expect(agent.frames.filter((frame) => frame.type === "mcp").map((frame) => frame.message)).toEqual([
      { jsonrpc: "2.0", id: "version", error: INVALID_REQUEST },
      { jsonrpc: "2.0", id: 5, error: INVALID_REQUEST },
      { jsonrpc: "2.0", id: "after", result: {} },
    ]);
    await flush(provider, "provider socket processed");
    expect(forwarded(provider)).toEqual([]);
  });

  it("forwards a request whose id JSON.parse reads as Infinity under id null, and times it out under id null", async () => {
    const call = (id: string) => `{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":"echo","arguments":{}}}`;
    // One room per transport: the two requests would share the pending key number:Infinity.
    const [ws, http] = await Promise.all([recordedRoom({ relay: { mcpRequestTimeoutMs: 1000 } }), recordedRoom({ relay: { mcpRequestTimeoutMs: 1000 } })]);

    ws.agent.send(`{"type":"mcp","message":${call("1e400")}}`);
    const posted = fetch(`${http.relay.base}/p/${http.room.id}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${http.joined.clientToken}` },
      body: call("1e400"),
    });
    for (const provider of [ws.provider, http.provider]) {
      const request = await provider.waitFor((frame) => frame.type === "mcp", "the forwarded call");
      expect(request.message).toEqual({ jsonrpc: "2.0", id: null, method: "tools/call", params: { name: "echo", arguments: {} } });
    }
    const timedOut = { jsonrpc: "2.0", id: null, error: { code: -32001, message: "MCP_REQUEST_TIMEOUT" } };
    expect((await ws.agent.waitFor((frame) => frame.type === "mcp" && frame.message?.error, "the timeout")).message).toEqual(timedOut);
    const response = await posted;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(timedOut);
  });
});

describe("the relay's checks of a WebSocket tools/call", { timeout: 20_000 }, () => {
  it("refuses invalid params, a catalog stamp that is not the room's and an unknown tool before the provider sees them", async () => {
    const { relay, room, provider, agent } = await recordedRoom();
    const entry = relay.server.rooms.get(room.id)!;
    const current = { catalogVersion: entry.catalogVersion, catalogHash: entry.catalogHash };

    for (const params of [{}, { name: "" }, { name: 7 }]) {
      expect((await ask(agent, `params-${JSON.stringify(params)}`, { method: "tools/call", params })).message.error).toEqual({
        code: -32602,
        message: "tools/call params are invalid",
      });
    }
    for (const stamp of [{ catalogVersion: current.catalogVersion + 1 }, { catalogHash: "0".repeat(64) }]) {
      const reply = await ask(agent, `stamp-${JSON.stringify(stamp)}`, { method: "tools/call", params: { name: "echo", arguments: {}, _meta: stamp } });
      expect(reply.message.error).toEqual({ code: -32010, message: "CATALOG_CHANGED", data: current });
    }
    expect((await ask(agent, "unknown", { method: "tools/call", params: { name: "unknown", arguments: {} } })).message.error).toEqual({
      code: -32602,
      message: "TOOL_NOT_FOUND",
    });
    await flush(provider, "provider socket processed");
    expect(forwarded(provider)).toEqual([]);

    // The room's own stamp passes, and a notification is forwarded without these checks (the
    // provider runs no message without an id).
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: "current", method: "tools/call", params: { name: "echo", arguments: {}, _meta: current } } });
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", method: "tools/call", params: { name: "unknown" } } });
    await until(() => forwarded(provider).length, (count) => count === 2, "the calls forwarded");
    expect(forwarded(provider).map((frame) => [frame.message.id, frame.message.params.name])).toEqual([["current", "echo"], [undefined, "unknown"]]);
  });
});

describe("the timeout of a forwarded request", { timeout: 20_000 }, () => {
  it("answers a request the provider does not answer within mcpRequestTimeoutMs, at least 1000 ms, and drops the late answer", async () => {
    // 200 ms is under the floor, so the relay waits 1000 ms.
    const { relay, room, provider, joined, agent } = await recordedRoom({ relay: { mcpRequestTimeoutMs: 200 } });
    const call = { method: "tools/call", params: { name: "echo", arguments: {} } };
    const timedOut = { code: -32001, message: "MCP_REQUEST_TIMEOUT" };
    const started = Date.now();
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: "ws", ...call } });
    const http = postMcp(relay, room.id, { jsonrpc: "2.0", id: "http", ...call }, joined.clientToken);
    await until(() => forwarded(provider).length, (count) => count === 2, "both calls forwarded");

    const wsReply = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === "ws", "the WebSocket timeout");
    expect(wsReply.message).toEqual({ jsonrpc: "2.0", id: "ws", error: timedOut });
    expect(await http).toEqual({ status: 200, body: { jsonrpc: "2.0", id: "http", error: timedOut } });
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);

    provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: "ws", result: { content: [], isError: false } } });
    await flush(provider, "the late answer processed");
    await ask(agent, "after", { method: "ping" });
    expect(agent.frames.filter((frame) => frame.type === "mcp" && frame.message?.id === "ws")).toEqual([wsReply]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31])("times every forwarded request out at once for mcpRequestTimeoutMs %s, which Node's timer runs after 1 ms", async (mcpRequestTimeoutMs) => {
    // Node reports a delay it cannot hold with a process warning; it is the case under test.
    vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    const { provider, agent } = await recordedRoom({ relay: { mcpRequestTimeoutMs } });
    const started = Date.now();
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: "fast", method: "tools/call", params: { name: "echo", arguments: {} } } });
    const reply = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === "fast", "the timeout");
    expect(reply.message.error).toEqual({ code: -32001, message: "MCP_REQUEST_TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(900);
    expect(forwarded(provider)).toHaveLength(1);
  });
});

describe("notifications", { timeout: 20_000 }, () => {
  it("answers a notification of a method the relay answers itself 202 with an empty body, without checking the room, the ticket or the catalog", async () => {
    // No catalog and no provider: a listing request would be 503, a relayed one 503. No ticket
    // either, and a room that does not exist is not checked.
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    for (const roomId of [room.id, "nowhere"]) {
      for (const method of ["ping", "initialize", "tools/list", "server/discover", "notifications/initialized"]) {
        const reply = await postMcp(relay, roomId, { jsonrpc: "2.0", method, params: {} });
        expect({ roomId, method, ...reply }).toEqual({ roomId, method, status: 202, body: null });
      }
    }
    // What the relay checks before the method, the MCP-Protocol-Version header among it, still applies.
    const unsupported = await postJson(`${relay.base}/p/${room.id}/mcp`, { jsonrpc: "2.0", method: "notifications/initialized" }, { "mcp-protocol-version": "1999-01-01" });
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "UNSUPPORTED_PROTOCOL_VERSION" } });
    // With an id they are requests, answered as before.
    expect((await postMcp(relay, room.id, { jsonrpc: "2.0", id: 1, method: "ping" })).body).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    expect((await postMcp(relay, room.id, { jsonrpc: "2.0", id: 2, method: "tools/list" })).status).toBe(503);
  });

  it("checks a notification of any other method as it checks a request, and answers it 202 once the provider takes it", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [tool("echo")] } });
    const room = await createRoom(relay.base);
    const joined = await joinRoom(relay.base, room);
    const cancelled = { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } };
    // Refused as a request of the same ticket would be, with its status, under id null.
    const refused = (status: number, message: string) => ({
      status,
      body: { jsonrpc: "2.0", id: null, error: expect.objectContaining({ message }) },
    });
    expect(await postMcp(relay, "nowhere", cancelled, joined.clientToken)).toEqual(refused(404, "ROOM_NOT_FOUND"));
    expect(await postMcp(relay, room.id, cancelled)).toEqual(refused(401, "CLIENT_TOKEN_REQUIRED"));
    expect(await postMcp(relay, room.id, cancelled, joined.clientToken)).toEqual(refused(503, "PROVIDER_UNAVAILABLE"));

    const provider = await openProvider(relay, room, sockets);
    expect(await postMcp(relay, room.id, cancelled, joined.clientToken)).toEqual({ status: 202, body: null });
    await until(() => forwarded(provider).length, (count) => count === 1, "the notification forwarded");
    expect(forwarded(provider)[0]).toMatchObject({ from: "client", sessionId: joined.sessionId, message: cancelled });
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

    // The WebSocket initialize must fit the relay message limit, so its bootstrap catalog names the
    // catalog that `tools` lists instead of listing it a second time.
    const withoutBootstrapTools = (body: Frame) => {
      const { tools: _tools, ...bootstrapCatalog } = body.result._meta.bootstrapCatalog;
      return { ...body, result: { ...body.result, _meta: { ...body.result._meta, bootstrapCatalog } } };
    };
    const initializeParams = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ws-agent", version: "1" } };
    const initialized = await ask(agent, 1, { method: "initialize", params: initializeParams });
    const httpInitialized = await http(1, "initialize", initializeParams);
    expect(httpInitialized.result._meta.bootstrapCatalog.tools).toEqual([tool("echo")]);
    expect(initialized.message).toEqual(withWsCapabilities(withoutBootstrapTools(httpInitialized)));
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
    // The relay passes a listing on only while it holds no catalog, and then takes its catalog: each
    // case is a room of its own.
    const listedRoom = async () => {
      const { relay, room, provider, agent } = await recordedRoom({ tools: [] });
      provider.ws.addEventListener("message", (event) => {
        const frame = JSON.parse(String(event.data)) as Frame;
        if (frame.type !== "mcp" || frame.message?.method !== "tools/list") return;
        provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: frame.message.id, result: { tools: [tool("a")], _meta: { page: "all" } } } });
      });
      const stamp = () => ({ catalogVersion: 1, catalogHash: relay.server.rooms.get(room.id)!.catalogHash });
      return { agent, stamp };
    };

    // Where every HTTP listing has it, whether or not the agent sent _meta.
    const plain = await listedRoom();
    expect((await ask(plain.agent, "plain", { method: "tools/list", params: {} })).message.result).toEqual({
      tools: [tool("a")],
      _meta: { page: "all", ...plain.stamp() },
    });
    // An agent that sent _meta also gets the stamp at the top of the result (deprecated).
    const meta = await listedRoom();
    expect((await ask(meta.agent, "meta", { method: "tools/list", params: { _meta: {} } })).message.result).toEqual({
      tools: [tool("a")],
      ...meta.stamp(),
      _meta: { page: "all", ...meta.stamp() },
    });
    // The catalog is the relay's from then on: it answers the next listing itself, as an HTTP
    // agent's, with the stamp in its listing metadata.
    const relayListing = (await ask(meta.agent, "again", { method: "tools/list", params: {} })).message.result;
    expect(relayListing).toMatchObject({ tools: [tool("a")], _meta: meta.stamp() });
    expect(relayListing._meta).not.toHaveProperty("page");
  });
});

describe("pending requests of an agent socket", { timeout: 20_000 }, () => {
  it("handles nothing more of an agent behind on what it asked for, the rest of its read included, and counts its 64 requests once it reads", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [tool("echo")] } });
    const room = await createRoom(relay.base, { approvalRequired: false });
    const provider = await openProvider(relay, room, sockets);
    const joined = await joinRoom(relay.base, room);
    const agent = await RawPeer.open(relay, `/p/${room.id}/client`, joined.clientToken, rawPeers);
    const entry = relay.server.rooms.get(room.id)!;
    const agentSocket: PeerSocket = [...entry.clientSockets].at(-1)!;

    // The agent's queue is full: what the relay owes it waits in its outbox. In one read, an offer
    // the relay refuses (offer.refused waits), then 65 calls.
    const sent = vi.spyOn(agentSocket, "send").mockReturnValue("busy");
    const call = (id: number) => ({ type: "mcp", message: { jsonrpc: "2.0", id, method: "tools/call", params: { name: "echo", arguments: {} } } });
    agent.sendAll([
      { type: "offer", sdp: "v=0", requestId: "o".repeat(2_000) },
      ...Array.from({ length: 65 }, (_, index) => call(index + 1)),
    ]);
    // While the refusal waits, the relay handles none of the calls, though it already read them.
    await until(() => sent.mock.calls.length, (count) => count > 0, "the refusal offered to the agent");
    await flush(provider, "provider socket processed");
    expect(forwarded(provider)).toEqual([]);

    // Once the agent reads, the refusal goes out first; then the relay handles the calls, forwards
    // the 64 the pending limit takes and refuses the 65th.
    sent.mockRestore();
    const refusal = await agent.waitFor((message) => message.type === "mcp" && message.message?.id === 65, "the 65th call's refusal");
    expect(refusal.message.error).toEqual({ code: -32087, message: "TOO_MANY_PENDING_REQUESTS", data: { limit: 64 } });
    await flush(provider, "provider socket processed");
    expect(forwarded(provider).map((frame) => frame.message.id)).toEqual(Array.from({ length: 64 }, (_, index) => index + 1));
    const answers = agent.messages.filter((message) => message.type === "offer.refused" || message.type === "mcp");
    expect(answers[0]).toMatchObject({ type: "offer.refused", error: { message: "REQUEST_ID_TOO_LARGE" } });
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
