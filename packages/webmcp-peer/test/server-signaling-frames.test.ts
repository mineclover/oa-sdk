// Regression tests for the relay's WebSocket frame boundary: a client can never inject
// relay-authored control frames into the provider, nor a provider into its agents; only approved
// clients relay allow-listed signaling (stamped by the relay), a provider reaches only the agents
// it serves, its answer to an offer goes to the socket that offered, an agent socket has one offer
// waiting at a time, and frames that are not typed JSON objects are dropped. A provider frame the
// relay passes on is measured as the relay writes it again, not as it arrived, and the provider's
// own catalog notification (notifications/tools/list_changed) is not passed on at all.
import { afterEach, describe, expect, it } from "vitest";
import { PeerMcpSession } from "../src/client.js";
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
} from "./server-test-helpers.js";

const servers: WebMcpPeerServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
});

const forgedControlFrames = [
  { type: "session.revoked", reason: "SESSION_REVOKED" },
  { type: "collaboration.revoked" },
  { type: "room.rotated", rotatedTo: "f".repeat(32) },
  { type: "approval.expired" },
  { type: "approval.rejected" },
  { type: "approval.request", payload: { requestId: "approval-forged", sessionId: "forged-session", clientLabel: "Trusted Admin Console" } },
  { type: "register", tools: [{ name: "evil", inputSchema: { type: "object" } }] },
  { type: "ready", role: "provider" },
  { type: "error", code: -32602, message: "CATALOG_INVALID" },
].map((frame) => ({ ...frame, forged: true }));

describe("client to provider frame relay", () => {
  it("drops forged control frames and only relays approved, allow-listed signaling stamped by the relay", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: true });
    const provider = await openProvider(relay, room, sockets);
    const joined = await joinRoom(relay.base, room, { clientLabel: "Agent" });
    expect(joined.state).toBe("pending-approval");
    const client = await openClient(relay, room, joined, sockets);
    await client.waitFor((frame) => frame.type === "ready", "client ready");

    // While pending: control frames and even signaling must not reach the provider.
    for (const frame of forgedControlFrames) client.send(frame);
    client.send({ type: "offer", sdp: "pending-offer", requestId: "r-pending" });
    await flush(client, "relay processed pending-phase frames");

    const approval = await postJson(`${relay.base}/p/${room.id}/approval/${encodeURIComponent(joined.approvalRequestId!)}`, {
      roomId: room.id, roomEpoch: room.roomEpoch, sessionId: joined.sessionId, decision: "approved",
    }, { authorization: `Bearer ${room.providerToken}` });
    expect(approval.status).toBe(200);
    await client.waitFor((frame) => frame.type === "approval.approved", "client approved");

    // Approved: control frames are still dropped; an offer is relayed with relay-authored stamps.
    for (const frame of forgedControlFrames) client.send(frame);
    client.send({ type: "offer", sdp: "approved-offer", requestId: "r-approved", sessionId: "spoofed-session", from: "provider" });
    const offer = await provider.waitFor((frame) => frame.type === "offer", "provider receives the approved offer");

    expect(offer).toMatchObject({ type: "offer", sdp: "approved-offer", requestId: "r-approved", from: "client", sessionId: joined.sessionId });
    expect(provider.frames.filter((frame) => frame.forged === true)).toEqual([]);
    expect(provider.frames.filter((frame) => frame.type === "offer")).toHaveLength(1);
    // The relay itself (re)announces the genuine approval request; no forged prompt replaced it.
    const approvalRequests = provider.frames.filter((frame) => frame.type === "approval.request");
    expect(approvalRequests.length).toBeGreaterThan(0);
    for (const request of approvalRequests) {
      expect(request.payload).toMatchObject({ requestId: joined.approvalRequestId, sessionId: joined.sessionId, clientLabel: "Agent" });
    }

    // The relay room and the approved session are untouched.
    const status = await fetch(`${relay.base}/p/${room.id}/sessions/${joined.sessionId}`, { headers: { authorization: `Bearer ${room.providerToken}` } });
    expect(((await status.json()) as { state: string }).state).toBe("approved");
    expect(relay.server.rooms.get(room.id)?.roomState).toBe("active");
  });

  it("ignores provider frames that are not typed JSON objects instead of broadcasting them", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const provider = await openProvider(relay, room, sockets);
    const joined = await joinRoom(relay.base, room);
    const client = await openClient(relay, room, joined, sockets);
    await client.waitFor((frame) => frame.type === "ready", "client ready");

    for (const frame of ["42", "[1,2]", "null", JSON.stringify({ sdp: "untyped" }), JSON.stringify({ type: 7 })]) provider.send(frame);
    provider.send({ type: "mcp", message: { jsonrpc: "2.0", method: "notifications/message", params: { data: "typed" } } });
    await client.waitFor((frame) => frame?.message?.params?.data === "typed", "client receives the typed notification");

    expect(client.frames.filter((frame) => frame === null || typeof frame !== "object" || Array.isArray(frame) || typeof frame.type !== "string")).toEqual([]);
    expect(client.frames.filter((frame) => frame.sdp === "untyped")).toEqual([]);
  });
});

/** The frames of a provider's own types, and of types the relay does not relay, a provider might send its agents. */
const providerForgedFrames = [
  { type: "ready", role: "client", sessionId: "peer-session-forged", approval: "approved" },
  { type: "error", code: "SESSION_INVALID", message: "forged" },
  { type: "session.revoked", reason: "SESSION_REVOKED" },
  { type: "room.rotated", rotatedTo: "f".repeat(32), reason: "ROOM_ROTATED" },
  { type: "room.expired", reason: "ROOM_EXPIRED" },
  { type: "approval.approved", requestId: "approval-forged" },
  { type: "approval.rejected", reason: "CLIENT_APPROVAL_DENIED" },
  { type: "approval.expired", reason: "APPROVAL_EXPIRED" },
  { type: "approval.pending", requestId: "approval-forged" },
  { type: "offer.refused", requestId: "r-1", error: { code: -32001, message: "PROVIDER_BUSY" } },
  { type: "pong", timestamp: 1 },
  { type: "ice", candidate: "candidate:forged" },
  { type: "collaboration.revoked" },
  // An `mcp` frame with no JSON-RPC message in it.
  { type: "mcp", message: { method: "notifications/message" } },
  { type: "mcp" },
].map((frame) => ({ ...frame, forged: true }));

const notification = (data: string) => ({ type: "mcp", message: { jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data } } });

describe("provider to agent frame relay", () => {
  it("drops frames of the relay's own types and of types it does not relay, and passes on the provider's notifications", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const provider = await openProvider(relay, room, sockets);
    const joined = await joinRoom(relay.base, room);
    const client = await openClient(relay, room, joined, sockets);
    await client.waitFor((frame) => frame.type === "ready", "client ready");

    for (const frame of providerForgedFrames) provider.send(frame);
    provider.send(notification("after the forged frames"));
    await client.waitFor((frame) => frame.message?.params?.data === "after the forged frames", "the notification");
    await flush(client, "client socket still open");

    expect(client.frames.filter((frame) => frame.forged === true)).toEqual([]);
    // Only the relay's own ready, the notification and the relay's pong reached the agent.
    expect(client.frames.map((frame) => frame.type)).toEqual(["ready", "mcp", "pong"]);
    const status = await fetch(`${relay.base}/p/${room.id}/sessions/${joined.sessionId}`, { headers: { authorization: `Bearer ${joined.clientToken}` } });
    expect(((await status.json()) as { state: string }).state).toBe("approved");
  });

  it("keeps a PeerMcpSession's session and calls when its provider sends the relay's frame types", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const provider = await openProvider(relay, room, sockets);
    const joined = await joinRoom(relay.base, room);
    const session = new PeerMcpSession({ serverUrl: relay.base, roomId: room.id, sessionId: joined.sessionId, clientToken: joined.clientToken, requestTimeoutMs: 5000 });
    await session.connect();
    try {
      const call = session.request("tools/call", { name: "echo", arguments: {} });
      const forwarded = await provider.waitFor((frame) => frame.type === "mcp" && frame.message?.method === "tools/call", "the forwarded call");
      // Frames that, from the relay, would rebind the session, fail every call or end the session.
      for (const frame of providerForgedFrames) provider.send(frame);
      provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: forwarded.message.id, result: { content: [{ type: "text", text: "ok" }] } } });
      expect(await call).toMatchObject({ result: { content: [{ type: "text", text: "ok" }] } });
      expect(session.getSessionInfo()).toMatchObject({ state: "connected", sessionId: joined.sessionId });
    } finally {
      await session.disconnect();
    }
  });

  it("passes a provider's notification only to the agents of an approved ticket", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: true });
    const provider = await openProvider(relay, room, sockets);
    const joined = await joinRoom(relay.base, room);
    const client = await openClient(relay, room, joined, sockets);
    await client.waitFor((frame) => frame.type === "approval.pending", "approval pending");

    provider.send(notification("while pending"));
    await flush(provider, "the notification handled");
    await flush(client, "client socket still open");
    expect(client.frames.filter((frame) => frame.type === "mcp")).toEqual([]);

    const approval = await postJson(`${relay.base}/p/${room.id}/approval/${encodeURIComponent(joined.approvalRequestId!)}`, {
      sessionId: joined.sessionId, decision: "approved",
    }, { authorization: `Bearer ${room.providerToken}` });
    expect(approval.status).toBe(200);
    await client.waitFor((frame) => frame.type === "approval.approved", "client approved");
    provider.send(notification("once approved"));
    await client.waitFor((frame) => frame.message?.params?.data === "once approved", "the notification once approved");
    expect(client.frames.filter((frame) => frame.type === "mcp").map((frame) => frame.message.params.data)).toEqual(["once approved"]);
  });

  it("drops the provider's own notifications/tools/list_changed, so its agents hear of a catalog change from the relay alone", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const provider = await openProvider(relay, room, sockets);
    const client = await openClient(relay, room, await joinRoom(relay.base, room), sockets);
    await client.waitFor((frame) => frame.type === "ready", "client ready");
    const listChanged = (params: unknown) => ({ type: "mcp", message: { jsonrpc: "2.0", method: "notifications/tools/list_changed", params } });

    // A stamp the relay never issued: an agent that took it would send calls the relay refuses.
    provider.send(listChanged({ catalogVersion: 99, catalogHash: "f".repeat(64) }));
    provider.send(listChanged(undefined));
    provider.send(notification("after"));
    await client.waitFor((frame) => frame.message?.params?.data === "after", "the notification after them");
    expect(client.frames.filter((frame) => frame.type === "mcp").map((frame) => frame.message.method)).toEqual(["notifications/message"]);

    // The relay's own notification for a catalog it took still reaches the agent, with its stamp.
    provider.send({ type: "register", tools: [{ name: "echo", inputSchema: { type: "object" } }] });
    const told = await client.waitFor((frame) => frame.message?.method === "notifications/tools/list_changed", "the relay's list_changed");
    const entry = relay.server.rooms.get(room.id)!;
    expect(told.message.params).toEqual({ catalogVersion: entry.catalogVersion, catalogHash: entry.catalogHash });
    expect(entry.catalogVersion).toBe(1);
  });

  it("measures a provider notification as it writes it again, so one that grows past the message limit reaches no agent", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const provider = await openProvider(relay, room, sockets);
    const client = await openClient(relay, room, await joinRoom(relay.base, room), sockets);
    await client.waitFor((frame) => frame.type === "ready", "client ready");

    // 15000 numbers written as 1e20 are 75 KB as sent and 330 KB once JSON.stringify writes them out.
    const numbers = Array.from({ length: 15_000 }, () => "1e20").join(",");
    const grown = `{"type":"mcp","message":{"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info","data":[${numbers}]}}}`;
    expect(grown.length).toBeLessThan(256 * 1024);
    expect(JSON.stringify(JSON.parse(grown)).length).toBeGreaterThan(256 * 1024);
    provider.send(grown);
    provider.send(notification("after"));

    await client.waitFor((frame) => frame.message?.params?.data === "after", "the notification after it");
    expect(client.frames.filter((frame) => frame.type === "mcp").map((frame) => frame.message.params.data)).toEqual(["after"]);
    // Neither socket is told or closed.
    await flush(provider, "provider socket still open");
    await flush(client, "client socket still open");
    expect(provider.frames.map((frame) => frame.type).filter((type) => type !== "pong")).toEqual(["ready"]);
  });

  it("sends the answer and the release of an offer to the agent socket that offered, and drops one that names no offer", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const provider = await openProvider(relay, room, sockets);
    const joined = await joinRoom(relay.base, room);
    const offering = await openClient(relay, room, joined, sockets);
    const other = await openClient(relay, room, joined, sockets);
    await offering.waitFor((frame) => frame.type === "ready", "offering socket ready");
    await other.waitFor((frame) => frame.type === "ready", "other socket ready");

    offering.send({ type: "offer", sdp: "v=0 offer", requestId: "offer-1" });
    await provider.waitFor((frame) => frame.type === "offer" && frame.requestId === "offer-1", "the forwarded offer");
    provider.send({ type: "answer", requestId: "offer-unknown", sdp: "v=0 stray" });
    provider.send({ type: "answer", requestId: "offer-1", sdp: "v=0 answer" });
    provider.send({ type: "answer", requestId: "offer-1", sdp: "v=0 second answer" });
    provider.send({ type: "release", requestId: "offer-1" });
    provider.send({ type: "release", requestId: "offer-1" });
    await offering.waitFor((frame) => frame.type === "release", "the release");
    await flush(offering, "offering socket still open");
    await flush(other, "other socket still open");

    // The first answer settles the offer and the release ends its route; the rest are dropped.
    expect(offering.frames.filter((frame) => frame.type === "answer" || frame.type === "release")).toEqual([
      { type: "answer", requestId: "offer-1", sdp: "v=0 answer" },
      { type: "release", requestId: "offer-1" },
    ]);
    expect(other.frames.filter((frame) => frame.type === "answer" || frame.type === "release")).toEqual([]);
  });

  it("ends an offer whose answer or release grows past the message limit as it writes it again: a refusal, and a release of the requestId alone", async () => {
    const relay = await startRelay(servers, { mcpRequestTimeoutMs: 1000 });
    const room = await createRoom(relay.base, { approvalRequired: false });
    const provider = await openProvider(relay, room, sockets);
    const client = await openClient(relay, room, await joinRoom(relay.base, room), sockets);
    await client.waitFor((frame) => frame.type === "ready", "client ready");
    // 15000 numbers written as 1e20 are 75 KB as sent and 330 KB once JSON.stringify writes them out.
    const grown = (type: string, requestId: string) => {
      const text = `{"type":"${type}","requestId":"${requestId}","sdp":"v=0","candidates":[${Array.from({ length: 15_000 }, () => "1e20").join(",")}]}`;
      expect(text.length).toBeLessThan(256 * 1024);
      expect(JSON.stringify(JSON.parse(text)).length).toBeGreaterThan(256 * 1024);
      return text;
    };
    const offered = (requestId: string) => provider.waitFor((frame) => frame.type === "offer" && frame.requestId === requestId, `offer ${requestId}`);

    // The answer cannot reach the agent: the offer is refused at once, not left to time out.
    client.send({ type: "offer", sdp: "v=0", requestId: "first" });
    await offered("first");
    provider.send(grown("answer", "first"));
    expect(await client.waitFor((frame) => frame.type === "offer.refused", "the refusal", 900)).toEqual({
      type: "offer.refused", requestId: "first", error: { code: -32603, message: "RESULT_TOO_LARGE", data: { limitBytes: 256 * 1024 } },
    });

    // The refusal ended the offer, so the socket may offer again, and a release still ends that one.
    client.send({ type: "offer", sdp: "v=0", requestId: "second" });
    await offered("second");
    provider.send({ type: "answer", requestId: "second", sdp: "v=0 answer" });
    await client.waitFor((frame) => frame.type === "answer", "the answer");
    provider.send(grown("release", "second"));
    expect(await client.waitFor((frame) => frame.type === "release", "the release")).toEqual({ type: "release", requestId: "second" });
    await flush(client, "client socket still open");
    await flush(provider, "provider socket still open");
  });
});

describe("offers an agent socket has waiting", () => {
  it("refuses an offer without a requestId the answer can be matched by, without forwarding it", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const provider = await openProvider(relay, room, sockets);
    const client = await openClient(relay, room, await joinRoom(relay.base, room), sockets);
    await client.waitFor((frame) => frame.type === "ready", "client ready");

    for (const requestId of [undefined, "", 7, null, { id: "r" }, ["r"]]) client.send({ type: "offer", sdp: "v=0", requestId });
    await until(() => client.frames.filter((frame) => frame.type === "offer.refused").length, (count) => count === 6, "every refusal");
    await flush(provider, "provider socket still open");
    // Not echoed: the requestId is what is wrong.
    expect(client.frames.filter((frame) => frame.type === "offer.refused")).toEqual(
      Array.from({ length: 6 }, () => ({ type: "offer.refused", error: { code: -32600, message: "INVALID_REQUEST" } })),
    );
    expect(provider.frames.filter((frame) => frame.type === "offer")).toEqual([]);
  });

  it("lets an agent socket have one offer waiting for its answer, until the provider answers it or the request timeout passes", async () => {
    const relay = await startRelay(servers, { mcpRequestTimeoutMs: 1000 });
    const room = await createRoom(relay.base, { approvalRequired: false });
    const provider = await openProvider(relay, room, sockets);
    const client = await openClient(relay, room, await joinRoom(relay.base, room), sockets);
    await client.waitFor((frame) => frame.type === "ready", "client ready");
    const offers = () => provider.frames.filter((frame) => frame.type === "offer").map((frame) => frame.requestId);
    const refusal = (requestId: string) => client.waitFor((frame) => frame.type === "offer.refused" && frame.requestId === requestId, `refusal of ${requestId}`);

    client.send({ type: "offer", sdp: "v=0", requestId: "first" });
    client.send({ type: "offer", sdp: "v=0", requestId: "second" });
    expect(await refusal("second")).toEqual({
      type: "offer.refused", requestId: "second", error: { code: -32087, message: "TOO_MANY_PENDING_REQUESTS", data: { limit: 1 } },
    });
    expect(offers()).toEqual(["first"]);

    // Answered, the offer no longer waits: the next one is forwarded.
    provider.send({ type: "answer", requestId: "first", sdp: "v=0 answer" });
    await client.waitFor((frame) => frame.type === "answer", "the answer");
    client.send({ type: "offer", sdp: "v=0", requestId: "third" });
    await until(() => offers(), (forwarded) => forwarded.length === 2, "the third offer forwarded");

    // Unanswered, it is refused once the request timeout passes, and then the next one is forwarded.
    expect(await refusal("third")).toEqual({ type: "offer.refused", requestId: "third", error: { code: -32001, message: "MCP_REQUEST_TIMEOUT" } });
    provider.send({ type: "answer", requestId: "third", sdp: "v=0 late answer" });
    client.send({ type: "offer", sdp: "v=0", requestId: "fourth" });
    await until(() => offers(), (forwarded) => forwarded.length === 3, "the fourth offer forwarded");
    await flush(client, "client socket still open");
    expect(offers()).toEqual(["first", "third", "fourth"]);
    expect(client.frames.filter((frame) => frame.type === "answer").map((frame) => frame.sdp)).toEqual(["v=0 answer"]);
  });

  it("refuses an offer whose requestId another agent socket of the room waits on", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const provider = await openProvider(relay, room, sockets);
    const joined = await joinRoom(relay.base, room);
    const first = await openClient(relay, room, joined, sockets);
    const second = await openClient(relay, room, joined, sockets);
    await first.waitFor((frame) => frame.type === "ready", "first socket ready");
    await second.waitFor((frame) => frame.type === "ready", "second socket ready");

    first.send({ type: "offer", sdp: "v=0", requestId: "shared" });
    await provider.waitFor((frame) => frame.type === "offer", "the first offer");
    second.send({ type: "offer", sdp: "v=0", requestId: "shared" });
    expect(await second.waitFor((frame) => frame.type === "offer.refused", "the refusal")).toEqual({
      type: "offer.refused", requestId: "shared", error: { code: -32600, message: "DUPLICATE_REQUEST_ID" },
    });
    await flush(provider, "provider socket still open");
    expect(provider.frames.filter((frame) => frame.type === "offer")).toHaveLength(1);
  });

  it("refuses an offer still waiting for an answer with PROVIDER_DISCONNECTED when the provider socket goes away", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const provider = await openProvider(relay, room, sockets);
    const client = await openClient(relay, room, await joinRoom(relay.base, room), sockets);
    await client.waitFor((frame) => frame.type === "ready", "client ready");

    client.send({ type: "offer", sdp: "v=0", requestId: "waiting" });
    await provider.waitFor((frame) => frame.type === "offer", "the forwarded offer");
    provider.ws.close();
    expect(await client.waitFor((frame) => frame.type === "offer.refused", "the refusal")).toEqual({
      type: "offer.refused", requestId: "waiting", error: { code: -32001, message: "PROVIDER_DISCONNECTED" },
    });
  });
});
