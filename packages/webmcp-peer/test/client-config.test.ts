// Regression tests for the `./config` helpers agents and hosts use before connecting.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PEER_PROTOCOL, WS_SUBPROTOCOL } from "../examples/live-demo/peer-protocol.js";
import * as client from "../src/client.js";
import * as config from "../src/config.js";
import {
  WEBMCP_PROTOCOL,
  WEBMCP_SUBPROTOCOL,
  buildInvitationUrl,
  createPeerConfigProfile,
  fetchPeerServerConfig,
  parseInvitationUrl,
  parsePeerConfig,
  redactInvitationUrl,
} from "../src/config.js";
import * as root from "../src/index.js";
import * as provider from "../src/provider.js";
import * as server from "../src/server.js";

const relays: server.WebMcpPeerServer[] = [];
afterEach(async () => {
  for (const relay of relays.splice(0)) await relay.close();
});

describe("fetchPeerServerConfig", () => {
  it("rejects an already-aborted signal without sending a request", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ type: "framebook.peer.config" }));
    const failure = await fetchPeerServerConfig("https://peer.example.com", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: AbortSignal.abort(),
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: "AbortError" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a valid config document", async () => {
    const document = {
      type: "framebook.peer.config",
      version: 1,
      roomEndpoint: "https://peer.example.com/p",
      defaults: { approvalRequired: true, roomTtlMs: 7_200_000, maxRoomTtlMs: 86_400_000 },
    };
    const fetchImpl = (async () => Response.json(document)) as typeof fetch;
    await expect(fetchPeerServerConfig("https://peer.example.com", { fetchImpl })).resolves.toEqual(document);
  });

  it("rejects a config document whose declared members have the wrong type", async () => {
    const fetchImpl = (async () => Response.json({ roomEndpoint: 5 })) as typeof fetch;
    await expect(fetchPeerServerConfig("https://peer.example.com", { fetchImpl })).rejects.toThrow(
      "피어 서버 설정 응답 형식이 올바르지 않습니다",
    );
  });

  it("rejects a config document whose defaults.maxRoomTtlMs is not a finite number", async () => {
    // 1e999 is JSON for a number that parses to Infinity.
    for (const maxRoomTtlMs of ['"600000"', "null", "1e999"]) {
      const fetchImpl = (async () => new Response(`{"defaults":{"maxRoomTtlMs":${maxRoomTtlMs}}}`)) as typeof fetch;
      await expect(fetchPeerServerConfig("https://peer.example.com", { fetchImpl }), maxRoomTtlMs).rejects.toThrow(
        "피어 서버 설정 응답 형식이 올바르지 않습니다",
      );
    }
  });

  it("reports the relay's error text for a failed response", async () => {
    const fetchImpl = (async () => Response.json({ error: "ORIGIN_NOT_ALLOWED", origin: "https://app.example" }, { status: 403 })) as typeof fetch;
    await expect(fetchPeerServerConfig("https://peer.example.com", { fetchImpl })).rejects.toThrow("ORIGIN_NOT_ALLOWED");
  });
});

describe("probePeerHealth", () => {
  it("reports the relay's live rooms and the expired or rotated ones it still retains apart", async () => {
    const relay = server.createWebMcpPeerServer({ port: 0, host: "127.0.0.1", roomSweepIntervalMs: 0 });
    relays.push(relay);
    const base = `http://127.0.0.1:${await relay.listen()}`;
    const create = async () => (await (await fetch(`${base}/p`, { method: "POST", body: "{}" })).json()) as { id: string; providerToken: string };
    const rotated = await create();
    await create();
    const rotation = await fetch(`${base}/p/${rotated.id}/rotate`, { method: "POST", body: "{}", headers: { authorization: `Bearer ${rotated.providerToken}` } });
    expect(rotation.status).toBe(201);

    expect(await config.probePeerHealth(base)).toMatchObject({ ok: true, state: "healthy", activeRooms: 2, retainedRooms: 1 });
  });
});

describe("invitation URLs", () => {
  it("name the relay's room descriptor route as descriptorUrl, from either invitation form", async () => {
    const relay = server.createWebMcpPeerServer({ port: 0, host: "127.0.0.1", roomSweepIntervalMs: 0 });
    relays.push(relay);
    const base = `http://127.0.0.1:${await relay.listen()}`;
    const created = await fetch(`${base}/p`, { method: "POST", body: JSON.stringify({ approvalRequired: false }) });
    const room = (await created.json()) as { id: string; descriptorUrl: string; inviteToken: string };

    const built = buildInvitationUrl({ serverUrl: base, roomId: room.id, inviteToken: room.inviteToken });
    expect(built).toBe(`${room.descriptorUrl}#invite=${room.inviteToken}`);
    for (const invitation of [built, `${base}/p/${room.id}#invite=${room.inviteToken}`, `${base}/p/${room.id}/?invite=${room.inviteToken}`]) {
      const parsed = parseInvitationUrl(invitation);
      expect(parsed, invitation).toMatchObject({ roomId: room.id, descriptorUrl: room.descriptorUrl, mcpEndpoint: room.descriptorUrl });
      const descriptor = await fetch(parsed!.descriptorUrl);
      expect(descriptor.status).toBe(200);
      expect(await descriptor.json()).toMatchObject({ roomId: room.id, roomValid: true });
    }
    expect(createPeerConfigProfile({ serverUrl: base, roomId: room.id, inviteToken: room.inviteToken }).invitationUrl).toBe(built);
  });
});

describe("protocol identifiers", () => {
  it("are webmcp-peer/1 and its subprotocol webmcp-peer.v1 in the package and in the live demo", () => {
    expect(WEBMCP_PROTOCOL).toBe("webmcp-peer/1");
    expect(WEBMCP_SUBPROTOCOL).toBe("webmcp-peer.v1");
    // The demo's browser modules cannot import the package, so they keep their own copies.
    expect(PEER_PROTOCOL).toBe(WEBMCP_PROTOCOL);
    expect(WS_SUBPROTOCOL).toBe(WEBMCP_SUBPROTOCOL);
    expect(createPeerConfigProfile().protocol).toBe(WEBMCP_PROTOCOL);
  });
});

describe("redactInvitationUrl", () => {
  it("masks invite tokens with malformed percent-encoding instead of throwing", () => {
    const fragment = "http://h/p/room1/mcp#invite=secret-token-%E0-abcdef";
    const query = "http://h/p/room1/mcp?invite=abc%zzdefgh";
    expect(parseInvitationUrl(fragment)?.roomId).toBe("room1");

    const redactedFragment = redactInvitationUrl(fragment);
    expect(redactedFragment).toBe("http://h/p/room1/mcp#invite=secr...ef");
    expect(redactedFragment).not.toContain("token-%E0-abcd");
    expect(redactInvitationUrl(query)).toBe("http://h/p/room1/mcp?invite=abc%...gh");
    expect(redactInvitationUrl("not a url #invite=abc%")).toBe("not a url #invite=****");
  });

  it("still decodes well-formed tokens before masking", () => {
    expect(redactInvitationUrl("http://h/p/r#invite=ab%2Fcdefgh")).toBe("http://h/p/r#invite=ab/c...gh");
  });
});

describe("parsePeerConfig", () => {
  it("drops a member with the wrong type and keeps the rest of the document", () => {
    expect(parsePeerConfig(JSON.stringify({ serverUrl: "peer.example.com/", alias: 5, roomId: " room1 " }))).toEqual({
      serverUrl: "http://peer.example.com",
      roomId: "room1",
    });
  });

  it("returns null for JSON that is not a config object", () => {
    expect(parsePeerConfig("[1,2]")).toBeNull();
    expect(parsePeerConfig("42")).toBeNull();
  });
});

describe("package root exports", () => {
  const subpaths: Record<string, Record<string, unknown>> = {
    "./config": config,
    "./client": client,
    "./provider": provider,
    "./server": server,
  };
  const rootExports: Record<string, unknown> = root;

  for (const [subpath, module] of Object.entries(subpaths)) {
    it(`re-exports every ${subpath} runtime export`, () => {
      const missing = Object.keys(module).filter((name) => !(name in rootExports));
      expect(missing).toEqual([]);
      const different = Object.keys(module).filter((name) => rootExports[name] !== module[name]);
      expect(different).toEqual([]);
    });
  }

  it("re-exports the helpers added after the first release", () => {
    expect(root.redactInvitationUrl).toBe(config.redactInvitationUrl);
    expect(root.isSecurePeerTransport).toBe(config.isSecurePeerTransport);
    expect(root.truncateUnterminatedTailSync).toBe(server.truncateUnterminatedTailSync);
  });
});
