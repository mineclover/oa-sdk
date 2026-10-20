// Regression tests for the relay's error model: one code per error name on every route and
// transport, how a refused credential is reported, what a rotated room and a rotate binding
// mismatch answer, and a malformed path parameter.
import { afterEach, describe, expect, it } from "vitest";
import type { WebMcpPeerServer } from "../src/server.js";
import {
  createRoom,
  joinRoom,
  openClient,
  postJson,
  startRelay,
  type RoomDescriptor,
} from "./server-test-helpers.js";

const servers: WebMcpPeerServer[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
});

/** A response's status, `WWW-Authenticate` header and JSON body. */
async function reply(response: Response): Promise<{ status: number; challenge: string | null; body: Record<string, unknown> }> {
  return { status: response.status, challenge: response.headers.get("www-authenticate"), body: (await response.json()) as Record<string, unknown> };
}

const toolsCall = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "read", arguments: {} } });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("one code per error name", () => {
  it("puts the code of an error's JSON-RPC namesake in its lifecycle body", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const unknown = "Room_Unknown-1";
    expect(await reply(await postJson(`${relay.base}/p/${unknown}/join`, { inviteToken: "invite" }))).toMatchObject({
      status: 404,
      body: { error: "ROOM_NOT_FOUND", code: -32004 },
    });
    const mcp = await reply(await postJson(`${relay.base}/p/${unknown}/mcp`, toolsCall(1)));
    expect(mcp).toMatchObject({ status: 404, body: { error: { code: -32004, message: "ROOM_NOT_FOUND" } } });

    const room = await createRoom(relay.base, { approvalRequired: false });
    expect(await reply(await fetch(`${relay.base}/p/${room.id}/sessions/peer-session-x`))).toMatchObject({
      status: 401,
      body: { error: "CLIENT_TOKEN_REQUIRED", code: -32003 },
    });
    expect(await reply(await fetch(`${relay.base}/p/${room.id}/mcp/tools`))).toMatchObject({
      status: 503,
      body: { error: "CATALOG_UNAVAILABLE", code: -32090, catalogVersion: 0 },
    });
    expect(await reply(await fetch(`${relay.base}/mcp/catalog`))).toMatchObject({
      status: 503,
      body: { error: "CATALOG_UNAVAILABLE", code: -32090 },
    });

    const entry = relay.server.rooms.get(room.id)!;
    entry.expiresAt = Date.now() - 1;
    const reclaim = await postJson(`${relay.base}/p/${room.id}/reclaim`, { leaseToken: entry.reconnectLeaseToken });
    expect(await reply(reclaim)).toMatchObject({ status: 410, body: { error: "ROOM_EXPIRED", code: -32056, roomId: room.id } });
  });

  it("gives an unapproved ticket's error the same data over HTTP and WebSocket", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: true });
    const joined = await joinRoom(relay.base, room);
    const expected = {
      code: -32053,
      message: "CLIENT_APPROVAL_REQUIRED",
      data: { roomId: room.id, sessionId: joined.sessionId, approvalRequestId: joined.approvalRequestId, approvalRequired: true },
    };

    const http = await reply(await postJson(`${relay.base}/p/${room.id}/mcp`, toolsCall(1), bearer(joined.clientToken)));
    expect(http).toMatchObject({ status: 403, body: { id: 1, error: expected } });

    const agent = await openClient(relay, room, joined, sockets);
    agent.send({ type: "mcp", message: toolsCall(2) });
    const answer = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === 2, "ticket error");
    expect(answer.message.error).toEqual(expected);
  });

  it("refuses a client revoke naming another session with SESSION_NOT_OWNED, not a binding error", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const joined = await joinRoom(relay.base, room);
    const binding = { roomId: room.id, roomEpoch: room.roomEpoch };

    const other = await postJson(`${relay.base}/p/${room.id}/session/revoke`, { ...binding, sessionId: "peer-session-other" }, bearer(joined.clientToken));
    expect(await reply(other)).toMatchObject({ status: 403, body: { error: "SESSION_NOT_OWNED" } });
    const stale = await postJson(`${relay.base}/p/${room.id}/session/revoke`, { roomId: room.id, roomEpoch: room.roomEpoch + 1 }, bearer(joined.clientToken));
    expect(await reply(stale)).toMatchObject({ status: 409, body: { error: "SESSION_BINDING_INVALID", code: -32002 } });
    expect([...relay.server.rooms.get(room.id)!.clientTickets.values()].map((ticket) => ticket.status)).toEqual(["approved"]);
  });
});

describe("credential errors", () => {
  it("tells a missing Authorization credential from a wrong one, with a Bearer challenge", async () => {
    const relay = await startRelay(servers, { publishKey: "publish-secret" });
    const missing = { challenge: "Bearer" };
    const wrong = { challenge: 'Bearer error="invalid_token"' };

    expect(await reply(await postJson(`${relay.base}/p`, {}))).toMatchObject({ status: 401, ...missing, body: { error: "PUBLISH_KEY_REQUIRED" } });
    expect(await reply(await postJson(`${relay.base}/p`, {}, bearer("guess")))).toMatchObject({ status: 401, ...wrong, body: { error: "PUBLISH_KEY_INVALID" } });

    const room = await createRoom(relay.base, { approvalRequired: true }, bearer("publish-secret"));
    const joined = await joinRoom(relay.base, room);
    const decision = { sessionId: joined.sessionId, roomId: room.id, roomEpoch: room.roomEpoch, decision: "approved" };
    const approval = (headers: Record<string, string>) => postJson(`${relay.base}/p/${room.id}/approval/${joined.approvalRequestId}`, decision, headers);
    expect(await reply(await approval({}))).toMatchObject({ status: 401, ...missing, body: { error: "PROVIDER_TOKEN_REQUIRED" } });
    expect(await reply(await approval(bearer(joined.clientToken)))).toMatchObject({ status: 401, ...wrong, body: { error: "PROVIDER_TOKEN_INVALID" } });
    const rotate = (headers: Record<string, string>) => postJson(`${relay.base}/p/${room.id}/rotate`, {}, headers);
    expect(await reply(await rotate({}))).toMatchObject({ status: 401, ...missing, body: { error: "PROVIDER_TOKEN_REQUIRED" } });
    expect(await reply(await rotate(bearer("guess")))).toMatchObject({ status: 401, ...wrong, body: { error: "PROVIDER_TOKEN_INVALID" } });

    const status = (headers: Record<string, string>) => fetch(`${relay.base}/p/${room.id}/sessions/${joined.sessionId}`, { headers });
    expect(await reply(await status({}))).toMatchObject({ status: 401, ...missing, body: { error: "CLIENT_TOKEN_REQUIRED", code: -32003 } });
    expect(await reply(await status(bearer("guess")))).toMatchObject({ status: 401, ...wrong, body: { error: "CLIENT_TOKEN_INVALID", code: -32003 } });
    const revoke = (headers: Record<string, string>) => postJson(`${relay.base}/p/${room.id}/session/revoke`, { roomId: room.id, roomEpoch: room.roomEpoch }, headers);
    expect(await reply(await revoke({}))).toMatchObject({ status: 401, ...missing, body: { error: "CLIENT_TOKEN_REQUIRED", code: -32003 } });
    expect(await reply(await revoke(bearer("guess")))).toMatchObject({ status: 401, ...wrong, body: { error: "CLIENT_TOKEN_INVALID", code: -32003 } });

    const mcp = (headers: Record<string, string>) => postJson(`${relay.base}/p/${room.id}/mcp`, toolsCall(1), headers);
    expect(await reply(await mcp({}))).toMatchObject({
      status: 401,
      ...missing,
      body: { error: { code: -32003, message: "CLIENT_TOKEN_REQUIRED", data: { roomId: room.id, sessionId: null, approvalRequestId: null } } },
    });
    expect(await reply(await mcp(bearer("guess")))).toMatchObject({ status: 401, ...wrong, body: { error: { code: -32003, message: "CLIENT_TOKEN_INVALID" } } });
    expect((await revoke(bearer(joined.clientToken))).status).toBe(200);
    expect(await reply(await mcp(bearer(joined.clientToken)))).toMatchObject({ status: 401, ...wrong, body: { error: { code: -32001, message: "SESSION_INVALID" } } });
  });

  it("answers a missing body credential with 400 and a wrong one with 403, without a challenge", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base);
    const entry = relay.server.rooms.get(room.id)!;
    const binding = { roomId: room.id, roomEpoch: room.roomEpoch };
    const refusals = [
      [await postJson(`${relay.base}/p/${room.id}/join`, {}), 400, "INVITE_TOKEN_REQUIRED"],
      [await postJson(`${relay.base}/p/${room.id}/join`, { inviteToken: "guess" }), 403, "INVITE_TOKEN_INVALID"],
      [await postJson(`${relay.base}/p/${room.id}/reclaim`, binding), 400, "ROOM_LEASE_REQUIRED"],
      [await postJson(`${relay.base}/p/${room.id}/reclaim`, { ...binding, leaseToken: "guess" }), 403, "ROOM_LEASE_INVALID"],
    ] as const;
    for (const [response, status, error] of refusals) {
      expect(await reply(response), error).toEqual({ status, challenge: null, body: { error } });
    }
    // Neither refusal used the invite or the lease.
    expect((await joinRoom(relay.base, room)).sessionId).toMatch(/^peer-session-/);
    expect((await postJson(`${relay.base}/p/${room.id}/reclaim`, { ...binding, leaseToken: entry.reconnectLeaseToken })).status).toBe(200);
  });

  it("tells only the right invite that it was already used", async () => {
    const relay = await startRelay(servers);
    const room: RoomDescriptor = await createRoom(relay.base);
    await joinRoom(relay.base, room);
    expect(await reply(await postJson(`${relay.base}/p/${room.id}/join`, { inviteToken: "guess" }))).toMatchObject({ status: 403, body: { error: "INVITE_TOKEN_INVALID" } });
    expect(await reply(await postJson(`${relay.base}/p/${room.id}/join`, { inviteToken: room.inviteToken }))).toMatchObject({ status: 409, body: { error: "INVITE_TOKEN_CONSUMED" } });
  });

  it("lets a client token read the status of its own session only", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const joined = await joinRoom(relay.base, room);
    const status = (sessionId: string, token: string) => fetch(`${relay.base}/p/${room.id}/sessions/${sessionId}`, { headers: bearer(token) });

    expect((await status(joined.sessionId, joined.clientToken)).status).toBe(200);
    expect(await reply(await status("peer-session-other", joined.clientToken))).toMatchObject({ status: 403, challenge: null, body: { error: "SESSION_NOT_OWNED" } });
    expect(await reply(await status("peer-session-other", room.providerToken))).toMatchObject({ status: 404, body: { error: "SESSION_NOT_FOUND" } });
  });
});

describe("rotated rooms and the rotate binding", () => {
  it("answers every lifecycle route of a rotated room with 410 ROOM_ROTATED and its replacement", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: true });
    const joined = await joinRoom(relay.base, room);
    const leaseToken = relay.server.rooms.get(room.id)!.reconnectLeaseToken;
    const binding = { roomId: room.id, roomEpoch: room.roomEpoch };
    const rotated = await postJson(`${relay.base}/p/${room.id}/rotate`, binding, bearer(room.providerToken));
    expect(rotated.status).toBe(201);
    const replacementRoomId = ((await rotated.json()) as { replacementRoomId: string }).replacementRoomId;

    const expected = { status: 410, body: { error: "ROOM_ROTATED", code: -32057, roomId: room.id, roomEpoch: room.roomEpoch, replacementRoomId } };
    const routes: Array<[string, () => Promise<Response>]> = [
      ["approval", () => postJson(`${relay.base}/p/${room.id}/approval/${joined.approvalRequestId}`, { ...binding, sessionId: joined.sessionId, decision: "approved" }, bearer(room.providerToken))],
      ["revoke", () => postJson(`${relay.base}/p/${room.id}/session/revoke`, binding, bearer(room.providerToken))],
      ["session revoke", () => postJson(`${relay.base}/p/${room.id}/sessions/${joined.sessionId}/revoke`, binding, bearer(joined.clientToken))],
      ["rotate", () => postJson(`${relay.base}/p/${room.id}/rotate`, binding, bearer(room.providerToken))],
      ["join", () => postJson(`${relay.base}/p/${room.id}/join`, { inviteToken: room.inviteToken })],
      ["session status", () => fetch(`${relay.base}/p/${room.id}/sessions/${joined.sessionId}`, { headers: bearer(joined.clientToken) })],
      ["reclaim", () => postJson(`${relay.base}/p/${room.id}/reclaim`, { ...binding, leaseToken })],
    ];
    for (const [label, request] of routes) {
      const { status, body } = await reply(await request());
      expect({ status, body }, label).toEqual(expected);
    }
    // The second rotation minted no other replacement.
    expect([...relay.server.rooms.values()].filter((entry) => entry.roomEpoch === room.roomEpoch + 1)).toHaveLength(1);
  });

  it("refuses a rotate whose body names another room or epoch with ROOM_BINDING_INVALID", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base);
    for (const body of [{ roomId: "another-room" }, { roomEpoch: room.roomEpoch + 1 }]) {
      const response = await postJson(`${relay.base}/p/${room.id}/rotate`, body, bearer(room.providerToken));
      expect(await reply(response), JSON.stringify(body)).toEqual({
        status: 409,
        challenge: null,
        body: { error: "ROOM_BINDING_INVALID", code: -32002, roomId: room.id, roomEpoch: room.roomEpoch },
      });
    }
    expect(relay.server.rooms.get(room.id)!.rotatedTo).toBeUndefined();
  });
});

describe("path parameters", () => {
  it("answers a malformed percent-encoding with 400 INVALID_PATH instead of failing the request", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const joined = await joinRoom(relay.base, room);
    const binding = { roomId: room.id, roomEpoch: room.roomEpoch };
    const requests: Array<[string, () => Promise<Response>]> = [
      ["approval", () => postJson(`${relay.base}/p/${room.id}/approval/%E0`, {}, bearer(room.providerToken))],
      ["session status", () => fetch(`${relay.base}/p/${room.id}/sessions/%E0`, { headers: bearer(joined.clientToken) })],
      ["session revoke", () => postJson(`${relay.base}/p/${room.id}/sessions/%E0%A4/revoke`, binding, bearer(room.providerToken))],
    ];
    for (const [label, request] of requests) {
      expect(await reply(await request()), label).toEqual({ status: 400, challenge: null, body: { error: "INVALID_PATH" } });
    }
    expect([...relay.server.rooms.get(room.id)!.clientTickets.values()].map((ticket) => ticket.status)).toEqual(["approved"]);
  });
});
