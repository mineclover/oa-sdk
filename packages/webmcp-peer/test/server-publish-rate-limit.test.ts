// Regression tests: publish-key guessing must be throttled no matter which wrong key a caller
// sends, the stores must stay bounded, and the File store must validate its persisted state.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FilePublishRateLimitStore,
  InMemoryPublishRateLimitStore,
  SqlitePublishRateLimitStore,
  resolvePeerServerConfig,
  type PublishRateLimitRequest,
  type WebMcpPeerServer,
} from "../src/server.js";
import { startRelay } from "./server-test-helpers.js";

const servers: WebMcpPeerServer[] = [];
let tempDir = "";
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "webmcp-peer-rate-"));
});
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  delete process.env.FRAMEBOOK_PUBLISH_RATE_LIMIT_SQLITE_PATH;
  delete process.env.WEBMCP_PUBLISH_RATE_LIMIT_SQLITE_PATH;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

class RecordingStore extends InMemoryPublishRateLimitStore {
  readonly keys = new Set<string>();
  override consume(request: PublishRateLimitRequest) {
    this.keys.add(request.key);
    return super.consume(request);
  }
}

async function publish(base: string, token?: string): Promise<number> {
  const response = await fetch(`${base}/p`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ approvalRequired: false }),
  });
  await response.arrayBuffer();
  return response.status;
}

describe("publish rate limiting", () => {
  it("throttles distinct wrong publish keys from one address and keeps the valid key's quota separate", async () => {
    const store = new RecordingStore();
    const relay = await startRelay(servers, { publishKey: "correct-horse", publishRateLimitMax: 3, publishRateLimitStore: store });

    const wrong: number[] = [];
    for (let attempt = 0; attempt < 8; attempt++) wrong.push(await publish(relay.base, `wrong-${attempt}`));
    expect(wrong).toEqual([401, 401, 401, 429, 429, 429, 429, 429]);
    expect(await publish(relay.base)).toBe(429);

    expect(await publish(relay.base, "correct-horse")).toBe(201);
    // Failed attempts share one bucket per address; the valid key has its own.
    expect(store.keys.size).toBe(2);
  });

  it("bounds the in-memory store and evicts the oldest windows first", () => {
    const store = new InMemoryPublishRateLimitStore();
    const request = (key: string, nowMs = 1_000): PublishRateLimitRequest => ({ key, nowMs, windowMs: 60_000, max: 1 });
    expect(store.consume(request("first")).allowed).toBe(true);
    expect(store.consume(request("first")).allowed).toBe(false);
    for (let index = 0; index < 4096; index++) store.consume(request(`key-${index}`));
    // "first" held the oldest window and was evicted to keep the map at its bound.
    expect(store.consume(request("first")).allowed).toBe(true);
    expect(store.consume(request("key-4095")).allowed).toBe(false);
  });

  it("deletes expired SQLite windows instead of keeping a row per key forever", () => {
    const file = path.join(tempDir, "rate.sqlite");
    const store = new SqlitePublishRateLimitStore(file);
    try {
      for (let index = 0; index < 20; index++) store.consume({ key: `key-${index}`, nowMs: 1_000, windowMs: 60_000, max: 3 });
      store.consume({ key: "late", nowMs: 1_000 + 60_000, windowMs: 60_000, max: 3 });
      const db = new DatabaseSync(file);
      try {
        expect(db.prepare("SELECT bucket_key FROM publish_rate_limit").all().map((row) => row.bucket_key)).toEqual(["late"]);
      } finally {
        db.close();
      }
    } finally {
      store.close();
    }
  });

  it("validates the File store's persisted state", () => {
    const file = path.join(tempDir, "rate.json");
    const store = new FilePublishRateLimitStore(file);
    const request = { key: "k", nowMs: 1_000, windowMs: 60_000, max: 2 };
    expect(store.consume(request)).toMatchObject({ allowed: true, remaining: 1 });
    expect(store.consume(request)).toMatchObject({ allowed: true, remaining: 0 });
    expect(store.consume(request).allowed).toBe(false);

    fs.writeFileSync(file, JSON.stringify({ buckets: { k: { windowStartedAt: "1000", count: 1 } } }));
    expect(() => store.consume(request)).toThrow("PUBLISH_RATE_LIMIT_STATE_INVALID");
    fs.writeFileSync(file, JSON.stringify({ buckets: [] }));
    expect(() => store.consume(request)).toThrow("PUBLISH_RATE_LIMIT_STATE_INVALID");
    fs.writeFileSync(file, "{not json");
    expect(() => store.consume(request)).toThrow("PUBLISH_RATE_LIMIT_STATE_UNREADABLE");
  });
});

describe("the configured publish rate-limit store", () => {
  it("is the SQLite database the environment names, ahead of a JSON file, closed with the relay", async () => {
    process.env.FRAMEBOOK_PUBLISH_RATE_LIMIT_SQLITE_PATH = "rate.sqlite";
    const relay = await startRelay(servers, {
      cwd: tempDir,
      argv: ["--publish-rate-limit-path", "rate.json"],
      publishKey: "correct-horse",
      publishRateLimitMax: 2,
    });
    expect(relay.server.publishRateLimitStore).toBeInstanceOf(SqlitePublishRateLimitStore);
    const results: number[] = [];
    for (let attempt = 0; attempt < 3; attempt++) results.push(await publish(relay.base, "correct-horse"));
    expect(results).toEqual([201, 201, 429]);

    const db = new DatabaseSync(path.join(tempDir, "rate.sqlite"));
    try {
      expect(db.prepare("SELECT request_count FROM publish_rate_limit").all().map((row) => row.request_count)).toEqual([3]);
    } finally {
      db.close();
    }
    expect(fs.existsSync(path.join(tempDir, "rate.json"))).toBe(false);

    await relay.server.close();
    servers.splice(servers.indexOf(relay.server), 1);
    expect(() => relay.server.publishRateLimitStore.consume({ key: "k", nowMs: 1_000, windowMs: 60_000, max: 1 })).toThrow();
  });

  it("resolves the SQLite path from the CLI, the options, the config file and the environment, in that order", () => {
    const resolveWith = (argv: string[], options: { publishRateLimitSqlitePath?: string } = {}) =>
      resolvePeerServerConfig(options, argv, tempDir, { loadEnvFiles: false }).publishRateLimitSqlitePath;
    process.env.WEBMCP_PUBLISH_RATE_LIMIT_SQLITE_PATH = "webmcp-env.sqlite";
    expect(resolveWith([])).toBe(path.join(tempDir, "webmcp-env.sqlite"));
    process.env.FRAMEBOOK_PUBLISH_RATE_LIMIT_SQLITE_PATH = "env.sqlite";
    expect(resolveWith([])).toBe(path.join(tempDir, "env.sqlite"));
    fs.writeFileSync(path.join(tempDir, "peer-server.config.json"), JSON.stringify({ publishRateLimitSqlitePath: "file.sqlite" }));
    expect(resolveWith([])).toBe(path.join(tempDir, "file.sqlite"));
    expect(resolveWith([], { publishRateLimitSqlitePath: "option.sqlite" })).toBe(path.join(tempDir, "option.sqlite"));
    expect(resolveWith(["--publish-rate-limit-sqlite-path=cli.sqlite"], { publishRateLimitSqlitePath: "option.sqlite" })).toBe(
      path.join(tempDir, "cli.sqlite"),
    );
    expect(() => resolveWith(["--publish-rate-limit-sqlite-path", " "])).toThrow("PUBLISH_RATE_LIMIT_SQLITE_PATH_INVALID");
  });
});
