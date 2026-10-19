// Regression tests for room TTL bounds and idempotent session revocation responses.
import { afterEach, describe, expect, it } from "vitest";
import type { WebMcpPeerServer } from "../src/server.js";
import { createRoom, joinRoom, postJson, startRelay } from "./server-test-helpers.js";

const servers: WebMcpPeerServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

const DAY_MS = 24 * 60 * 60 * 1000;

describe("room TTL bounds", () => {
  it("clamps a huge ttlMs on creation and rotation so the room expires and session status stays readable", async () => {
    const relay = await startRelay(servers);
    const before = Date.now();
    const room = await createRoom(relay.base, { approvalRequired: false, ttlMs: 1e16 });
    expect(room.expiresAt).toBeGreaterThan(before);
    expect(room.expiresAt).toBeLessThanOrEqual(Date.now() + DAY_MS);

    const joined = await joinRoom(relay.base, room);
    const status = await fetch(`${relay.base}/p/${room.id}/sessions/${joined.sessionId}`, { headers: { authorization: `Bearer ${joined.clientToken}` } });
    expect(status.status).toBe(200);
    expect(((await status.json()) as { expiresAt: string }).expiresAt).toBe(new Date(room.expiresAt).toISOString());

    const rotated = await postJson(`${relay.base}/p/${room.id}/rotate`, { ttlMs: 1e16 }, { authorization: `Bearer ${room.providerToken}` });
    expect(rotated.status).toBe(201);
    expect(((await rotated.json()) as { expiresAt: number }).expiresAt).toBeLessThanOrEqual(Date.now() + DAY_MS);
  });

  it("honours a configured maxRoomTtlMs and advertises it in /config", async () => {
    const relay = await startRelay(servers, { maxRoomTtlMs: 10 * 60_000 });
    const room = await createRoom(relay.base, { approvalRequired: false, ttlMs: 60 * 60_000 });
    expect(room.expiresAt).toBeLessThanOrEqual(Date.now() + 10 * 60_000);
    const config = (await (await fetch(`${relay.base}/config`)).json()) as { defaults: Record<string, number> };
    expect(config.defaults).toMatchObject({ roomTtlMs: 10 * 60_000, maxRoomTtlMs: 10 * 60_000 });
  });
});

describe("session revocation responses", () => {
  async function approvedSession() {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const joined = await joinRoom(relay.base, room);
    return { relay, room, joined };
  }

  type RevokeBody = { alreadyRevoked: boolean; revokedAt: string; state: string };

  it("reports alreadyRevoked false then true for a provider revocation", async () => {
    const { relay, room, joined } = await approvedSession();
    const revoke = async () => {
      const response = await postJson(`${relay.base}/p/${room.id}/sessions/${joined.sessionId}/revoke`, { roomId: room.id, roomEpoch: room.roomEpoch }, {
        authorization: `Bearer ${room.providerToken}`,
      });
      expect(response.status).toBe(200);
      return (await response.json()) as RevokeBody;
    };
    const first = await revoke();
    const second = await revoke();
    expect(first).toMatchObject({ state: "revoked", alreadyRevoked: false });
    expect(second).toMatchObject({ state: "revoked", alreadyRevoked: true, revokedAt: first.revokedAt });
  });

  it("reports alreadyRevoked false then true for a client revocation", async () => {
    const { relay, room, joined } = await approvedSession();
    const revoke = async () => {
      const response = await postJson(`${relay.base}/p/${room.id}/session/revoke`, { roomId: room.id, roomEpoch: room.roomEpoch }, {
        authorization: `Bearer ${joined.clientToken}`,
      });
      expect(response.status).toBe(200);
      return (await response.json()) as RevokeBody;
    };
    const first = await revoke();
    const second = await revoke();
    expect(first).toMatchObject({ state: "revoked", alreadyRevoked: false });
    expect(second).toMatchObject({ state: "revoked", alreadyRevoked: true, revokedAt: first.revokedAt });
  });
});
