import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { withFileLockSync } from "./durable-file.js";

const require = createRequire(import.meta.url);

export interface PublishRateLimitRequest {
  readonly key: string;
  readonly nowMs: number;
  readonly windowMs: number;
  readonly max: number;
}

export interface PublishRateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
  readonly remaining: number;
}

export interface PublishRateLimitStore {
  consume(
    request: PublishRateLimitRequest,
  ): PublishRateLimitDecision | PromiseLike<PublishRateLimitDecision>;
}

type SqliteRateLimitDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  };
  close(): void;
};

function openRateLimitSqlite(filePath: string): SqliteRateLimitDb {
  try {
    const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => SqliteRateLimitDb };
    return new DatabaseSync(filePath);
  } catch (error) {
    throw new Error("PUBLISH_RATE_LIMIT_SQLITE_UNAVAILABLE", { cause: error });
  }
}

interface RateLimitBucket {
  windowStartedAt: number;
  count: number;
}

function validateRateLimitRequest(request: PublishRateLimitRequest): void {
  if (!request || typeof request.key !== "string" || request.key.length === 0) {
    throw new Error("PUBLISH_RATE_LIMIT_REQUEST_INVALID");
  }
  if (!Number.isFinite(request.nowMs)
    || !Number.isFinite(request.windowMs)
    || request.windowMs <= 0
    || !Number.isFinite(request.max)
    || request.max < 0
    || !Number.isInteger(request.max)) {
    throw new Error("PUBLISH_RATE_LIMIT_REQUEST_INVALID");
  }
}

export function validatePublishRateLimitDecision(
  decision: PublishRateLimitDecision,
): PublishRateLimitDecision {
  if (!decision || typeof decision.allowed !== "boolean"
    || !Number.isFinite(decision.retryAfterMs)
    || decision.retryAfterMs < 0
    || (!Number.isFinite(decision.remaining) && decision.remaining !== Number.POSITIVE_INFINITY)
    || decision.remaining < 0) {
    throw new Error("PUBLISH_RATE_LIMIT_DECISION_INVALID");
  }
  return {
    allowed: decision.allowed,
    retryAfterMs: Math.max(0, Math.ceil(decision.retryAfterMs)),
    remaining: decision.remaining === Number.POSITIVE_INFINITY
      ? decision.remaining : Math.max(0, Math.floor(decision.remaining)),
  };
}

/** Bucket count above which the in-memory store prunes expired windows, then evicts the oldest. */
const MAX_IN_MEMORY_BUCKETS = 4096;

/**
 * Fixed-window counters (each window is anchored at the first request per key), so up to about
 * `2 * max` requests can pass across a window boundary. The bucket map is bounded: past
 * `MAX_IN_MEMORY_BUCKETS` keys, expired windows are pruned and then the oldest windows evicted.
 */
export class InMemoryPublishRateLimitStore implements PublishRateLimitStore {
  private readonly buckets = new Map<string, RateLimitBucket>();

  consume(request: PublishRateLimitRequest): PublishRateLimitDecision {
    validateRateLimitRequest(request);
    if (request.max === 0) {
      return { allowed: true, retryAfterMs: 0, remaining: Number.POSITIVE_INFINITY };
    }
    if (this.buckets.size >= MAX_IN_MEMORY_BUCKETS && !this.buckets.has(request.key)) {
      for (const [key, bucket] of this.buckets) {
        if (request.nowMs - bucket.windowStartedAt >= request.windowMs) this.buckets.delete(key);
      }
      // Map iteration follows insertion order and a window restart re-inserts its key, so the
      // first keys are the ones with the oldest windows.
      for (const key of this.buckets.keys()) {
        if (this.buckets.size < MAX_IN_MEMORY_BUCKETS) break;
        this.buckets.delete(key);
      }
    }
    const current = this.buckets.get(request.key);
    if (!current || request.nowMs - current.windowStartedAt >= request.windowMs) {
      this.buckets.delete(request.key);
      this.buckets.set(request.key, { windowStartedAt: request.nowMs, count: 1 });
      return {
        allowed: true,
        retryAfterMs: request.windowMs,
        remaining: Math.max(0, request.max - 1),
      };
    }
    current.count += 1;
    return {
      allowed: current.count <= request.max,
      retryAfterMs: Math.max(1, request.windowMs - (request.nowMs - current.windowStartedAt)),
      remaining: Math.max(0, request.max - current.count),
    };
  }
}

interface PersistedRateLimitState {
  buckets: Record<string, RateLimitBucket>;
}

function isStateRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Named validator for the File store's persisted `{ buckets: { [key]: { windowStartedAt, count } } }`. */
const PersistedRateLimitStateSchema = {
  parse(value: unknown): PersistedRateLimitState {
    if (!isStateRecord(value) || !isStateRecord(value.buckets)) throw new TypeError("PUBLISH_RATE_LIMIT_STATE_INVALID");
    const buckets: Record<string, RateLimitBucket> = Object.create(null);
    for (const [key, bucket] of Object.entries(value.buckets)) {
      if (!isStateRecord(bucket) || !isValidCounter(bucket.windowStartedAt) || !isValidCounter(bucket.count)) {
        throw new TypeError("PUBLISH_RATE_LIMIT_STATE_INVALID");
      }
      buckets[key] = { windowStartedAt: bucket.windowStartedAt, count: bucket.count };
    }
    return { buckets };
  },
};

function readRateLimitState(filePath: string): PersistedRateLimitState {
  if (!existsSync(filePath)) return { buckets: Object.create(null) };
  try {
    return PersistedRateLimitStateSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
  } catch (error) {
    if (error instanceof TypeError && error.message === "PUBLISH_RATE_LIMIT_STATE_INVALID") {
      throw new Error("PUBLISH_RATE_LIMIT_STATE_INVALID", { cause: error });
    }
    throw new Error("PUBLISH_RATE_LIMIT_STATE_UNREADABLE", { cause: error });
  }
}

function writeRateLimitState(filePath: string, state: PersistedRateLimitState): void {
  const parent = dirname(filePath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const fd = openSync(temp, constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY, 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(state)}\n`, { encoding: "utf8" });
    fsyncSync(fd);
  } finally {
    try { closeSync(fd); } catch { /* best effort */ }
  }
  try {
    renameSync(temp, filePath);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* best effort */ }
    throw error;
  }
}

export class FilePublishRateLimitStore implements PublishRateLimitStore {
  readonly filePath: string;

  constructor(filePath: string) {
    if (!filePath || typeof filePath !== "string") throw new Error("PUBLISH_RATE_LIMIT_PATH_INVALID");
    this.filePath = filePath;
    const parent = dirname(filePath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  }

  consume(request: PublishRateLimitRequest): PublishRateLimitDecision {
    validateRateLimitRequest(request);
    if (request.max === 0) {
      return { allowed: true, retryAfterMs: 0, remaining: Number.POSITIVE_INFINITY };
    }
    return withFileLockSync(this.filePath, () => {
      const state = readRateLimitState(this.filePath);
      for (const [key, bucket] of Object.entries(state.buckets)) {
        if (request.nowMs - bucket.windowStartedAt >= request.windowMs) delete state.buckets[key];
      }
      const current = state.buckets[request.key];
      let decision: PublishRateLimitDecision;
      if (!current || request.nowMs - current.windowStartedAt >= request.windowMs) {
        state.buckets[request.key] = { windowStartedAt: request.nowMs, count: 1 };
        decision = {
          allowed: true,
          retryAfterMs: request.windowMs,
          remaining: Math.max(0, request.max - 1),
        };
      } else {
        current.count += 1;
        decision = {
          allowed: current.count <= request.max,
          retryAfterMs: Math.max(1, request.windowMs - (request.nowMs - current.windowStartedAt)),
          remaining: Math.max(0, request.max - current.count),
        };
      }
      writeRateLimitState(this.filePath, state);
      return decision;
    });
  }
}

export class SqlitePublishRateLimitStore implements PublishRateLimitStore {
  private readonly db: SqliteRateLimitDb;

  constructor(readonly filePath: string) {
    if (!filePath || typeof filePath !== "string") throw new Error("PUBLISH_RATE_LIMIT_SQLITE_PATH_INVALID");
    this.db = openRateLimitSqlite(filePath);
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS publish_rate_limit (
        bucket_key TEXT PRIMARY KEY,
        window_started_at INTEGER NOT NULL,
        request_count INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS publish_rate_limit_window_started_at
        ON publish_rate_limit(window_started_at);
    `);
  }

  close(): void { this.db.close(); }

  consume(request: PublishRateLimitRequest): PublishRateLimitDecision {
    validateRateLimitRequest(request);
    if (request.max === 0) return { allowed: true, retryAfterMs: 0, remaining: Number.POSITIVE_INFINITY };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // Expired windows are dead state; dropping them keeps the table bounded by active keys.
      this.db.prepare("DELETE FROM publish_rate_limit WHERE window_started_at <= ?").run(request.nowMs - request.windowMs);
      const row = this.db.prepare("SELECT window_started_at, request_count FROM publish_rate_limit WHERE bucket_key = ?").get(request.key);
      const startedAt = typeof row?.window_started_at === "number" ? row.window_started_at : undefined;
      const count = typeof row?.request_count === "number" ? row.request_count : undefined;
      const expired = startedAt === undefined || count === undefined || request.nowMs - startedAt >= request.windowMs;
      const nextStartedAt = expired ? request.nowMs : startedAt;
      const nextCount = expired ? 1 : count + 1;
      this.db.prepare(`INSERT INTO publish_rate_limit(bucket_key, window_started_at, request_count)
        VALUES (?, ?, ?) ON CONFLICT(bucket_key) DO UPDATE SET
          window_started_at = excluded.window_started_at, request_count = excluded.request_count`).run(
        request.key, nextStartedAt, nextCount,
      );
      this.db.exec("COMMIT");
      return {
        allowed: nextCount <= request.max,
        retryAfterMs: expired ? request.windowMs : Math.max(1, request.windowMs - (request.nowMs - startedAt)),
        remaining: Math.max(0, request.max - nextCount),
      };
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }
}

/**
 * The SQLite rate-limit database an environment names: `FRAMEBOOK_PUBLISH_RATE_LIMIT_SQLITE_PATH`,
 * else `WEBMCP_PUBLISH_RATE_LIMIT_SQLITE_PATH`. `resolvePeerServerConfig` reads it after the CLI flag,
 * the options and the config file. Internal to the package.
 */
export function publishRateLimitSqlitePathFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  return env.FRAMEBOOK_PUBLISH_RATE_LIMIT_SQLITE_PATH ?? env.WEBMCP_PUBLISH_RATE_LIMIT_SQLITE_PATH;
}

/**
 * A SQLite store at the database `env` names (see `publishRateLimitSqlitePathFromEnv`), or undefined.
 * The relay opens that store on its own when the environment names one; this helper is for a host
 * that builds its store before the relay (and passes it as `publishRateLimitStore`).
 */
export function createPublishRateLimitStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PublishRateLimitStore | undefined {
  const path = publishRateLimitSqlitePathFromEnv(env);
  return path ? new SqlitePublishRateLimitStore(path) : undefined;
}
