/**
 * @oa-sdk/webmcp-peer/server
 *
 * Product-agnostic Room-based HTTP MCP router, WebSocket signaling relay,
 * deployment catalog bootstrap, and durable admission rate limiter.
 */
import http, { type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import {
  isCommitReceipt,
  isUtcTimestamp,
  type AiRunLedgerStore,
  type AiRunLedgerWriteOptions,
  type AiRunLedgerWriteResult,
  type AiRunOperationRecord,
} from './provider.js';

const require = createRequire(import.meta.url);

// ============================================================================
// 1. RFC 6455 Zero-Dependency WebSocket Upgrader
// ============================================================================

export interface PeerSocket {
  send: (value: unknown) => void;
  close: () => void;
}

export const MAX_WEBSOCKET_FRAME_BYTES = 128 * 1024;
export const MAX_WEBSOCKET_MESSAGE_BYTES = 256 * 1024;
const MAX_WEBSOCKET_BUFFER_BYTES = MAX_WEBSOCKET_MESSAGE_BYTES + MAX_WEBSOCKET_FRAME_BYTES + 16;

export function upgradeWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  onText: (text: string) => void,
  onClose: () => void,
): PeerSocket {
  const upgradeHeader = req.headers.upgrade;
  const version = req.headers['sec-websocket-version'];
  const key = req.headers['sec-websocket-key'];

  if (upgradeHeader?.toLowerCase() !== 'websocket' || version !== '13' || typeof key !== 'string') {
    throw new Error('BAD_UPGRADE');
  }

  const accept = createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const rawProtocol = req.headers['sec-websocket-protocol'];
  const requestedProtocols = typeof rawProtocol === 'string'
    ? rawProtocol.split(',').map((p) => p.trim())
    : [];

  const protocolHeader = requestedProtocols.includes('webmcp-peer.v1')
    ? `Sec-WebSocket-Protocol: webmcp-peer.v1\r\n`
    : requestedProtocols.length > 0
      ? `Sec-WebSocket-Protocol: ${requestedProtocols[0]}\r\n`
      : '';

  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\n` +
    `Upgrade: websocket\r\n` +
    `Connection: Upgrade\r\n` +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    protocolHeader +
    `\r\n`,
  );

  let buffer = Buffer.alloc(0);
  let stopped = false;
  let fragments: Buffer[] = [];
  let fragmentBytes = 0;

  const sendFrame = (opcode: number, data: Buffer | string, fin = true) => {
    if (stopped || socket.destroyed) return;
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    let header: Buffer;
    if (body.length < 126) {
      header = Buffer.from([(fin ? 0x80 : 0) | opcode, body.length]);
    } else if (body.length <= 65535) {
      header = Buffer.alloc(4);
      header[0] = (fin ? 0x80 : 0) | opcode;
      header[1] = 126;
      header.writeUInt16BE(body.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = (fin ? 0x80 : 0) | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(body.length), 2);
    }
    socket.write(Buffer.concat([header, body]));
  };

  const sendMessage = (data: Buffer | string) => {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (body.length > MAX_WEBSOCKET_MESSAGE_BYTES) {
      close();
      return;
    }
    if (body.length <= MAX_WEBSOCKET_FRAME_BYTES) {
      sendFrame(1, body);
      return;
    }
    for (let offset = 0; offset < body.length; offset += MAX_WEBSOCKET_FRAME_BYTES) {
      const chunk = body.subarray(offset, offset + MAX_WEBSOCKET_FRAME_BYTES);
      const first = offset === 0;
      const last = offset + chunk.length >= body.length;
      sendFrame(first ? 1 : 0, chunk, last);
    }
  };

  const close = () => {
    if (stopped) return;
    sendFrame(8, Buffer.from([3, 232]));
    stopped = true;
    socket.end();
  };

  const parse = (data: Buffer) => {
    if (stopped) return;
    buffer = Buffer.concat([buffer, data]);
    if (buffer.length > MAX_WEBSOCKET_BUFFER_BYTES) {
      close();
      return;
    }
    try {
      while (buffer.length >= 2) {
        const first = buffer[0];
        const masked = !!(buffer[1] & 128);
        const opcode = first & 15;
        const fin = !!(first & 128);
        if ((first & 0x70) || !masked) throw new Error('BAD_FRAME');

        let len = buffer[1] & 127;
        let offset = 2;
        if (len === 126) {
          if (buffer.length < 4) return;
          len = buffer.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buffer.length < 10) return;
          const large = buffer.readBigUInt64BE(2);
          if (large > BigInt(MAX_WEBSOCKET_FRAME_BYTES)) throw new Error('FRAME_LIMIT');
          len = Number(large);
          offset = 10;
        }
        if (len > MAX_WEBSOCKET_FRAME_BYTES || (opcode >= 8 && (!fin || len > 125))) throw new Error('FRAME_LIMIT');
        if (buffer.length < offset + 4 + len) return;

        const mask = buffer.subarray(offset, offset + 4);
        const body = Buffer.from(buffer.subarray(offset + 4, offset + 4 + len));
        for (let i = 0; i < len; i++) body[i] ^= mask[i % 4];
        buffer = buffer.subarray(offset + 4 + len);

        if (opcode === 8) {
          close();
          return;
        }
        if (opcode === 9) {
          sendFrame(10, body);
          continue;
        }
        if (opcode === 10) continue;
        if (opcode !== 0 && opcode !== 1) throw new Error('TEXT_ONLY');
        if (opcode === 1 && fragments.length) throw new Error('INTERLEAVED');
        if (opcode === 0 && !fragments.length) throw new Error('BAD_CONTINUATION');

        fragments.push(body);
        fragmentBytes += len;
        if (fragmentBytes > MAX_WEBSOCKET_MESSAGE_BYTES) throw new Error('FRAME_LIMIT');

        if (fin) {
          const value = Buffer.concat(fragments).toString('utf8');
          fragments = [];
          fragmentBytes = 0;
          onText(value);
        }
      }
    } catch {
      close();
    }
  };

  socket.on('data', parse);
  socket.on('error', () => {});
  socket.on('close', () => {
    stopped = true;
    onClose();
  });
  if (head.length) queueMicrotask(() => parse(head));

  return {
    send: (value: unknown) => sendMessage(JSON.stringify(value)),
    close,
  };
}

// ============================================================================
// 2. Durable File Lock & Append-Only JSONL Helpers
// ============================================================================

export function withFileLockSync<T>(
  filePath: string,
  work: () => T,
  options: { readonly maxWaitMs?: number; readonly staleAfterMs?: number; readonly retryMs?: number } = {},
): T {
  const lockPath = `${filePath}.lock`;
  const parent = dirname(filePath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  const maxWaitMs = Math.max(1, options.maxWaitMs ?? 60_000);
  const staleAfterMs = Math.max(1, options.staleAfterMs ?? 60_000);
  const retryMs = Math.max(1, options.retryMs ?? 2);
  const startedAt = Date.now();
  const token = `${process.pid}:${randomBytes(12).toString('hex')}`;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  let lockFd: number | undefined;

  while (lockFd === undefined) {
    try {
      lockFd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      writeFileSync(lockFd, `${token}\n`, { encoding: 'utf8' });
      fsyncSync(lockFd);
    } catch (error) {
      if (lockFd !== undefined) {
        try { closeSync(lockFd); } catch { /* best effort */ }
        try { unlinkSync(lockPath); } catch { /* best effort */ }
        lockFd = undefined;
      }
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const age = Date.now() - statSync(lockPath).mtimeMs;
        if (age >= staleAfterMs) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        // Owner may have released lock between stat and unlink.
      }
      if (Date.now() - startedAt >= maxWaitMs) {
        const timeout = new Error(`FILE_LOCK_TIMEOUT:${filePath}`);
        (timeout as Error & { code?: string }).code = 'FILE_LOCK_TIMEOUT';
        throw timeout;
      }
      Atomics.wait(sleeper, 0, 0, retryMs);
    }
  }

  try {
    return work();
  } finally {
    try { fsyncSync(lockFd); } catch { /* advisory */ }
    try { closeSync(lockFd); } catch { /* best effort */ }
    try { unlinkSync(lockPath); } catch { /* already removed */ }
  }
}

export function appendDurableLineSync(filePath: string, line: string): void {
  const fd = openSync(filePath, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY, 0o600);
  try {
    writeSync(fd, line, undefined, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function readDurableJsonLinesSync<T>(filePath: string, errorCode: string): T[] {
  const raw = readFileSync(filePath, 'utf8');
  if (raw.length === 0) return [];
  const terminated = raw.endsWith('\n');
  const lines = raw.split('\n');
  if (terminated) lines.pop();
  const rows: T[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) throw new Error(`${errorCode}: empty row ${index + 1}`);
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      if (!terminated && index === lines.length - 1) continue;
      throw new Error(`${errorCode}: malformed row ${index + 1}`);
    }
  }
  return rows;
}

// ============================================================================
// 3. Publish Rate Limiting (InMemory, File, SQLite)
// ============================================================================

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
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => SqliteRateLimitDb };
    return new DatabaseSync(filePath);
  } catch (error) {
    throw new Error('PUBLISH_RATE_LIMIT_SQLITE_UNAVAILABLE', { cause: error });
  }
}

interface RateLimitBucket {
  windowStartedAt: number;
  count: number;
}

function validateRateLimitRequest(request: PublishRateLimitRequest): void {
  if (!request || typeof request.key !== 'string' || request.key.length === 0) {
    throw new Error('PUBLISH_RATE_LIMIT_REQUEST_INVALID');
  }
  if (!Number.isFinite(request.nowMs)
    || !Number.isFinite(request.windowMs)
    || request.windowMs <= 0
    || !Number.isFinite(request.max)
    || request.max < 0
    || !Number.isInteger(request.max)) {
    throw new Error('PUBLISH_RATE_LIMIT_REQUEST_INVALID');
  }
}

export function validatePublishRateLimitDecision(
  decision: PublishRateLimitDecision,
): PublishRateLimitDecision {
  if (!decision || typeof decision.allowed !== 'boolean'
    || !Number.isFinite(decision.retryAfterMs)
    || decision.retryAfterMs < 0
    || (!Number.isFinite(decision.remaining) && decision.remaining !== Number.POSITIVE_INFINITY)
    || decision.remaining < 0) {
    throw new Error('PUBLISH_RATE_LIMIT_DECISION_INVALID');
  }
  return {
    allowed: decision.allowed,
    retryAfterMs: Math.max(0, Math.ceil(decision.retryAfterMs)),
    remaining: decision.remaining === Number.POSITIVE_INFINITY
      ? decision.remaining : Math.max(0, Math.floor(decision.remaining)),
  };
}

export class InMemoryPublishRateLimitStore implements PublishRateLimitStore {
  private readonly buckets = new Map<string, RateLimitBucket>();

  consume(request: PublishRateLimitRequest): PublishRateLimitDecision {
    validateRateLimitRequest(request);
    if (request.max === 0) {
      return { allowed: true, retryAfterMs: 0, remaining: Number.POSITIVE_INFINITY };
    }
    if (this.buckets.size > 4096) {
      for (const [key, bucket] of this.buckets) {
        if (request.nowMs - bucket.windowStartedAt >= request.windowMs) this.buckets.delete(key);
      }
    }
    const current = this.buckets.get(request.key);
    if (!current || request.nowMs - current.windowStartedAt >= request.windowMs) {
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

function readRateLimitState(filePath: string): PersistedRateLimitState {
  if (!existsSync(filePath)) return { buckets: {} };
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as PersistedRateLimitState;
    if (!parsed || typeof parsed !== 'object' || !parsed.buckets || typeof parsed.buckets !== 'object') {
      throw new Error('PUBLISH_RATE_LIMIT_STATE_INVALID');
    }
    const buckets: Record<string, RateLimitBucket> = {};
    for (const [key, value] of Object.entries(parsed.buckets)) {
      if (!value || !Number.isFinite(value.windowStartedAt) || !Number.isFinite(value.count)
        || value.windowStartedAt < 0 || value.count < 0) {
        throw new Error('PUBLISH_RATE_LIMIT_STATE_INVALID');
      }
      buckets[key] = { windowStartedAt: value.windowStartedAt, count: value.count };
    }
    return { buckets };
  } catch (error) {
    if (error instanceof Error && error.message === 'PUBLISH_RATE_LIMIT_STATE_INVALID') throw error;
    throw new Error('PUBLISH_RATE_LIMIT_STATE_UNREADABLE');
  }
}

function writeRateLimitState(filePath: string, state: PersistedRateLimitState): void {
  const parent = dirname(filePath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const fd = openSync(temp, constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY, 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(state)}\n`, { encoding: 'utf8' });
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
    if (!filePath || typeof filePath !== 'string') throw new Error('PUBLISH_RATE_LIMIT_PATH_INVALID');
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
    if (!filePath || typeof filePath !== 'string') throw new Error('PUBLISH_RATE_LIMIT_SQLITE_PATH_INVALID');
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
    `);
  }

  close(): void { this.db.close(); }

  consume(request: PublishRateLimitRequest): PublishRateLimitDecision {
    validateRateLimitRequest(request);
    if (request.max === 0) return { allowed: true, retryAfterMs: 0, remaining: Number.POSITIVE_INFINITY };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT window_started_at, request_count FROM publish_rate_limit WHERE bucket_key = ?').get(request.key);
      const startedAt = typeof row?.window_started_at === 'number' ? row.window_started_at : undefined;
      const count = typeof row?.request_count === 'number' ? row.request_count : undefined;
      const expired = startedAt === undefined || count === undefined || request.nowMs - startedAt >= request.windowMs;
      const nextStartedAt = expired ? request.nowMs : startedAt;
      const nextCount = expired ? 1 : count + 1;
      this.db.prepare(`INSERT INTO publish_rate_limit(bucket_key, window_started_at, request_count)
        VALUES (?, ?, ?) ON CONFLICT(bucket_key) DO UPDATE SET
          window_started_at = excluded.window_started_at, request_count = excluded.request_count`).run(
        request.key, nextStartedAt, nextCount,
      );
      this.db.exec('COMMIT');
      return {
        allowed: nextCount <= request.max,
        retryAfterMs: expired ? request.windowMs : Math.max(1, request.windowMs - (request.nowMs - startedAt)),
        remaining: Math.max(0, request.max - nextCount),
      };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }
}

export function createPublishRateLimitStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PublishRateLimitStore | undefined {
  const path = env.FRAMEBOOK_PUBLISH_RATE_LIMIT_SQLITE_PATH ?? env.WEBMCP_PUBLISH_RATE_LIMIT_SQLITE_PATH;
  return path ? new SqlitePublishRateLimitStore(path) : undefined;
}

// ============================================================================
// 4. Deployment Catalog Loader
// ============================================================================

const MAX_CATALOG_TOOLS = 128;

export interface DeploymentCatalogSnapshot {
  readonly tools: readonly Record<string, unknown>[];
  readonly catalogVersion: number;
  readonly catalogHash: string;
  readonly catalogUpdatedAt: number;
  readonly source: 'deployment' | 'empty' | 'injected';
}

export interface DeploymentCatalogInput {
  tools: readonly unknown[];
  catalogVersion?: number;
  catalogHash?: string;
  catalogUpdatedAt?: number;
}

function isCatalogRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stableCatalogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableCatalogValue);
  if (!isCatalogRecord(value)) return value;
  return Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = stableCatalogValue(value[key]);
    return result;
  }, {});
}

export function hashDeploymentCatalog(tools: readonly Record<string, unknown>[]): string {
  const ordered = [...tools].sort((left, right) => String(left.name ?? '').localeCompare(String(right.name ?? '')));
  return createHash('sha256').update(JSON.stringify(stableCatalogValue(ordered))).digest('hex');
}

function normalizeCatalogTools(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.length > MAX_CATALOG_TOOLS) return null;
  const names = new Set<string>();
  const tools: Record<string, unknown>[] = [];
  for (const candidate of value) {
    if (!isCatalogRecord(candidate) || typeof candidate.name !== 'string' || !candidate.name.trim()) return null;
    if (names.has(candidate.name)) return null;
    names.add(candidate.name);
    if ('inputSchema' in candidate && (!isCatalogRecord(candidate.inputSchema) || candidate.inputSchema.type !== 'object')) return null;
    try { tools.push(structuredClone(candidate)); } catch { return null; }
  }
  return tools;
}

function buildCatalogSnapshot(input: DeploymentCatalogInput, source: DeploymentCatalogSnapshot['source']): DeploymentCatalogSnapshot {
  const tools = normalizeCatalogTools(input.tools) ?? [];
  const computedHash = hashDeploymentCatalog(tools);
  const hash = typeof input.catalogHash === 'string' && input.catalogHash === computedHash
    ? input.catalogHash
    : computedHash;
  const version = Number.isSafeInteger(input.catalogVersion) && (input.catalogVersion ?? 0) > 0
    ? input.catalogVersion as number
    : tools.length ? 1 : 0;
  return Object.freeze({
    tools: Object.freeze(tools),
    catalogVersion: version,
    catalogHash: hash,
    catalogUpdatedAt: Number.isFinite(input.catalogUpdatedAt) ? input.catalogUpdatedAt as number : source === 'deployment' ? 0 : Date.now(),
    source,
  });
}

export function loadDeploymentCatalog(injected?: DeploymentCatalogInput): DeploymentCatalogSnapshot {
  if (injected) return buildCatalogSnapshot(injected, 'injected');
  const candidates = [
    process.env.WEBMCP_CATALOG_PATH,
    process.env.FRAMEBOOK_MCP_CATALOG_PATH,
    resolve(process.cwd(), 'api/webmcp-tools.json'),
    resolve(process.cwd(), '../../api/webmcp-tools.json'),
    resolve(process.cwd(), 'packages/peer-server/api/webmcp-tools.json'),
  ].filter((value): value is string => Boolean(value));
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
      if (!isCatalogRecord(parsed)) continue;
      const result = buildCatalogSnapshot({
        tools: Array.isArray(parsed.tools) ? parsed.tools : [],
        catalogVersion: typeof parsed.catalogVersion === 'number' ? parsed.catalogVersion : 1,
      }, 'deployment');
      if (result.tools.length > 0) return result;
    } catch {
      // Malformed deployment artifact must not become an executable fallback.
    }
  }
  return buildCatalogSnapshot({ tools: [] }, 'empty');
}

// ============================================================================
// 5. Server Configuration Loader & Origin/Host Whitelist Validator
// ============================================================================

export interface PeerServerConfig {
  port: number;
  host: string;
  allowedOrigins: string[];
  allowedHosts: string[];
  configPath?: string;
  journalPath?: string;
  publishKey?: string;
  publishKeyOwner?: string;
  publishRateLimitWindowMs: number;
  publishRateLimitMax: number;
  publishRateLimitPath?: string;
}

export interface CliParsedArgs {
  port?: number;
  host?: string;
  allowedOrigins?: string[];
  allowedHosts?: string[];
  configPath?: string;
  journalPath?: string;
  publishKey?: string;
  publishKeyOwner?: string;
  publishRateLimitWindowMs?: number;
  publishRateLimitMax?: number;
  publishRateLimitPath?: string;
  help?: boolean;
}

export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  'http://localhost:4500',
  'http://127.0.0.1:4500',
  'http://[::1]:4500',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://framebook-storyboard.pages.dev',
]);

export const DEFAULT_ALLOWED_HOSTS: readonly string[] = Object.freeze([
  'localhost',
  '127.0.0.1',
  '[::1]',
  'framebook-storyboard.pages.dev',
  '*.framebook-storyboard.pages.dev',
  '*.trycloudflare.com',
  '*.workers.dev',
  '*.pages.dev',
]);

export const DEFAULT_PUBLISH_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_PUBLISH_RATE_LIMIT_MAX = 30;

export function loadEnvFile(envPath: string): Record<string, string> {
  const loaded: Record<string, string> = {};
  if (!existsSync(envPath)) return loaded;

  try {
    const content = readFileSync(envPath, 'utf8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      loaded[key] = value;
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {}
  return loaded;
}

export function autoLoadEnvFiles(startDir: string = process.cwd()): void {
  let curr = resolve(startDir);
  const candidates: string[] = [];

  for (let i = 0; i < 4; i++) {
    candidates.push(resolve(curr, '.env.local'));
    candidates.push(resolve(curr, '.env'));
    const parent = dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }

  for (let i = candidates.length - 1; i >= 0; i--) {
    loadEnvFile(candidates[i]);
  }
}

export function parseCliArgs(args: string[]): CliParsedArgs {
  const parsed: CliParsedArgs = {};
  const originList: string[] = [];
  const hostList: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '-p' || arg === '--port') {
      const val = args[++i];
      if (val && !isNaN(Number(val))) parsed.port = Number(val);
    } else if (arg.startsWith('--port=')) {
      const val = arg.slice('--port='.length);
      if (val && !isNaN(Number(val))) parsed.port = Number(val);
    } else if (arg === '--host') {
      parsed.host = args[++i];
    } else if (arg.startsWith('--host=')) {
      parsed.host = arg.slice('--host='.length);
    } else if (arg === '-o' || arg === '--allowed-origins' || arg === '--allowed-origin') {
      const val = args[++i];
      if (val) originList.push(...val.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (arg.startsWith('--allowed-origins=')) {
      const val = arg.slice('--allowed-origins='.length);
      if (val) originList.push(...val.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (arg === '--allowed-hosts' || arg === '--allowed-host') {
      const val = args[++i];
      if (val) hostList.push(...val.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (arg.startsWith('--allowed-hosts=')) {
      const val = arg.slice('--allowed-hosts='.length);
      if (val) hostList.push(...val.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (arg === '-c' || arg === '--config') {
      parsed.configPath = args[++i];
    } else if (arg.startsWith('--config=')) {
      parsed.configPath = arg.slice('--config='.length);
    } else if (arg === '--journal-path') {
      parsed.journalPath = args[++i];
    } else if (arg.startsWith('--journal-path=')) {
      parsed.journalPath = arg.slice('--journal-path='.length);
    } else if (arg === '--publish-key' || arg === '--publishKey') {
      parsed.publishKey = args[++i];
    } else if (arg.startsWith('--publish-key=')) {
      parsed.publishKey = arg.slice('--publish-key='.length);
    } else if (arg === '--publish-owner' || arg === '--publish-key-owner' || arg === '--publishKeyOwner') {
      parsed.publishKeyOwner = args[++i];
    } else if (arg.startsWith('--publish-owner=')) {
      parsed.publishKeyOwner = arg.slice('--publish-owner='.length);
    } else if (arg.startsWith('--publish-key-owner=')) {
      parsed.publishKeyOwner = arg.slice('--publish-key-owner='.length);
    } else if (arg === '--publish-rate-limit-window-ms' || arg === '--rate-limit-window-ms') {
      const val = args[++i];
      if (val && Number.isFinite(Number(val))) parsed.publishRateLimitWindowMs = Number(val);
    } else if (arg.startsWith('--publish-rate-limit-window-ms=')) {
      const val = arg.slice('--publish-rate-limit-window-ms='.length);
      if (val && Number.isFinite(Number(val))) parsed.publishRateLimitWindowMs = Number(val);
    } else if (arg.startsWith('--rate-limit-window-ms=')) {
      const val = arg.slice('--rate-limit-window-ms='.length);
      if (val && Number.isFinite(Number(val))) parsed.publishRateLimitWindowMs = Number(val);
    } else if (arg === '--publish-rate-limit-max' || arg === '--rate-limit-max') {
      const val = args[++i];
      if (val && Number.isFinite(Number(val))) parsed.publishRateLimitMax = Number(val);
    } else if (arg.startsWith('--publish-rate-limit-max=')) {
      const val = arg.slice('--publish-rate-limit-max='.length);
      if (val && Number.isFinite(Number(val))) parsed.publishRateLimitMax = Number(val);
    } else if (arg === '--publish-rate-limit-path') {
      parsed.publishRateLimitPath = args[++i];
    } else if (arg.startsWith('--publish-rate-limit-path=')) {
      parsed.publishRateLimitPath = arg.slice('--publish-rate-limit-path='.length);
    } else if (arg.startsWith('--rate-limit-max=')) {
      const val = arg.slice('--rate-limit-max='.length);
      if (val && Number.isFinite(Number(val))) parsed.publishRateLimitMax = Number(val);
    }
  }

  if (originList.length > 0) parsed.allowedOrigins = originList;
  if (hostList.length > 0) parsed.allowedHosts = hostList;

  return parsed;
}

export function findConfigFile(explicitPath?: string, cwd: string = process.cwd()): string | undefined {
  if (explicitPath) {
    const full = resolve(cwd, explicitPath);
    return existsSync(full) ? full : undefined;
  }

  const envConfig = process.env.PEER_SERVER_CONFIG;
  if (envConfig) {
    const full = resolve(cwd, envConfig);
    if (existsSync(full)) return full;
  }

  const candidates = [
    'peer-server.config.json',
    '.peer-serverrc.json',
    '.peer-serverrc',
  ];

  let dir = resolve(cwd);
  for (let i = 0; i < 4; i++) {
    for (const file of candidates) {
      const candidate = resolve(dir, file);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return undefined;
}

export function loadConfigFile(filePath: string): Partial<PeerServerConfig> {
  try {
    const content = readFileSync(filePath, 'utf8');
    const json = JSON.parse(content);
    if (typeof json !== 'object' || json === null) return {};

    const res: Partial<PeerServerConfig> = {};
    if (typeof json.port === 'number') res.port = json.port;
    if (typeof json.host === 'string') res.host = json.host;
    if (Array.isArray(json.allowedOrigins)) {
      res.allowedOrigins = json.allowedOrigins.filter((s: unknown): s is string => typeof s === 'string');
    }
    if (Array.isArray(json.allowedHosts)) {
      res.allowedHosts = json.allowedHosts.filter((s: unknown): s is string => typeof s === 'string');
    }
    if (typeof json.journalPath === 'string') res.journalPath = json.journalPath;
    if (json.publishKey !== undefined && (typeof json.publishKey !== 'string' || !json.publishKey.trim())) {
      throw new Error('PUBLISH_KEY_CONFIG_INVALID');
    }
    if (typeof json.publishKey === 'string') res.publishKey = json.publishKey;
    if (json.publishKeyOwner !== undefined && (typeof json.publishKeyOwner !== 'string' || !json.publishKeyOwner.trim())) {
      throw new Error('PUBLISH_OWNER_CONFIG_INVALID');
    }
    if (typeof json.publishKeyOwner === 'string') res.publishKeyOwner = json.publishKeyOwner;
    if (typeof json.publishOwner === 'string') res.publishKeyOwner = json.publishOwner;
    const rateLimit = json.publishRateLimit ?? json.rateLimit;
    if (rateLimit && typeof rateLimit === 'object' && !Array.isArray(rateLimit)) {
      if (typeof rateLimit.windowMs === 'number') res.publishRateLimitWindowMs = rateLimit.windowMs;
      if (typeof rateLimit.max === 'number') res.publishRateLimitMax = rateLimit.max;
    }
    if (typeof json.publishRateLimitWindowMs === 'number') res.publishRateLimitWindowMs = json.publishRateLimitWindowMs;
    if (typeof json.publishRateLimitMax === 'number') res.publishRateLimitMax = json.publishRateLimitMax;
    if (typeof json.publishRateLimitPath === 'string') res.publishRateLimitPath = json.publishRateLimitPath;
    if (typeof json.rateLimitPath === 'string') res.publishRateLimitPath = json.rateLimitPath;
    return res;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PUBLISH_')) throw error;
    const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
    throw new Error(`PEER_SERVER_CONFIG_INVALID${detail}`);
  }
}

export function resolvePeerServerConfig(
  options: {
    port?: number;
    host?: string;
    allowedOrigins?: string[];
    allowedHosts?: string[];
    configPath?: string;
    journalPath?: string;
    publishKey?: string;
    publishKeyOwner?: string;
    publishRateLimitWindowMs?: number;
    publishRateLimitMax?: number;
    publishRateLimitPath?: string;
  } = {},
  argv: string[] = process.argv.slice(2),
  cwd: string = process.cwd(),
): PeerServerConfig {
  autoLoadEnvFiles(cwd);
  const cli = parseCliArgs(argv);

  const explicitConfigPath = cli.configPath ?? options.configPath ?? process.env.PEER_SERVER_CONFIG;
  const resolvedConfigPath = findConfigFile(explicitConfigPath, cwd);
  if (explicitConfigPath && !resolvedConfigPath) {
    throw new Error('PEER_SERVER_CONFIG_NOT_FOUND');
  }
  const fileConfig = resolvedConfigPath ? loadConfigFile(resolvedConfigPath) : {};

  const envOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const envHosts = process.env.ALLOWED_HOSTS
    ? process.env.ALLOWED_HOSTS.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const port =
    cli.port ??
    options.port ??
    fileConfig.port ??
    (process.env.PORT ? Number(process.env.PORT) : undefined) ??
    (process.env.PEER_SERVER_PORT ? Number(process.env.PEER_SERVER_PORT) : undefined) ??
    8787;

  const host =
    cli.host ??
    options.host ??
    fileConfig.host ??
    process.env.HOST ??
    process.env.PEER_SERVER_HOST ??
    '127.0.0.1';

  const journalPath =
    cli.journalPath ??
    options.journalPath ??
    fileConfig.journalPath ??
    process.env.FRAMEBOOK_COLLAB_JOURNAL_PATH;

  const envPublishKey = process.env.FRAMEBOOK_PUBLISH_KEY
    ?? process.env.PEER_SERVER_PUBLISH_KEY
    ?? process.env.PUBLISH_KEY;
  const envPublishOwner = process.env.FRAMEBOOK_PUBLISH_OWNER
    ?? process.env.FRAMEBOOK_PUBLISH_KEY_OWNER
    ?? process.env.PEER_SERVER_PUBLISH_OWNER
    ?? process.env.PUBLISH_OWNER_ID;
  const parseEnvNumber = (value: string | undefined): number | undefined => {
    if (value === undefined || value.trim() === '') return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error('PUBLISH_RATE_LIMIT_NUMBER_INVALID');
    return parsed;
  };
  const publishKey =
    (typeof cli.publishKey === 'string' ? cli.publishKey : undefined)
    ?? options.publishKey
    ?? fileConfig.publishKey
    ?? envPublishKey;
  const publishKeyOwner =
    (typeof cli.publishKeyOwner === 'string' ? cli.publishKeyOwner : undefined)
    ?? options.publishKeyOwner
    ?? fileConfig.publishKeyOwner
    ?? envPublishOwner;
  if (publishKey !== undefined && (typeof publishKey !== 'string' || !publishKey.trim())) throw new Error('PUBLISH_KEY_CONFIG_INVALID');
  if (publishKeyOwner !== undefined && (typeof publishKeyOwner !== 'string' || !publishKeyOwner.trim())) throw new Error('PUBLISH_OWNER_CONFIG_INVALID');
  if (publishKeyOwner !== undefined && publishKey === undefined) throw new Error('PUBLISH_OWNER_REQUIRES_KEY');
  const configuredWindow =
    cli.publishRateLimitWindowMs
    ?? options.publishRateLimitWindowMs
    ?? fileConfig.publishRateLimitWindowMs
    ?? parseEnvNumber(process.env.FRAMEBOOK_PUBLISH_RATE_LIMIT_WINDOW_MS
      ?? process.env.PEER_SERVER_PUBLISH_RATE_LIMIT_WINDOW_MS);
  const configuredMax =
    cli.publishRateLimitMax
    ?? options.publishRateLimitMax
    ?? fileConfig.publishRateLimitMax
    ?? parseEnvNumber(process.env.FRAMEBOOK_PUBLISH_RATE_LIMIT_MAX
      ?? process.env.PEER_SERVER_PUBLISH_RATE_LIMIT_MAX);
  if (configuredWindow !== undefined && (!Number.isFinite(configuredWindow) || configuredWindow <= 0)) {
    throw new Error('PUBLISH_RATE_LIMIT_WINDOW_INVALID');
  }
  if (configuredMax !== undefined && (!Number.isFinite(configuredMax) || configuredMax < 0)) {
    throw new Error('PUBLISH_RATE_LIMIT_MAX_INVALID');
  }
  const publishRateLimitWindowMs = Number.isFinite(configuredWindow) && configuredWindow! > 0
    ? Math.max(1_000, Math.floor(configuredWindow!))
    : DEFAULT_PUBLISH_RATE_LIMIT_WINDOW_MS;
  const publishRateLimitMax = configuredMax !== undefined
    ? Number.isFinite(configuredMax) && configuredMax >= 0
      ? Math.floor(configuredMax)
      : DEFAULT_PUBLISH_RATE_LIMIT_MAX
    : publishKey?.trim() ? DEFAULT_PUBLISH_RATE_LIMIT_MAX : 0;
  const publishRateLimitPath =
    cli.publishRateLimitPath
    ?? options.publishRateLimitPath
    ?? fileConfig.publishRateLimitPath
    ?? process.env.FRAMEBOOK_PUBLISH_RATE_LIMIT_PATH
    ?? process.env.PEER_SERVER_PUBLISH_RATE_LIMIT_PATH;
  if (publishRateLimitPath !== undefined && (!publishRateLimitPath.trim() || publishRateLimitPath.includes('\u0000'))) {
    throw new Error('PUBLISH_RATE_LIMIT_PATH_INVALID');
  }

  const allowedOriginsSet = new Set<string>([
    `http://${host}:${port}`,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    ...DEFAULT_ALLOWED_ORIGINS,
    ...(fileConfig.allowedOrigins ?? []),
    ...envOrigins,
    ...(options.allowedOrigins ?? []),
    ...(cli.allowedOrigins ?? []),
  ]);

  const allowedHostsSet = new Set<string>([
    host,
    `${host}:${port}`,
    ...DEFAULT_ALLOWED_HOSTS,
    ...(fileConfig.allowedHosts ?? []),
    ...envHosts,
    ...(options.allowedHosts ?? []),
    ...(cli.allowedHosts ?? []),
  ]);

  return {
    port,
    host,
    allowedOrigins: Array.from(allowedOriginsSet),
    allowedHosts: Array.from(allowedHostsSet),
    configPath: resolvedConfigPath,
    journalPath,
    ...(publishKey?.trim() ? { publishKey: publishKey.trim() } : {}),
    ...(publishKeyOwner?.trim() ? { publishKeyOwner: publishKeyOwner.trim() } : {}),
    publishRateLimitWindowMs,
    publishRateLimitMax,
    ...(publishRateLimitPath?.trim() ? { publishRateLimitPath: resolve(cwd, publishRateLimitPath.trim()) } : {}),
  };
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes('*')) return true;
  if (allowedOrigins.includes(origin)) return true;

  try {
    const u = new URL(origin);
    const hostname = u.hostname.toLowerCase();

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
      return true;
    }

    if (
      hostname === 'framebook-storyboard.pages.dev' ||
      hostname.endsWith('.framebook-storyboard.pages.dev')
    ) {
      return true;
    }

    for (const raw of allowedOrigins) {
      const rule = raw.trim();
      if (!rule) continue;
      if (rule === '*' || rule === origin) return true;

      if (rule.startsWith('*.')) {
        const suffix = rule.slice(2).toLowerCase();
        if (hostname === suffix || hostname.endsWith('.' + suffix)) return true;
      } else if (rule.includes('://*.')) {
        const [ruleProto, ruleDomainPart] = rule.split('://*.');
        if (u.protocol.slice(0, -1) === ruleProto) {
          const ruleDomain = ruleDomainPart.split(':')[0].toLowerCase();
          if (hostname === ruleDomain || hostname.endsWith('.' + ruleDomain)) return true;
        }
      } else if (!rule.includes('://')) {
        const [domainPart, portPart] = rule.split(':');
        if (hostname === domainPart.toLowerCase()) {
          if (!portPart || portPart === '*' || portPart === u.port) return true;
        }
      }
    }
  } catch {}

  return false;
}

export function isHostAllowed(
  hostHeader: string | undefined,
  allowedHosts: string[],
  allowedOrigins: string[] = [],
): boolean {
  if (!hostHeader) return false;

  const rawHost = hostHeader.trim().toLowerCase();
  let hostWithoutPort = rawHost;
  if (rawHost.startsWith('[')) {
    const closeBracketIdx = rawHost.indexOf(']');
    if (closeBracketIdx > 0) {
      hostWithoutPort = rawHost.slice(0, closeBracketIdx + 1);
    }
  } else {
    hostWithoutPort = rawHost.split(':')[0];
  }

  if (
    hostWithoutPort === 'localhost' ||
    hostWithoutPort === '127.0.0.1' ||
    hostWithoutPort === '[::1]'
  ) {
    return true;
  }

  if (
    hostWithoutPort === 'framebook-storyboard.pages.dev' ||
    hostWithoutPort.endsWith('.framebook-storyboard.pages.dev') ||
    hostWithoutPort.endsWith('.trycloudflare.com') ||
    hostWithoutPort.endsWith('.workers.dev') ||
    hostWithoutPort.endsWith('.pages.dev')
  ) {
    return true;
  }

  for (const rule of allowedHosts) {
    const normRule = rule.trim().toLowerCase();
    if (!normRule) continue;
    if (normRule === '*' || normRule === rawHost || normRule === hostWithoutPort) return true;
    if (normRule.startsWith('*.')) {
      const suffix = normRule.slice(2);
      if (hostWithoutPort === suffix || hostWithoutPort.endsWith('.' + suffix)) return true;
    }
  }

  for (const originRule of allowedOrigins) {
    if (originRule.includes(hostWithoutPort)) return true;
    try {
      if (originRule.includes('://')) {
        const u = new URL(originRule);
        if (u.hostname.toLowerCase() === hostWithoutPort) return true;
      }
    } catch {}
  }

  return false;
}

// ============================================================================
// 6. Durable AI Run Ledger Stores (File & SQLite)
// ============================================================================

type AiRunLedgerConflict = { readonly status: 'conflict'; readonly entry?: AiRunOperationRecord };

function ledgerKey(runId: string, requestId: string): string {
  return `${runId}\u0000${requestId}`;
}

function cloneLedger<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalLedgerJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalLedgerJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(name => `${JSON.stringify(name)}:${canonicalLedgerJson(object[name])}`).join(',')}}`;
}

function sameLedgerIdentity(left: AiRunOperationRecord, right: AiRunOperationRecord, allowUnknownBinding = false): boolean {
  const exact = left.status !== 'outcome-unknown' || !allowUnknownBinding;
  return left.runId === right.runId && left.requestId === right.requestId
    && left.documentId === right.documentId && left.actionId === right.actionId
    && left.stepIndex === right.stepIndex
    && (!exact || left.operationId === right.operationId)
    && (!exact || left.transactionId === right.transactionId)
    && (!exact || left.replicaId === right.replicaId);
}

function sameLedgerRow(left: AiRunOperationRecord, right: AiRunOperationRecord): boolean {
  return sameLedgerIdentity(left, right) && canonicalLedgerJson(left) === canonicalLedgerJson(right);
}

function validLedgerEntry(value: unknown): value is AiRunOperationRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as AiRunOperationRecord;
  if (!entry.runId?.trim() || !entry.requestId?.trim() || !entry.documentId?.trim() || !entry.actionId?.trim()
    || !Number.isSafeInteger(entry.stepIndex) || entry.stepIndex < 0
    || !isCommitReceipt(entry.receipt) || entry.receipt.requestId !== entry.requestId
    || entry.receipt.documentId !== entry.documentId || entry.receipt.status !== entry.status
    || !isUtcTimestamp(entry.recordedAt) || !isUtcTimestamp(entry.updatedAt)) return false;
  const receipt = entry.receipt;
  if (entry.operationId !== ('operationId' in receipt && typeof receipt.operationId === 'string' ? receipt.operationId : undefined)
    || entry.transactionId !== ('transactionId' in receipt && typeof receipt.transactionId === 'string' ? receipt.transactionId : undefined)
    || entry.replicaId !== ('replicaId' in receipt && typeof receipt.replicaId === 'string' ? receipt.replicaId : undefined)) return false;
  if (entry.rollbackStatus === undefined) return entry.rollbackUpdatedAt === undefined;
  return (entry.rollbackStatus === 'rolled-back' || entry.rollbackStatus === 'failed' || entry.rollbackStatus === 'outcome-unknown')
    && isUtcTimestamp(entry.rollbackUpdatedAt);
}

function assertLedgerEntry(value: unknown): asserts value is AiRunOperationRecord {
  if (!validLedgerEntry(value)) throw new Error('AI_RUN_LEDGER_ENTRY_INVALID');
}

const ledgerStatusRanks = { rejected: 0, committed: 1, durable: 2, replicating: 3, replicated: 4, 'outcome-unknown': -1 };

function canReplaceLedger(existing: AiRunOperationRecord, entry: AiRunOperationRecord, options: AiRunLedgerWriteOptions): boolean {
  if (!sameLedgerIdentity(existing, entry, options.allowOutcomeUnknownResolution === true)) return false;
  if (options.expectedUpdatedAt !== undefined && existing.updatedAt !== options.expectedUpdatedAt) return false;
  if (options.expectedEntry && canonicalLedgerJson(existing) !== canonicalLedgerJson(options.expectedEntry)) return false;
  if (sameLedgerRow(existing, entry)) return true;
  if (existing.rollbackStatus === 'rolled-back' || existing.rollbackStatus === 'outcome-unknown') {
    if (existing.rollbackStatus !== entry.rollbackStatus) return false;
  }
  if (existing.status === 'outcome-unknown' && entry.status !== 'outcome-unknown') return options.allowOutcomeUnknownResolution === true;
  if (entry.status === 'outcome-unknown' && existing.status !== 'outcome-unknown') return false;
  if (existing.status === 'rejected') return false;
  return ledgerStatusRanks[entry.status] >= ledgerStatusRanks[existing.status];
}

function ledgerRowsFromFile(filePath: string): Map<string, AiRunOperationRecord> {
  if (!existsSync(filePath)) return new Map();
  const rows = readDurableJsonLinesSync<AiRunOperationRecord>(filePath, 'AI_RUN_LEDGER_FILE_CORRUPT');
  const result = new Map<string, AiRunOperationRecord>();
  for (const row of rows) {
    assertLedgerEntry(row);
    result.set(ledgerKey(row.runId, row.requestId), row);
  }
  return result;
}

function recoverTornFinalLedgerRow(filePath: string): void {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, 'utf8');
  if (raw.length > 0 && !raw.endsWith('\n')) truncateSync(filePath, raw.lastIndexOf('\n') + 1);
}

export class FileAiRunLedgerStore implements AiRunLedgerStore {
  constructor(readonly filePath: string) {}

  find(runId: string, requestId: string): AiRunOperationRecord | null {
    return withFileLockSync(this.filePath, () => cloneLedger(ledgerRowsFromFile(this.filePath).get(ledgerKey(runId, requestId)) ?? null));
  }

  list(runId: string): readonly AiRunOperationRecord[] {
    return withFileLockSync(this.filePath, () => [...ledgerRowsFromFile(this.filePath).values()]
      .filter(row => row.runId === runId)
      .map(cloneLedger));
  }

  appendIdempotent(entry: AiRunOperationRecord, options: AiRunLedgerWriteOptions = {}): AiRunLedgerWriteResult | AiRunLedgerConflict {
    assertLedgerEntry(entry);
    return withFileLockSync(this.filePath, () => {
      const rows = ledgerRowsFromFile(this.filePath);
      const existing = rows.get(ledgerKey(entry.runId, entry.requestId));
      const duplicateOperation = entry.operationId && [...rows.values()].find(row =>
        row.runId === entry.runId && row.requestId !== entry.requestId && row.operationId === entry.operationId);
      if (duplicateOperation) return { status: 'conflict', entry: cloneLedger(duplicateOperation) };
      if (existing && sameLedgerRow(existing, entry)) {
        if (options.expectedUpdatedAt !== undefined && existing.updatedAt !== options.expectedUpdatedAt) return { status: 'conflict', entry: cloneLedger(existing) };
        if (options.expectedEntry && canonicalLedgerJson(existing) !== canonicalLedgerJson(options.expectedEntry)) return { status: 'conflict', entry: cloneLedger(existing) };
        return { status: 'duplicate', entry: cloneLedger(existing) };
      }
      if (options.expectedEntry && !existing) return { status: 'conflict' };
      if (existing && !canReplaceLedger(existing, entry, options)) return { status: 'conflict', entry: cloneLedger(existing) };
      mkdirSync(dirname(this.filePath), { recursive: true });
      recoverTornFinalLedgerRow(this.filePath);
      appendDurableLineSync(this.filePath, `${JSON.stringify(entry)}\n`);
      return { status: existing ? 'updated' : 'appended', entry: cloneLedger(entry) };
    });
  }
}

type SqliteLedgerRow = { run_id: string; request_id: string; entry_json: string };
type SqliteLedgerDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): SqliteLedgerRow | undefined;
    all(...params: unknown[]): SqliteLedgerRow[];
    run(...params: unknown[]): { changes: number };
  };
  close(): void;
};

function openLedgerDatabase(filePath: string): SqliteLedgerDb {
  try {
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => SqliteLedgerDb };
    return new DatabaseSync(filePath);
  } catch (error) {
    throw new Error('AI_RUN_LEDGER_SQLITE_RUNTIME_UNAVAILABLE', { cause: error });
  }
}

function ledgerRowEntry(row: SqliteLedgerRow): AiRunOperationRecord {
  try {
    const entry = JSON.parse(row.entry_json) as AiRunOperationRecord;
    if (entry.runId !== row.run_id || entry.requestId !== row.request_id) throw new Error();
    assertLedgerEntry(entry);
    return entry;
  } catch {
    throw new Error('AI_RUN_LEDGER_SQLITE_CORRUPT');
  }
}

export class SqliteAiRunLedgerStore implements AiRunLedgerStore {
  private readonly db: SqliteLedgerDb;

  constructor(readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = openLedgerDatabase(filePath);
    this.db.exec(`PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS framebook_ai_run_operation_ledger (
        run_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        entry_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(run_id, request_id)
      );`);
  }

  close(): void { this.db.close(); }

  find(runId: string, requestId: string): AiRunOperationRecord | null {
    const row = this.db.prepare('SELECT run_id, request_id, entry_json FROM framebook_ai_run_operation_ledger WHERE run_id = ? AND request_id = ?').get(runId, requestId);
    return row ? ledgerRowEntry(row) : null;
  }

  list(runId: string): readonly AiRunOperationRecord[] {
    return this.db.prepare('SELECT run_id, request_id, entry_json FROM framebook_ai_run_operation_ledger WHERE run_id = ? ORDER BY updated_at, request_id').all(runId).map(ledgerRowEntry);
  }

  appendIdempotent(entry: AiRunOperationRecord, options: AiRunLedgerWriteOptions = {}): AiRunLedgerWriteResult | AiRunLedgerConflict {
    assertLedgerEntry(entry);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const duplicate = entry.operationId
        ? this.db.prepare('SELECT run_id, request_id, entry_json FROM framebook_ai_run_operation_ledger WHERE run_id = ? AND request_id <> ?').all(entry.runId, entry.requestId)
          .map(ledgerRowEntry).find(row => row.operationId === entry.operationId)
        : undefined;
      if (duplicate) { this.db.exec('ROLLBACK'); return { status: 'conflict', entry: cloneLedger(duplicate) }; }
      const existingRow = this.db.prepare('SELECT run_id, request_id, entry_json FROM framebook_ai_run_operation_ledger WHERE run_id = ? AND request_id = ?').get(entry.runId, entry.requestId);
      const existing = existingRow ? ledgerRowEntry(existingRow) : undefined;
      if (existing && sameLedgerRow(existing, entry)) {
        if ((options.expectedUpdatedAt !== undefined && existing.updatedAt !== options.expectedUpdatedAt)
          || (options.expectedEntry && canonicalLedgerJson(existing) !== canonicalLedgerJson(options.expectedEntry))) {
          this.db.exec('ROLLBACK');
          return { status: 'conflict', entry: cloneLedger(existing) };
        }
        this.db.exec('ROLLBACK');
        return { status: 'duplicate', entry: cloneLedger(existing) };
      }
      if (options.expectedEntry && !existing) {
        this.db.exec('ROLLBACK');
        return { status: 'conflict' };
      }
      if (existing && !canReplaceLedger(existing, entry, options)) {
        this.db.exec('ROLLBACK');
        return { status: 'conflict', entry: cloneLedger(existing) };
      }
      this.db.prepare(`INSERT INTO framebook_ai_run_operation_ledger(run_id, request_id, entry_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(run_id, request_id) DO UPDATE SET entry_json = excluded.entry_json, updated_at = excluded.updated_at`)
        .run(entry.runId, entry.requestId, JSON.stringify(entry), entry.updatedAt);
      this.db.exec('COMMIT');
      return { status: existing ? 'updated' : 'appended', entry: cloneLedger(entry) };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve original failure */ }
      throw error;
    }
  }
}

// ============================================================================
// 7. WebMCP Peer Server (Room Control Plane, HTTP MCP Router & WS Relay)
// ============================================================================

export type PeerCapability = 'mcp-control' | 'mcp-crdt';
export type ClientSessionStatus = 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired' | 'room-rotated';

export interface ClientSessionTicket {
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
  status: ClientSessionStatus;
  approvedAt?: number;
  revokedAt?: number;
  approvalRequestId?: string;
  clientLabel?: string;
  readonly capabilities: readonly PeerCapability[];
}

export interface PendingApprovalRequest {
  requestId: string;
  clientToken: string;
  sessionId: string;
  roomId: string;
  roomEpoch: number;
  clientLabel: string;
  identity: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
}

export interface PendingMcpRequest {
  socket: PeerSocket;
  timer: ReturnType<typeof setTimeout>;
  method: string;
  id: string | number;
  wireId: string | number;
  includeCatalogMeta?: boolean;
}

export interface RoomEntry {
  id: string;
  roomEpoch: number;
  roomState: 'provisioned' | 'provider-connected' | 'accepting-clients' | 'active' | 'rotating' | 'rotated' | 'expired';
  createdAt: number;
  updatedAt: number;
  alias: string;
  ownerId?: string;
  providerToken: string;
  inviteToken: string;
  inviteConsumed: boolean;
  capabilities: readonly PeerCapability[];
  approvalRequired: boolean;
  expiresAt: number;
  providerSocket?: PeerSocket;
  clientSockets: Set<PeerSocket>;
  cachedTools?: unknown[];
  catalogSource?: 'deployment' | 'provider';
  catalogVersion: number;
  catalogHash: string;
  catalogUpdatedAt?: number;
  mcpPending: Map<string, PendingMcpRequest>;
  clientTokens: Map<string, ClientSessionTicket>;
  pendingApprovals: Map<string, PendingApprovalRequest>;
  clientSocketTickets: Map<PeerSocket, ClientSessionTicket>;
  rotatedTo?: string;
  reconnectLeaseToken: string;
  reconnectLeaseHash: string;
  reconnectLeaseExpiresAt: number;
  rotatedRetainUntil?: number;
  metadataRetainUntil?: number;
}

export interface WebMcpPeerServerOptions {
  port?: number;
  host?: string;
  allowedOrigins?: string[];
  allowedHosts?: string[];
  configPath?: string;
  journalPath?: string;
  publishKey?: string;
  publishKeyOwner?: string;
  publishRateLimitWindowMs?: number;
  publishRateLimitMax?: number;
  publishRateLimitStore?: PublishRateLimitStore;
  mcpRequestTimeoutMs?: number;
  roomSweepIntervalMs?: number;
  deploymentCatalog?: DeploymentCatalogInput;
  serverName?: string;
  serverVersion?: string;
  /**
   * Optional custom HTTP route hook invoked after CORS/Origin validation and
   * before `/p/*` room routes. Return `true` if the request was handled.
   */
  customHttpHandler?: (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    origin: string | undefined,
    server: WebMcpPeerServer,
  ) => Promise<boolean> | boolean;
  /**
   * Optional custom WebSocket upgrade hook invoked after Origin validation and
   * before `/p/:id/provider` and `/p/:id/client` routes. Return `true` if handled.
   */
  customUpgradeHandler?: (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    url: URL,
    origin: string | undefined,
    server: WebMcpPeerServer,
  ) => Promise<boolean> | boolean;
  /** Optional custom error mapper for unhandled HTTP exceptions. */
  formatHttpError?: (
    req: IncomingMessage,
    error: unknown,
  ) => { status: number; error: string; requestId?: string };
}

export class WebMcpPeerServer {
  readonly server: Server;
  readonly rooms = new Map<string, RoomEntry>();
  port: number;
  readonly host: string;
  readonly allowedOrigins: string[];
  readonly allowedHosts: string[];
  readonly configPath?: string;
  readonly publishKeyConfigured: boolean;
  readonly publishKeyOwner?: string;
  readonly publishRateLimitWindowMs: number;
  readonly publishRateLimitMax: number;
  readonly publishRateLimitStore: PublishRateLimitStore;
  readonly mcpRequestTimeoutMs: number;
  readonly deploymentCatalog: DeploymentCatalogSnapshot;
  readonly serverName: string;
  readonly serverVersion: string;
  private mcpWireSequence = 0;
  private readonly publishKeyHash?: string;
  protected readonly roomSweepTimer?: ReturnType<typeof setInterval>;
  private readonly customHttpHandler?: WebMcpPeerServerOptions['customHttpHandler'];
  private readonly customUpgradeHandler?: WebMcpPeerServerOptions['customUpgradeHandler'];
  private readonly formatHttpErrorHook?: WebMcpPeerServerOptions['formatHttpError'];

  constructor(options: WebMcpPeerServerOptions = {}) {
    const config = resolvePeerServerConfig(options);
    this.port = config.port;
    this.host = config.host;
    this.allowedOrigins = config.allowedOrigins;
    this.allowedHosts = config.allowedHosts;
    this.configPath = config.configPath;
    this.publishKeyConfigured = Boolean(config.publishKey);
    this.publishKeyOwner = config.publishKeyOwner;
    this.publishRateLimitWindowMs = config.publishRateLimitWindowMs;
    this.publishRateLimitMax = config.publishRateLimitMax;
    this.publishRateLimitStore = options.publishRateLimitStore
      ?? (config.publishRateLimitPath
        ? new FilePublishRateLimitStore(config.publishRateLimitPath)
        : new InMemoryPublishRateLimitStore());
    this.publishKeyHash = config.publishKey
      ? createHash('sha256').update(config.publishKey, 'utf8').digest('hex')
      : undefined;
    this.mcpRequestTimeoutMs = Math.max(1000, options.mcpRequestTimeoutMs ?? 30_000);
    this.deploymentCatalog = loadDeploymentCatalog(options.deploymentCatalog);
    this.serverName = options.serverName ?? 'framebook-peer-server';
    this.serverVersion = options.serverVersion ?? '0.4.0';
    this.customHttpHandler = options.customHttpHandler;
    this.customUpgradeHandler = options.customUpgradeHandler;
    this.formatHttpErrorHook = options.formatHttpError;

    const sweepMs = options.roomSweepIntervalMs === 0
      ? 0 : Math.max(1000, options.roomSweepIntervalMs ?? 30_000);
    if (sweepMs > 0) {
      this.roomSweepTimer = setInterval(() => this.cleanupExpiredRooms(), sweepMs);
      this.roomSweepTimer.unref?.();
    }

    this.server = http.createServer((req, res) => {
      void this.handleHttp(req, res).catch(error => {
        if (res.headersSent) { res.destroy(); return; }
        const failure = this.formatHttpError(req, error);
        this.sendJson(
          res,
          failure.status,
          { error: failure.error, ...(failure.requestId ? { requestId: failure.requestId } : {}) },
          typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
        );
      });
    });
    this.server.on('upgrade', (req, socket, head) => {
      void this.handleUpgrade(req, socket, head).catch(() => socket.destroy());
    });
  }

  protected formatHttpError(
    req: IncomingMessage,
    error: unknown,
  ): { status: number; error: string; requestId?: string } {
    if (this.formatHttpErrorHook) {
      return this.formatHttpErrorHook(req, error);
    }
    return { status: 500, error: 'PEER_REQUEST_FAILED' };
  }

  async listen(): Promise<number> {
    return new Promise((resolvePort, reject) => {
      const onError = (err: Error) => {
        this.server.removeListener('error', onError);
        reject(err);
      };
      this.server.once('error', onError);
      this.server.listen(this.port, this.host, () => {
        this.server.removeListener('error', onError);
        const addr = this.server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : this.port;
        this.port = actualPort;
        resolvePort(actualPort);
      });
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolveClose, reject) => {
      if (this.roomSweepTimer) clearInterval(this.roomSweepTimer);
      for (const room of this.rooms.values()) {
        this.failPendingForProvider(room);
        for (const pending of room.mcpPending.values()) clearTimeout(pending.timer);
        room.mcpPending.clear();
        room.providerSocket?.close();
        for (const cs of room.clientSockets) cs.close();
      }
      this.rooms.clear();
      this.server.close((err) => (err ? reject(err) : resolveClose()));
    });
  }

  isOriginAllowed(origin?: string): boolean {
    return isOriginAllowed(origin, this.allowedOrigins);
  }

  isHostAllowed(hostHeader?: string): boolean {
    return isHostAllowed(hostHeader, this.allowedHosts, this.allowedOrigins);
  }

  protected emptyCatalogHash(): string {
    return createHash('sha256').update('[]').digest('hex');
  }

  protected createRoomEntry(
    alias = 'wireframe-local',
    approvalRequired = true,
    ttlMs = 2 * 60 * 60 * 1000,
    roomEpoch = 1,
    capabilities: readonly PeerCapability[] = ['mcp-control'],
    ownerId?: string,
  ): RoomEntry {
    const id = randomBytes(16).toString('hex');
    const providerToken = randomBytes(24).toString('hex');
    const inviteToken = randomBytes(24).toString('hex');
    const reconnectLeaseToken = randomBytes(24).toString('hex');
    const expiresAt = Date.now() + Math.max(60_000, ttlMs);
    return {
      id,
      roomEpoch,
      roomState: 'provisioned',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      alias,
      ...(ownerId ? { ownerId } : {}),
      providerToken,
      inviteToken,
      inviteConsumed: false,
      capabilities: [...new Set<PeerCapability>(['mcp-control', ...capabilities])],
      approvalRequired,
      expiresAt,
      reconnectLeaseToken,
      reconnectLeaseHash: createHash('sha256').update(reconnectLeaseToken).digest('hex'),
      reconnectLeaseExpiresAt: Math.min(expiresAt, Date.now() + 15 * 60_000),
      metadataRetainUntil: expiresAt + 24 * 60 * 60_000,
      clientSockets: new Set(),
      clientSocketTickets: new Map(),
      pendingApprovals: new Map(),
      ...(this.deploymentCatalog.tools.length > 0
        ? {
            cachedTools: structuredClone(this.deploymentCatalog.tools) as unknown[],
            catalogUpdatedAt: this.deploymentCatalog.catalogUpdatedAt,
            catalogSource: 'deployment' as const,
          }
        : {}),
      catalogVersion: this.deploymentCatalog.tools.length > 0 ? this.deploymentCatalog.catalogVersion : 0,
      catalogHash: this.deploymentCatalog.tools.length > 0 ? this.deploymentCatalog.catalogHash : this.emptyCatalogHash(),
      mcpPending: new Map(),
      clientTokens: new Map(),
    };
  }

  public requestOrigin(req: IncomingMessage): string {
    const forwardedProto = (req.headers['x-forwarded-proto'] as string) || ((req.socket as any).encrypted ? 'https' : 'http');
    const addr = this.server.address();
    const currentPort = typeof addr === 'object' && addr ? addr.port : this.port;
    const fallbackHost = `${this.host}:${currentPort}`;
    const rawForwardedHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || fallbackHost;
    const safeHost = this.isHostAllowed(rawForwardedHost) ? rawForwardedHost : fallbackHost;
    return `${forwardedProto}://${safeHost}`;
  }

  protected roomDescriptor(req: IncomingMessage, entry: RoomEntry): Record<string, unknown> {
    const serverUrl = this.requestOrigin(req);
    return {
      id: entry.id,
      roomId: entry.id,
      roomEpoch: entry.roomEpoch,
      providerToken: entry.providerToken,
      inviteToken: entry.inviteToken,
      reconnectToken: entry.reconnectLeaseToken,
      reconnectTokenExpiresAt: entry.reconnectLeaseExpiresAt,
      descriptorUrl: `${serverUrl}/p/${entry.id}/mcp`,
      expiresAt: entry.expiresAt,
      state: entry.roomState,
      createdAt: new Date(entry.createdAt).toISOString(),
      updatedAt: new Date(entry.updatedAt).toISOString(),
      approvalRequired: entry.approvalRequired,
      capabilities: [...entry.capabilities],
      alias: entry.alias,
      ...(entry.ownerId ? { ownerId: entry.ownerId } : {}),
    };
  }

  protected isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  protected parsePeerCapabilities(value: unknown, fallback: readonly PeerCapability[] = ['mcp-control']): PeerCapability[] | null {
    if (value === undefined) return [...fallback];
    if (!Array.isArray(value) || value.length === 0) return null;
    const capabilities = [...new Set(value)];
    if (!capabilities.every(item => item === 'mcp-control' || item === 'mcp-crdt')) return null;
    if (!capabilities.includes('mcp-control')) capabilities.unshift('mcp-control');
    return capabilities as PeerCapability[];
  }

  protected normalizeTools(value: unknown): unknown[] | null {
    if (!Array.isArray(value) || value.length > 128) return null;
    const tools = value.filter((tool): tool is Record<string, unknown> => (
      this.isRecord(tool) && typeof tool.name === 'string' && tool.name.length > 0
    ));
    if (tools.length !== value.length) return null;
    const names = new Set<string>();
    for (const tool of tools) {
      const name = tool.name as string;
      if (names.has(name)) return null;
      names.add(name);
      if ('inputSchema' in tool && (!this.isRecord(tool.inputSchema) || tool.inputSchema.type !== 'object')) return null;
    }
    try {
      return structuredClone(tools);
    } catch {
      return null;
    }
  }

  protected catalogHash(tools: unknown[]): string {
    const canonicalize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonicalize);
      if (!this.isRecord(value)) return value;
      return Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
    };
    const orderedTools = [...tools].sort((left, right) => {
      const leftName = this.isRecord(left) && typeof left.name === 'string' ? left.name : '';
      const rightName = this.isRecord(right) && typeof right.name === 'string' ? right.name : '';
      return leftName.localeCompare(rightName);
    });
    const canonical = canonicalize(orderedTools);
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  protected isRpcRequest(value: unknown): value is { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: unknown } {
    if (!this.isRecord(value) || value.jsonrpc !== '2.0' || typeof value.method !== 'string') return false;
    if ('id' in value && value.id !== undefined && value.id !== null
      && typeof value.id !== 'string' && typeof value.id !== 'number') return false;
    return true;
  }

  protected isRpcResponse(value: unknown): value is { jsonrpc: '2.0'; id: string | number; result?: unknown; error?: unknown } {
    return this.isRecord(value) && value.jsonrpc === '2.0'
      && (typeof value.id === 'string' || typeof value.id === 'number')
      && ('result' in value || 'error' in value);
  }

  protected rpcKey(id: string | number): string {
    return `${typeof id}:${String(id)}`;
  }

  protected allocateWireId(entry: RoomEntry, id: string | number): string | number {
    if (!entry.mcpPending.has(this.rpcKey(id))) return id;
    let wireId: string;
    do {
      wireId = `framebook:${++this.mcpWireSequence}:${typeof id}:${String(id)}`;
    } while (entry.mcpPending.has(this.rpcKey(wireId)));
    return wireId;
  }

  protected hasPendingRequest(entry: RoomEntry, socket: PeerSocket, id: string | number): boolean {
    for (const pending of entry.mcpPending.values()) {
      if (pending.socket === socket && pending.id === id) return true;
    }
    return false;
  }

  protected sendRpcError(socket: PeerSocket, id: string | number | null | undefined, code: number, message: string, data?: unknown): void {
    if (id === undefined) return;
    const error: Record<string, unknown> = { code, message };
    if (data !== undefined) error.data = data;
    socket.send({ type: 'mcp', message: { jsonrpc: '2.0', id, error } });
  }

  protected replaceCatalog(entry: RoomEntry, value: unknown): boolean {
    const tools = this.normalizeTools(value);
    if (!tools) return false;
    const hash = this.catalogHash(tools);
    if (entry.catalogVersion > 0 && hash === entry.catalogHash) return true;
    entry.cachedTools = tools;
    entry.catalogSource = 'provider';
    entry.catalogHash = hash;
    entry.catalogVersion += 1;
    entry.catalogUpdatedAt = Date.now();
    for (const client of entry.clientSockets) {
      client.send({
        type: 'mcp',
        message: {
          jsonrpc: '2.0',
          method: 'notifications/tools/list_changed',
          params: { catalogVersion: entry.catalogVersion, catalogHash: entry.catalogHash },
        },
      });
    }
    return true;
  }

  protected clearPending(entry: RoomEntry, key: string, error?: { code: number; message: string }): void {
    const pending = entry.mcpPending.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    entry.mcpPending.delete(key);
    if (error) {
      this.sendRpcError(pending.socket, pending.id, error.code, error.message);
    }
  }

  protected failPendingForSocket(entry: RoomEntry, socket: PeerSocket, error?: { code: number; message: string }): void {
    for (const [key, pending] of entry.mcpPending) {
      if (pending.socket === socket) {
        clearTimeout(pending.timer);
        entry.mcpPending.delete(key);
        if (error) this.sendRpcError(pending.socket, pending.id, error.code, error.message);
      }
    }
  }

  protected failPendingForProvider(entry: RoomEntry): void {
    for (const [key, pending] of entry.mcpPending) {
      clearTimeout(pending.timer);
      entry.mcpPending.delete(key);
      this.sendRpcError(pending.socket, pending.id, -32001, 'PROVIDER_DISCONNECTED');
    }
  }

  protected mcpCatalogCacheHeaders(catalogVersion: number, catalogHash: string): Record<string, string> {
    return {
      'Cache-Control': 'public, max-age=30, s-maxage=300, stale-while-revalidate=60, stale-if-error=600',
      ETag: `"mcp-catalog-${catalogVersion}-${catalogHash}"`,
      'X-MCP-Catalog-Version': String(catalogVersion),
      'X-MCP-Catalog-Hash': catalogHash,
      Vary: 'Origin, Accept-Encoding',
    };
  }

  protected mcpDeploymentCatalogCacheHeaders(catalogVersion: number, catalogHash: string): Record<string, string> {
    return {
      'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
      'CDN-Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"mcp-deployment-catalog-${catalogVersion}-${catalogHash}"`,
      'X-MCP-Catalog-Version': String(catalogVersion),
      'X-MCP-Catalog-Hash': catalogHash,
      Vary: 'Origin, Accept-Encoding',
    };
  }

  protected mcpDescriptorCacheHeaders(body: unknown, catalogVersion: number, catalogHash: string): Record<string, string> {
    const digest = createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
    return {
      'Cache-Control': 'public, max-age=5, s-maxage=30, stale-while-revalidate=60, stale-if-error=300',
      ETag: `"mcp-descriptor-${digest}"`,
      'X-MCP-Catalog-Version': String(catalogVersion),
      'X-MCP-Catalog-Hash': catalogHash,
      Vary: 'Origin, Accept-Encoding',
    };
  }

  protected mcpPostMetadataHeaders(catalogVersion: number, catalogHash: string): Record<string, string> {
    return {
      'Cache-Control': 'no-store',
      'X-MCP-Catalog-Version': String(catalogVersion),
      'X-MCP-Catalog-Hash': catalogHash,
      Vary: 'Origin',
    };
  }

  protected sendMcpMetadata(
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    body: unknown,
    origin: string | undefined,
    cacheHeaders: Record<string, string>,
    allowNotModified = false,
  ): void {
    if (allowNotModified) {
      const requested = req.headers['if-none-match'];
      const ifNoneMatch = Array.isArray(requested) ? requested.join(',') : requested;
      const etag = cacheHeaders.ETag;
      const matched = typeof ifNoneMatch === 'string' && etag
        && (ifNoneMatch.split(',').some(token => token.trim() === etag) || ifNoneMatch.trim() === '*');
      if (matched) {
        const isAllowed = this.isOriginAllowed(origin);
        const headers: Record<string, string> = { ...cacheHeaders, 'Content-Length': '0' };
        if (origin && isAllowed) {
          headers['Access-Control-Allow-Origin'] = origin;
          headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With, X-Publish-Key, X-Framebook-Owner, X-Owner-Id';
        }
        res.writeHead(304, headers);
        res.end();
        return;
      }
    }
    this.sendJson(res, status, body, origin, cacheHeaders);
  }

  protected mcpRoomState(entry: RoomEntry | undefined, now = Date.now()): 'unknown' | 'expired' | 'rotated' | RoomEntry['roomState'] {
    if (!entry) return 'unknown';
    if (entry.rotatedTo) return 'rotated';
    if (entry.expiresAt <= now || entry.roomState === 'expired') return 'expired';
    return entry.roomState;
  }

  protected mcpCatalogSnapshot(entry: RoomEntry | undefined): { tools: unknown[]; catalogVersion: number; catalogHash: string; catalogUpdatedAt: number | null } {
    const deployment = this.deploymentCatalog;
    const fallback = deployment.tools.length > 0
      ? { tools: structuredClone(deployment.tools) as unknown[], catalogVersion: deployment.catalogVersion, catalogHash: deployment.catalogHash, catalogUpdatedAt: deployment.catalogUpdatedAt }
      : { tools: [] as unknown[], catalogVersion: 0, catalogHash: this.emptyCatalogHash(), catalogUpdatedAt: null };
    return {
      tools: entry?.cachedTools ? structuredClone(entry.cachedTools) : fallback.tools,
      catalogVersion: entry?.cachedTools ? entry.catalogVersion : fallback.catalogVersion,
      catalogHash: entry?.cachedTools ? entry.catalogHash : fallback.catalogHash,
      catalogUpdatedAt: entry?.cachedTools ? entry.catalogUpdatedAt ?? null : fallback.catalogUpdatedAt,
    };
  }

  protected mcpAuthMetadata(entry: RoomEntry | undefined, state: string): Record<string, unknown> {
    return {
      discovery: 'public',
      execution: 'client-ticket-and-approval',
      clientTokenRequired: true,
      approvalRequired: entry?.approvalRequired ?? true,
      state,
    };
  }

  public sendJson(res: ServerResponse, status: number, body: unknown, origin?: string, extraHeaders?: Record<string, string>): void {
    const isAllowed = this.isOriginAllowed(origin);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    };
    if (origin && isAllowed) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With, X-Publish-Key, X-Framebook-Owner, X-Owner-Id';
      headers['Vary'] = 'Origin';
    }
    if (extraHeaders) Object.assign(headers, extraHeaders);
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  }

  public constantTimeTokenEqual(left: string, right: string): boolean {
    const leftBytes = Buffer.from(left, 'utf8');
    const rightBytes = Buffer.from(right, 'utf8');
    if (leftBytes.length !== rightBytes.length) return false;
    return timingSafeEqual(leftBytes, rightBytes);
  }

  public bearerToken(req: IncomingMessage): string {
    const authorization = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0] : req.headers.authorization;
    if (typeof authorization === 'string' && /^Bearer\s+/i.test(authorization)) {
      return authorization.replace(/^Bearer\s+/i, '').trim();
    }
    const header = req.headers['x-publish-key'];
    return typeof header === 'string' ? header.trim() : '';
  }

  public authorizePublishRequest(req: IncomingMessage): { ok: true; tokenHash: string } | { ok: false; tokenHash: string; error: 'PUBLISH_KEY_REQUIRED' | 'PUBLISH_KEY_INVALID' } {
    if (!this.publishKeyConfigured || !this.publishKeyHash) {
      return { ok: true, tokenHash: 'anonymous' };
    }
    const token = this.bearerToken(req);
    if (!token) return { ok: false, tokenHash: 'missing', error: 'PUBLISH_KEY_REQUIRED' };
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    if (!this.constantTimeTokenEqual(tokenHash, this.publishKeyHash)) return { ok: false, tokenHash, error: 'PUBLISH_KEY_INVALID' };
    return { ok: true, tokenHash };
  }

  protected publishRateIdentity(req: IncomingMessage, tokenHash: string): string {
    return `${req.socket.remoteAddress ?? 'unknown'}\u0000${tokenHash}`;
  }

  public async consumePublishRateLimit(req: IncomingMessage, tokenHash: string): Promise<
    { available: true; allowed: boolean; retryAfterMs: number; remaining: number }
    | { available: false; retryAfterMs: number }
  > {
    if (this.publishRateLimitMax === 0) {
      return { available: true, allowed: true, retryAfterMs: 0, remaining: Number.POSITIVE_INFINITY };
    }
    try {
      const decision = validatePublishRateLimitDecision(await this.publishRateLimitStore.consume({
        key: this.publishRateIdentity(req, tokenHash),
        nowMs: Date.now(),
        windowMs: this.publishRateLimitWindowMs,
        max: this.publishRateLimitMax,
      }));
      return { available: true, ...decision };
    } catch {
      return { available: false, retryAfterMs: 1_000 };
    }
  }

  public async readJsonBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) throw new Error('BODY_TOO_LARGE');
      chunks.push(buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!this.isRecord(parsed)) throw new Error('BODY_OBJECT_REQUIRED');
    return parsed;
  }

  protected resolveClientTicket(entry: RoomEntry, token: string): ClientSessionTicket | null {
    const ticket = entry.clientTokens.get(token);
    if (!ticket) return null;
    if (entry.expiresAt <= Date.now()) {
      entry.roomState = entry.roomState === 'rotated' ? entry.roomState : 'expired';
      entry.updatedAt = Date.now();
    }
    if (ticket.expiresAt <= Date.now()) {
      if (ticket.status !== 'revoked' && ticket.status !== 'rejected' && ticket.status !== 'room-rotated') ticket.status = 'expired';
      return ticket;
    }
    return ticket;
  }

  protected clientTicketError(ticket: ClientSessionTicket | null): { status: number; code: number; message: string } | null {
    if (!ticket) return { status: 401, code: -32003, message: 'CLIENT_TOKEN_REQUIRED' };
    if (ticket.status === 'pending') return { status: 403, code: -32053, message: 'CLIENT_APPROVAL_REQUIRED' };
    if (ticket.status === 'rejected') return { status: 403, code: -32054, message: 'CLIENT_APPROVAL_DENIED' };
    if (ticket.status === 'expired') return { status: 410, code: -32056, message: 'SESSION_EXPIRED' };
    if (ticket.status === 'revoked') return { status: 401, code: -32001, message: 'SESSION_INVALID' };
    return null;
  }

  protected findClientToken(entry: RoomEntry, sessionId: string): { token: string; ticket: ClientSessionTicket } | null {
    for (const [token, ticket] of entry.clientTokens) {
      if (ticket.sessionId === sessionId) return { token, ticket };
    }
    return null;
  }

  protected sendApprovalRequest(entry: RoomEntry, ticket: ClientSessionTicket, socket?: PeerSocket): PendingApprovalRequest | null {
    if (!entry.approvalRequired || ticket.status === 'approved') return null;
    const existing = ticket.approvalRequestId ? entry.pendingApprovals.get(ticket.approvalRequestId) : undefined;
    if (existing) {
      entry.providerSocket?.send({
        protocol: 'webmcp-peer/1', messageId: `approval-${existing.requestId}`, type: 'approval.request',
        roomId: entry.id, roomEpoch: entry.roomEpoch, sessionId: ticket.sessionId, requestId: existing.requestId,
        sentAt: new Date(existing.createdAt).toISOString(), expiresAt: existing.expiresAt,
        payload: { requestId: existing.requestId, sessionId: ticket.sessionId, roomId: entry.id, roomEpoch: entry.roomEpoch, clientLabel: existing.clientLabel, capabilities: [...ticket.capabilities], requestedAt: new Date(existing.createdAt).toISOString(), expiresAt: existing.expiresAt },
      });
      if (socket) socket.send({ type: 'approval.pending', roomId: entry.id, roomEpoch: entry.roomEpoch, requestId: existing.requestId, sessionId: ticket.sessionId, capabilities: [...ticket.capabilities], expiresAt: existing.expiresAt });
      return existing;
    }
    const requestId = `approval-${randomBytes(16).toString('hex')}`;
    const request: PendingApprovalRequest = {
      requestId,
      clientToken: [...entry.clientTokens.entries()].find(([, candidate]) => candidate === ticket)?.[0] ?? '',
      sessionId: ticket.sessionId,
      roomId: entry.id,
      roomEpoch: entry.roomEpoch,
      clientLabel: ticket.clientLabel || 'MCP client',
      identity: { sessionId: ticket.sessionId, roomId: entry.id, clientLabel: ticket.clientLabel || 'MCP client' },
      createdAt: Date.now(),
      expiresAt: Math.min(entry.expiresAt, Date.now() + this.mcpRequestTimeoutMs),
    };
    ticket.approvalRequestId = requestId;
    entry.pendingApprovals.set(requestId, request);
    const approvalTimer = setTimeout(() => {
      const current = entry.pendingApprovals.get(requestId);
      if (!current || current.expiresAt > Date.now()) return;
      entry.pendingApprovals.delete(requestId);
      if (ticket.status !== 'pending') return;
      ticket.status = 'expired';
      ticket.revokedAt = Date.now();
      ticket.approvalRequestId = undefined;
      for (const [clientSocket, boundTicket] of entry.clientSocketTickets) {
        if (boundTicket !== ticket) continue;
        clientSocket.send({ protocol: 'webmcp-peer/1', messageId: `approval-expired-${requestId}`, type: 'approval.expired', roomId: entry.id, roomEpoch: entry.roomEpoch, sessionId: ticket.sessionId, requestId, reason: 'APPROVAL_EXPIRED' });
        clientSocket.close();
        entry.clientSocketTickets.delete(clientSocket);
        entry.clientSockets.delete(clientSocket);
      }
    }, Math.max(1, request.expiresAt - Date.now()));
    approvalTimer.unref?.();
    const sentAt = new Date(request.createdAt).toISOString();
    entry.providerSocket?.send({
      protocol: 'webmcp-peer/1',
      messageId: `approval-${requestId}`,
      type: 'approval.request',
      roomId: entry.id,
      roomEpoch: entry.roomEpoch,
      sessionId: ticket.sessionId,
      requestId,
      sentAt,
      expiresAt: request.expiresAt,
      payload: {
        requestId,
        sessionId: ticket.sessionId,
        roomId: entry.id,
        roomEpoch: entry.roomEpoch,
        clientLabel: request.clientLabel,
        capabilities: [...ticket.capabilities],
        requestedAt: sentAt,
        expiresAt: request.expiresAt,
      },
    });
    if (socket) socket.send({ type: 'approval.pending', roomId: entry.id, roomEpoch: entry.roomEpoch, requestId, sessionId: ticket.sessionId, capabilities: [...ticket.capabilities], expiresAt: request.expiresAt });
    return request;
  }

  protected closeClientTicket(entry: RoomEntry, token: string, status: 'rejected' | 'revoked' | 'room-rotated', reason: string): boolean {
    const ticket = entry.clientTokens.get(token);
    if (!ticket) return false;
    ticket.status = status;
    ticket.revokedAt = Date.now();
    const approvalRequestId = ticket.approvalRequestId;
    if (approvalRequestId) entry.pendingApprovals.delete(approvalRequestId);
    for (const [socket, boundTicket] of entry.clientSocketTickets) {
      if (boundTicket !== ticket) continue;
      try {
        const type = status === 'revoked' ? 'session.revoked' : status === 'room-rotated' ? 'room.rotated' : 'approval.rejected';
        socket.send({
          protocol: 'webmcp-peer/1',
          messageId: `${type}-${ticket.sessionId}-${Date.now()}`,
          type,
          roomId: entry.id,
          roomEpoch: entry.roomEpoch,
          sessionId: ticket.sessionId,
          ...(approvalRequestId ? { requestId: approvalRequestId } : {}),
          sentAt: new Date().toISOString(),
          payload: { ...(approvalRequestId ? { requestId: approvalRequestId } : {}), sessionId: ticket.sessionId, roomId: entry.id, roomEpoch: entry.roomEpoch, reason },
          reason,
        });
      } catch {}
      this.failPendingForSocket(entry, socket, { code: status === 'room-rotated' ? -32057 : status === 'revoked' ? -32001 : -32054, message: status === 'room-rotated' ? 'ROOM_ROTATED' : status === 'revoked' ? 'SESSION_INVALID' : 'CLIENT_APPROVAL_DENIED' });
      socket.close();
      entry.clientSocketTickets.delete(socket);
      entry.clientSockets.delete(socket);
    }
    ticket.approvalRequestId = undefined;
    return true;
  }

  protected approveClientTicket(entry: RoomEntry, requestId: string, allow: boolean, reason?: string): boolean {
    const pending = entry.pendingApprovals.get(requestId);
    if (!pending) return false;
    const ticket = entry.clientTokens.get(pending.clientToken);
    entry.pendingApprovals.delete(requestId);
    if (!ticket || ticket.approvalRequestId !== requestId) return false;
    if (!allow) {
      ticket.status = 'rejected';
      ticket.revokedAt = Date.now();
      this.closeClientTicket(entry, pending.clientToken, 'rejected', reason || 'CLIENT_APPROVAL_DENIED');
      return true;
    }
    ticket.status = 'approved';
    ticket.approvedAt = Date.now();
    entry.roomState = 'active';
    entry.updatedAt = Date.now();
    const sentAt = new Date(ticket.approvedAt).toISOString();
    for (const [socket, boundTicket] of entry.clientSocketTickets) {
      if (boundTicket !== ticket) continue;
      socket.send({
        protocol: 'webmcp-peer/1',
        messageId: `approval-approved-${requestId}`,
        type: 'approval.approved',
        roomId: entry.id,
        roomEpoch: entry.roomEpoch,
        sessionId: ticket.sessionId,
        requestId,
        sentAt,
        expiresAt: ticket.expiresAt,
        payload: { requestId, sessionId: ticket.sessionId, roomId: entry.id, roomEpoch: entry.roomEpoch, state: 'approved', clientTokenActive: true, decidedAt: sentAt, expiresAt: ticket.expiresAt },
      });
      socket.send({ type: 'ready', role: 'client', roomId: entry.id, roomEpoch: entry.roomEpoch, sessionId: ticket.sessionId, capabilities: [...ticket.capabilities], expiresAt: ticket.expiresAt, approval: 'approved' });
    }
    ticket.approvalRequestId = undefined;
    return true;
  }

  protected revokeAllClientTickets(entry: RoomEntry, reason: string, status: 'revoked' | 'room-rotated' = 'revoked'): void {
    for (const [token] of entry.clientTokens) this.closeClientTicket(entry, token, status, reason);
    for (const pending of entry.mcpPending.values()) clearTimeout(pending.timer);
    entry.mcpPending.clear();
    entry.pendingApprovals.clear();
  }

  protected resolveBearerClientTicket(entry: RoomEntry, authorization: string | string[] | undefined): ClientSessionTicket | null {
    const header = Array.isArray(authorization) ? authorization[0] : authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    const token = header.slice('Bearer '.length).trim();
    if (!token) return null;
    return this.resolveClientTicket(entry, token);
  }

  protected cleanupExpiredRooms(now = Date.now()): void {
    for (const [roomId, entry] of this.rooms) {
      if (entry.expiresAt > now) continue;
      const retainUntil = Math.max(entry.metadataRetainUntil ?? 0, entry.rotatedRetainUntil ?? 0);
      if (retainUntil > now) {
        if (entry.roomState !== 'expired' && !entry.rotatedTo) {
          entry.roomState = 'expired';
          entry.updatedAt = now;
          this.revokeAllClientTickets(entry, 'ROOM_EXPIRED', 'revoked');
          try { entry.providerSocket?.close(); } catch {}
          for (const socket of entry.clientSockets) {
            try { socket.close(); } catch {}
          }
          entry.providerSocket = undefined;
          entry.clientSockets.clear();
          entry.clientSocketTickets.clear();
        }
        continue;
      }
      this.revokeAllClientTickets(entry, 'ROOM_EXPIRED', 'revoked');
      try { entry.providerSocket?.close(); } catch {}
      for (const socket of entry.clientSockets) {
        try { socket.close(); } catch {}
      }
      entry.providerSocket = undefined;
      entry.clientSockets.clear();
      entry.clientSocketTickets.clear();
      this.rooms.delete(roomId);
    }
  }

  async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    const url = new URL(req.url ?? '/', `http://${this.host}:${this.port}`);
    this.cleanupExpiredRooms();

    // Strict CORS preflight
    if (req.method === 'OPTIONS') {
      if (origin && !this.isOriginAllowed(origin)) {
        res.writeHead(403, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify({ error: 'CORS_ORIGIN_DENIED', origin }));
        return;
      }
      const allowOrigin = origin || `http://${this.host}:${this.port}`;
      res.writeHead(204, {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Publish-Key, X-Framebook-Owner, X-Owner-Id',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      });
      res.end();
      return;
    }

    // Fail-Closed: Deny non-whitelisted browser origins on all HTTP endpoints
    if (origin && !this.isOriginAllowed(origin)) {
      this.sendJson(res, 403, { error: 'ORIGIN_NOT_ALLOWED', origin }, origin);
      return;
    }

    // Health / Status
    if (url.pathname === '/status' || url.pathname === '/health' || url.pathname === '/ping') {
      this.sendJson(res, 200, {
        status: 'healthy',
        activeRooms: this.rooms.size,
        uptimeSec: process.uptime(),
      }, origin);
      return;
    }

    // Public, secret-free profile used by the browser's one-click clone control.
    if (req.method === 'GET' && url.pathname === '/config') {
      const serverUrl = this.requestOrigin(req);
      this.sendJson(res, 200, {
        type: 'framebook.peer.config',
        version: 1,
        serverUrl,
        protocol: 'webmcp-peer/1',
        mcpEndpointTemplate: `${serverUrl}/p/{roomId}/mcp`,
        clientEndpointTemplate: `${serverUrl.replace(/^http/i, 'ws')}/p/{roomId}/client`,
        roomEndpoint: `${serverUrl}/p`,
        defaults: { approvalRequired: true, roomTtlMs: 2 * 60 * 60 * 1000 },
      }, origin);
      return;
    }

    if (this.customHttpHandler) {
      const handled = await this.customHttpHandler(req, res, url, origin, this);
      if (handled) return;
    }

    // 1. Room Creation: POST /p
    if (req.method === 'POST' && url.pathname === '/p') {
      const publishAuth = this.authorizePublishRequest(req);
      const publishRate = await this.consumePublishRateLimit(req, publishAuth.tokenHash);
      if (!publishRate.available) {
        const retryAfterSec = Math.max(1, Math.ceil(publishRate.retryAfterMs / 1000));
        this.sendJson(res, 503, {
          error: 'PUBLISH_RATE_LIMIT_UNAVAILABLE',
          code: -32089,
          retryAfterMs: publishRate.retryAfterMs,
        }, origin, {
          'Retry-After': String(retryAfterSec),
          'X-RateLimit-Limit': String(this.publishRateLimitMax),
          'X-RateLimit-Remaining': '0',
        });
        return;
      }
      if (!publishRate.allowed) {
        const retryAfterSec = Math.max(1, Math.ceil(publishRate.retryAfterMs / 1000));
        this.sendJson(res, 429, {
          error: 'PUBLISH_RATE_LIMITED',
          code: -32088,
          retryAfterMs: publishRate.retryAfterMs,
        }, origin, {
          'Retry-After': String(retryAfterSec),
          'X-RateLimit-Limit': String(this.publishRateLimitMax),
          'X-RateLimit-Remaining': '0',
        });
        return;
      }
      if (!publishAuth.ok) {
        this.sendJson(res, 401, { error: publishAuth.error }, origin);
        return;
      }
      let body: Record<string, unknown>;
      try { body = await this.readJsonBody(req); } catch {
        this.sendJson(res, 400, { error: 'INVALID_JSON_BODY' }, origin);
        return;
      }
      const rawHeaderOwner = req.headers['x-framebook-owner'] ?? req.headers['x-owner-id'];
      const headerOwner = typeof rawHeaderOwner === 'string' ? rawHeaderOwner.trim() : '';
      const bodyOwner = typeof body.ownerId === 'string' ? body.ownerId.trim()
        : typeof body.owner === 'string' ? body.owner.trim() : '';
      const ownerId = this.publishKeyConfigured ? this.publishKeyOwner ?? 'publish-key-owner' : undefined;
      if ((headerOwner && bodyOwner && headerOwner !== bodyOwner)
        || (ownerId && ((headerOwner && headerOwner !== ownerId)
          || (bodyOwner && bodyOwner !== ownerId)))) {
        this.sendJson(res, 403, { error: 'PUBLISH_OWNER_BINDING_INVALID' }, origin);
        return;
      }
      const alias = typeof body.alias === 'string' && body.alias.trim() ? body.alias.trim() : 'wireframe-local';
      const approvalRequired = body.approvalRequired !== false;
      const ttlMs = typeof body.ttlMs === 'number' && Number.isFinite(body.ttlMs) ? body.ttlMs : 2 * 60 * 60 * 1000;
      const capabilities = this.parsePeerCapabilities(body.capabilities);
      if (!capabilities) {
        this.sendJson(res, 400, { error: 'CAPABILITIES_INVALID' }, origin);
        return;
      }
      const entry = this.createRoomEntry(alias, approvalRequired, ttlMs, 1, capabilities, ownerId);
      this.rooms.set(entry.id, entry);
      const rateHeaders = this.publishRateLimitMax > 0 ? {
        'X-RateLimit-Limit': String(this.publishRateLimitMax),
        'X-RateLimit-Remaining': String(publishRate.remaining),
      } : undefined;
      this.sendJson(res, 201, this.roomDescriptor(req, entry), origin, rateHeaders);
      return;
    }

    // Browser F5 handoff: POST /p/:id/reclaim
    const reclaimMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/reclaim$/);
    if (req.method === 'POST' && reclaimMatch) {
      const roomId = reclaimMatch[1];
      const entry = this.rooms.get(roomId);
      if (!entry) {
        this.sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }, origin);
        return;
      }
      if (entry.rotatedTo) {
        this.sendJson(res, 410, {
          error: 'ROOM_ROTATED', code: -32057, roomId, roomEpoch: entry.roomEpoch,
          replacementRoomId: entry.rotatedTo,
        }, origin);
        return;
      }
      const now = Date.now();
      if (entry.expiresAt <= now || entry.reconnectLeaseExpiresAt <= now) {
        this.sendJson(res, 404, { error: 'ROOM_EXPIRED' }, origin);
        return;
      }
      let body: Record<string, unknown>;
      try { body = await this.readJsonBody(req); } catch {
        this.sendJson(res, 400, { error: 'INVALID_JSON_BODY' }, origin);
        return;
      }
      const leaseToken = typeof body.leaseToken === 'string' ? body.leaseToken.trim() : '';
      const requestedEpoch = body.roomEpoch === undefined ? entry.roomEpoch : body.roomEpoch;
      if (!leaseToken || requestedEpoch !== entry.roomEpoch || (body.roomId !== undefined && body.roomId !== roomId)) {
        this.sendJson(res, 409, { error: 'ROOM_LEASE_BINDING_INVALID', code: -32002, roomId, roomEpoch: entry.roomEpoch }, origin);
        return;
      }
      const leaseHash = createHash('sha256').update(leaseToken).digest('hex');
      if (!this.constantTimeTokenEqual(leaseHash, entry.reconnectLeaseHash)) {
        this.sendJson(res, 401, { error: 'ROOM_LEASE_INVALID' }, origin);
        return;
      }
      if (entry.providerSocket) {
        this.sendJson(res, 409, { error: 'ROOM_PROVIDER_ACTIVE', roomId, roomEpoch: entry.roomEpoch }, origin);
        return;
      }

      entry.providerToken = randomBytes(24).toString('hex');
      entry.reconnectLeaseToken = randomBytes(24).toString('hex');
      entry.reconnectLeaseHash = createHash('sha256').update(entry.reconnectLeaseToken).digest('hex');
      entry.reconnectLeaseExpiresAt = Math.min(entry.expiresAt, now + 15 * 60_000);
      entry.updatedAt = now;
      entry.roomState = entry.clientTokens.size ? 'accepting-clients' : 'provisioned';
      this.sendJson(res, 200, {
        ...this.roomDescriptor(req, entry),
        reclaimed: true,
        reclaimedAt: new Date(now).toISOString(),
      }, origin);
      return;
    }

    // Room-independent immutable deployment catalog: GET /mcp/catalog or /mcp/catalog/:hash
    const deploymentCatalogHashMatch = url.pathname.match(/^\/mcp\/catalog\/([a-f0-9]{64})$/);
    if (req.method === 'GET' && (url.pathname === '/mcp/catalog' || deploymentCatalogHashMatch)) {
      const snapshot = this.mcpCatalogSnapshot(undefined);
      if (snapshot.tools.length === 0) {
        this.sendJson(res, 503, { error: 'CATALOG_UNAVAILABLE', catalogVersion: 0, catalogHash: snapshot.catalogHash }, origin);
        return;
      }
      if (deploymentCatalogHashMatch && deploymentCatalogHashMatch[1] !== snapshot.catalogHash) {
        this.sendJson(res, 404, { error: 'CATALOG_HASH_NOT_FOUND', catalogHash: snapshot.catalogHash }, origin);
        return;
      }
      this.sendMcpMetadata(req, res, 200, {
        protocol: 'webmcp-peer.v1',
        source: this.deploymentCatalog.source,
        tools: snapshot.tools,
        catalogVersion: snapshot.catalogVersion,
        catalogHash: snapshot.catalogHash,
        catalogUrl: `/mcp/catalog/${snapshot.catalogHash}`,
        updatedAt: snapshot.catalogUpdatedAt,
        auth: this.mcpAuthMetadata(undefined, 'not-joined'),
      }, origin, deploymentCatalogHashMatch
        ? this.mcpDeploymentCatalogCacheHeaders(snapshot.catalogVersion, snapshot.catalogHash)
        : this.mcpCatalogCacheHeaders(snapshot.catalogVersion, snapshot.catalogHash), true);
      return;
    }

    // MCP Descriptor: GET /p/:id/mcp
    const mcpMatch = url.pathname.match(/^\/p\/([A-Za-z0-9_-]{1,128})\/mcp$/);
    if (req.method === 'GET' && mcpMatch) {
      const roomId = mcpMatch[1];
      const entry = this.rooms.get(roomId);
      const now = Date.now();
      const state = this.mcpRoomState(entry, now);
      const snapshot = this.mcpCatalogSnapshot(entry);
      const descriptor = {
        roomId,
        roomEpoch: entry?.roomEpoch ?? 0,
        alias: entry?.alias ?? 'unknown-room',
        protocol: 'webmcp-peer.v1',
        status: state,
        state,
        roomValid: Boolean(entry && !entry.rotatedTo && entry.expiresAt > now),
        expiresAt: entry?.expiresAt ?? null,
        catalogVersion: snapshot.catalogVersion,
        catalogHash: snapshot.catalogHash,
        toolCount: snapshot.tools.length,
        catalogUpdatedAt: snapshot.catalogUpdatedAt,
        providerConnected: Boolean(entry?.providerSocket),
        approvalRequired: entry?.approvalRequired ?? true,
        auth: this.mcpAuthMetadata(entry, 'not-joined'),
        pendingApprovalCount: entry?.pendingApprovals.size ?? 0,
        activeClientCount: entry ? [...entry.clientTokens.values()].filter(ticket => ticket.status === 'approved').length : 0,
        rotatedTo: entry?.rotatedTo ?? null,
      };
      this.sendMcpMetadata(req, res, 200, descriptor, origin,
        this.mcpDescriptorCacheHeaders(descriptor, snapshot.catalogVersion, snapshot.catalogHash), true);
      return;
    }

    // Cached MCP catalog snapshot: GET /p/:id/mcp/tools
    const toolsMatch = url.pathname.match(/^\/p\/([A-Za-z0-9_-]{1,128})\/mcp\/tools$/);
    if (req.method === 'GET' && toolsMatch) {
      const roomId = toolsMatch[1];
      const entry = this.rooms.get(roomId);
      const snapshot = this.mcpCatalogSnapshot(entry);
      const state = this.mcpRoomState(entry);
      const catalog = {
        roomId,
        tools: snapshot.tools,
        catalogVersion: snapshot.catalogVersion,
        catalogHash: snapshot.catalogHash,
        updatedAt: snapshot.catalogUpdatedAt,
        state,
        roomValid: Boolean(entry && !entry.rotatedTo && entry.expiresAt > Date.now()),
        providerConnected: Boolean(entry?.providerSocket),
        auth: this.mcpAuthMetadata(entry, 'not-joined'),
      };
      if (snapshot.tools.length === 0) {
        this.sendJson(res, 503, { error: 'CATALOG_UNAVAILABLE', catalogVersion: 0, catalogHash: snapshot.catalogHash, auth: this.mcpAuthMetadata(entry, 'not-joined') }, origin);
        return;
      }
      this.sendMcpMetadata(req, res, 200, catalog, origin,
        this.mcpDescriptorCacheHeaders(catalog, snapshot.catalogVersion, snapshot.catalogHash), true);
      return;
    }

    // Canonical MCP-over-HTTP JSON-RPC router: POST /p/:id/mcp
    if (req.method === 'POST' && mcpMatch) {
      const roomId = mcpMatch[1];
      const entry = this.rooms.get(roomId);
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
        if (Buffer.concat(chunks).length > 150_000) break;
      }
      let rpc: unknown;
      try { rpc = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
        this.sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'PARSE_ERROR' } }, origin);
        return;
      }
      if (!this.isRpcRequest(rpc)) {
        this.sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'INVALID_REQUEST' } }, origin);
        return;
      }
      const id = rpc.id ?? null;
      const metadataOnly = rpc.method === 'initialize'
        || rpc.method === 'server/discover'
        || rpc.method === 'tools/list'
        || rpc.method === 'ping'
        || rpc.method === 'notifications/initialized';
      const mcpTicket = entry ? this.resolveBearerClientTicket(entry, req.headers.authorization) : null;
      if (entry && mcpTicket?.status === 'pending') this.sendApprovalRequest(entry, mcpTicket);
      const roomState = this.mcpRoomState(entry);
      const snapshot = this.mcpCatalogSnapshot(entry);
      if (!metadataOnly && !entry) {
        this.sendJson(res, 404, { jsonrpc: '2.0', id, error: { code: -32004, message: 'ROOM_NOT_FOUND', data: { roomId } } }, origin);
        return;
      }
      if (!metadataOnly && entry?.rotatedTo) {
        this.sendJson(res, 410, { jsonrpc: '2.0', id, error: { code: -32057, message: 'ROOM_ROTATED', data: { replacementRoomId: entry.rotatedTo, roomId, roomEpoch: entry.roomEpoch } } }, origin);
        return;
      }
      if (!metadataOnly && entry && entry.expiresAt <= Date.now()) {
        this.sendJson(res, 410, { jsonrpc: '2.0', id, error: { code: -32056, message: 'ROOM_EXPIRED', data: { roomId, roomEpoch: entry.roomEpoch } } }, origin);
        return;
      }
      const mcpAuthError = this.clientTicketError(mcpTicket);
      if (mcpAuthError && !metadataOnly) {
        this.sendJson(res, mcpAuthError.status, { jsonrpc: '2.0', id, error: { code: mcpAuthError.code, message: mcpAuthError.message, data: { roomId, sessionId: mcpTicket?.sessionId ?? null, approvalRequired: entry?.approvalRequired ?? true } } }, origin);
        return;
      }
      if (snapshot.tools.length === 0 && (rpc.method === 'tools/list' || rpc.method === 'server/discover')) {
        this.sendJson(res, 503, { jsonrpc: '2.0', id, error: { code: -32090, message: 'CATALOG_UNAVAILABLE', data: { catalogSource: this.deploymentCatalog.source } } }, origin);
        return;
      }
      if (rpc.method === 'initialize') {
        const initialize = {
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: '2026-07-28',
            capabilities: { tools: { listChanged: true }, stateless: true },
            serverInfo: { name: this.serverName, version: this.serverVersion },
            tools: snapshot.tools,
            _meta: {
              roomId,
              roomEpoch: entry?.roomEpoch ?? 0,
              roomState,
              roomValid: Boolean(entry && !entry.rotatedTo && entry.expiresAt > Date.now()),
              catalogVersion: snapshot.catalogVersion,
              catalogHash: snapshot.catalogHash,
              toolCount: snapshot.tools.length,
              bootstrapCatalog: {
                tools: snapshot.tools,
                catalogVersion: snapshot.catalogVersion,
                catalogHash: snapshot.catalogHash,
                source: entry?.catalogSource ?? this.deploymentCatalog.source,
              },
              auth: this.mcpAuthMetadata(entry, mcpTicket?.status ?? 'not-joined'),
            },
          },
        };
        this.sendJson(res, 200, initialize, origin,
          this.mcpPostMetadataHeaders(snapshot.catalogVersion, snapshot.catalogHash));
        return;
      }
      if (rpc.method === 'ping') {
        this.sendJson(res, 200, { jsonrpc: '2.0', id, result: {} }, origin,
          this.mcpPostMetadataHeaders(snapshot.catalogVersion, snapshot.catalogHash));
        return;
      }
      if (rpc.method === 'notifications/initialized') {
        this.sendJson(res, 202, { jsonrpc: '2.0', id: null, result: {} }, origin,
          this.mcpPostMetadataHeaders(snapshot.catalogVersion, snapshot.catalogHash));
        return;
      }
      if (rpc.method === 'server/discover') {
        const discover = {
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: '2026-07-28',
            serverInfo: { name: this.serverName, version: this.serverVersion },
            tools: snapshot.tools,
            _meta: {
              roomId,
              roomEpoch: entry?.roomEpoch ?? 0,
              roomState,
              roomValid: Boolean(entry && !entry.rotatedTo && entry.expiresAt > Date.now()),
              catalogVersion: snapshot.catalogVersion,
              catalogHash: snapshot.catalogHash,
              auth: this.mcpAuthMetadata(entry, mcpTicket?.status ?? 'not-joined'),
            },
          },
        };
        this.sendJson(res, 200, discover, origin,
          this.mcpPostMetadataHeaders(snapshot.catalogVersion, snapshot.catalogHash));
        return;
      }
      if (rpc.method === 'tools/list') {
        const list = {
          jsonrpc: '2.0', id,
          result: {
            tools: snapshot.tools,
            _meta: {
              roomId,
              roomEpoch: entry?.roomEpoch ?? 0,
              roomState,
              roomValid: Boolean(entry && !entry.rotatedTo && entry.expiresAt > Date.now()),
              catalogVersion: snapshot.catalogVersion,
              catalogHash: snapshot.catalogHash,
              auth: this.mcpAuthMetadata(entry, mcpTicket?.status ?? 'not-joined'),
            },
          },
        };
        this.sendJson(res, 200, list, origin,
          this.mcpPostMetadataHeaders(snapshot.catalogVersion, snapshot.catalogHash));
        return;
      }
      if (!entry) {
        this.sendJson(res, 404, { jsonrpc: '2.0', id, error: { code: -32004, message: 'ROOM_NOT_FOUND', data: { roomId } } }, origin);
        return;
      }
      if (rpc.method === 'tools/call') {
        const params = this.isRecord(rpc.params) ? rpc.params : null;
        if (!params || typeof params.name !== 'string' || !params.name) {
          this.sendJson(res, 400, { jsonrpc: '2.0', id, error: { code: -32602, message: 'tools/call params are invalid' } }, origin);
          return;
        }
        const metadata = this.isRecord(params._meta) ? params._meta : null;
        if ((typeof metadata?.catalogVersion === 'number' && metadata.catalogVersion !== entry.catalogVersion)
          || (typeof metadata?.catalogHash === 'string' && metadata.catalogHash !== entry.catalogHash)) {
          this.sendJson(res, 409, {
            jsonrpc: '2.0', id,
            error: {
              code: -32010,
              message: 'CATALOG_CHANGED',
              data: { catalogVersion: entry.catalogVersion, catalogHash: entry.catalogHash },
            },
          }, origin);
          return;
        }
        if (entry.cachedTools && !entry.cachedTools.some(tool => this.isRecord(tool) && tool.name === params.name)) {
          this.sendJson(res, 400, { jsonrpc: '2.0', id, error: { code: -32602, message: 'TOOL_NOT_FOUND' } }, origin);
          return;
        }
      }
      if (!entry.providerSocket) {
        this.sendJson(res, 503, { jsonrpc: '2.0', id, error: { code: -32001, message: 'PROVIDER_UNAVAILABLE' } }, origin);
        return;
      }
      if (id === null) {
        entry.providerSocket.send({ type: 'mcp', message: rpc });
        this.sendJson(res, 202, { jsonrpc: '2.0', id: null, result: {} }, origin);
        return;
      }
      const wireId = this.allocateWireId(entry, id);
      const key = this.rpcKey(wireId);
      let resolveResponse!: (value: unknown) => void;
      const responsePromise = new Promise<unknown>(resolveResp => { resolveResponse = resolveResp; });
      const bridgeSocket: PeerSocket = {
        send: value => resolveResponse(this.isRecord(value) && value.type === 'mcp' ? value.message : value),
        close: () => {},
      };
      const timer = setTimeout(() => this.clearPending(entry, key, { code: -32001, message: 'MCP_REQUEST_TIMEOUT' }), this.mcpRequestTimeoutMs);
      entry.mcpPending.set(key, { socket: bridgeSocket, timer, method: rpc.method, id, wireId });
      entry.providerSocket.send({ type: 'mcp', message: wireId === id ? rpc : { ...rpc, id: wireId } });
      const response = await responsePromise;
      this.sendJson(res, 200, response, origin);
      return;
    }

    // 2. Client Join: POST /p/:id/join
    const joinMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/join$/);
    if (req.method === 'POST' && joinMatch) {
      const roomId = joinMatch[1];
      const entry = this.rooms.get(roomId);
      if (entry?.rotatedTo) {
        this.sendJson(res, 410, { error: 'ROOM_ROTATED', code: -32057, replacementRoomId: entry.rotatedTo, roomId, roomEpoch: entry.roomEpoch }, origin);
        return;
      }
      if (!entry || entry.expiresAt < Date.now()) {
        this.sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }, origin);
        return;
      }
      let body: Record<string, unknown>;
      try {
        body = await this.readJsonBody(req);
      } catch (error) {
        this.sendJson(res, 400, { error: error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'INVALID_JSON_BODY' }, origin);
        return;
      }
      const inviteToken = typeof body.inviteToken === 'string' ? body.inviteToken.trim() : '';
      if (!inviteToken) {
        this.sendJson(res, 401, { error: 'INVITE_TOKEN_REQUIRED' }, origin);
        return;
      }
      if (entry.inviteConsumed) {
        this.sendJson(res, 409, { error: 'INVITE_TOKEN_CONSUMED' }, origin);
        return;
      }
      if (!this.constantTimeTokenEqual(inviteToken, entry.inviteToken)) {
        this.sendJson(res, 403, { error: 'INVITE_TOKEN_INVALID' }, origin);
        return;
      }
      const requestedCapabilities = this.parsePeerCapabilities(body.capabilities);
      if (!requestedCapabilities) {
        this.sendJson(res, 400, { error: 'CAPABILITIES_INVALID' }, origin);
        return;
      }
      if (requestedCapabilities.includes('mcp-crdt') && !entry.capabilities.includes('mcp-crdt')) {
        this.sendJson(res, 403, { error: 'CRDT_CAPABILITY_NOT_GRANTED' }, origin);
        return;
      }

      entry.inviteConsumed = true;
      const clientToken = randomBytes(24).toString('hex');
      const sessionId = `peer-session-${randomBytes(16).toString('hex')}`;
      const issuedAt = Date.now();
      const approvedAt = entry.approvalRequired ? undefined : issuedAt;
      const clientLabel = typeof body.clientLabel === 'string' && body.clientLabel.trim() ? body.clientLabel.trim() : 'MCP client';
      const ticket: ClientSessionTicket = {
        sessionId,
        issuedAt,
        expiresAt: entry.expiresAt,
        status: entry.approvalRequired ? 'pending' : 'approved',
        ...(approvedAt ? { approvedAt } : {}),
        clientLabel,
        capabilities: requestedCapabilities,
      };
      entry.clientTokens.set(clientToken, ticket);
      entry.roomState = entry.roomState === 'provisioned' || entry.roomState === 'provider-connected'
        ? 'accepting-clients' : entry.roomState;
      entry.updatedAt = Date.now();
      const approval = this.sendApprovalRequest(entry, ticket);

      this.sendJson(res, 201, {
        roomId,
        roomEpoch: entry.roomEpoch,
        clientToken,
        sessionId,
        issuedAt,
        expiresAt: entry.expiresAt,
        approvalRequired: entry.approvalRequired,
        capabilities: [...ticket.capabilities],
        approvalState: ticket.status,
        state: entry.approvalRequired ? 'pending-approval' : 'approved',
        ...(approval ? { approvalRequestId: approval.requestId } : {}),
      }, origin);
      return;
    }

    // 3. HTTP Approval Decision: POST /p/:id/approval/:requestId
    const approvalMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/approval\/([^/]+)$/);
    if (req.method === 'POST' && approvalMatch) {
      const roomId = approvalMatch[1];
      const requestId = decodeURIComponent(approvalMatch[2]);
      const entry = this.rooms.get(roomId);
      if (!entry || entry.expiresAt <= Date.now()) {
        this.sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }, origin);
        return;
      }
      const authorization = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
      const bearer = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      if (!bearer || !this.constantTimeTokenEqual(bearer, entry.providerToken)) {
        this.sendJson(res, 401, { error: 'PROVIDER_TOKEN_REQUIRED' }, origin);
        return;
      }
      const body: Record<string, unknown> = await this.readJsonBody(req).catch(() => ({} as Record<string, unknown>));
      const pending = entry.pendingApprovals.get(requestId);
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
      const roomEpoch = typeof body.roomEpoch === 'number' ? body.roomEpoch : undefined;
      const decision = body.decision;
      if (!pending || !sessionId || pending.sessionId !== sessionId || body.roomId !== roomId || roomEpoch !== entry.roomEpoch
        || (decision !== 'approved' && decision !== 'rejected')) {
        this.sendJson(res, 409, { error: 'INVALID_APPROVAL', code: -32081 }, origin);
        return;
      }
      const handled = this.approveClientTicket(entry, requestId, decision === 'approved', typeof body.reason === 'string' ? body.reason : undefined);
      if (!handled) {
        this.sendJson(res, 409, { error: 'INVALID_APPROVAL', code: -32081 }, origin);
        return;
      }
      this.sendJson(res, 200, {
        requestId,
        sessionId,
        roomId,
        roomEpoch: entry.roomEpoch,
        state: decision,
        clientTokenActive: decision === 'approved',
        decidedAt: new Date().toISOString(),
        expiresAt: new Date(pending.expiresAt).toISOString(),
      }, origin);
      return;
    }

    // 4. Session Status: GET /p/:id/sessions/:sessionId
    const sessionStatusMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/sessions\/([^/]+)$/);
    if (req.method === 'GET' && sessionStatusMatch) {
      const roomId = sessionStatusMatch[1];
      const sessionId = decodeURIComponent(sessionStatusMatch[2]);
      const entry = this.rooms.get(roomId);
      if (!entry) {
        this.sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }, origin);
        return;
      }
      if (entry.rotatedTo) {
        this.sendJson(res, 410, { error: 'ROOM_ROTATED', code: -32057, replacementRoomId: entry.rotatedTo, roomId, roomEpoch: entry.roomEpoch }, origin);
        return;
      }
      const authorization = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
      const bearer = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      const found = this.findClientToken(entry, sessionId);
      const authorized = Boolean(bearer && ((found && this.constantTimeTokenEqual(bearer, found.token)) || this.constantTimeTokenEqual(bearer, entry.providerToken)));
      if (!authorized || !found) {
        this.sendJson(res, authorized ? 404 : 401, { error: authorized ? 'SESSION_NOT_FOUND' : 'CLIENT_TOKEN_REQUIRED' }, origin);
        return;
      }
      const ticket = found.ticket;
      if (ticket.expiresAt <= Date.now() && ticket.status !== 'revoked' && ticket.status !== 'rejected') ticket.status = 'expired';
      const state = ticket.status === 'pending' ? 'pending-approval' : ticket.status === 'rejected' ? 'rejected' : ticket.status;
      this.sendJson(res, 200, {
        roomId,
        roomEpoch: entry.roomEpoch,
        sessionId,
        state,
        clientLabel: ticket.clientLabel ?? 'MCP client',
        approvalRequestId: ticket.approvalRequestId ?? null,
        issuedAt: new Date(ticket.issuedAt).toISOString(),
        expiresAt: new Date(ticket.expiresAt).toISOString(),
        ...(ticket.approvedAt ? { approvedAt: new Date(ticket.approvedAt).toISOString() } : {}),
        ...(ticket.revokedAt ? { revokedAt: new Date(ticket.revokedAt).toISOString() } : {}),
      }, origin);
      return;
    }

    // 5. Session Revocation: POST /p/:id/session/revoke or POST /p/:id/sessions/:sessionId/revoke
    const revokePeerMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/(?:session\/revoke|sessions\/([^/]+)\/revoke)$/);
    if (req.method === 'POST' && revokePeerMatch) {
      const roomId = revokePeerMatch[1];
      const entry = this.rooms.get(roomId);
      if (!entry || entry.expiresAt <= Date.now()) {
        this.sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }, origin);
        return;
      }
      const authorization = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
      const bearer = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      const body: Record<string, unknown> = await this.readJsonBody(req).catch(() => ({} as Record<string, unknown>));
      const pathSessionId = revokePeerMatch[2] ? decodeURIComponent(revokePeerMatch[2]) : '';
      if (pathSessionId && (body.roomId !== roomId || body.roomEpoch !== entry.roomEpoch)) {
        this.sendJson(res, 409, { error: 'SESSION_BINDING_INVALID', code: -32002 }, origin);
        return;
      }
      if (pathSessionId) body.sessionId = pathSessionId;
      if (bearer && this.constantTimeTokenEqual(bearer, entry.providerToken)) {
        const requestedSessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
        if (!requestedSessionId) {
          this.revokeAllClientTickets(entry, 'ROOM_REVOKED');
          this.sendJson(res, 200, { roomId, revoked: true, revokedSessions: true }, origin);
          return;
        }
        const found = this.findClientToken(entry, requestedSessionId);
        if (!found) {
          this.sendJson(res, 404, { error: 'SESSION_NOT_FOUND' }, origin);
          return;
        }
        this.closeClientTicket(entry, found.token, 'revoked', 'SESSION_REVOKED');
        this.sendJson(res, 200, { roomId, roomEpoch: entry.roomEpoch, sessionId: requestedSessionId, state: 'revoked', revoked: true, revokedAt: new Date().toISOString(), reason: body.reason ?? 'provider-request', alreadyRevoked: found.ticket.status === 'revoked' }, origin);
        return;
      }
      const ticket = bearer ? this.resolveClientTicket(entry, bearer) : null;
      if (!ticket) {
        this.sendJson(res, 401, { error: 'CLIENT_TOKEN_REQUIRED' }, origin);
        return;
      }
      if (typeof body.sessionId === 'string' && body.sessionId && body.sessionId !== ticket.sessionId) {
        this.sendJson(res, 403, { error: 'SESSION_BINDING_INVALID' }, origin);
        return;
      }
      if (body.roomId !== roomId || body.roomEpoch !== entry.roomEpoch) {
        this.sendJson(res, 409, { error: 'SESSION_BINDING_INVALID', code: -32002 }, origin);
        return;
      }
      this.closeClientTicket(entry, bearer, 'revoked', 'CLIENT_REVOKED');
      this.sendJson(res, 200, { roomId, roomEpoch: entry.roomEpoch, sessionId: ticket.sessionId, state: 'revoked', revoked: true, revokedAt: new Date().toISOString(), reason: body.reason ?? 'client-request', alreadyRevoked: ticket.status === 'revoked' }, origin);
      return;
    }

    // 6. Room Rotation: POST /p/:id/rotate
    const rotateMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/rotate$/);
    if (req.method === 'POST' && rotateMatch) {
      const roomId = rotateMatch[1];
      const entry = this.rooms.get(roomId);
      if (!entry || entry.expiresAt <= Date.now()) {
        this.sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }, origin);
        return;
      }
      const authorization = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
      const bearer = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      if (!bearer || !this.constantTimeTokenEqual(bearer, entry.providerToken)) {
        this.sendJson(res, 401, { error: 'PROVIDER_TOKEN_REQUIRED' }, origin);
        return;
      }
      const body: Record<string, unknown> = await this.readJsonBody(req).catch(() => ({} as Record<string, unknown>));
      if ((body.roomId !== undefined && body.roomId !== roomId) || (body.roomEpoch !== undefined && body.roomEpoch !== entry.roomEpoch)) {
        this.sendJson(res, 409, { error: 'ROOM_ROTATED', code: -32057, roomId, roomEpoch: entry.roomEpoch, replacementRoomId: entry.rotatedTo ?? null }, origin);
        return;
      }
      const alias = typeof body.alias === 'string' && body.alias.trim() ? body.alias.trim() : entry.alias;
      const ttlMs = typeof body.ttlMs === 'number' && Number.isFinite(body.ttlMs) ? body.ttlMs : 2 * 60 * 60 * 1000;
      const rotatedAt = Date.now();
      entry.roomState = 'rotating';
      entry.updatedAt = rotatedAt;
      const replacement = this.createRoomEntry(alias, entry.approvalRequired, ttlMs, entry.roomEpoch + 1, entry.capabilities, entry.ownerId);
      this.rooms.set(replacement.id, replacement);
      entry.rotatedTo = replacement.id;
      entry.expiresAt = rotatedAt;
      entry.rotatedRetainUntil = rotatedAt + 5 * 60_000;
      entry.roomState = 'rotated';
      entry.updatedAt = rotatedAt;
      this.revokeAllClientTickets(entry, 'ROOM_ROTATED', 'room-rotated');
      entry.providerSocket?.send({
        protocol: 'webmcp-peer/1',
        messageId: `room-rotated-${entry.id}`,
        type: 'room.rotated',
        roomId: entry.id,
        roomEpoch: entry.roomEpoch,
        sentAt: new Date().toISOString(),
        payload: { previousRoomId: entry.id, previousRoomEpoch: entry.roomEpoch, previousState: 'rotated', replacementRoomId: replacement.id, replacementRoomEpoch: replacement.roomEpoch, rotatedAt: new Date().toISOString(), invalidatedSessionCount: entry.clientTokens.size },
        rotatedTo: replacement.id,
      });
      for (const socket of entry.clientSockets) {
        socket.send({
          protocol: 'webmcp-peer/1',
          messageId: `room-rotated-${entry.id}-${entry.clientTokens.size}`,
          type: 'room.rotated',
          roomId: entry.id,
          roomEpoch: entry.roomEpoch,
          sentAt: new Date().toISOString(),
          payload: { previousRoomId: entry.id, previousRoomEpoch: entry.roomEpoch, previousState: 'rotated', replacementRoomId: replacement.id, replacementRoomEpoch: replacement.roomEpoch, rotatedAt: new Date().toISOString(), invalidatedSessionCount: entry.clientTokens.size },
          rotatedTo: replacement.id,
        });
      }
      entry.providerSocket?.close();
      for (const socket of entry.clientSockets) socket.close();
      entry.clientSockets.clear();
      entry.clientSocketTickets.clear();
      entry.providerSocket = undefined;
      this.sendJson(res, 201, {
        ...this.roomDescriptor(req, replacement),
        rotatedFrom: roomId,
        previousRoomId: roomId,
        previousRoomEpoch: entry.roomEpoch,
        previousState: 'rotated',
        replacementRoomId: replacement.id,
        replacementRoomEpoch: replacement.roomEpoch,
        rotatedAt: new Date().toISOString(),
        invalidatedSessionCount: entry.clientTokens.size,
      }, origin);
      return;
    }

    this.sendJson(res, 404, { error: 'NOT_FOUND' }, origin);
  }

  async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    try {
      const origin = req.headers.origin;
      if (origin && !this.isOriginAllowed(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nOrigin not allowed\r\n');
        socket.destroy();
        return;
      }

      const url = new URL(req.url ?? '/', `http://${this.host}:${this.port}`);
      if (this.customUpgradeHandler) {
        const handled = await this.customUpgradeHandler(req, socket, head, url, origin, this);
        if (handled) return;
      }

      const providerMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/provider$/);
      const clientMatch = url.pathname.match(/^\/p\/([a-f0-9]+)\/client$/);

      if (providerMatch) {
        const roomId = providerMatch[1];
        const entry = this.rooms.get(roomId);
        if (!entry || entry.expiresAt <= Date.now()) {
          socket.destroy();
          return;
        }
        const protocols = typeof req.headers['sec-websocket-protocol'] === 'string'
          ? req.headers['sec-websocket-protocol'].split(',').map(value => value.trim()) : [];
        const ticket = protocols.find(value => value.startsWith('ticket.'))?.slice('ticket.'.length);
        if (!ticket || !this.constantTimeTokenEqual(ticket, entry.providerToken)) {
          socket.destroy();
          return;
        }

        const peer = upgradeWebSocket(
          req,
          socket,
          head,
          (text) => {
            try {
              if (entry.expiresAt <= Date.now()) {
                peer.close();
                return;
              }
              const msg = JSON.parse(text);
              if (msg && msg.type === 'ping') {
                peer.send({ type: 'pong', timestamp: Date.now() });
                return;
              }
              if (msg && msg.type === 'approval.decision') {
                const payload = this.isRecord(msg.payload) ? msg.payload : msg;
                const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
                const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
                const roomEpoch = typeof payload.roomEpoch === 'number' ? payload.roomEpoch : msg.roomEpoch;
                const decision = payload.decision;
                const reason = typeof payload.reason === 'string' ? payload.reason : undefined;
                if (msg.protocol !== 'webmcp-peer/1' || typeof msg.messageId !== 'string'
                  || !requestId || !sessionId || payload.roomId !== roomId || roomEpoch !== entry.roomEpoch
                  || (msg.roomId !== undefined && msg.roomId !== roomId)
                  || (msg.sessionId !== undefined && msg.sessionId !== sessionId)
                  || (decision !== 'approved' && decision !== 'rejected')) {
                  peer.send({ type: 'error', code: -32081, message: 'INVALID_APPROVAL', requestId: requestId || null });
                  return;
                }
                const pending = entry.pendingApprovals.get(requestId);
                if (!pending || pending.sessionId !== sessionId) {
                  peer.send({ type: 'error', code: -32081, message: 'INVALID_APPROVAL', requestId });
                  return;
                }
                const handled = this.approveClientTicket(entry, requestId, decision === 'approved', reason);
                if (!handled) {
                  peer.send({ type: 'error', code: -32081, message: 'INVALID_APPROVAL', requestId });
                  return;
                }
                peer.send({
                  protocol: 'webmcp-peer/1',
                  messageId: `approval-decision-${requestId}`,
                  type: decision === 'approved' ? 'approval.approved' : 'approval.rejected',
                  roomId,
                  roomEpoch: entry.roomEpoch,
                  sessionId,
                  requestId,
                  sentAt: new Date().toISOString(),
                  expiresAt: pending.expiresAt,
                  payload: { requestId, sessionId, roomId, roomEpoch: entry.roomEpoch, state: decision, clientTokenActive: decision === 'approved', decidedAt: new Date().toISOString(), expiresAt: pending.expiresAt },
                  ...(reason ? { reason } : {}),
                });
                return;
              }
              if (msg.type === 'register' && Array.isArray(msg.tools)) {
                this.replaceCatalog(entry, msg.tools);
                for (const cs of entry.clientSockets) cs.send(msg);
                return;
              }
              if (msg.type === 'mcp' && this.isRpcResponse(msg.message)) {
                const rpc = msg.message;
                const pending = entry.mcpPending.get(this.rpcKey(rpc.id));
                if (!pending) return;
                this.clearPending(entry, this.rpcKey(rpc.id));
                if (this.isRecord(rpc.result) && 'tools' in rpc.result) {
                  this.replaceCatalog(entry, rpc.result.tools);
                }
                let response = pending.wireId === pending.id
                  ? msg
                  : { ...msg, message: { ...rpc, id: pending.id } };
                if (pending.includeCatalogMeta && this.isRecord(rpc.result) && 'tools' in rpc.result) {
                  const responseMessage = this.isRecord(response) && this.isRecord(response.message) ? response.message : rpc;
                  response = {
                    ...response,
                    message: {
                      ...responseMessage,
                      result: {
                        ...rpc.result,
                        catalogVersion: entry.catalogVersion,
                        catalogHash: entry.catalogHash,
                      },
                    },
                  };
                }
                pending.socket.send(response);
                return;
              }
              if (msg.type === 'mcp' && this.isRpcRequest(msg.message)) {
                for (const cs of entry.clientSockets) cs.send(msg);
                return;
              }
              for (const cs of entry.clientSockets) {
                cs.send(msg);
              }
            } catch { /* malformed frames ignored */ }
          },
          () => {
            if (entry.providerSocket === peer) {
              entry.providerSocket = undefined;
              this.failPendingForProvider(entry);
            }
          },
        );

        entry.providerSocket = peer;
        entry.roomState = entry.clientTokens.size ? 'accepting-clients' : 'provider-connected';
        entry.updatedAt = Date.now();
        peer.send({ type: 'ready', role: 'provider', roomId, roomEpoch: entry.roomEpoch, capabilities: [...entry.capabilities], expiresAt: entry.expiresAt });
        for (const ticket of entry.clientTokens.values()) {
          if (ticket.status === 'pending') this.sendApprovalRequest(entry, ticket);
        }
        return;
      }

      if (clientMatch) {
        const roomId = clientMatch[1];
        const entry = this.rooms.get(roomId);
        if (!entry || entry.expiresAt <= Date.now()) {
          socket.destroy();
          return;
        }
        const protocols = typeof req.headers['sec-websocket-protocol'] === 'string'
          ? req.headers['sec-websocket-protocol'].split(',').map(value => value.trim()) : [];
        const ticket = protocols.find(value => value.startsWith('ticket.'))?.slice('ticket.'.length);
        const clientTicket = ticket ? this.resolveClientTicket(entry, ticket) : null;
        if (!ticket || !clientTicket || clientTicket.expiresAt <= Date.now() || clientTicket.status === 'revoked' || clientTicket.status === 'rejected' || clientTicket.status === 'expired' || clientTicket.status === 'room-rotated') {
          socket.destroy();
          return;
        }

        const peer = upgradeWebSocket(
          req,
          socket,
          head,
          (text) => {
            try {
              if (entry.expiresAt <= Date.now() || clientTicket.expiresAt <= Date.now()) {
                peer.close();
                return;
              }
              const msg = JSON.parse(text);
              if (msg && msg.type === 'ping') {
                peer.send({ type: 'pong', timestamp: Date.now() });
                return;
              }
              if (msg?.type === 'mcp') {
                const rpc = msg.message;
                if (!this.isRpcRequest(rpc)) {
                  this.sendRpcError(peer, this.isRecord(rpc) && ('id' in rpc) ? (rpc.id as any) : undefined, -32600, 'INVALID_REQUEST');
                  return;
                }
                if (clientTicket.status !== 'approved') {
                  const statusCode = clientTicket.status === 'revoked' || clientTicket.status === 'room-rotated' ? -32001 : clientTicket.status === 'expired' ? -32056 : clientTicket.status === 'rejected' ? -32054 : -32053;
                  const statusMessage = clientTicket.status === 'revoked' || clientTicket.status === 'room-rotated' ? 'SESSION_INVALID' : clientTicket.status === 'expired' ? 'SESSION_EXPIRED' : clientTicket.status === 'rejected' ? 'CLIENT_APPROVAL_DENIED' : 'CLIENT_APPROVAL_REQUIRED';
                  this.sendRpcError(peer, rpc.id, statusCode, statusMessage, {
                    sessionId: clientTicket.sessionId,
                    approvalRequestId: clientTicket.approvalRequestId,
                  });
                  return;
                }
                const id = rpc.id;
                if (id === undefined || id === null) {
                  entry.providerSocket?.send(msg);
                  return;
                }
                if (rpc.method === 'tools/call') {
                  const params = this.isRecord(rpc.params) ? rpc.params : null;
                  if (!params || typeof params.name !== 'string' || !params.name) {
                    this.sendRpcError(peer, id, -32602, 'tools/call params are invalid');
                    return;
                  }
                  const metadata = this.isRecord(params._meta) ? params._meta : null;
                  const version = metadata?.catalogVersion;
                  const hash = metadata?.catalogHash;
                  if ((typeof version === 'number' && version !== entry.catalogVersion)
                    || (typeof hash === 'string' && hash !== entry.catalogHash)) {
                    this.sendRpcError(peer, id, -32010, 'CATALOG_CHANGED', {
                      catalogVersion: entry.catalogVersion,
                      catalogHash: entry.catalogHash,
                    });
                    return;
                  }
                  if (entry.cachedTools && !entry.cachedTools.some(tool => this.isRecord(tool) && tool.name === params.name)) {
                    this.sendRpcError(peer, id, -32602, 'TOOL_NOT_FOUND');
                    return;
                  }
                }
                if (this.hasPendingRequest(entry, peer, id)) {
                  this.sendRpcError(peer, id, -32600, 'DUPLICATE_REQUEST_ID');
                  return;
                }
                const wireId = this.allocateWireId(entry, id);
                const key = this.rpcKey(wireId);
                if (!entry.providerSocket) {
                  this.sendRpcError(peer, id, -32001, 'PROVIDER_UNAVAILABLE');
                  return;
                }
                const timer = setTimeout(() => {
                  this.clearPending(entry, key, { code: -32001, message: 'MCP_REQUEST_TIMEOUT' });
                }, this.mcpRequestTimeoutMs);
                entry.mcpPending.set(key, {
                  socket: peer,
                  timer,
                  method: rpc.method,
                  id,
                  wireId,
                  includeCatalogMeta: this.isRecord(rpc.params) && this.isRecord(rpc.params._meta),
                });
                const wireMessage = wireId === id ? msg : { ...msg, message: { ...rpc, id: wireId } };
                entry.providerSocket.send(wireMessage);
                return;
              }
              entry.providerSocket?.send(msg);
            } catch { /* malformed frames ignored */ }
          },
          () => {
            entry.clientSockets.delete(peer);
            entry.clientSocketTickets.delete(peer);
            this.failPendingForSocket(entry, peer);
          },
        );

        entry.clientSockets.add(peer);
        entry.clientSocketTickets.set(peer, clientTicket);
        peer.send({ type: 'ready', role: 'client', roomId, roomEpoch: entry.roomEpoch, sessionId: clientTicket.sessionId, capabilities: [...clientTicket.capabilities], expiresAt: clientTicket.expiresAt, approval: clientTicket.status });
        if (clientTicket.status === 'pending') this.sendApprovalRequest(entry, clientTicket, peer);
        return;
      }

      socket.destroy();
    } catch {
      socket.destroy();
    }
  }
}

export function createWebMcpPeerServer(options?: WebMcpPeerServerOptions): WebMcpPeerServer {
  return new WebMcpPeerServer(options);
}
