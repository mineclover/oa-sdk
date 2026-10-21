// Regression tests for the agent-side client: room catalog discovery over Streamable HTTP,
// requests issued while a connect is in flight, ticket revocation (also through PeerMcpService),
// how a session learns that its room expired or that the relay closed its socket (the close code in
// TRANSPORT_CLOSED's details), when it connects again on a new socket and when it must not, the
// connects made around disconnect() and the transports it and they close (a factory's, one a factory
// hands out again, the caller's own, whose onMessage delivers to the session that took it last and
// which stays open while another session's connection holds it), the request ids disconnect() gives
// back, and response validation.
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
  waitForPeerApproval,
  type PeerMcpTransport,
  type PeerMcpTransportCallbacks,
} from "../src/client.js";
import { PEER_RELAY_MAX_PENDING_REQUESTS, WEBMCP_CLOSE_CODES, WEBMCP_SUBPROTOCOL } from "../src/config.js";
import { createWebMcpPeerServer, type WebMcpPeerServer } from "../src/server.js";

const servers: WebMcpPeerServer[] = [];
const sessions: PeerMcpSession[] = [];
const providers: WebSocket[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.disconnect().catch(() => {});
  for (const provider of providers.splice(0)) provider.close();
  for (const server of servers.splice(0)) await server.close();
});

const tool = { name: "doc_read", description: "Read", inputSchema: { type: "object", properties: {} } };

describe("discoverPeerCatalog over a room MCP endpoint", () => {
  function mockRelay() {
    const calls: Array<{ url: string; method: string; authorization?: string }> = [];
    const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const rpc = JSON.parse(String(init.body)) as { id?: string; method: string };
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(input), method: rpc.method, authorization: headers.authorization });
      // A notification is accepted with 202 and an empty body, as the relay answers it.
      if (rpc.id === undefined) return new Response(null, { status: 202 });
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
      // The initialization ends with notifications/initialized before the session lists tools.
      expect(calls).toEqual([
        { url: "http://relay.test/p/room1/mcp", method: "initialize", authorization: "Bearer tok" },
        { url: "http://relay.test/p/room1/mcp", method: "notifications/initialized", authorization: "Bearer tok" },
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

  it.each([
    ["with the relay's session id", true],
    ["without a session id", false],
  ])("revokes an HTTP session %s that never learned its room epoch with one POST, leaving the epoch out", async (_label, withSessionId) => {
    const { joined, status } = await joinedRoom();
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
      requests.push({ method: init.method ?? "GET", url: String(input), body: init.body === undefined ? undefined : JSON.parse(String(init.body)) });
      return fetch(input, init);
    }) as typeof fetch;
    const session = new PeerMcpSession({
      mcpEndpoint: joined.mcpEndpoint,
      clientToken: joined.clientToken,
      fetchImpl,
      ...(withSessionId ? { sessionId: joined.sessionId } : {}),
    });
    sessions.push(session);
    expect(session.roomEpoch).toBeUndefined();

    await expect(session.revoke()).resolves.toMatchObject({ revoked: true, sessionId: joined.sessionId });
    // The relay needs no epoch to find the ticket, so none is looked up first.
    const route = withSessionId ? `/sessions/${joined.sessionId}/revoke` : "/session/revoke";
    expect(requests).toEqual([{
      method: "POST",
      url: joined.mcpEndpoint.replace(/\/mcp$/, route),
      body: { ...(withSessionId ? { sessionId: joined.sessionId } : {}), roomId: joined.roomId, reason: "client-request", requestedAt: expect.any(String) },
    }]);
    expect(session.roomEpoch).toBeUndefined();
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

describe("a session whose room expires", () => {
  async function joinedRoom({ approvalRequired = false } = {}) {
    const server = createWebMcpPeerServer({ port: 0, host: "127.0.0.1", roomSweepIntervalMs: 0, deploymentCatalog: { tools: [] } });
    servers.push(server);
    const serverUrl = `http://127.0.0.1:${await server.listen()}`;
    const created = await fetch(`${serverUrl}/p`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalRequired }),
    });
    const room = (await created.json()) as { id: string; inviteToken: string; providerToken: string };
    const joined = await joinPeerRoom({ serverUrl, roomId: room.id, inviteToken: room.inviteToken });
    // The room's time runs out; the relay's next request sweeps it.
    const expire = async () => {
      server.rooms.get(room.id)!.expiresAt = Date.now() - 1;
      await fetch(`${serverUrl}/status`);
    };
    return { serverUrl, room, joined, expire };
  }

  it("rejects a WebSocket request in flight with ROOM_EXPIRED, not SESSION_REVOKED", async () => {
    const { serverUrl, room, joined, expire } = await joinedRoom();
    // A provider that takes the request and never answers it.
    const provider = new WebSocket(`${serverUrl.replace(/^http/, "ws")}/p/${room.id}/provider`, [WEBMCP_SUBPROTOCOL, `ticket.${room.providerToken}`]);
    providers.push(provider);
    const forwarded = new Promise<void>((resolve) => {
      provider.onmessage = (event) => {
        if ((JSON.parse(String(event.data)) as { type?: unknown }).type === "mcp") resolve();
      };
    });
    await new Promise<void>((resolve, reject) => {
      provider.onopen = () => resolve();
      provider.onerror = () => reject(new Error("provider socket failed to open"));
    });
    const session = new PeerMcpSession({ serverUrl, roomId: room.id, clientToken: joined.clientToken });
    sessions.push(session);
    await session.connect();
    const call = session.request("tools/call", { name: "doc_read", arguments: {} });
    call.catch(() => {});
    await forwarded;

    await expire();
    await expect(call).rejects.toMatchObject({ code: "ROOM_EXPIRED", details: { type: "room.expired", roomId: room.id } });
    expect(session.getSessionInfo()).toMatchObject({ state: "error" });
  });

  it("reports a session still waiting for approval as expired, so waitForPeerApproval throws APPROVAL_EXPIRED", async () => {
    const { serverUrl, joined, expire } = await joinedRoom({ approvalRequired: true });
    await expire();
    const options = { serverUrl, roomId: joined.roomId, sessionId: joined.sessionId, clientToken: joined.clientToken };
    expect(await getPeerSessionStatus(options)).toMatchObject({ state: "expired" });
    await expect(waitForPeerApproval({ ...options, timeoutMs: 1_000 })).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" });
  });
});

describe("a session whose socket the relay closes", () => {
  it("rejects a request in flight with TRANSPORT_CLOSED, whose details carry the close code", async () => {
    const server = createWebMcpPeerServer({ port: 0, host: "127.0.0.1", roomSweepIntervalMs: 0, deploymentCatalog: { tools: [] } });
    servers.push(server);
    const serverUrl = `http://127.0.0.1:${await server.listen()}`;
    const created = await fetch(`${serverUrl}/p`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalRequired: false }),
    });
    const room = (await created.json()) as { id: string; inviteToken: string; providerToken: string };
    const joined = await joinPeerRoom({ serverUrl, roomId: room.id, inviteToken: room.inviteToken });
    // A provider that takes the request and never answers it.
    const provider = new WebSocket(`${serverUrl.replace(/^http/, "ws")}/p/${room.id}/provider`, [WEBMCP_SUBPROTOCOL, `ticket.${room.providerToken}`]);
    providers.push(provider);
    const forwarded = new Promise<void>((resolve) => {
      provider.onmessage = (event) => {
        if ((JSON.parse(String(event.data)) as { type?: unknown }).type === "mcp") resolve();
      };
    });
    await new Promise<void>((resolve, reject) => {
      provider.onopen = () => resolve();
      provider.onerror = () => reject(new Error("provider socket failed to open"));
    });
    const open = async () => {
      const session = new PeerMcpSession({ serverUrl, roomId: room.id, clientToken: joined.clientToken });
      sessions.push(session);
      await session.connect();
      return session;
    };
    const oldest = await open();
    const call = oldest.request("tools/call", { name: "doc_read", arguments: {} });
    call.catch(() => {});
    await forwarded;

    // Four more sockets of the same ticket: the relay closes the oldest with 4001 SUPERSEDED.
    for (let count = 0; count < 4; count++) await open();
    await expect(call).rejects.toMatchObject({
      code: "TRANSPORT_CLOSED",
      details: { code: WEBMCP_CLOSE_CODES.SUPERSEDED, reason: "" },
    });
    expect(oldest.getSessionInfo().state).toBe("disconnected");
  });
});

/** A relay room an approved agent joined, and a WebSocket class that counts the sockets a session opens. */
async function joinedSession() {
  const server = createWebMcpPeerServer({ port: 0, host: "127.0.0.1", roomSweepIntervalMs: 0, deploymentCatalog: { tools: [] } });
  servers.push(server);
  const serverUrl = `http://127.0.0.1:${await server.listen()}`;
  const created = await fetch(`${serverUrl}/p`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approvalRequired: false }),
  });
  const room = (await created.json()) as { id: string; inviteToken: string; providerToken: string };
  const joined = await joinPeerRoom({ serverUrl, roomId: room.id, inviteToken: room.inviteToken });
  const opened: WebSocket[] = [];
  class CountingWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      opened.push(this);
    }
  }
  const session = new PeerMcpSession({ serverUrl, roomId: room.id, clientToken: joined.clientToken, requestTimeoutMs: 2_000, WebSocket: CountingWebSocket });
  sessions.push(session);
  await session.connect();
  const entry = () => server.rooms.get(room.id)!;
  /** The relay closes the session's socket with `code`, and the session learns it. */
  const closeFromRelay = async (code: number) => {
    [...entry().clientSockets].at(-1)!.close(code);
    await waitUntil(() => session.getSessionInfo().state === "disconnected", "the session sees the close");
  };
  return { server, serverUrl, room, joined, session, opened, CountingWebSocket, entry, closeFromRelay };
}

async function waitUntil(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * A session on a `transportFactory` whose transports record their callbacks and how often they were
 * closed. `makeTransport` delays the making of each, `closeTransport` the close of each.
 */
function factorySession(options: {
  requestTimeoutMs?: number;
  makeTransport?: () => Promise<void>;
  closeTransport?: () => Promise<void>;
} = {}) {
  const made: Array<{ callbacks: PeerMcpTransportCallbacks; closed: number }> = [];
  const session = new PeerMcpSession({
    requestTimeoutMs: options.requestTimeoutMs ?? 1_000,
    transportFactory: async (_url: string, _protocols: string[], callbacks: PeerMcpTransportCallbacks) => {
      await options.makeTransport?.();
      const transport = { callbacks, closed: 0 };
      made.push(transport);
      return {
        send: () => {},
        close: () => {
          transport.closed += 1;
          return options.closeTransport?.();
        },
      };
    },
  });
  sessions.push(session);
  /** The relay's `ready` on the latest transport. */
  const ready = () => made.at(-1)!.callbacks.onMessage?.({ type: "ready", role: "client", roomId: "room1" });
  return { session, made, ready };
}

/** A promise `open()` resolves: what a fake transport waits on to make, connect or close. */
function gate(): { opened: Promise<void>; open: () => void } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** The error `promise` rejects with, which must come within `ms`; an Error saying so when it does not. */
async function rejectionWithin(promise: Promise<unknown>, ms: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`still pending after ${ms} ms`)), ms);
  });
  try {
    await Promise.race([promise, late]);
    return new Error("resolved instead of rejecting");
  } catch (error) {
    return error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A session on the caller's own transport (`options.transport`), which every connect uses again. Its
 * `connect(callbacks)` keeps the callbacks it is handed (the transport reports through the latest),
 * waits for `connecting` when given one, then opens and delivers the relay's `ready`. Its `send`
 * answers every request with an empty result. Its `close()` counts and, through the callbacks of the
 * connect whose socket it closes, delivers the `closing` frames, as the relay's last frame arrives
 * when its socket closes, and then a close with `closeCode` (1000 by default): at once, or
 * `closeLateMs` later, as a WebSocket's close event arrives after `close()` returned.
 */
function suppliedTransportSession(options: {
  connecting?: () => Promise<void>;
  closing?: ReadonlyArray<Record<string, unknown>>;
  closeCode?: number;
  closeLateMs?: number;
  /** What `connect` resolves with, which the session merges into the transport it uses. */
  connected?: Record<string, unknown>;
} = {}) {
  const transport = {
    connects: 0,
    closes: 0,
    callbacks: undefined as PeerMcpTransportCallbacks | undefined,
    async connect(callbacks?: PeerMcpTransportCallbacks): Promise<Record<string, unknown> | undefined> {
      transport.connects += 1;
      transport.callbacks = callbacks;
      await options.connecting?.();
      callbacks?.onOpen?.();
      callbacks?.onMessage?.({ type: "ready", role: "client", roomId: "room1" });
      return options.connected;
    },
    send(value: unknown): void {
      const rpc = (value as { message: { id: string } }).message;
      queueMicrotask(() => transport.callbacks?.onMessage?.({ type: "mcp", message: { jsonrpc: "2.0", id: rpc.id, result: {} } }));
    },
    close(): void {
      transport.closes += 1;
      const closed = transport.callbacks;
      const report = () => {
        for (const frame of options.closing ?? []) closed?.onMessage?.(frame);
        closed?.onClose?.({ code: options.closeCode ?? WEBMCP_CLOSE_CODES.NORMAL, reason: "" });
      };
      if (options.closeLateMs === undefined) report();
      else setTimeout(report, options.closeLateMs);
    },
  };
  const session = new PeerMcpSession({ requestTimeoutMs: 1_000, transport });
  sessions.push(session);
  return { session, transport };
}

describe("a session whose socket closed", () => {
  it.each<[string, number]>([
    ["1001 GOING_AWAY", WEBMCP_CLOSE_CODES.GOING_AWAY],
    ["1013 TRY_AGAIN_LATER", WEBMCP_CLOSE_CODES.TRY_AGAIN_LATER],
  ])("connects again on a new socket for the next request after %s", async (_label, code) => {
    const { session, opened, entry, closeFromRelay } = await joinedSession();
    await closeFromRelay(code);
    expect(entry().clientSockets.size).toBe(0);

    expect((await session.request("ping")).result).toEqual({});
    expect(opened).toHaveLength(2);
    expect(entry().clientSockets.size).toBe(1);
    expect(session.getSessionInfo().state).toBe("connected");
  });

  it.each<[string, number]>([
    ["1000, a final close", WEBMCP_CLOSE_CODES.NORMAL],
    ["4001 SUPERSEDED", WEBMCP_CLOSE_CODES.SUPERSEDED],
    ["4002 ROOM_EXPIRED", WEBMCP_CLOSE_CODES.ROOM_EXPIRED],
    ["1009, a frame of its own refused", 1009],
  ])("fails the next request after %s without connecting again, until connect() is called", async (_label, code) => {
    const { session, opened, entry, closeFromRelay } = await joinedSession();
    await closeFromRelay(code);

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(session.request("ping")).rejects.toMatchObject({ code: "TRANSPORT_CLOSED", details: { code, reason: "" } });
    }
    expect(opened).toHaveLength(1);
    expect(entry().clientSockets.size).toBe(0);

    // The caller decides to connect again.
    await session.connect();
    expect((await session.request("ping")).result).toEqual({});
    expect(opened).toHaveLength(2);
  });

  it("lets a PeerMcpService call connect only as a request would, so it does not displace the socket that replaced its own", async () => {
    const { serverUrl, room, joined, opened, CountingWebSocket, entry } = await joinedSession();
    const service = new PeerMcpService({ serverUrl, requestTimeoutMs: 2_000, WebSocket: CountingWebSocket });
    const session = await service.connect({ roomId: room.id, clientToken: joined.clientToken });
    sessions.push(session);
    expect(opened).toHaveLength(2);
    await waitUntil(() => entry().clientSockets.size === 2, "both sockets attached");

    [...entry().clientSockets].at(-1)!.close(WEBMCP_CLOSE_CODES.SUPERSEDED);
    await waitUntil(() => session.getSessionInfo().state === "disconnected", "the service's session sees the close");
    await expect(service.callTool("doc_read")).rejects.toMatchObject({ code: "TRANSPORT_CLOSED", details: { code: WEBMCP_CLOSE_CODES.SUPERSEDED } });
    await expect(service.refreshCatalog()).rejects.toMatchObject({ code: "TRANSPORT_CLOSED" });
    expect(opened).toHaveLength(2);
    expect(entry().clientSockets.size).toBe(1);
  });

  it("closes the transport a connect replaces, and lets none of its late events speak for the new one", async () => {
    const { session, made, ready } = factorySession();
    const first = session.connect();
    await waitUntil(() => made.length === 1, "the first transport");
    ready();
    await first;
    made[0]!.callbacks.onClose?.({ code: WEBMCP_CLOSE_CODES.TRY_AGAIN_LATER });

    const second = session.connect();
    await waitUntil(() => made.length === 2, "the second transport");
    expect(made[0]!.closed).toBe(1);
    // The old transport's ready and close arrive late: the new connection still waits for its own.
    made[0]!.callbacks.onMessage?.({ type: "ready", role: "client", roomId: "room1" });
    made[0]!.callbacks.onClose?.({ code: WEBMCP_CLOSE_CODES.SUPERSEDED });
    expect(session.getSessionInfo().state).toBe("connecting");
    ready();
    await second;
    expect(session.getSessionInfo().state).toBe("connected");
    expect(made[1]!.closed).toBe(0);
  });

  it.each<[string, (callbacks: PeerMcpTransportCallbacks) => void, boolean]>([
    ["a close it may connect again after", (callbacks) => callbacks.onClose?.({ code: WEBMCP_CLOSE_CODES.GOING_AWAY }), true],
    ["the frame that ended its session", (callbacks) => callbacks.onMessage?.({ type: "session.revoked", reason: "CLIENT_REVOKED" }), false],
  ])("does not take a new transport that never opens for the one that was open, after %s", async (_label, end, closes) => {
    const { session, made, ready } = factorySession({ requestTimeoutMs: 100 });
    const first = session.connect();
    await waitUntil(() => made.length === 1, "the first transport");
    made[0]!.callbacks.onOpen?.();
    ready();
    expect((await first).connectedAt).toEqual(expect.any(Number));
    end(made[0]!.callbacks);
    // A closed transport is open since no time and has sent no ready.
    if (closes) {
      expect(session.getSessionInfo().connectedAt).toBeNull();
      expect(session.readySeen).toBe(false);
    }

    // The relay is not back: the next transport neither opens nor sends ready.
    await expect(session.connect()).rejects.toMatchObject({ code: "TRANSPORT_TIMEOUT" });
    expect(made).toHaveLength(2);
    expect(session.getSessionInfo()).toMatchObject({ state: "error", connectedAt: null });
  });

  it("fails the next request after the frame that ended its session, without connecting again", async () => {
    const { server, serverUrl, room, joined, session, opened } = await joinedSession();
    const revoked = await fetch(`${serverUrl}/p/${room.id}/sessions/${joined.sessionId}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${room.providerToken}` },
      body: "{}",
    });
    expect(revoked.status).toBe(200);
    await waitUntil(() => session.getSessionInfo().state === "error", "the session sees session.revoked");

    await expect(session.request("ping")).rejects.toMatchObject({ code: "SESSION_REVOKED", details: { type: "session.revoked" } });
    expect(opened).toHaveLength(1);
    expect(server.rooms.get(room.id)!.clientSockets.size).toBe(0);
  });
});

describe("disconnect() and the connects around it", () => {
  it.each<[string, (session: PeerMcpSession) => Promise<unknown>]>([
    ["a request", (session) => session.request("ping")],
    ["connect()", (session) => session.connect()],
  ])("lets %s made while it runs connect once it has closed the socket, so one socket stays open", async (_label, connectAgain) => {
    const { session, opened, entry } = await joinedSession();
    const disconnected = session.disconnect();
    const connected = connectAgain(session);

    await expect(disconnected).resolves.toMatchObject({ state: "idle" });
    await connected;
    expect(session.getSessionInfo().state).toBe("connected");
    expect(opened).toHaveLength(2);
    expect(opened[0]!.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
    await waitUntil(() => entry().clientSockets.size === 1, "the relay holds the new socket alone");
    expect((await session.request("ping")).result).toEqual({});

    await session.disconnect();
    expect(opened[1]!.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
    await waitUntil(() => entry().clientSockets.size === 0, "the relay sees the last socket close");
  });

  it.each<[string, boolean]>([
    ["while its transport is being made", true],
    ["while it waits for ready", false],
  ])("ends a connect %s with SESSION_DISCONNECTED at once, closes its transport and leaves the session idle", async (_label, making) => {
    const made$ = gate();
    // Far beyond the test's own timeout: only disconnect() can end the connect in time.
    const { session, made } = factorySession({ requestTimeoutMs: 60_000, ...(making ? { makeTransport: () => made$.opened } : {}) });
    const connecting = session.connect();
    connecting.catch(() => {});
    if (!making) await waitUntil(() => made.length === 1, "the transport");
    const disconnected = session.disconnect();
    made$.open();

    expect(await rejectionWithin(connecting, 500)).toMatchObject({ code: "SESSION_DISCONNECTED" });
    await expect(disconnected).resolves.toMatchObject({ state: "idle" });
    expect(made.map((transport) => transport.closed)).toEqual([1]);
    // Neither the closed transport nor a wait for its ready is left for the next connect.
    expect(session.transport).toBeUndefined();
    expect(session.readyPromise).toBeNull();
    expect(session.getSessionInfo()).toMatchObject({ state: "idle", error: null });
  });

  it.each<[string, boolean]>([
    ["still waits for a factory to make its transport", true],
    ["still waits for the caller's own transport to connect", false],
  ])("ends a request at once whose connect %s, so a request under its id is sent after the next connect", async (_label, factory) => {
    // The first connect gets its transport only when the test ends; every later one gets one at
    // once. Each transport delivers the relay's `ready` once it is connected and answers every
    // request through the callbacks of its own connect.
    const firstConnect = gate();
    let connects = 0;
    const sent: unknown[] = [];
    const ready = (callbacks?: PeerMcpTransportCallbacks) =>
      queueMicrotask(() => callbacks?.onMessage?.({ type: "ready", role: "client", roomId: "room1" }));
    const answering = (callbacks: () => PeerMcpTransportCallbacks | undefined): PeerMcpTransport => ({
      send(value) {
        const rpc = (value as { message: { id: string } }).message;
        sent.push(rpc.id);
        queueMicrotask(() => callbacks()?.onMessage?.({ type: "mcp", message: { jsonrpc: "2.0", id: rpc.id, result: {} } }));
      },
      close() {},
    });
    let latest: PeerMcpTransportCallbacks | undefined;
    const own: PeerMcpTransport = {
      ...answering(() => latest),
      async connect(callbacks) {
        latest = callbacks;
        if (++connects === 1) await firstConnect.opened;
        ready(callbacks);
      },
    };
    const session = new PeerMcpSession({
      requestTimeoutMs: 1_000,
      ...(factory
        ? {
            transportFactory: async (_url: string, _protocols: string[], callbacks: PeerMcpTransportCallbacks) => {
              if (++connects === 1) await firstConnect.opened;
              ready(callbacks);
              return answering(() => callbacks);
            },
          }
        : { transport: own }),
    });
    sessions.push(session);

    const waiting = session.request("ping", {}, { id: "x" });
    waiting.catch(() => {});
    await waitUntil(() => connects === 1, "the first connect getting its transport");
    const disconnected = session.disconnect();

    expect(await rejectionWithin(waiting, 500)).toMatchObject({ code: "SESSION_DISCONNECTED" });
    await expect(disconnected).resolves.toMatchObject({ state: "idle" });
    await expect(session.connect()).resolves.toMatchObject({ state: "connected" });
    expect((await session.request("ping", {}, { id: "x" })).result).toEqual({});
    expect(sent).toEqual(["x"]);

    // The connect disconnect() ended gets its transport last, and changes nothing.
    firstConnect.open();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session.getSessionInfo()).toMatchObject({ state: "connected", error: null });
    expect((await session.request("ping", {}, { id: "x" })).result).toEqual({});
    expect(sent).toEqual(["x", "x"]);
  });

  it.each<[string, boolean]>([
    ["ends", false],
    ["fails", true],
  ])("gives back at once the id of a request whose send still runs, and that send, when it %s later, touches nothing of the request sent under its id after the next connect", async (_label, fails) => {
    // The first transport's send settles only when the test releases it, not when the transport
    // closes; every later transport records the callbacks it was made with, and answers only what
    // the test answers through them.
    const firstSend = gate();
    const made: PeerMcpTransportCallbacks[] = [];
    const sent: Array<{ transport: number; id: unknown }> = [];
    const session = new PeerMcpSession({
      requestTimeoutMs: 5_000,
      transportFactory: (_url: string, _protocols: string[], callbacks: PeerMcpTransportCallbacks) => {
        const index = made.push(callbacks) - 1;
        queueMicrotask(() => callbacks.onMessage?.({ type: "ready", role: "client", roomId: "room1" }));
        return {
          async send(value) {
            const rpc = (value as { message: { id: unknown } }).message;
            sent.push({ transport: index, id: rpc.id });
            if (index !== 0) return;
            await firstSend.opened;
            if (fails) throw new Error("send failed");
          },
          close() {},
        };
      },
    });
    sessions.push(session);
    const answer = (transport: number, id: unknown) =>
      made[transport]!.onMessage?.({ type: "mcp", message: { jsonrpc: "2.0", id, result: { transport } } });

    await session.connect();
    const first = session.request("ping", {}, { id: "x" });
    first.catch(() => {});
    await waitUntil(() => sent.length === 1, "the first send");
    await expect(session.disconnect()).resolves.toMatchObject({ state: "idle" });
    await session.connect();

    // The send still runs, but its connection has ended: the id is free on the next one.
    let secondSettled = false;
    const second = session.request("ping", {}, { id: "x" });
    second.then(
      () => (secondSettled = true),
      () => (secondSettled = true),
    );
    await waitUntil(() => sent.length === 2, "the request under its id sent on the next connection");
    expect(sent).toEqual([{ transport: 0, id: "x" }, { transport: 1, id: "x" }]);

    // The first send settles last: its request ends as disconnect() ended it, and leaves the id,
    // the pending answer and the relay slot of the request under it alone.
    firstSend.open();
    expect(await rejectionWithin(first, 500)).toMatchObject({ code: "SESSION_DISCONNECTED" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondSettled).toBe(false);
    await expect(session.request("ping", {}, { id: "x" })).rejects.toMatchObject({ code: "DUPLICATE_REQUEST_ID" });
    // With the request under the id, 63 more fill the relay socket's slots: one past them waits.
    for (let index = 1; index < PEER_RELAY_MAX_PENDING_REQUESTS; index++) void session.request("ping", {}, { id: `fill-${index}` }).catch(() => {});
    void session.request("ping", {}, { id: "past" }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent.filter((request) => request.transport === 1)).toHaveLength(PEER_RELAY_MAX_PENDING_REQUESTS);

    answer(1, "x");
    await expect(second).resolves.toMatchObject({ id: "x", result: { transport: 1 } });
    await waitUntil(() => sent.at(-1)?.id === "past", "the request past the slots sent once the one under the id is answered");
  });

  it("ends a request waiting for a connect at once with TRANSPORT_CLOSED when that connect's transport closes while a factory still makes it", async () => {
    const made$ = gate();
    // Far beyond the test's own timeout: the connect's wait for `ready` cannot end the request in time.
    const session = new PeerMcpSession({
      requestTimeoutMs: 60_000,
      transportFactory: async (_url: string, _protocols: string[], callbacks: PeerMcpTransportCallbacks) => {
        callbacks.onClose?.({ code: WEBMCP_CLOSE_CODES.GOING_AWAY, reason: "" });
        await made$.opened;
        return { send: () => {}, close: () => {} };
      },
    });
    sessions.push(session);

    const waiting = session.request("ping", {}, { id: "x" });
    waiting.catch(() => {});
    expect(await rejectionWithin(waiting, 500)).toMatchObject({
      code: "TRANSPORT_CLOSED",
      details: { code: WEBMCP_CLOSE_CODES.GOING_AWAY, reason: "" },
    });
    made$.open();
  });

  it("ends a connect whose ready arrives in the same tick as disconnect(), so the session stays idle", async () => {
    const { session, made, ready } = factorySession();
    const connecting = session.connect();
    connecting.catch(() => {});
    await waitUntil(() => made.length === 1, "the transport");
    ready();
    const disconnected = session.disconnect();

    await expect(connecting).rejects.toMatchObject({ code: "SESSION_DISCONNECTED" });
    await expect(disconnected).resolves.toMatchObject({ state: "idle" });
    expect(made[0]!.closed).toBe(1);
    expect(session.transport).toBeUndefined();
    expect(session.getSessionInfo().state).toBe("idle");
  });

  it("starts a new connect for a connect() made right after it, instead of handing out the one it ended", async () => {
    const { session, made, ready } = factorySession();
    const first = session.connect();
    first.catch(() => {});
    await waitUntil(() => made.length === 1, "the first transport");
    const disconnected = session.disconnect();
    const second = session.connect();

    await expect(first).rejects.toMatchObject({ code: "SESSION_DISCONNECTED" });
    await disconnected;
    await waitUntil(() => made.length === 2, "the second transport");
    ready();
    await expect(second).resolves.toMatchObject({ state: "connected" });
    expect(made.map((transport) => transport.closed)).toEqual([1, 0]);
  });

  it("ends a connect asked for while it runs when disconnect() is called again before that connect starts", async () => {
    const { session, made, ready } = factorySession();
    const first = session.connect();
    await waitUntil(() => made.length === 1, "the first transport");
    ready();
    await first;

    const disconnected = session.disconnect();
    const connecting = session.connect();
    connecting.catch(() => {});
    const again = session.disconnect();

    await expect(connecting).rejects.toMatchObject({ code: "SESSION_DISCONNECTED" });
    expect(await Promise.all([disconnected, again])).toMatchObject([{ state: "idle" }, { state: "idle" }]);
    expect(made).toHaveLength(1);
    expect(made[0]!.closed).toBe(1);
    expect(session.getSessionInfo().state).toBe("idle");
  });

  it("resolves a second disconnect() once the first has closed the transport, so neither leaves a later connect idle", async () => {
    const closed$ = gate();
    const { session, made, ready } = factorySession({ closeTransport: () => closed$.opened });
    const first = session.connect();
    await waitUntil(() => made.length === 1, "the first transport");
    ready();
    await first;

    let secondDone = false;
    const disconnected = session.disconnect();
    const again = session.disconnect().then((info) => {
      secondDone = true;
      return info;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The transport is still closing.
    expect(secondDone).toBe(false);
    const connecting = session.connect();
    closed$.open();

    expect(await Promise.all([disconnected, again])).toMatchObject([{ state: "idle" }, { state: "idle" }]);
    await waitUntil(() => made.length === 2, "the transport of the connect made after them");
    ready();
    await expect(connecting).resolves.toMatchObject({ state: "connected" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session.getSessionInfo().state).toBe("connected");
    expect(made.map((transport) => transport.closed)).toEqual([1, 0]);
  });

  it("closes the transport a connect was replacing when it ends that connect, without waiting for its new one", async () => {
    const made$ = gate();
    let making = false;
    const { session, made, ready } = factorySession({ makeTransport: () => (making ? made$.opened : Promise.resolve()) });
    const first = session.connect();
    await waitUntil(() => made.length === 1, "the first transport");
    ready();
    await first;
    // The relay ended the session; its socket, as far as the session knows, is still open.
    made[0]!.callbacks.onMessage?.({ type: "session.revoked", reason: "CLIENT_REVOKED" });
    making = true;
    const replacing = session.connect();
    replacing.catch(() => {});

    await expect(session.disconnect()).resolves.toMatchObject({ state: "idle" });
    expect(made.map((transport) => transport.closed)).toEqual([1]);
    made$.open();
    await expect(replacing).rejects.toMatchObject({ code: "SESSION_DISCONNECTED" });
    expect(made.map((transport) => transport.closed)).toEqual([1, 1]);
  });

  it.each<[string, boolean]>([
    ["before the connect after it has its own", true],
    ["after the connect after it has its own", false],
  ])("closes the transport a connect it ended gets %s, and only that one", async (_label, endedFirst) => {
    // Each factory call, with the callbacks it was given, makes its transport once its gate opens.
    const calls: Array<{ callbacks: PeerMcpTransportCallbacks; make: () => void; closed: number }> = [];
    const session = new PeerMcpSession({
      requestTimeoutMs: 1_000,
      transportFactory: async (_url: string, _protocols: string[], callbacks: PeerMcpTransportCallbacks) => {
        const made = gate();
        const call = { callbacks, make: made.open, closed: 0 };
        calls.push(call);
        await made.opened;
        return { send: () => {}, close: () => { call.closed += 1; } };
      },
    });
    sessions.push(session);
    const ended = session.connect();
    ended.catch(() => {});
    await waitUntil(() => calls.length === 1, "the first transport being made");
    await session.disconnect();
    const next = session.connect();
    await waitUntil(() => calls.length === 2, "the second transport being made");

    if (endedFirst) {
      calls[0]!.make();
      await expect(ended).rejects.toMatchObject({ code: "SESSION_DISCONNECTED" });
      calls[1]!.make();
    } else {
      calls[1]!.make();
      await waitUntil(() => session.transport !== undefined, "the second transport in use");
      calls[0]!.make();
      await expect(ended).rejects.toMatchObject({ code: "SESSION_DISCONNECTED" });
      expect(calls.map((call) => call.closed)).toEqual([1, 0]);
    }
    await waitUntil(() => session.transport !== undefined, "the second transport in use");
    calls[1]!.callbacks.onMessage?.({ type: "ready", role: "client", roomId: "room1" });
    await expect(next).resolves.toMatchObject({ state: "connected" });
    expect(calls.map((call) => call.closed)).toEqual([1, 0]);
  });

  it.each<[string, readonly [number, number]]>([
    ["the connect it ended gets it first", [0, 1]],
    ["the connect after it gets it first", [1, 0]],
  ])("leaves open a transport a factory hands out again to the connect after it, when %s", async (_label, order) => {
    // Each factory call, with the callbacks it was given, answered with the one transport once its gate opens.
    const calls: Array<{ callbacks: PeerMcpTransportCallbacks; answer: () => void; answered: boolean }> = [];
    let closed = 0;
    const transport = { send: () => {}, close: () => { closed += 1; } };
    const session = new PeerMcpSession({
      requestTimeoutMs: 1_000,
      transportFactory: async (_url: string, _protocols: string[], callbacks: PeerMcpTransportCallbacks) => {
        const answered = gate();
        const call = { callbacks, answer: answered.open, answered: false };
        calls.push(call);
        await answered.opened;
        call.answered = true;
        return transport;
      },
    });
    sessions.push(session);
    const ended = session.connect();
    ended.catch(() => {});
    await waitUntil(() => calls.length === 1, "the first factory call");
    await session.disconnect();
    const next = session.connect();
    await waitUntil(() => calls.length === 2, "the second factory call");

    for (const index of order) calls[index]!.answer();
    await expect(ended).rejects.toMatchObject({ code: "SESSION_DISCONNECTED" });
    await waitUntil(() => calls.every((call) => call.answered), "both factory calls answered");
    calls[1]!.callbacks.onMessage?.({ type: "ready", role: "client", roomId: "room1" });
    await expect(next).resolves.toMatchObject({ state: "connected" });
    expect(session.transport).toBe(transport);
    expect(closed).toBe(0);
  });
});

describe("disconnect() of a session on the caller's own transport", () => {
  it("lets nothing the transport reports while it closes end the session, so the next request connects again", async () => {
    // The relay's last frame arrives as its socket closes.
    const { session, transport } = suppliedTransportSession({ closing: [{ type: "session.revoked", reason: "CLIENT_REVOKED" }] });
    await session.connect();
    expect((await session.request("ping")).result).toEqual({});

    await expect(session.disconnect()).resolves.toMatchObject({ state: "idle", error: null, connectedAt: null });
    expect(transport.closes).toBe(1);
    expect(session.readySeen).toBe(false);

    expect((await session.request("ping")).result).toEqual({});
    expect(transport.connects).toBe(2);
    expect(session.getSessionInfo().state).toBe("connected");
  });

  it.each<[string, readonly [number, number], Record<string, unknown> | undefined]>([
    ["the connect it ended finishes first", [0, 1], undefined],
    ["the connect after it finishes first", [1, 0], undefined],
    ["the connect it ended finishes first, and connect resolves with what to merge into it", [0, 1], { connected: true }],
    ["the connect after it finishes first, and connect resolves with what to merge into it", [1, 0], { connected: true }],
  ])("closes the transport a connect is connecting, and leaves it to the connect after it, when %s", async (_label, order, connected) => {
    const gates: Array<() => void> = [];
    const { session, transport } = suppliedTransportSession({
      connecting: () => new Promise<void>((resolve) => gates.push(resolve)),
      connected,
    });
    const ended = session.connect();
    ended.catch(() => {});
    await waitUntil(() => gates.length === 1, "the first connect of the transport");
    await expect(session.disconnect()).resolves.toMatchObject({ state: "idle" });
    expect(transport.closes).toBe(1);

    const next = session.connect();
    await waitUntil(() => gates.length === 2, "the second connect of the transport");
    for (const index of order) gates[index]!();

    await expect(ended).rejects.toMatchObject({ code: "SESSION_DISCONNECTED" });
    await expect(next).resolves.toMatchObject({ state: "connected" });
    expect((await session.request("ping")).result).toEqual({});
    expect(transport.closes).toBe(1);
    expect(session.getSessionInfo().state).toBe("connected");
  });

  it.each<[string, ReadonlyArray<Record<string, unknown>>]>([
    ["its close", []],
    ["the frame that ended its session, then its close", [{ type: "session.revoked", reason: "CLIENT_REVOKED" }]],
  ])("lets nothing it reports late through an earlier connect's callbacks (%s) end the connect after it", async (_label, closing) => {
    // The close event, and the relay's last frame before it, arrive after close() returned and the
    // next connect has connected the transport again.
    const { session, transport } = suppliedTransportSession({ closing, closeCode: 1005, closeLateMs: 20 });
    await session.connect();
    await session.disconnect();
    await session.connect();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(session.getSessionInfo()).toMatchObject({ state: "connected", error: null });
    expect((await session.request("ping")).result).toEqual({});
    expect(transport.connects).toBe(2);
  });

  it("delivers what reaches the onMessage the session gave it to the connect that holds it, and to nothing after disconnect()", async () => {
    // A transport without connect(callbacks): it delivers through the onMessage the session sets on it
    // once and that it keeps across connects.
    const transport: PeerMcpTransport = {
      send(value) {
        const rpc = (value as { message: { id: string } }).message;
        queueMicrotask(() => transport.onMessage?.({ type: "mcp", message: { jsonrpc: "2.0", id: rpc.id, result: {} } }));
      },
      close() {},
    };
    const session = new PeerMcpSession({ requestTimeoutMs: 1_000, transport });
    sessions.push(session);
    const connect = async () => {
      const connecting = session.connect();
      await waitUntil(() => session.transport === transport, "the session uses the transport");
      transport.onMessage?.({ type: "ready", role: "client", roomId: "room1" });
      await connecting;
    };

    await connect();
    const onMessage = transport.onMessage;
    expect((await session.request("ping")).result).toEqual({});
    await session.disconnect();
    // No connect holds the transport: a frame that would end the session speaks for nothing.
    transport.onMessage?.({ type: "session.revoked", reason: "CLIENT_REVOKED" });
    expect(session.getSessionInfo()).toMatchObject({ state: "idle", error: null });

    await connect();
    expect(transport.onMessage).toBe(onMessage);
    expect((await session.request("ping")).result).toEqual({});
    expect(session.getSessionInfo().state).toBe("connected");
  });

  it("delivers what reaches the onMessage a session gave it to the session that took it last, of every session handed it", async () => {
    // A transport that answers each `ping` through its onMessage, and announces the relay's `ready`
    // when asked: what a PeerMcpService({ transport }) hands every session it makes.
    const transport: PeerMcpTransport = {
      send(value) {
        const rpc = (value as { message: { id: string } }).message;
        queueMicrotask(() => transport.onMessage?.({ type: "mcp", message: { jsonrpc: "2.0", id: rpc.id, result: {} } }));
      },
      close() {},
    };
    const service = new PeerMcpService({ requestTimeoutMs: 1_000, transport });
    const connect = async (key: string) => {
      const connecting = service.connect({ key });
      await waitUntil(() => service.getSession(key)?.transport === transport, `${key} uses the transport`);
      transport.onMessage?.({ type: "ready", role: "client", roomId: "room1" });
      const session = await connecting;
      sessions.push(session);
      return session;
    };

    const first = await connect("first");
    const onMessage = transport.onMessage;
    expect((await first.request("ping")).result).toEqual({});
    await service.disconnect("first");

    // The next session the service makes gets the transport's `ready` and answers, through the
    // same onMessage, instead of timing out while they go to the first one.
    const second = await connect("second");
    expect(transport.onMessage).toBe(onMessage);
    expect((await second.request("ping")).result).toEqual({});

    // While two sessions hold it, the one that took it last does.
    const third = await connect("third");
    expect((await third.request("ping")).result).toEqual({});
    expect(first.getSessionInfo().state).toBe("idle");
  });

  it("lets a connect disconnect() ended take that onMessage from no session, though it finishes after another session took it", async () => {
    // A transport whose first connect runs until it is released, and that reports through the
    // onMessage a session gives it, answering each `ping`.
    const firstConnect = gate();
    let connects = 0;
    const transport: PeerMcpTransport = {
      async connect() {
        connects += 1;
        if (connects === 1) await firstConnect.opened;
      },
      send(value) {
        const rpc = (value as { message: { id: string } }).message;
        queueMicrotask(() => transport.onMessage?.({ type: "mcp", message: { jsonrpc: "2.0", id: rpc.id, result: {} } }));
      },
      close() {},
    };
    const first = new PeerMcpSession({ requestTimeoutMs: 1_000, transport });
    const second = new PeerMcpSession({ requestTimeoutMs: 1_000, transport });
    sessions.push(first, second);

    const ended = first.connect();
    ended.catch(() => {});
    await waitUntil(() => connects === 1, "the first session's connect of the transport");
    await first.disconnect();
    const connecting = second.connect();
    await waitUntil(() => second.transport === transport, "the second session uses the transport");
    transport.onMessage?.({ type: "ready", role: "client", roomId: "room1" });
    await expect(connecting).resolves.toMatchObject({ state: "connected" });

    // The connect disconnect() ended finishes last.
    firstConnect.open();
    await expect(ended).rejects.toMatchObject({ code: "SESSION_DISCONNECTED" });
    expect((await second.request("ping")).result).toEqual({});
    expect(second.getSessionInfo().state).toBe("connected");
    expect(first.getSessionInfo()).toMatchObject({ state: "idle", error: null });
  });

  it.each<[string, boolean]>([
    ["once the other session is connected", true],
    ["while the other session's connect still connects it", false],
  ])("leaves open the transport another session holds when a connect disconnect() ended connects it late, %s", async (_label, otherFirst) => {
    // The caller's own transport, as a PeerMcpService({ transport }) hands every session it makes.
    // close() really closes it: a send then fails, and the close (1000) is reported through the
    // callbacks of the latest connect. Each connect(callbacks) opens it again once its gate opens,
    // and the transport answers each `ping` through the latest connect's callbacks.
    const gates: Array<() => void> = [];
    const transport = {
      closes: 0,
      open: false,
      callbacks: undefined as PeerMcpTransportCallbacks | undefined,
      async connect(callbacks?: PeerMcpTransportCallbacks): Promise<void> {
        transport.callbacks = callbacks;
        await new Promise<void>((resolve) => gates.push(resolve));
        transport.open = true;
        callbacks?.onOpen?.();
        callbacks?.onMessage?.({ type: "ready", role: "client", roomId: "room1" });
      },
      send(value: unknown): void {
        if (!transport.open) throw new Error("transport is closed");
        const rpc = (value as { message: { id: string } }).message;
        const callbacks = transport.callbacks;
        queueMicrotask(() => callbacks?.onMessage?.({ type: "mcp", message: { jsonrpc: "2.0", id: rpc.id, result: {} } }));
      },
      close(): void {
        transport.closes += 1;
        transport.open = false;
        transport.callbacks?.onClose?.({ code: WEBMCP_CLOSE_CODES.NORMAL, reason: "" });
      },
    };
    const first = new PeerMcpSession({ requestTimeoutMs: 1_000, transport });
    const second = new PeerMcpSession({ requestTimeoutMs: 1_000, transport });
    sessions.push(first, second);

    const ended = first.connect();
    ended.catch(() => {});
    await waitUntil(() => gates.length === 1, "the first session's connect of the transport");
    await first.disconnect();
    expect(transport.closes).toBe(1);
    const connecting = second.connect();
    connecting.catch(() => {});
    await waitUntil(() => gates.length === 2, "the second session's connect of the transport");

    // The connect disconnect() ended connects the transport after, or while, the other session does.
    if (otherFirst) {
      gates[1]!();
      await expect(connecting).resolves.toMatchObject({ state: "connected" });
      gates[0]!();
      await expect(ended).rejects.toMatchObject({ code: "SESSION_DISCONNECTED" });
    } else {
      gates[0]!();
      await expect(ended).rejects.toMatchObject({ code: "SESSION_DISCONNECTED" });
      gates[1]!();
      await expect(connecting).resolves.toMatchObject({ state: "connected" });
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(transport.closes).toBe(1);
    expect((await second.request("ping")).result).toEqual({});
    expect(second.getSessionInfo()).toMatchObject({ state: "connected", error: null });
    expect(first.getSessionInfo()).toMatchObject({ state: "idle", error: null });
  });

  it("closes the transport again once a connect it ended has connected it, when no connect uses it", async () => {
    const connected$ = gate();
    const { session, transport } = suppliedTransportSession({ connecting: () => connected$.opened });
    const ended = session.connect();
    ended.catch(() => {});
    await waitUntil(() => transport.connects === 1, "the transport's connect");
    await session.disconnect();
    expect(transport.closes).toBe(1);

    connected$.open();
    await expect(ended).rejects.toMatchObject({ code: "SESSION_DISCONNECTED" });
    expect(transport.closes).toBe(2);
    expect(session.getSessionInfo()).toMatchObject({ state: "idle", error: null, connectedAt: null });
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

describe("the relay's catalog hash", () => {
  const docWrite = { name: "doc_write", description: "Write", inputSchema: { type: "object", properties: {} } };

  /** A session whose raw transport answers each tools/list with the next of `listings`. */
  async function sessionListing(listings: Array<Record<string, unknown>>) {
    let callbacks!: PeerMcpTransportCallbacks;
    const session = new PeerMcpSession({
      requestTimeoutMs: 1000,
      transportFactory: (_url: string, _protocols: string[], transportCallbacks: PeerMcpTransportCallbacks) => {
        callbacks = transportCallbacks;
        queueMicrotask(() => transportCallbacks.onMessage?.({ type: "ready" }));
        return {
          raw: true,
          send(value) {
            const rpc = value as { id: string; method: string };
            const listing = listings.shift();
            if (rpc.method === "tools/list" && listing) queueMicrotask(() => callbacks.onMessage?.({ jsonrpc: "2.0", id: rpc.id, result: listing }));
          },
        };
      },
    });
    sessions.push(session);
    await session.connect();
    return { session, deliver: (frame: Record<string, unknown>) => callbacks.onMessage?.(frame) };
  }

  it("is checked against the tools, so a listing it does not describe is refused and the cached catalog stays", async () => {
    const hash = hashTools([tool]);
    const { session, deliver } = await sessionListing([
      { tools: [tool], _meta: { catalogVersion: 3, catalogHash: hash } },
      // A relay (or a path to it) that changed the tools but not their hash.
      { tools: [tool, docWrite], _meta: { catalogVersion: 4, catalogHash: hash } },
    ]);
    expect((await session.listTools()).map((entry) => entry.name)).toEqual(["doc_read"]);

    const failure = await session.listTools().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PeerMcpError);
    expect(failure).toMatchObject({
      code: "CATALOG_INTEGRITY_UNVERIFIED",
      details: { catalogHash: hash, computedHash: hashTools([tool, docWrite]) },
    });
    expect({ tools: session.cachedTools, version: session.catalogVersion, hash: session.catalogHash }).toEqual({ tools: [tool], version: 3, hash });

    // A catalog announcement whose hash does not match is dropped the same way.
    deliver({ type: "register", tools: [docWrite], catalogVersion: 5, catalogHash: hash });
    expect(session.cachedTools).toEqual([tool]);
    expect(session.getSessionInfo().error).toMatch(/does not match its tools/);
    deliver({ type: "register", tools: [docWrite], catalogVersion: 5, catalogHash: hashTools([docWrite]) });
    expect({ tools: session.cachedTools, version: session.catalogVersion }).toEqual({ tools: [docWrite], version: 5 });
  });
});

describe("the Streamable HTTP transport", () => {
  const ACCEPT = "application/json, text/event-stream";

  /** A relay MCP endpoint that records each POST and answers like the relay. */
  function recordingEndpoint(negotiated: string) {
    const posts: Array<{ method: string; id: unknown; accept?: string; protocolVersion?: string }> = [];
    const fetchImpl = (async (_input: string | URL | Request, init: RequestInit = {}) => {
      const rpc = JSON.parse(String(init.body)) as { id?: string; method: string };
      const headers = (init.headers ?? {}) as Record<string, string>;
      posts.push({ method: rpc.method, id: rpc.id, accept: headers.accept, protocolVersion: headers["mcp-protocol-version"] });
      if (rpc.id === undefined) return new Response(null, { status: 202 });
      if (rpc.method === "initialize") return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: negotiated, _meta: {} } });
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { tools: [tool], _meta: { catalogVersion: 1, catalogHash: hashTools([tool]) } } });
    }) as typeof fetch;
    return { posts, fetchImpl };
  }

  it("accepts JSON and SSE, ends initialize with notifications/initialized, and names the negotiated revision on every later request", async () => {
    const { posts, fetchImpl } = recordingEndpoint("2025-06-18");
    const session = new PeerMcpSession({ mcpEndpoint: "http://relay.test/p/room1/mcp", clientToken: "tok", protocolVersion: "2025-06-18", fetchImpl });
    sessions.push(session);

    await session.initialize();
    await session.listTools();
    expect(posts).toEqual([
      { method: "initialize", id: expect.any(String), accept: ACCEPT, protocolVersion: undefined },
      { method: "notifications/initialized", id: undefined, accept: ACCEPT, protocolVersion: "2025-06-18" },
      { method: "tools/list", id: expect.any(String), accept: ACCEPT, protocolVersion: "2025-06-18" },
    ]);

    // A session that connects again starts uninitialized.
    await session.disconnect();
    await session.listTools();
    expect(posts.at(-1)).toMatchObject({ method: "tools/list", protocolVersion: undefined });
  });

  it("is served by the relay with the revision it negotiated", async () => {
    const server = createWebMcpPeerServer({ port: 0, host: "127.0.0.1", roomSweepIntervalMs: 0, deploymentCatalog: { tools: [tool] } });
    servers.push(server);
    const serverUrl = `http://127.0.0.1:${await server.listen()}`;
    const created = await fetch(`${serverUrl}/p`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approvalRequired: false }) });
    const room = (await created.json()) as { id: string; inviteToken: string };
    const joined = await joinPeerRoom({ serverUrl, roomId: room.id, inviteToken: room.inviteToken });
    const session = new PeerMcpSession({ mcpEndpoint: joined.mcpEndpoint, clientToken: joined.clientToken, protocolVersion: "2024-11-05" });
    sessions.push(session);

    expect(await session.initialize()).toMatchObject({ protocolVersion: "2024-11-05" });
    expect((await session.listTools()).map((entry) => entry.name)).toEqual(["doc_read"]);
  });

  it("names the package's own version as clientInfo.version and in its user-agent", async () => {
    const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    const sent: Array<{ method: string; userAgent?: string; clientInfo?: unknown }> = [];
    const fetchImpl = (async (_input: string | URL | Request, init: RequestInit = {}) => {
      const rpc = JSON.parse(String(init.body)) as { id?: string; method: string; params?: { clientInfo?: unknown } };
      sent.push({ method: rpc.method, userAgent: (init.headers as Record<string, string>)["user-agent"], clientInfo: rpc.params?.clientInfo });
      if (rpc.id === undefined) return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-11-25", _meta: {} } });
    }) as typeof fetch;
    const session = new PeerMcpSession({ mcpEndpoint: "http://relay.test/p/room1/mcp", clientToken: "tok", fetchImpl });
    sessions.push(session);

    await session.initialize();
    expect(sent).toEqual([
      { method: "initialize", userAgent: `framebook-peer-mcp-client/${version}`, clientInfo: { name: "framebook-cli", version } },
      { method: "notifications/initialized", userAgent: `framebook-peer-mcp-client/${version}`, clientInfo: undefined },
    ]);
  });

  it("reads a response the server sends as an event stream", async () => {
    const fetchImpl = (async (_input: string | URL | Request, init: RequestInit = {}) => {
      const rpc = JSON.parse(String(init.body)) as { id: string };
      const reply = JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { tools: [tool] } });
      const body = `event: message\nid: 1\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\nevent: message\ndata: ${reply}\n\n`;
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const session = new PeerMcpSession({ mcpEndpoint: "http://relay.test/p/room1/mcp", clientToken: "tok", fetchImpl, requestTimeoutMs: 1000 });
    sessions.push(session);
    expect((await session.listTools()).map((entry) => entry.name)).toEqual(["doc_read"]);
  });
});
