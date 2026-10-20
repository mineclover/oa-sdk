// Regression tests for how the relay answers a WebSocket upgrade, closes the sockets it holds and
// notices the ones that went away (relay protocol spec 2.1, 2.4, R-WS-038):
//   - every refused upgrade gets an HTTP response with Content-Length and Connection: close, never
//     a bare reset: the opening handshake is checked first (400 BAD_UPGRADE, 426 for another
//     version), then the webmcp-peer.v1 subprotocol (400 SUBPROTOCOL_REQUIRED), the path (404
//     NOT_FOUND), the room (404 ROOM_NOT_FOUND, 410 ROOM_ROTATED, 410 ROOM_EXPIRED, as the lifecycle
//     routes answer) and the ticket (401 with a Bearer challenge, or the status an MCP POST of the
//     same client token gets);
//   - the close codes say why a socket was closed: 4002 ROOM_EXPIRED for a provider whose room
//     expired, and 1001 for a socket the relay stopped hearing from;
//   - the relay pings every socket and closes one that answers nothing for the idle timeout, which
//     a browser or Node WebSocket never hits since it answers pings on its own.
// A raw node:net client writes each upgrade request by hand and reads the whole response.
import { randomBytes } from "node:crypto";
import { connect, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WEBMCP_CLOSE_CODES, WEBMCP_SUBPROTOCOL } from "../src/config.js";
import { createWebMcpPeerServer, type WebMcpPeerServer } from "../src/server.js";
import {
  RawPeer,
  createRoom,
  joinRoom,
  openProvider,
  postJson,
  startRelay,
  until,
  type Relay,
  type RoomDescriptor,
} from "./server-test-helpers.js";

const servers: WebMcpPeerServer[] = [];
const sockets: WebSocket[] = [];
const peers: RawPeer[] = [];
const rawSockets: Socket[] = [];

afterEach(async () => {
  for (const socket of rawSockets.splice(0)) socket.destroy();
  for (const peer of peers.splice(0)) peer.destroy();
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
});

interface UpgradeAnswer {
  status: number;
  /** Header names lowercased. */
  headers: Record<string, string>;
  body: unknown;
  /** Every byte the relay sent, as latin1. */
  raw: string;
}

interface UpgradeRequest {
  method?: string;
  version?: string;
  /** The `Sec-WebSocket-Protocol` values; `null` sends no header. */
  protocols?: string[] | null;
  /** Header lines replacing (by name, case-insensitively) or, with `undefined`, removing the defaults. */
  headers?: Record<string, string | undefined>;
}

/**
 * Sends an upgrade request for `path` and resolves with the relay's whole answer once it closed the
 * connection: a refusal is a complete HTTP response, and the connection ends after it.
 */
function upgrade(relay: Relay, path: string, request: UpgradeRequest = {}): Promise<UpgradeAnswer> {
  const url = new URL(relay.base);
  const fields: Record<string, string | undefined> = {
    Host: url.host,
    Upgrade: "websocket",
    Connection: "Upgrade",
    "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
    "Sec-WebSocket-Version": "13",
    ...(request.protocols === null ? {} : { "Sec-WebSocket-Protocol": (request.protocols ?? [WEBMCP_SUBPROTOCOL]).join(", ") }),
  };
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    const existing = Object.keys(fields).find((field) => field.toLowerCase() === name.toLowerCase());
    if (existing) delete fields[existing];
    if (value !== undefined) fields[name] = value;
  }
  const socket = connect({ port: Number(url.port), host: url.hostname });
  rawSockets.push(socket);
  socket.on("error", () => {});
  const received: Buffer[] = [];
  socket.on("data", (chunk: Buffer) => received.push(chunk));
  socket.once("connect", () => {
    socket.write(
      `${request.method ?? "GET"} ${path} HTTP/${request.version ?? "1.1"}\r\n`
        + Object.entries(fields).filter(([, value]) => value !== undefined).map(([name, value]) => `${name}: ${value}\r\n`).join("")
        + "\r\n",
    );
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no complete answer to the upgrade of ${path}`)), 5_000);
    socket.once("close", () => {
      clearTimeout(timer);
      const bytes = Buffer.concat(received);
      const end = bytes.indexOf("\r\n\r\n");
      if (end < 0) {
        reject(new Error(`the relay closed the upgrade of ${path} without a response`));
        return;
      }
      const [statusLine, ...lines] = bytes.subarray(0, end).toString("latin1").split("\r\n");
      const headers = Object.fromEntries(lines.map((line) => {
        const colon = line.indexOf(":");
        return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
      }));
      const body = bytes.subarray(end + 4);
      // The Content-Length is the body's, so the client knows it has the whole response.
      expect(body.length).toBe(Number(headers["content-length"]));
      resolve({
        status: Number(statusLine!.split(" ")[1]),
        headers,
        body: JSON.parse(body.toString("utf8")),
        raw: bytes.toString("latin1"),
      });
    });
  });
}

/** The refusal of a status and body, the way every refused upgrade answers. */
function refusal(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return {
    status,
    headers: expect.objectContaining({ "content-type": "application/json", connection: "close", "cache-control": "no-store", ...headers }),
    body,
  };
}

const answerOf = ({ status, headers, body }: UpgradeAnswer) => ({ status, headers, body });

describe("refused upgrades", () => {
  it.each<[string, UpgradeRequest, number, Record<string, unknown>, Record<string, string>]>([
    ["a POST", { method: "POST" }, 400, { error: "BAD_UPGRADE" }, {}],
    ["an Upgrade that does not name websocket", { headers: { Upgrade: "h2c" } }, 400, { error: "BAD_UPGRADE" }, {}],
    ["a Sec-WebSocket-Key that is not 16 bytes of base64", { headers: { "Sec-WebSocket-Key": "c2hvcnQ=" } }, 400, { error: "BAD_UPGRADE" }, {}],
    ["no Sec-WebSocket-Key", { headers: { "Sec-WebSocket-Key": undefined } }, 400, { error: "BAD_UPGRADE" }, {}],
    ["WebSocket version 8", { headers: { "Sec-WebSocket-Version": "8" } }, 426, { error: "UNSUPPORTED_WEBSOCKET_VERSION" }, { "sec-websocket-version": "13", upgrade: "websocket", connection: "Upgrade, close" }],
    ["no webmcp-peer.v1 subprotocol", { protocols: ["ticket.secret-token"] }, 400, { error: "SUBPROTOCOL_REQUIRED" }, {}],
    ["an unknown subprotocol only", { protocols: ["chat.v2"] }, 400, { error: "SUBPROTOCOL_REQUIRED" }, {}],
    ["no subprotocol", { protocols: null }, 400, { error: "SUBPROTOCOL_REQUIRED" }, {}],
  ])("answers %s with an HTTP response before looking at the path, the room or the ticket", async (_label, request, status, body, headers) => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base);

    // The same answer for a live room's socket, a room that does not exist and no socket path at all.
    for (const path of [`/p/${room.id}/provider`, `/p/${"0".repeat(32)}/client`, "/elsewhere"]) {
      const answer = await upgrade(relay, path, request);
      expect(answerOf(answer), path).toEqual(refusal(status, body, headers));
      expect(answer.headers).not.toHaveProperty("sec-websocket-protocol");
      // A ticket the request offered never comes back.
      expect(answer.raw).not.toContain("secret-token");
    }
    expect(relay.server.rooms.get(room.id)?.providerSocket).toBeUndefined();
  });

  it("answers a path that is not a socket endpoint with 404 NOT_FOUND", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base);
    for (const path of [`/p/${room.id}/other`, "/p/not.an.id/client", `/p/${"a".repeat(129)}/provider`, "/"]) {
      expect(answerOf(await upgrade(relay, path, { protocols: [WEBMCP_SUBPROTOCOL, `ticket.${room.providerToken}`] })), path)
        .toEqual(refusal(404, { error: "NOT_FOUND" }));
    }
  });

  it("answers an upgrade to a room that is gone, rotated or expired as the lifecycle routes do", async () => {
    const relay = await startRelay(servers);
    const offer = (token: string) => ({ protocols: [WEBMCP_SUBPROTOCOL, `ticket.${token}`] });

    const gone = await createRoom(relay.base);
    const goneJoined = await joinRoom(relay.base, gone);
    relay.server.rooms.delete(gone.id);
    const notFound = refusal(404, { error: "ROOM_NOT_FOUND", code: -32004 });
    expect(answerOf(await upgrade(relay, `/p/${gone.id}/provider`, offer(gone.providerToken)))).toEqual(notFound);
    expect(answerOf(await upgrade(relay, `/p/${gone.id}/client`, offer(goneJoined.clientToken)))).toEqual(notFound);

    const rotatedRoom = await createRoom(relay.base);
    const rotatedJoined = await joinRoom(relay.base, rotatedRoom);
    const rotate = await postJson(`${relay.base}/p/${rotatedRoom.id}/rotate`, {}, { authorization: `Bearer ${rotatedRoom.providerToken}` });
    const replacement = (await rotate.json()) as RoomDescriptor;
    const rotated = refusal(410, { error: "ROOM_ROTATED", code: -32057, roomId: rotatedRoom.id, roomEpoch: 1, replacementRoomId: replacement.id });
    expect(answerOf(await upgrade(relay, `/p/${rotatedRoom.id}/provider`, offer(rotatedRoom.providerToken)))).toEqual(rotated);
    expect(answerOf(await upgrade(relay, `/p/${rotatedRoom.id}/client`, offer(rotatedJoined.clientToken)))).toEqual(rotated);

    const expiredRoom = await createRoom(relay.base);
    const expiredJoined = await joinRoom(relay.base, expiredRoom);
    relay.server.rooms.get(expiredRoom.id)!.expiresAt = Date.now() - 1;
    const expired = refusal(410, { error: "ROOM_EXPIRED", code: -32056, roomId: expiredRoom.id, roomEpoch: 1 });
    expect(answerOf(await upgrade(relay, `/p/${expiredRoom.id}/client`, offer(expiredJoined.clientToken)))).toEqual(expired);
    // The upgrade that found the room expired carried out its expiry, as the lifecycle routes do.
    expect(relay.server.rooms.get(expiredRoom.id)?.roomState).toBe("expired");
    expect(answerOf(await upgrade(relay, `/p/${expiredRoom.id}/provider`, offer(expiredRoom.providerToken)))).toEqual(expired);
  });

  it("tells a missing provider token from a wrong one, with a Bearer challenge", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base);
    const path = `/p/${room.id}/provider`;

    expect(answerOf(await upgrade(relay, path))).toEqual(
      refusal(401, { error: "PROVIDER_TOKEN_REQUIRED" }, { "www-authenticate": "Bearer" }),
    );
    expect(answerOf(await upgrade(relay, path, { protocols: [WEBMCP_SUBPROTOCOL, "ticket."] }))).toEqual(
      refusal(401, { error: "PROVIDER_TOKEN_REQUIRED" }, { "www-authenticate": "Bearer" }),
    );
    expect(answerOf(await upgrade(relay, path, { protocols: [WEBMCP_SUBPROTOCOL, `ticket.${room.inviteToken}`] }))).toEqual(
      refusal(401, { error: "PROVIDER_TOKEN_INVALID" }, { "www-authenticate": 'Bearer error="invalid_token"' }),
    );
  });

  it("refuses a client ticket with the status and name an MCP POST of the same token gets", async () => {
    const relay = await startRelay(servers);
    const answers = async (room: RoomDescriptor, token: string | undefined) => {
      const upgraded = await upgrade(relay, `/p/${room.id}/client`, { protocols: token === undefined ? [WEBMCP_SUBPROTOCOL] : [WEBMCP_SUBPROTOCOL, `ticket.${token}`] });
      const posted = await postJson(
        `${relay.base}/p/${room.id}/mcp`,
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read", arguments: {} } },
        token === undefined ? {} : { authorization: `Bearer ${token}` },
      );
      const rpc = (await posted.json()) as { error: { code: number; message: string } };
      return { upgraded: answerOf(upgraded), posted: { status: posted.status, error: rpc.error.message, code: rpc.error.code } };
    };

    const open = await createRoom(relay.base, { approvalRequired: false });
    const required = await answers(open, undefined);
    expect(required.upgraded).toEqual(refusal(401, { error: "CLIENT_TOKEN_REQUIRED", code: -32003 }, { "www-authenticate": "Bearer" }));
    expect(required.posted).toEqual({ status: 401, error: "CLIENT_TOKEN_REQUIRED", code: -32003 });
    const invalid = await answers(open, open.providerToken);
    expect(invalid.upgraded).toEqual(refusal(401, { error: "CLIENT_TOKEN_INVALID", code: -32003 }, { "www-authenticate": 'Bearer error="invalid_token"' }));
    expect(invalid.posted).toEqual({ status: 401, error: "CLIENT_TOKEN_INVALID", code: -32003 });

    const revokedRoom = await createRoom(relay.base, { approvalRequired: false });
    const revoked = await joinRoom(relay.base, revokedRoom);
    expect((await postJson(`${relay.base}/p/${revokedRoom.id}/session/revoke`, {}, { authorization: `Bearer ${revoked.clientToken}` })).status).toBe(200);
    const revokedAnswers = await answers(revokedRoom, revoked.clientToken);
    expect(revokedAnswers.upgraded).toEqual(refusal(401, { error: "SESSION_INVALID", code: -32001 }, { "www-authenticate": 'Bearer error="invalid_token"' }));
    expect(revokedAnswers.posted).toEqual({ status: 401, error: "SESSION_INVALID", code: -32001 });

    const rejectedRoom = await createRoom(relay.base, { approvalRequired: true });
    const rejected = await joinRoom(relay.base, rejectedRoom);
    const decided = await postJson(
      `${relay.base}/p/${rejectedRoom.id}/approval/${rejected.approvalRequestId}`,
      { decision: "rejected", sessionId: rejected.sessionId },
      { authorization: `Bearer ${rejectedRoom.providerToken}` },
    );
    expect(decided.status).toBe(200);
    const rejectedAnswers = await answers(rejectedRoom, rejected.clientToken);
    expect(rejectedAnswers.upgraded).toEqual(refusal(403, { error: "CLIENT_APPROVAL_DENIED", code: -32054 }));
    expect(rejectedAnswers.upgraded.headers).not.toHaveProperty("www-authenticate");
    expect(rejectedAnswers.posted).toEqual({ status: 403, error: "CLIENT_APPROVAL_DENIED", code: -32054 });
  });

  it("selects webmcp-peer.v1 for an upgrade it takes, whatever else the request offers", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base);
    const peer = await RawPeer.open(relay, `/p/${room.id}/provider`, room.providerToken, peers);
    expect(peer.handshake).toMatch(/^HTTP\/1\.1 101 /);
    expect(peer.handshake.split("\r\n").filter((line) => /^sec-websocket-protocol:/i.test(line))).toEqual([`Sec-WebSocket-Protocol: ${WEBMCP_SUBPROTOCOL}`]);
    expect(peer.handshake).not.toContain(room.providerToken);
  });
});

describe("close codes", () => {
  it("closes the provider socket of a room that expires with 4002 ROOM_EXPIRED, and an agent's with 1000 after room.expired", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const joined = await joinRoom(relay.base, room);
    const provider = await RawPeer.open(relay, `/p/${room.id}/provider`, room.providerToken, peers);
    const agent = await RawPeer.open(relay, `/p/${room.id}/client`, joined.clientToken, peers);

    relay.server.rooms.get(room.id)!.expiresAt = Date.now() - 1;
    // Any HTTP request sweeps the expired room.
    await fetch(`${relay.base}/status`);

    await until(() => provider.closeCode, (code) => code !== undefined, "provider closed");
    expect(provider.closeCode).toBe(WEBMCP_CLOSE_CODES.ROOM_EXPIRED);
    // The provider is told by the code alone, the agent by the frame before its close.
    expect(provider.messages.map((message) => message.type)).toEqual(["ready"]);
    await until(() => agent.closeCode, (code) => code !== undefined, "agent closed");
    expect(agent.closeCode).toBe(WEBMCP_CLOSE_CODES.NORMAL);
    expect(agent.messages.map((message) => message.type)).toEqual(["ready", "room.expired"]);
  });
});

describe("liveness", () => {
  it("pings every socket and closes one it stops hearing from with 1001, detaching the provider", async () => {
    const relay = await startRelay(servers, { webSocketPingIntervalMs: 100, webSocketIdleTimeoutMs: 1_000 });
    const room = await createRoom(relay.base, { approvalRequired: false });
    const joined = await joinRoom(relay.base, room);
    // A raw peer that reads pings and never answers them: a peer that went away without a FIN.
    const silent = await RawPeer.open(relay, `/p/${room.id}/provider`, room.providerToken, peers);
    const started = Date.now();
    await until(() => silent.pings, (count) => count >= 2, "pings to the silent provider");

    await until(() => silent.closeCode, (code) => code !== undefined, "silent provider closed", 5_000);
    expect(silent.closeCode).toBe(WEBMCP_CLOSE_CODES.GOING_AWAY);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    await until(() => relay.server.rooms.get(room.id)!.providerSocket, (socket) => socket === undefined, "provider detached");
    const call = await postJson(
      `${relay.base}/p/${room.id}/mcp`,
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read", arguments: {} } },
      { authorization: `Bearer ${joined.clientToken}` },
    );
    expect(((await call.json()) as { error?: { message: string } }).error?.message).toBe("PROVIDER_UNAVAILABLE");
  });

  it("keeps a WebSocket that answers its pings on its own open past the idle timeout", async () => {
    const relay = await startRelay(servers, { webSocketPingIntervalMs: 100, webSocketIdleTimeoutMs: 1_000 });
    const room = await createRoom(relay.base, { approvalRequired: false });
    const provider = await openProvider(relay, room, sockets);
    let closed = false;
    provider.ws.addEventListener("close", () => {
      closed = true;
    });

    // Its application sends nothing for three idle timeouts; only its automatic pongs reach the relay.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(closed).toBe(false);
    expect(relay.server.rooms.get(room.id)!.providerSocket).toBeDefined();
  });

  it.each<[string, Record<string, number>]>([
    ["a ping interval of 0", { webSocketPingIntervalMs: 0 }],
    ["an infinite idle timeout", { webSocketIdleTimeoutMs: Infinity }],
    ["an idle timeout no longer than the ping interval", { webSocketPingIntervalMs: 5_000, webSocketIdleTimeoutMs: 5_000 }],
  ])("refuses %s when constructed", (_label, options) => {
    expect(() => createWebMcpPeerServer({ port: 0, host: "127.0.0.1", roomSweepIntervalMs: 0, ...options })).toThrow(RangeError);
  });
});
