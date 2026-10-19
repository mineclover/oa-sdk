// Regression tests for the `./config` helpers agents and hosts use before connecting.
import { describe, expect, it, vi } from "vitest";
import * as client from "../src/client.js";
import * as config from "../src/config.js";
import {
  fetchPeerServerConfig,
  parseInvitationUrl,
  parsePeerConfig,
  redactInvitationUrl,
} from "../src/config.js";
import * as root from "../src/index.js";
import * as provider from "../src/provider.js";
import * as server from "../src/server.js";

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

  it("reports the relay's error text for a failed response", async () => {
    const fetchImpl = (async () => Response.json({ error: "ORIGIN_DENIED" }, { status: 403 })) as typeof fetch;
    await expect(fetchPeerServerConfig("https://peer.example.com", { fetchImpl })).rejects.toThrow("ORIGIN_DENIED");
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
