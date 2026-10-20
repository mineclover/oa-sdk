// Regression tests for the agent-side client: room catalog discovery over Streamable HTTP,
// requests issued while a connect is in flight, ticket revocation (also through PeerMcpService),
// and response validation.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  JsonPeerMcpStore,
  PeerMcpError,
  PeerMcpService,
  PeerMcpSession,
  discoverPeerCatalog,
  getPeerSessionStatus,
  hashTools,
  joinPeerRoom,
  parseRoomId,
  PROTOCOL_VERSION,
  type PeerMcpTransportCallbacks,
} from "../src/client.js";
import { WEBMCP_SUBPROTOCOL } from "../src/config.js";
import { createWebMcpPeerServer, type WebMcpPeerServer } from "../src/server.js";

const servers: WebMcpPeerServer[] = [];
const sessions: PeerMcpSession[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.disconnect().catch(() => {});
  for (const server of servers.splice(0)) await server.close();
});

const tool = { name: "doc_read", description: "Read", inputSchema: { type: "object", properties: {} } };

describe("discoverPeerCatalog over a room MCP endpoint", () => {
  function mockRelay() {
    const calls: Array<{ url: string; method: string; authorization?: string }> = [];
    const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const rpc = JSON.parse(String(init.body)) as { id: string; method: string };
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(input), method: rpc.method, authorization: headers.authorization });
      if (rpc.method === "initialize") {
        return Response.json({
          jsonrpc: "2.0",
          id: rpc.id,
          result: { protocolVersion: "2025-11-25", serverInfo: { name: "relay" }, _meta: { roomId: "room1", roomEpoch: 2 } },
        });
      }
      if (rpc.method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { tools: [tool], catalogVersion: 4 } });
      }
      return Response.json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Method not found" } });
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  const targets = [
    { label: "serverUrl + roomId", options: { serverUrl: "http://relay.test", roomId: "room1", clientToken: "tok" } },
    { label: "invitationUrl", options: { invitationUrl: "http://relay.test/p/room1#invite=abc", clientToken: "tok" } },
    { label: "mcpEndpoint", options: { mcpEndpoint: "http://relay.test/p/room1/mcp", clientToken: "tok" } },
  ];

  for (const target of targets) {
    it(`initializes and lists tools for ${target.label}`, async () => {
      const { calls, fetchImpl } = mockRelay();
      const catalog = await discoverPeerCatalog({ ...target.options, fetchImpl, timeoutMs: 1000 });

      expect(catalog.tools.map((entry) => entry.name)).toEqual(["doc_read"]);
      expect(catalog).toMatchObject({ protocolVersion: "2025-11-25", serverInfo: { name: "relay" }, catalogVersion: 4 });
      expect(catalog.catalogHash).toBe(hashTools([tool]));
      expect(calls).toEqual([
        { url: "http://relay.test/p/room1/mcp", method: "initialize", authorization: "Bearer tok" },
        { url: "http://relay.test/p/room1/mcp", method: "tools/list", authorization: "Bearer tok" },
      ]);
    });
  }
});

describe("discoverPeerCatalog over the bootstrap /mcp/catalog route", () => {
  const catalogFetch = (body: Record<string, unknown>) => (async () => Response.json(body)) as typeof fetch;

  it("keeps a relay's scalar catalog version and hash", async () => {
    const catalog = await discoverPeerCatalog({
      serverUrl: "http://relay.test",
      fetchImpl: catalogFetch({ tools: [tool], catalogVersion: "v7", catalogHash: "abc" }),
    });
    expect(catalog).toMatchObject({ catalogVersion: "v7", catalogHash: "abc" });
  });

  it("reports the relay protocol as protocol, not as the MCP revision", async () => {
    const server = createWebMcpPeerServer({ port: 0, host: "127.0.0.1", roomSweepIntervalMs: 0, deploymentCatalog: { tools: [tool] } });
    servers.push(server);
    const catalog = await discoverPeerCatalog({ serverUrl: `http://127.0.0.1:${await server.listen()}` });

    expect(catalog.protocol).toBe(WEBMCP_SUBPROTOCOL);
    expect(catalog.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(catalog.tools.map((entry) => entry.name)).toEqual(["doc_read"]);
  });

  for (const catalogVersion of [{}, [], null, Number.NaN, "  ", true]) {
    it(`falls back to version 1 for a non-scalar catalogVersion (${JSON.stringify(catalogVersion)})`, async () => {
      const catalog = await discoverPeerCatalog({
        serverUrl: "http://relay.test",
        fetchImpl: catalogFetch({ tools: [tool], catalogVersion }),
      });
      expect(catalog.catalogVersion).toBe(1);
      expect(catalog.catalogHash).toBe(hashTools([tool]));
    });
  }
});

describe("room ids", () => {
  it("are taken only in the protocol's grammar, from an id, a room path or a room URL", () => {
    const longest = "a".repeat(128);
    expect(parseRoomId("Room_1-a")).toBe("Room_1-a");
    expect(parseRoomId(longest)).toBe(longest);
    expect(parseRoomId("/p/room1/mcp")).toBe("room1");
    expect(parseRoomId("http://relay.test/p/ROOM_1/mcp/")).toBe("ROOM_1");
    expect(parseRoomId("  ")).toBeUndefined();
    for (const invalid of ["a/b", "a b", "a.b", "a".repeat(129), "http://relay.test/p/a%20b/mcp", "http://relay.test/p/a.b"]) {
      expect(parseRoomId(invalid), invalid).toBeUndefined();
    }
  });

  it("refuses an id outside the grammar with ROOM_ID_INVALID before any request", async () => {
    let fetched = 0;
    const fetchImpl = (async () => {
      fetched += 1;
      return Response.json({});
    }) as typeof fetch;
    const failures = await Promise.all([
      joinPeerRoom({ serverUrl: "http://relay.test", roomId: "a/b", inviteToken: "invite", fetchImpl }).catch((error: unknown) => error),
      joinPeerRoom({ invitationUrl: "http://relay.test/p/a.b#invite=secret-invite", fetchImpl }).catch((error: unknown) => error),
      getPeerSessionStatus({ roomId: "a b", sessionId: "s", clientToken: "t", fetchImpl }).catch((error: unknown) => error),
      // Not read as "no room": the deployment catalog of /mcp/catalog would answer for a room it is not.
      discoverPeerCatalog({ serverUrl: "http://relay.test", roomId: "a/b", fetchImpl }).catch((error: unknown) => error),
    ]);

    for (const failure of failures) {
      expect(failure).toBeInstanceOf(PeerMcpError);
      expect(failure).toMatchObject({ code: "ROOM_ID_INVALID" });
      expect(String((failure as Error).message)).not.toContain("secret-invite");
    }
    expect(() => new PeerMcpSession({ roomId: "a".repeat(129) })).toThrow(expect.objectContaining({ code: "ROOM_ID_INVALID" }));
    expect(fetched).toBe(0);
  });
});

/** A WebSocket that opens asynchronously, sends `ready`, and answers tools/list and tools/call. */
function asyncSocketClass() {
  const created: string[] = [];
  class AsyncOpenSocket {
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;

    constructor(url: string) {
      created.push(url);
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.();
        this.emit({ type: "ready", role: "client", roomId: "room1", roomEpoch: 3, sessionId: "peer-session-relay" });
      }, 20);
    }

    send(data: string): void {
      if (this.readyState !== 1) throw new Error("socket is not open");
      const rpc = (JSON.parse(data) as { message: { id: string; method: string } }).message;
      const result =
        rpc.method === "tools/list"
          ? { tools: [tool] }
          : { content: [{ type: "text", text: "ok" }], structuredContent: { ok: true } };
      queueMicrotask(() => this.emit({ type: "mcp", message: { jsonrpc: "2.0", id: rpc.id, result } }));
    }

    close(): void {
      this.readyState = 3;
      this.onclose?.();
    }

    private emit(frame: Record<string, unknown>): void {
      this.onmessage?.({ data: JSON.stringify(frame) });
    }
  }
  return { AsyncOpenSocket, created };
}

describe("requests while a connect is in flight", () => {
  it("wait for the shared connect instead of writing to a socket that is not open", async () => {
    const { AsyncOpenSocket, created } = asyncSocketClass();
    const session = new PeerMcpSession({ serverUrl: "http://relay.test", roomId: "room1", clientToken: "tok", WebSocket: AsyncOpenSocket });
    sessions.push(session);

    const [listed, called] = await Promise.all([session.listTools(), session.callTool("doc_read")]);
    expect(listed.map((entry) => entry.name)).toEqual(["doc_read"]);
    expect(called).toMatchObject({ structuredContent: { ok: true } });
    expect(created).toHaveLength(1);
  });

  it("let a request made from a connect listener join that connect", async () => {
    const { AsyncOpenSocket, created } = asyncSocketClass();
    const session = new PeerMcpSession({ serverUrl: "http://relay.test", roomId: "room1", clientToken: "tok", WebSocket: AsyncOpenSocket });
    sessions.push(session);
    let nested: Promise<unknown> | undefined;
    session.subscribe((info) => {
      if (info.state === "connecting" && !nested) nested = session.listTools();
    });

    await session.connect();
    await expect(nested).resolves.toHaveLength(1);
    expect(created).toHaveLength(1);
  });

  it("adopt the relay's session id from the ready frame", async () => {
    const { AsyncOpenSocket } = asyncSocketClass();
    const session = new PeerMcpSession({ serverUrl: "http://relay.test", roomId: "room1", clientToken: "tok", WebSocket: AsyncOpenSocket });
    sessions.push(session);
    await session.connect();
    expect(session.getSessionInfo()).toMatchObject({ sessionId: "peer-session-relay", roomEpoch: 3 });
  });
});

describe("PeerMcpSession.revoke against the relay", () => {
  async function joinedRoom({ approvalRequired = false } = {}) {
    const server = createWebMcpPeerServer({ port: 0, host: "127.0.0.1", roomSweepIntervalMs: 0 });
    servers.push(server);
    const serverUrl = `http://127.0.0.1:${await server.listen()}`;
    const created = await fetch(`${serverUrl}/p`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalRequired }),
    });
    const room = (await created.json()) as { id: string; inviteToken: string };
    const joined = await joinPeerRoom({ serverUrl, roomId: room.id, inviteToken: room.inviteToken });
    const status = () =>
      getPeerSessionStatus({ serverUrl, roomId: room.id, sessionId: joined.sessionId, clientToken: joined.clientToken });
    return { serverUrl, joined, status };
  }

  it("revokes a README-style Streamable HTTP session after initialize", async () => {
    const { joined, status } = await joinedRoom();
    const session = new PeerMcpSession({ mcpEndpoint: joined.mcpEndpoint, clientToken: joined.clientToken, sessionId: joined.sessionId });
    sessions.push(session);
    await session.connect();
    await session.initialize();
    expect(session.roomEpoch).toBe(joined.roomEpoch);

    await expect(session.revoke()).resolves.toMatchObject({ revoked: true, sessionId: joined.sessionId });
    expect((await status()).state).toBe("revoked");
  });

  it("revokes an HTTP session that never called initialize", async () => {
    const { joined, status } = await joinedRoom();
    const session = new PeerMcpSession({ mcpEndpoint: joined.mcpEndpoint, clientToken: joined.clientToken, sessionId: joined.sessionId });
    sessions.push(session);
    await session.connect();

    await session.revoke();
    expect((await status()).state).toBe("revoked");
  });

  it("revokes an HTTP session constructed without a session id", async () => {
    const { joined, status } = await joinedRoom();
    const session = new PeerMcpSession({ mcpEndpoint: joined.mcpEndpoint, clientToken: joined.clientToken });
    sessions.push(session);
    await session.connect();
    await session.initialize();

    await session.revoke();
    expect((await status()).state).toBe("revoked");
  });

  it("revokes an HTTP session constructed without a session id that never called initialize", async () => {
    const { joined, status } = await joinedRoom();
    const session = new PeerMcpSession({ mcpEndpoint: joined.mcpEndpoint, clientToken: joined.clientToken });
    sessions.push(session);
    await session.connect();
    expect(session.roomEpoch).toBeUndefined();

    await expect(session.revoke()).resolves.toMatchObject({ revoked: true, sessionId: joined.sessionId });
    expect(session.roomEpoch).toBe(joined.roomEpoch);
    expect((await status()).state).toBe("revoked");
  });

  it("revokes from a session that never connected", async () => {
    const { joined, status } = await joinedRoom();
    const session = new PeerMcpSession({ mcpEndpoint: joined.mcpEndpoint, clientToken: joined.clientToken });
    sessions.push(session);

    await session.revoke();
    expect((await status()).state).toBe("revoked");
  });

  it("revokes a ticket that is still waiting for approval", async () => {
    const { joined, status } = await joinedRoom({ approvalRequired: true });
    expect((await status()).state).toBe("pending-approval");
    const session = new PeerMcpSession({ mcpEndpoint: joined.mcpEndpoint, clientToken: joined.clientToken });
    sessions.push(session);

    await session.revoke();
    expect((await status()).state).toBe("revoked");
  });

  it("revokes a WebSocket session constructed without a session id", async () => {
    const { serverUrl, joined, status } = await joinedRoom();
    const session = new PeerMcpSession({ serverUrl, roomId: joined.roomId, clientToken: joined.clientToken });
    sessions.push(session);
    await session.connect();
    expect(session.sessionId).toBe(joined.sessionId);

    await session.revoke();
    expect((await status()).state).toBe("revoked");
  });

  it("reports the relay's error name as the code of a refused revoke", async () => {
    const { joined, status } = await joinedRoom();
    // A stale epoch: the relay refuses the binding with 409 SESSION_BINDING_INVALID (code −32002).
    const session = new PeerMcpSession({
      mcpEndpoint: joined.mcpEndpoint,
      clientToken: joined.clientToken,
      sessionId: joined.sessionId,
      roomEpoch: joined.roomEpoch + 1,
    });
    sessions.push(session);

    const failure = await session.revoke().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PeerMcpError);
    expect(failure).toMatchObject({ code: "SESSION_BINDING_INVALID", details: { error: "SESSION_BINDING_INVALID", code: -32002 } });
    expect((await status()).state).toBe("approved");
  });

  it("revokes a session a PeerMcpService registered under a key of its own", async () => {
    const { joined, status } = await joinedRoom();
    const service = new PeerMcpService();
    const session = await service.connect({ key: "primary", mcpEndpoint: joined.mcpEndpoint, clientToken: joined.clientToken });
    sessions.push(session);
    expect(service.getSession("primary")).toBe(session);
    expect(service.activeKey).toBe("primary");
    // The key names the session in the registry only: the relay never sees it as a session id.
    expect(session.sessionId).not.toBe("primary");

    await expect(service.revoke("primary")).resolves.toMatchObject({ revoked: true, sessionId: joined.sessionId });
    expect((await status()).state).toBe("revoked");
    expect(service.getSession("primary")).toBeUndefined();
  });
});

describe("response validation", () => {
  function sessionAnswering(result: unknown): PeerMcpSession {
    const session = new PeerMcpSession({
      requestTimeoutMs: 1000,
      transportFactory: (_url: string, _protocols: string[], callbacks: PeerMcpTransportCallbacks) => {
        queueMicrotask(() => callbacks.onMessage?.({ type: "ready" }));
        return {
          raw: true,
          send(value) {
            const rpc = value as { id: string; method: string };
            const reply = rpc.method === "tools/list" ? { tools: [tool] } : result;
            queueMicrotask(() => callbacks.onMessage?.({ jsonrpc: "2.0", id: rpc.id, result: reply }));
          },
        };
      },
    });
    sessions.push(session);
    return session;
  }

  it("rejects a tools/call result that is not a CallToolResult", async () => {
    const session = sessionAnswering({ content: "not blocks" });
    const failure = await session.callTool("doc_read").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PeerMcpError);
    expect(failure).toMatchObject({ code: "INVALID_TOOL_RESULT" });
  });

  it("returns a valid CallToolResult with its extra members", async () => {
    const session = sessionAnswering({ content: [{ type: "text", text: "x" }], structuredContent: { a: 1 }, data: { a: 1 } });
    await expect(session.callTool("doc_read")).resolves.toEqual({
      content: [{ type: "text", text: "x" }],
      structuredContent: { a: 1 },
      data: { a: 1 },
    });
  });

  it("rejects a join response that is not a client ticket", async () => {
    const fetchImpl = (async () => Response.json({ roomId: "room1" }, { status: 201 })) as typeof fetch;
    await expect(joinPeerRoom({ serverUrl: "http://relay.test", roomId: "room1", inviteToken: "i", fetchImpl })).rejects.toMatchObject({
      code: "INVALID_JOIN_RESPONSE",
    });
  });

  it("loads only a valid catalog cache from a JSON store", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webmcp-peer-store-"));
    try {
      const file = path.join(dir, "catalog.json");
      const store = new JsonPeerMcpStore(file);
      fs.writeFileSync(file, JSON.stringify({ cachedTools: [{ name: "x" }], catalogVersion: 2 }));
      expect(store.load()).toBeUndefined();
      store.save({ cachedTools: [tool], catalogVersion: 2, catalogHash: "stale", updatedAt: null });
      expect(store.load()).toEqual({ cachedTools: [tool], catalogVersion: 2, catalogHash: "stale", updatedAt: null });

      const session = new PeerMcpSession({ storage: store, roomId: "room1" });
      expect(session.getCatalogSnapshot()).toMatchObject({ catalogVersion: 2, catalogHash: hashTools([tool]) });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
