// Regression tests for the relay's WebSocket frame boundary: a client can never inject
// relay-authored control frames into the provider, only approved clients relay allow-listed
// signaling (stamped by the relay), and frames that are not typed JSON objects are dropped.
import { afterEach, describe, expect, it } from "vitest";
import type { WebMcpPeerServer } from "../src/server.js";
import {
  createRoom,
  flush,
  joinRoom,
  openClient,
  openProvider,
  postJson,
  startRelay,
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
    provider.send({ type: "answer", sdp: "typed-answer" });
    await client.waitFor((frame) => frame?.type === "answer", "client receives the typed answer");

    expect(client.frames.filter((frame) => frame === null || typeof frame !== "object" || Array.isArray(frame) || typeof frame.type !== "string")).toEqual([]);
    expect(client.frames.filter((frame) => frame.sdp === "untyped")).toEqual([]);
  });
});
