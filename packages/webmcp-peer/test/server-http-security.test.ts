// Regression tests for who the relay serves over HTTP and how it tells caches and browsers about it
// (relay protocol spec 2.6, 2.8, 2.9, 4.2, 4.4, 4.16):
//   - the Host guard: a relay that binds the loopback interface, or whose allowedHosts is
//     configured, refuses a request for any other host with 403 HOST_NOT_ALLOWED, so a page a DNS
//     rebinding pointed at it reaches nothing, and a configured list replaces the default hosts;
//   - X-Forwarded-* count only from a proxy trustProxy trusts: the descriptors' scheme and host,
//     and the address a publish rate-limit bucket belongs to;
//   - a configured allowedOrigins replaces the default origins, a loopback page included, and a
//     disallowed Origin gets one refusal, 403 ORIGIN_NOT_ALLOWED, on a preflight as elsewhere;
//   - room creation is bounded by default: a publish rate limit without a publish key, and
//     maxRooms, retained rooms included;
//   - CORS exposes the headers the relay sends for its clients, a preflight names the methods the
//     routes take, every response names Origin in Vary and the descriptor also Accept;
//   - a route asked with a method it does not take is 405 with its Allow, /health tells live rooms
//     from retained ones, and conditional GETs answer 304 with the route's cache headers.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ALLOWED_HOSTS,
  DEFAULT_ALLOWED_ORIGINS,
  InMemoryPublishRateLimitStore,
  isOriginAllowed,
  resolvePeerServerConfig,
  type PublishRateLimitRequest,
  type WebMcpPeerServer,
} from "../src/server.js";
import { createRoom, joinRoom, postJson, startRelay, tool, type Relay } from "./server-test-helpers.js";

const servers: WebMcpPeerServer[] = [];
let tempDir = "";
const ENV_NAMES = ["ALLOWED_ORIGINS", "ALLOWED_HOSTS", "PEER_SERVER_TRUST_PROXY"] as const;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "webmcp-peer-http-security-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const name of ENV_NAMES) delete process.env[name];
  for (const server of servers.splice(0)) await server.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const EXPOSED_HEADERS = "Retry-After, ETag, X-MCP-Catalog-Version, X-MCP-Catalog-Hash, X-RateLimit-Limit, X-RateLimit-Remaining";
const BROWSER = "http://localhost:5173";

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A request through node:http, which, unlike fetch, sends the `Host` header it is given. */
function request(relay: Relay, options: { method?: string; path: string; headers?: Record<string, string> }): Promise<RawResponse> {
  const url = new URL(relay.base);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: url.hostname,
      port: Number(url.port),
      method: options.method ?? "GET",
      path: options.path,
      headers: options.headers,
      agent: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** The configuration `options` and `argv` resolve to, read in `tempDir` without `.env` files. */
function configOf(options: Parameters<typeof resolvePeerServerConfig>[0] = {}, argv: string[] = []) {
  return resolvePeerServerConfig({ port: 8787, host: "127.0.0.1", ...options }, argv, tempDir, { loadEnvFiles: false });
}

class RecordingStore extends InMemoryPublishRateLimitStore {
  readonly keys: string[] = [];
  override consume(request: PublishRateLimitRequest) {
    this.keys.push(request.key);
    return super.consume(request);
  }
}

describe("the Host guard", () => {
  it("refuses a request for a host it does not serve with 403 HOST_NOT_ALLOWED on every route, its public ones included", async () => {
    // Bound to the loopback interface, so the host list is enforced without being configured.
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base);
    const port = new URL(relay.base).port;
    const rebound = `rebound.example:${port}`;

    for (const [method, route] of [["GET", "/health"], ["GET", "/config"], ["GET", `/p/${room.id}/mcp`], ["POST", "/p"], ["OPTIONS", "/p"]] as const) {
      const response = await request(relay, { method, path: route, headers: { host: rebound } });
      expect(response.status, `${method} ${route}`).toBe(403);
      expect(JSON.parse(response.body)).toEqual({ error: "HOST_NOT_ALLOWED", host: rebound });
    }
    expect(relay.server.rooms.size).toBe(1);

    // Its own address, a loopback name and a default host (a tunnel's) are served.
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, "relay.trycloudflare.com"]) {
      expect((await request(relay, { path: "/health", headers: { host } })).status, host).toBe(200);
    }
  });

  it("serves only its own address and the configured hosts once allowedHosts is set", async () => {
    const relay = await startRelay(servers, { allowedHosts: ["relay.example.com"] });
    const port = new URL(relay.base).port;
    const statusFor = async (host: string) => (await request(relay, { path: "/health", headers: { host } })).status;

    expect(await statusFor("relay.example.com")).toBe(200);
    expect(await statusFor(`127.0.0.1:${port}`)).toBe(200);
    // A configured list replaces the defaults, a tunnel's hosts among them.
    expect(await statusFor("relay.pages.dev")).toBe(403);
    expect(await statusFor("relay.trycloudflare.com")).toBe(403);
  });

  it("enforces the host list only when it is configured or the relay binds the loopback interface", () => {
    expect(configOf({ host: "127.0.0.1" }).enforceAllowedHosts).toBe(true);
    expect(configOf({ host: "127.0.0.2" }).enforceAllowedHosts).toBe(true);
    expect(configOf({ host: "localhost" }).enforceAllowedHosts).toBe(true);
    expect(configOf({ host: "0.0.0.0" }).enforceAllowedHosts).toBe(false);
    expect(configOf({ host: "relay.example.com" }).enforceAllowedHosts).toBe(false);
    expect(configOf({ host: "0.0.0.0", allowedHosts: ["relay.example.com"] }).enforceAllowedHosts).toBe(true);
    process.env.ALLOWED_HOSTS = "relay.example.com";
    expect(configOf({ host: "0.0.0.0" })).toMatchObject({
      enforceAllowedHosts: true,
      allowedHosts: ["0.0.0.0", "0.0.0.0:8787", "relay.example.com"],
    });
    delete process.env.ALLOWED_HOSTS;
    expect(configOf().allowedHosts).toEqual([...new Set(["127.0.0.1", "127.0.0.1:8787", ...DEFAULT_ALLOWED_HOSTS])]);
  });
});

describe("forwarded headers", () => {
  const forwarded = { "x-forwarded-proto": "https", "x-forwarded-host": "relay.pages.dev" };

  async function descriptorUrl(relay: Relay, headers: Record<string, string>): Promise<string> {
    const response = await postJson(`${relay.base}/p`, { approvalRequired: false }, headers);
    expect(response.status).toBe(201);
    return ((await response.json()) as { descriptorUrl: string }).descriptorUrl;
  }

  it("names the scheme and host X-Forwarded-* give only when they come from a proxy it trusts", async () => {
    const untrusting = await startRelay(servers);
    expect(await descriptorUrl(untrusting, forwarded)).toMatch(new RegExp(`^${untrusting.base}/p/[a-f0-9]{32}/mcp$`));
    const config = (await (await fetch(`${untrusting.base}/config`, { headers: forwarded })).json()) as { serverUrl: string };
    expect(config.serverUrl).toBe(untrusting.base);
    // A list that does not name the relay's peer trusts nothing it sends.
    const elsewhere = await startRelay(servers, { trustProxy: ["10.0.0.1"] });
    expect(await descriptorUrl(elsewhere, forwarded)).toMatch(new RegExp(`^${elsewhere.base}/p/`));

    for (const trustProxy of [true, ["127.0.0.0/8"]]) {
      const trusting = await startRelay(servers, { trustProxy });
      expect(await descriptorUrl(trusting, forwarded)).toMatch(/^https:\/\/relay\.pages\.dev\/p\/[a-f0-9]{32}\/mcp$/);
      // The nearest proxy's value is the last, and a scheme other than http or https is not one.
      expect(await descriptorUrl(trusting, { "x-forwarded-proto": "https, javascript", "x-forwarded-host": "a.pages.dev, b.pages.dev" }))
        .toMatch(/^http:\/\/b\.pages\.dev\/p\//);
    }
  });

  it("checks the host a trusted proxy names, and nothing an untrusted peer names", async () => {
    const trusting = await startRelay(servers, { trustProxy: true });
    const refused = await postJson(`${trusting.base}/p`, {}, { "x-forwarded-host": "rebound.example" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "HOST_NOT_ALLOWED", host: "rebound.example" });

    const untrusting = await startRelay(servers);
    expect((await postJson(`${untrusting.base}/p`, {}, { "x-forwarded-host": "rebound.example" })).status).toBe(201);
  });

  it.each<[string, boolean | string[], string, string]>([
    ["no proxy", false, "203.0.113.9, 198.51.100.7", "127.0.0.1"],
    ["its own peer", true, "203.0.113.9, 198.51.100.7", "198.51.100.7"],
    ["the listed proxies", ["127.0.0.1", "10.0.0.0/8"], "203.0.113.9, 198.51.100.7, 10.1.2.3", "198.51.100.7"],
    ["the listed proxies, every hop among them", ["127.0.0.1", "10.0.0.0/8"], "10.9.9.9, 10.1.2.3", "10.9.9.9"],
  ])("counts a publish against the client past the trusted hops, trusting %s", async (_label, trustProxy, forwardedFor, client) => {
    const store = new RecordingStore();
    const relay = await startRelay(servers, { trustProxy, publishRateLimitStore: store });
    expect((await postJson(`${relay.base}/p`, {}, { "x-forwarded-for": forwardedFor })).status).toBe(201);
    expect(store.keys).toEqual([`${client}\u0000anonymous`]);
  });

  it("does not let a caller pick its bucket by writing an address ahead of its proxy's", async () => {
    const relay = await startRelay(servers, { trustProxy: true, publishRateLimitMax: 1 });
    const publish = async (forwardedFor: string) => (await postJson(`${relay.base}/p`, {}, { "x-forwarded-for": forwardedFor })).status;
    expect(await publish("192.0.2.1, 203.0.113.5")).toBe(201);
    expect(await publish("192.0.2.2, 203.0.113.5")).toBe(429);
    expect(await publish("198.51.100.7")).toBe(201);
  });

  it("reads trustProxy from the CLI, the options, the config file and the environment, and refuses an entry that is no address", () => {
    expect(configOf().trustProxy).toBe(false);
    process.env.PEER_SERVER_TRUST_PROXY = "192.0.2.1, 2001:db8::/32";
    expect(configOf().trustProxy).toEqual(["192.0.2.1", "2001:db8::/32"]);
    fs.writeFileSync(path.join(tempDir, "peer-server.config.json"), JSON.stringify({ trustProxy: ["10.0.0.0/8"] }));
    expect(configOf().trustProxy).toEqual(["10.0.0.0/8"]);
    expect(configOf({ trustProxy: true }).trustProxy).toBe(true);
    expect(configOf({ trustProxy: true }, ["--trust-proxy", "FALSE"]).trustProxy).toBe(false);
    expect(configOf({}, ["--trust-proxy=127.0.0.1,::1"]).trustProxy).toEqual(["127.0.0.1", "::1"]);

    for (const trustProxy of [["10.0.0.0/33"], ["proxy.example"], ["10.0.0.1/8/8"], [""]]) {
      expect(() => configOf({ trustProxy }), String(trustProxy)).toThrow("TRUST_PROXY_INVALID");
    }
    fs.writeFileSync(path.join(tempDir, "peer-server.config.json"), JSON.stringify({ trustProxy: "yes" }));
    expect(() => configOf()).toThrow("TRUST_PROXY_INVALID");
  });
});

describe("allowed origins", () => {
  it("allows a loopback page of any scheme and port and the storyboard app by default, which a configured list leaves out", () => {
    const defaults = [...DEFAULT_ALLOWED_ORIGINS];
    for (const origin of ["http://localhost:9999", "https://127.0.0.1", "http://[::1]:4500", "https://framebook-storyboard.pages.dev", "https://preview.framebook-storyboard.pages.dev"]) {
      expect(isOriginAllowed(origin, defaults), origin).toBe(true);
    }
    expect(isOriginAllowed("https://evil.example", defaults)).toBe(false);
    expect(isOriginAllowed("http://localhost:5173", ["https://app.example"])).toBe(false);
    expect(isOriginAllowed("https://framebook-storyboard.pages.dev", ["https://app.example"])).toBe(false);
    // An IPv6 host keeps its brackets in a rule, with or without a port.
    expect(isOriginAllowed("http://[::1]:4500", ["[::1]:4500"])).toBe(true);
    expect(isOriginAllowed("http://[::1]:4501", ["[::1]:4500"])).toBe(false);
  });

  it("replaces the default origins with the lists configured anywhere, merged", () => {
    expect(configOf().allowedOrigins).toEqual(["http://127.0.0.1:8787", ...DEFAULT_ALLOWED_ORIGINS]);
    expect(configOf({ allowedOrigins: ["https://app.example"] }).allowedOrigins).toEqual(["https://app.example"]);
    expect(configOf({ allowedOrigins: [] }).allowedOrigins).toEqual([]);
    process.env.ALLOWED_ORIGINS = "https://env.example";
    fs.writeFileSync(path.join(tempDir, "peer-server.config.json"), JSON.stringify({ allowedOrigins: ["https://file.example"] }));
    expect(configOf({}, ["--allowed-origins", "https://cli.example"]).allowedOrigins)
      .toEqual(["https://file.example", "https://env.example", "https://cli.example"]);
  });

  it("serves only the configured origins once allowedOrigins is set, a loopback page included", async () => {
    const relay = await startRelay(servers, { allowedOrigins: ["https://app.example"] });
    const allowed = await fetch(`${relay.base}/health`, { headers: { origin: "https://app.example" } });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example");
    const loopback = await fetch(`${relay.base}/health`, { headers: { origin: BROWSER } });
    expect(loopback.status).toBe(403);
    expect(await loopback.json()).toEqual({ error: "ORIGIN_NOT_ALLOWED", origin: BROWSER });

    const defaults = await startRelay(servers);
    expect((await fetch(`${defaults.base}/health`, { headers: { origin: "http://localhost:9999" } })).status).toBe(200);
  });

  it("refuses a disallowed Origin with one 403 ORIGIN_NOT_ALLOWED, on a preflight as on any other request", async () => {
    const relay = await startRelay(servers);
    const origin = "https://evil.example";
    for (const method of ["OPTIONS", "GET", "POST"]) {
      const response = await fetch(`${relay.base}/p`, {
        method,
        headers: { origin, ...(method === "OPTIONS" ? { "access-control-request-method": "POST" } : {}) },
      });
      expect(response.status, method).toBe(403);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ error: "ORIGIN_NOT_ALLOWED", origin });
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(text)));
      expect(response.headers.get("vary")).toBe("Origin");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect(relay.server.rooms.size).toBe(0);
  });
});

describe("room creation bounds", () => {
  it("throttles room creation without a publish key, 30 rooms a minute from one address by default", async () => {
    expect(configOf().publishRateLimitMax).toBe(30);
    expect(configOf({ publishRateLimitMax: 0 }).publishRateLimitMax).toBe(0);

    const relay = await startRelay(servers);
    for (let index = 0; index < 30; index += 1) {
      const created = await postJson(`${relay.base}/p`, {});
      expect(created.status).toBe(201);
      expect(created.headers.get("x-ratelimit-remaining")).toBe(String(29 - index));
    }
    const limited = await postJson(`${relay.base}/p`, {});
    expect(limited.status).toBe(429);
    expect(limited.headers.get("x-ratelimit-limit")).toBe("30");
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("holds at most maxRooms rooms, retained ones included, refusing creation and rotation with 503 ROOM_CAPACITY_EXCEEDED", async () => {
    const relay = await startRelay(servers, { maxRooms: 2, publishRateLimitMax: 0 });
    const first = await createRoom(relay.base, { approvalRequired: false, ttlMs: 60_000 });
    await createRoom(relay.base);
    const firstDeletion = relay.server.rooms.get(first.id)!.metadataRetainUntil!;
    const realNow = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(realNow);

    const refused = await postJson(`${relay.base}/p`, { approvalRequired: false });
    expect(refused.status).toBe(503);
    // Until the first room the relay holds is deleted, a day after it expires.
    expect(await refused.json()).toEqual({ error: "ROOM_CAPACITY_EXCEEDED", retryAfterMs: firstDeletion - realNow });
    expect(refused.headers.get("retry-after")).toBe(String(Math.ceil((firstDeletion - realNow) / 1000)));

    // A rotation would add its replacement, so it is refused too, and the room is left as it was.
    const rotate = await postJson(`${relay.base}/p/${first.id}/rotate`, {}, { authorization: `Bearer ${first.providerToken}` });
    expect(rotate.status).toBe(503);
    expect(relay.server.rooms.get(first.id)?.rotatedTo).toBeUndefined();
    expect(relay.server.rooms.size).toBe(2);

    // An expired room still counts while the relay retains it, and stops counting once deleted.
    clock.mockReturnValue(first.expiresAt + 1_000);
    expect((await postJson(`${relay.base}/p`, {})).status).toBe(503);
    expect(relay.server.rooms.get(first.id)?.roomState).toBe("expired");
    clock.mockReturnValue(firstDeletion);
    expect((await postJson(`${relay.base}/p`, {})).status).toBe(201);
    expect(relay.server.rooms.has(first.id)).toBe(false);
  });
});

describe("CORS and Vary", () => {
  it("lets a browser read the headers the relay sends for its clients, on 200, 304 and 429 alike", async () => {
    const relay = await startRelay(servers, { publishRateLimitMax: 1 });
    const room = await createRoom(relay.base);
    const descriptor = await fetch(`${relay.base}/p/${room.id}/mcp`, { headers: { origin: BROWSER } });
    expect(descriptor.headers.get("access-control-expose-headers")).toBe(EXPOSED_HEADERS);

    const notModified = await fetch(`${relay.base}/p/${room.id}/mcp`, { headers: { origin: BROWSER, "if-none-match": descriptor.headers.get("etag")! } });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("access-control-allow-origin")).toBe(BROWSER);
    expect(notModified.headers.get("access-control-expose-headers")).toBe(EXPOSED_HEADERS);

    const limited = await postJson(`${relay.base}/p`, {}, { origin: BROWSER });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("access-control-expose-headers")).toBe(EXPOSED_HEADERS);
    // Without an Origin there is nothing to expose to.
    expect((await fetch(`${relay.base}/p/${room.id}/mcp`)).headers.get("access-control-expose-headers")).toBeNull();
  });

  it("answers a preflight with the methods the routes take, and an Origin-less OPTIONS without Access-Control-Allow-Origin", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base);
    const preflight = await fetch(`${relay.base}/p/${room.id}/mcp`, { method: "OPTIONS", headers: { origin: BROWSER, "access-control-request-method": "DELETE" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(BROWSER);
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, POST, DELETE, OPTIONS");
    expect(preflight.headers.get("vary")).toBe("Origin");

    const bare = await fetch(`${relay.base}/p/${room.id}/mcp`, { method: "OPTIONS" });
    expect(bare.status).toBe(204);
    expect(bare.headers.get("access-control-allow-origin")).toBeNull();
    expect(bare.headers.get("vary")).toBe("Origin");
  });

  it("names Origin in the Vary of every response, the descriptor's also Accept", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [tool("listed")] } });
    const room = await createRoom(relay.base);
    for (const route of ["/health", "/config", "/nowhere"]) {
      expect((await fetch(`${relay.base}${route}`)).headers.get("vary"), route).toBe("Origin");
    }
    expect((await fetch(`${relay.base}/p/${room.id}/mcp/tools`)).headers.get("vary")).toBe("Origin, Accept-Encoding");

    // An Accept of only text/event-stream gets 405 instead of the descriptor, so a shared cache
    // must not answer one with the other.
    const descriptor = await fetch(`${relay.base}/p/${room.id}/mcp`);
    expect(descriptor.headers.get("vary")).toBe("Origin, Accept, Accept-Encoding");
    const notModified = await fetch(`${relay.base}/p/${room.id}/mcp`, { headers: { "if-none-match": descriptor.headers.get("etag")! } });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("vary")).toBe("Origin, Accept, Accept-Encoding");
    const sse = await fetch(`${relay.base}/p/${room.id}/mcp`, { headers: { accept: "text/event-stream" } });
    expect(sse.status).toBe(405);
    expect(sse.headers.get("cache-control")).toBe("no-store");
  });
});

describe("methods, health and conditional GETs", () => {
  it("answers a method a route does not take with 405 and the methods it does", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base);
    const cases: Array<[string, string, string]> = [
      ["PUT", `/p/${room.id}/mcp`, "GET, POST"],
      ["PATCH", `/p/${room.id}/mcp`, "GET, POST"],
      ["GET", "/p", "POST"],
      ["GET", `/p/${room.id}/join`, "POST"],
      ["GET", `/p/${room.id}/reclaim`, "POST"],
      ["GET", `/p/${room.id}/approval/approval-1`, "POST"],
      ["GET", `/p/${room.id}/session/revoke`, "POST"],
      ["GET", `/p/${room.id}/sessions/peer-session-1/revoke`, "POST"],
      ["GET", `/p/${room.id}/rotate`, "POST"],
      ["POST", "/config", "GET"],
      ["POST", "/mcp/catalog", "GET"],
      ["DELETE", `/p/${room.id}/mcp/tools`, "GET"],
      ["PUT", `/p/${room.id}/sessions/peer-session-1`, "GET"],
    ];
    for (const [method, route, allow] of cases) {
      const response = await fetch(`${relay.base}${route}`, { method });
      expect(response.status, `${method} ${route}`).toBe(405);
      expect(response.headers.get("allow"), `${method} ${route}`).toBe(allow);
      expect(await response.json()).toEqual({ error: "METHOD_NOT_ALLOWED" });
    }

    // Every 405 of the MCP endpoint names the same methods, whatever its body.
    const sse = await fetch(`${relay.base}/p/${room.id}/mcp`, { headers: { accept: "text/event-stream" } });
    const terminate = await fetch(`${relay.base}/p/${room.id}/mcp`, { method: "DELETE" });
    for (const response of [sse, terminate]) {
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, POST");
    }
    // A path that is no route, a socket endpoint asked over plain HTTP included, is 404.
    for (const route of ["/nowhere", `/p/${room.id}/provider`]) {
      const response = await fetch(`${relay.base}${route}`);
      expect(response.status, route).toBe(404);
      expect(await response.json()).toEqual({ error: "NOT_FOUND" });
    }
    expect(relay.server.rooms.get(room.id)?.roomState).toBe("provisioned");
  });

  it("reports the live rooms as activeRooms and the expired or rotated ones it retains as retainedRooms", async () => {
    const relay = await startRelay(servers);
    const rotated = await createRoom(relay.base);
    const expired = await createRoom(relay.base);
    await createRoom(relay.base);
    expect((await postJson(`${relay.base}/p/${rotated.id}/rotate`, {}, { authorization: `Bearer ${rotated.providerToken}` })).status).toBe(201);
    relay.server.rooms.get(expired.id)!.expiresAt = Date.now() - 1;

    const health = (await (await fetch(`${relay.base}/health`)).json()) as Record<string, unknown>;
    // The replacement and the untouched room are live; the rotated and the expired one are retained.
    expect(health).toMatchObject({ status: "healthy", activeRooms: 2, retainedRooms: 2 });
    expect(relay.server.rooms.size).toBe(4);
  });

  it("answers a conditional GET whose If-None-Match names the ETag with 304 and the route's cache headers", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [tool("listed")] } });
    const room = await createRoom(relay.base);
    const catalog = (await (await fetch(`${relay.base}/mcp/catalog`)).json()) as { catalogHash: string };
    const routes: Array<[string, string]> = [
      [`/p/${room.id}/mcp`, "public, max-age=5, s-maxage=30, stale-while-revalidate=60, stale-if-error=300"],
      [`/p/${room.id}/mcp/tools`, "public, max-age=5, s-maxage=30, stale-while-revalidate=60, stale-if-error=300"],
      ["/mcp/catalog", "public, max-age=30, s-maxage=300, stale-while-revalidate=60, stale-if-error=600"],
      [`/mcp/catalog/${catalog.catalogHash}`, "public, max-age=31536000, s-maxage=31536000, immutable"],
    ];
    for (const [route, cacheControl] of routes) {
      const first = await fetch(`${relay.base}${route}`);
      expect(first.status, route).toBe(200);
      expect(first.headers.get("cache-control"), route).toBe(cacheControl);
      const etag = first.headers.get("etag")!;
      expect(etag, route).toMatch(/^"mcp-[a-z-]+-[\w-]+"$/);
      expect(first.headers.get("x-mcp-catalog-hash"), route).toBe(catalog.catalogHash);

      for (const ifNoneMatch of [etag, `"other", ${etag}`, "*"]) {
        const revalidated = await fetch(`${relay.base}${route}`, { headers: { "if-none-match": ifNoneMatch } });
        expect(revalidated.status, `${route} ${ifNoneMatch}`).toBe(304);
        expect(revalidated.headers.get("etag")).toBe(etag);
        expect(revalidated.headers.get("cache-control")).toBe(cacheControl);
        expect(revalidated.headers.get("vary")).toBe(first.headers.get("vary"));
        expect(revalidated.headers.get("content-length")).toBe("0");
        expect(await revalidated.text()).toBe("");
      }
      // A weak validator or another tag does not match.
      for (const ifNoneMatch of [`W/${etag}`, '"other"']) {
        expect((await fetch(`${relay.base}${route}`, { headers: { "if-none-match": ifNoneMatch } })).status, `${route} ${ifNoneMatch}`).toBe(200);
      }
    }

    // The descriptor's tag is its body's digest, so a change of the room's state gives a new one.
    const before = (await fetch(`${relay.base}/p/${room.id}/mcp`)).headers.get("etag")!;
    await joinRoom(relay.base, room);
    const after = await fetch(`${relay.base}/p/${room.id}/mcp`, { headers: { "if-none-match": before } });
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(before);
  });
});
