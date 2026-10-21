// Regression tests for the tool-catalog contract shared by provider, relay and client:
//   - the provider publishes one descriptor shape on every channel (no version flapping),
//   - the relay only accepts and announces catalogs its clients can validate, telling every agent the
//     catalog changed before it announces it, and hashes a catalog it received with a tool's own
//     __proto__ key as the client does,
//   - a client never crashes on a catalog frame it cannot validate.
import { afterEach, describe, expect, it } from "vitest";
import {
  PeerMcpSession,
  hashTools,
  joinPeerRoom,
  normalizeTools,
  waitForPeerApproval,
  type PeerMcpTransportCallbacks,
} from "../src/client.js";
import { PEER_CATALOG_MAX_TOOL_NAME_LENGTH, PEER_CATALOG_MAX_TOOLS } from "../src/config.js";
import { WebMcpPeerClient, toWireToolDescriptor, type WebMcpToolSummary } from "../src/provider.js";
import { createWebMcpPeerServer, normalizeToolCatalog, type WebMcpPeerServer } from "../src/server.js";

const servers: WebMcpPeerServer[] = [];
const providers: WebMcpPeerClient[] = [];
const sockets: WebSocket[] = [];
const sessions: PeerMcpSession[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.disconnect().catch(() => {});
  for (const socket of sockets.splice(0)) socket.close();
  for (const provider of providers.splice(0)) provider.disconnect();
  for (const server of servers.splice(0)) await server.close();
});

const tool = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  description: `${name} tool`,
  inputSchema: { type: "object", properties: {} },
  ...extra,
});

async function startServer(): Promise<string> {
  const server = createWebMcpPeerServer({ port: 0, host: "127.0.0.1", roomSweepIntervalMs: 0 });
  servers.push(server);
  return `http://127.0.0.1:${await server.listen()}`;
}

async function roomCatalog(serverUrl: string, roomId: string) {
  const response = await fetch(`${serverUrl}/p/${roomId}/mcp/tools`);
  return (await response.json()) as { tools: Array<Record<string, unknown>>; catalogVersion: number; catalogHash: string };
}

async function until<T>(read: () => Promise<T> | T, accept: (value: T) => boolean, label: string): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("provider tool serialization", () => {
  it("publishes the same descriptor via register and tools/list so the relay catalog never flaps", async () => {
    const serverUrl = await startServer();
    const tools: WebMcpToolSummary[] = [
      {
        name: "doc_get",
        title: "Document",
        description: "Read the document",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
      },
      { name: "doc_touch", description: "No schema declared by the host" },
    ];
    const provider = new WebMcpPeerClient({
      hostAdapter: { listTools: () => tools, getStatus: () => ({ writeEnabled: true }), invoke: async () => ({ ok: true }) },
    });
    providers.push(provider);
    const invitationUrl = await provider.connect({ serverUrl, alias: "serialization", enableWrite: true });
    const roomId = provider.getSession().roomId!;
    const registered = await until(() => roomCatalog(serverUrl, roomId), (catalog) => catalog.catalogVersion > 0, "register");

    const joined = await joinPeerRoom({ invitationUrl });
    await new Promise<void>((resolve) => {
      let approved = false;
      provider.subscribe((status) => {
        if (approved || status.approvalState !== "pending" || !status.approvalRequestId) return;
        approved = true;
        provider.approveClient(status.approvalRequestId);
        resolve();
      });
    });
    await waitForPeerApproval({ serverUrl, roomId, sessionId: joined.sessionId, clientToken: joined.clientToken, pollIntervalMs: 25 });

    // A WebSocket tools/list is answered by the provider and re-hashed by the relay.
    const session = new PeerMcpSession({ serverUrl, roomId, sessionId: joined.sessionId, clientToken: joined.clientToken });
    sessions.push(session);
    const listed = await session.listTools();
    expect(provider.syncTools()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const after = await roomCatalog(serverUrl, roomId);
    expect(after.catalogVersion).toBe(registered.catalogVersion);
    expect(after.catalogHash).toBe(registered.catalogHash);
    expect(session.catalogHash).toBe(registered.catalogHash);
    expect(listed.find((entry) => entry.name === "doc_get")).toMatchObject({ title: "Document", annotations: { readOnlyHint: true } });
    expect(after.tools).toEqual(tools.map(toWireToolDescriptor));
  });

  it("serializes host tools deterministically with an MCP-valid inputSchema", () => {
    expect(toWireToolDescriptor({ name: "a", description: "d" })).toEqual({
      name: "a",
      description: "d",
      inputSchema: { type: "object", properties: {} },
    });
    expect(
      toWireToolDescriptor({
        name: "b",
        title: "B",
        description: "d",
        inputSchema: { type: "object", properties: { x: { type: "string" } } },
        outputSchema: { type: "object" },
        annotations: { destructiveHint: true },
      }),
    ).toEqual({
      name: "b",
      title: "B",
      description: "d",
      inputSchema: { type: "object", properties: { x: { type: "string" } } },
      outputSchema: { type: "object" },
      annotations: { destructiveHint: true },
    });
  });
});

describe("relay register validation", () => {
  async function openRoom(serverUrl: string) {
    const created = await fetch(`${serverUrl}/p`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalRequired: false }),
    });
    const room = (await created.json()) as { id: string; providerToken: string; inviteToken: string };
    const frames: Array<Record<string, any>> = [];
    let current: unknown[] = [];
    const ws = new WebSocket(`${serverUrl.replace(/^http/, "ws")}/p/${room.id}/provider`, ["webmcp-peer.v1", `ticket.${room.providerToken}`]);
    sockets.push(ws);
    ws.onmessage = (event) => {
      const frame = JSON.parse(String(event.data));
      frames.push(frame);
      if (frame.type === "mcp" && frame.message?.method === "tools/list") {
        ws.send(JSON.stringify({ type: "mcp", message: { jsonrpc: "2.0", id: frame.message.id, result: { tools: current } } }));
      }
    };
    await new Promise((resolve) => (ws.onopen = resolve));
    const register = (tools: unknown[]) => {
      current = tools;
      ws.send(JSON.stringify({ type: "register", tools }));
    };
    return { room, frames, register };
  }

  it("rejects catalogs clients would reject and keeps every tier on the last valid catalog", async () => {
    const serverUrl = await startServer();
    const { room, frames, register } = await openRoom(serverUrl);
    register([tool("a"), tool("b")]);
    const valid = await until(() => roomCatalog(serverUrl, room.id), (catalog) => catalog.catalogVersion === 1, "valid register");

    const joined = await joinPeerRoom({ serverUrl, roomId: room.id, inviteToken: room.inviteToken });
    const session = new PeerMcpSession({ serverUrl, roomId: room.id, sessionId: joined.sessionId, clientToken: joined.clientToken });
    sessions.push(session);
    await session.listTools();

    const invalidCatalogs = [
      [tool("a"), tool("a")],
      [{ name: "no_schema", description: "missing inputSchema" }],
      [tool(" padded ")],
      [tool("x".repeat(257))],
      Array.from({ length: 129 }, (_, index) => tool(`t${index}`)),
      "not-an-array",
    ];
    for (const tools of invalidCatalogs) register(tools as unknown[]);
    await until(() => frames.filter((frame) => frame.type === "error").length, (count) => count === invalidCatalogs.length, "CATALOG_INVALID replies");

    expect(frames.filter((frame) => frame.type === "error").every((frame) => frame.code === -32602 && frame.message === "CATALOG_INVALID")).toBe(true);
    expect(await roomCatalog(serverUrl, room.id)).toMatchObject({ catalogVersion: valid.catalogVersion, catalogHash: valid.catalogHash });
    expect(session.catalogVersion).toBe(valid.catalogVersion);
    expect(session.cachedTools.map((entry) => entry.name)).toEqual(["a", "b"]);
    expect(session.sessionState).toBe("connected");
  });

  it("announces accepted catalogs with the relay's authoritative version and hash", async () => {
    const serverUrl = await startServer();
    const { room, register } = await openRoom(serverUrl);
    register([tool("a")]);
    await until(() => roomCatalog(serverUrl, room.id), (catalog) => catalog.catalogVersion === 1, "first register");

    const joined = await joinPeerRoom({ serverUrl, roomId: room.id, inviteToken: room.inviteToken });
    const session = new PeerMcpSession({ serverUrl, roomId: room.id, sessionId: joined.sessionId, clientToken: joined.clientToken });
    sessions.push(session);
    await session.listTools();

    register([tool("a"), tool("b", { title: "B" })]);
    const server = await until(() => roomCatalog(serverUrl, room.id), (catalog) => catalog.catalogVersion === 2, "second register");
    await until(() => session.catalogVersion, (version) => version === 2, "client adopts announced catalog");

    expect(session.catalogHash).toBe(server.catalogHash);
    expect(session.cachedTools.map((entry) => entry.name)).toEqual(["a", "b"]);
  });

  it("tells every agent the catalog changed before it announces the catalog, under the relay's version and hash", async () => {
    const serverUrl = await startServer();
    const { room, register } = await openRoom(serverUrl);
    const joined = await joinPeerRoom({ serverUrl, roomId: room.id, inviteToken: room.inviteToken });
    const agent = new WebSocket(`${serverUrl.replace(/^http/, "ws")}/p/${room.id}/client`, ["webmcp-peer.v1", `ticket.${joined.clientToken}`]);
    sockets.push(agent);
    const received: Array<Record<string, any>> = [];
    agent.onmessage = (event) => received.push(JSON.parse(String(event.data)));
    await until(() => received.some((frame) => frame.type === "ready"), Boolean, "agent ready");

    register([tool("a")]);
    await until(() => received.some((frame) => frame.type === "register"), Boolean, "the announcement");
    const catalog = await roomCatalog(serverUrl, room.id);
    const told = received.filter((frame) => frame.type === "register" || frame.message?.method === "notifications/tools/list_changed");
    expect(told).toEqual([
      { type: "mcp", message: { jsonrpc: "2.0", method: "notifications/tools/list_changed", params: { catalogVersion: 1, catalogHash: catalog.catalogHash } } },
      { type: "register", tools: [tool("a")], catalogVersion: 1, catalogHash: catalog.catalogHash },
    ]);
  });

  it("hashes a catalog that came with a tool's own __proto__ key as the client hashes what it lists", async () => {
    const serverUrl = await startServer();
    const { room, register } = await openRoom(serverUrl);
    // JSON.parse makes "__proto__" an own key, as the relay's parse of a register frame does.
    const withOwnKey = JSON.parse('[{"name":"a","description":"a tool","inputSchema":{"type":"object","properties":{"__proto__":{"type":"string"}}}}]') as unknown[];
    register(withOwnKey);
    const catalog = await until(() => roomCatalog(serverUrl, room.id), (listed) => listed.catalogVersion === 1, "register");

    expect(Object.hasOwn(catalog.tools[0]!.inputSchema as object, "properties")).toBe(true);
    expect(Object.keys((catalog.tools[0]!.inputSchema as { properties: object }).properties)).toEqual(["__proto__"]);
    expect(catalog.catalogHash).toBe(hashTools(catalog.tools as never));
    expect(catalog.catalogHash).not.toBe(hashTools([tool("a", { description: "a tool" })] as never));
    // A client takes the catalog: the hash it computes is the relay's.
    const joined = await joinPeerRoom({ serverUrl, roomId: room.id, inviteToken: room.inviteToken });
    const session = new PeerMcpSession({ serverUrl, roomId: room.id, sessionId: joined.sessionId, clientToken: joined.clientToken });
    sessions.push(session);
    expect((await session.listTools()).map((entry) => entry.name)).toEqual(["a"]);
    expect(session.catalogHash).toBe(catalog.catalogHash);
  });

  it("refuses exactly the catalogs the client refuses, and neither side trims a tool name", () => {
    const refused: Array<[string, unknown[], string]> = [
      ["a duplicate name", [tool("a"), tool("a")], "DUPLICATE_TOOL"],
      ["no inputSchema", [{ name: "no_schema", description: "missing inputSchema" }], "INVALID_TOOL_DESCRIPTOR"],
      ["an array inputSchema", [{ ...tool("a"), inputSchema: [] }], "INVALID_TOOL_DESCRIPTOR"],
      ["a padded name", [tool(" padded ")], "INVALID_TOOL_DESCRIPTOR"],
      ["a trailing space", [tool("trailing ")], "INVALID_TOOL_DESCRIPTOR"],
      ["an empty name", [tool("")], "INVALID_TOOL_DESCRIPTOR"],
      ["a name over the limit", [tool("x".repeat(PEER_CATALOG_MAX_TOOL_NAME_LENGTH + 1))], "TOOL_NAME_TOO_LONG"],
      ["too many tools", Array.from({ length: PEER_CATALOG_MAX_TOOLS + 1 }, (_, index) => tool(`t${index}`)), "INVALID_TOOLS_LIST"],
    ];
    for (const [label, tools, code] of refused) {
      expect(normalizeToolCatalog(tools), label).toBeNull();
      expect(() => normalizeTools({ result: { tools } }), label).toThrow(expect.objectContaining({ code }));
    }

    const accepted = [
      [tool("x".repeat(PEER_CATALOG_MAX_TOOL_NAME_LENGTH)), tool("inner space")],
      Array.from({ length: PEER_CATALOG_MAX_TOOLS }, (_, index) => tool(`t${index}`)),
    ];
    for (const tools of accepted) {
      expect(normalizeToolCatalog(tools)?.map((entry) => entry.name)).toEqual(tools.map((entry) => entry.name));
      expect(normalizeTools({ result: { tools } }).map((entry) => entry.name)).toEqual(tools.map((entry) => entry.name));
    }
  });

  it("validates tool catalogs with the client contract", () => {
    expect(normalizeToolCatalog([tool("a"), tool("b")])).toHaveLength(2);
    expect(normalizeToolCatalog([])).toEqual([]);
    expect(normalizeToolCatalog([tool("a"), tool("a")])).toBeNull();
    expect(normalizeToolCatalog([{ name: "a", description: "", inputSchema: { type: "string" } }])).toBeNull();
    expect(normalizeToolCatalog([{ name: "a", description: "" }])).toBeNull();
    expect(normalizeToolCatalog([tool("")])).toBeNull();
    expect(normalizeToolCatalog([tool("a ")])).toBeNull();
    expect(normalizeToolCatalog({ tools: [] })).toBeNull();
  });
});

describe("client catalog frame resilience", () => {
  it("drops an invalid register frame from a legacy relay instead of throwing out of the socket handler", async () => {
    let callbacks!: PeerMcpTransportCallbacks;
    const session = new PeerMcpSession({
      roomId: "abcdef",
      transportFactory: (_url, _protocols, transportCallbacks) => {
        callbacks = transportCallbacks;
        queueMicrotask(() => transportCallbacks.onMessage?.({ type: "ready", roomId: "abcdef" }));
        return { send() {}, open: true };
      },
    });
    sessions.push(session);
    await session.connect();

    callbacks.onMessage?.({ type: "register", tools: [tool("a")], catalogVersion: 4, catalogHash: hashTools([tool("a")]) });
    expect(session.catalogVersion).toBe(4);

    expect(() => callbacks.onMessage?.({ type: "register", tools: [tool("a"), tool("a")] })).not.toThrow();
    expect(session.catalogVersion).toBe(4);
    expect(session.cachedTools.map((entry) => entry.name)).toEqual(["a"]);
    expect(session.getSessionInfo().error).toMatch(/duplicate tool name/);
  });
});
