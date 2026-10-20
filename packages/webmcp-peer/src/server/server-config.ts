import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { publishRateLimitSqlitePathFromEnv } from "./rate-limit.js";

export interface PeerServerConfig {
  port: number;
  host: string;
  allowedOrigins: string[];
  allowedHosts: string[];
  configPath?: string;
  publishKey?: string;
  publishKeyOwner?: string;
  publishRateLimitWindowMs: number;
  publishRateLimitMax: number;
  /** JSON file of the publish rate limit (`FilePublishRateLimitStore`), resolved against `cwd`. */
  publishRateLimitPath?: string;
  /**
   * SQLite database of the publish rate limit (`SqlitePublishRateLimitStore`), resolved against
   * `cwd`. The relay prefers it to `publishRateLimitPath` when both are set.
   */
  publishRateLimitSqlitePath?: string;
}

export interface CliParsedArgs {
  port?: number;
  host?: string;
  allowedOrigins?: string[];
  allowedHosts?: string[];
  configPath?: string;
  publishKey?: string;
  publishKeyOwner?: string;
  publishRateLimitWindowMs?: number;
  publishRateLimitMax?: number;
  publishRateLimitPath?: string;
  publishRateLimitSqlitePath?: string;
  help?: boolean;
}

export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  "http://localhost:4500",
  "http://127.0.0.1:4500",
  "http://[::1]:4500",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://[::1]:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://framebook-storyboard.pages.dev",
]);

export const DEFAULT_ALLOWED_HOSTS: readonly string[] = Object.freeze([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "framebook-storyboard.pages.dev",
  "*.framebook-storyboard.pages.dev",
  "*.trycloudflare.com",
  "*.workers.dev",
  "*.pages.dev",
]);

export const DEFAULT_PUBLISH_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_PUBLISH_RATE_LIMIT_MAX = 30;

export function loadEnvFile(envPath: string): Record<string, string> {
  const loaded: Record<string, string> = {};
  if (!existsSync(envPath)) return loaded;

  try {
    const content = readFileSync(envPath, "utf8");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
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
    candidates.push(resolve(curr, ".env.local"));
    candidates.push(resolve(curr, ".env"));
    const parent = dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }

  for (let i = candidates.length - 1; i >= 0; i--) {
    loadEnvFile(candidates[i]!);
  }
}

export function parseCliArgs(args: readonly string[]): CliParsedArgs {
  const parsed: CliParsedArgs = {};
  const originList: string[] = [];
  const hostList: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "-p" || arg === "--port") {
      const val = args[++i];
      if (val && !isNaN(Number(val))) parsed.port = Number(val);
    } else if (arg.startsWith("--port=")) {
      const val = arg.slice("--port=".length);
      if (val && !isNaN(Number(val))) parsed.port = Number(val);
    } else if (arg === "--host") {
      parsed.host = args[++i];
    } else if (arg.startsWith("--host=")) {
      parsed.host = arg.slice("--host=".length);
    } else if (arg === "-o" || arg === "--allowed-origins" || arg === "--allowed-origin") {
      const val = args[++i];
      if (val) originList.push(...val.split(",").map((s) => s.trim()).filter(Boolean));
    } else if (arg.startsWith("--allowed-origins=")) {
      const val = arg.slice("--allowed-origins=".length);
      if (val) originList.push(...val.split(",").map((s) => s.trim()).filter(Boolean));
    } else if (arg === "--allowed-hosts" || arg === "--allowed-host") {
      const val = args[++i];
      if (val) hostList.push(...val.split(",").map((s) => s.trim()).filter(Boolean));
    } else if (arg.startsWith("--allowed-hosts=")) {
      const val = arg.slice("--allowed-hosts=".length);
      if (val) hostList.push(...val.split(",").map((s) => s.trim()).filter(Boolean));
    } else if (arg === "-c" || arg === "--config") {
      parsed.configPath = args[++i];
    } else if (arg.startsWith("--config=")) {
      parsed.configPath = arg.slice("--config=".length);
    } else if (arg === "--publish-key" || arg === "--publishKey") {
      parsed.publishKey = args[++i];
    } else if (arg.startsWith("--publish-key=")) {
      parsed.publishKey = arg.slice("--publish-key=".length);
    } else if (arg === "--publish-owner" || arg === "--publish-key-owner" || arg === "--publishKeyOwner") {
      parsed.publishKeyOwner = args[++i];
    } else if (arg.startsWith("--publish-owner=")) {
      parsed.publishKeyOwner = arg.slice("--publish-owner=".length);
    } else if (arg.startsWith("--publish-key-owner=")) {
      parsed.publishKeyOwner = arg.slice("--publish-key-owner=".length);
    } else if (arg === "--publish-rate-limit-window-ms" || arg === "--rate-limit-window-ms") {
      const val = args[++i];
      if (val && Number.isFinite(Number(val))) parsed.publishRateLimitWindowMs = Number(val);
    } else if (arg.startsWith("--publish-rate-limit-window-ms=")) {
      const val = arg.slice("--publish-rate-limit-window-ms=".length);
      if (val && Number.isFinite(Number(val))) parsed.publishRateLimitWindowMs = Number(val);
    } else if (arg.startsWith("--rate-limit-window-ms=")) {
      const val = arg.slice("--rate-limit-window-ms=".length);
      if (val && Number.isFinite(Number(val))) parsed.publishRateLimitWindowMs = Number(val);
    } else if (arg === "--publish-rate-limit-max" || arg === "--rate-limit-max") {
      const val = args[++i];
      if (val && Number.isFinite(Number(val))) parsed.publishRateLimitMax = Number(val);
    } else if (arg.startsWith("--publish-rate-limit-max=")) {
      const val = arg.slice("--publish-rate-limit-max=".length);
      if (val && Number.isFinite(Number(val))) parsed.publishRateLimitMax = Number(val);
    } else if (arg === "--publish-rate-limit-path") {
      parsed.publishRateLimitPath = args[++i];
    } else if (arg.startsWith("--publish-rate-limit-path=")) {
      parsed.publishRateLimitPath = arg.slice("--publish-rate-limit-path=".length);
    } else if (arg === "--publish-rate-limit-sqlite-path") {
      parsed.publishRateLimitSqlitePath = args[++i];
    } else if (arg.startsWith("--publish-rate-limit-sqlite-path=")) {
      parsed.publishRateLimitSqlitePath = arg.slice("--publish-rate-limit-sqlite-path=".length);
    } else if (arg.startsWith("--rate-limit-max=")) {
      const val = arg.slice("--rate-limit-max=".length);
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
    "peer-server.config.json",
    ".peer-serverrc.json",
    ".peer-serverrc",
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

function isConfigRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown[]): string[] {
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Named validator for a peer-server JSON config file. It returns only the recognised, well-typed
 * fields; a document that is not an object contributes nothing, and an empty or non-string
 * `publishKey` / `publishKeyOwner` throws.
 */
const PeerServerConfigFileSchema = {
  parse(value: unknown): Partial<PeerServerConfig> {
    if (!isConfigRecord(value)) return {};
    const res: Partial<PeerServerConfig> = {};
    if (typeof value.port === "number") res.port = value.port;
    if (typeof value.host === "string") res.host = value.host;
    if (Array.isArray(value.allowedOrigins)) res.allowedOrigins = stringList(value.allowedOrigins);
    if (Array.isArray(value.allowedHosts)) res.allowedHosts = stringList(value.allowedHosts);
    if (value.publishKey !== undefined && (typeof value.publishKey !== "string" || !value.publishKey.trim())) {
      throw new Error("PUBLISH_KEY_CONFIG_INVALID");
    }
    if (typeof value.publishKey === "string") res.publishKey = value.publishKey;
    if (value.publishKeyOwner !== undefined && (typeof value.publishKeyOwner !== "string" || !value.publishKeyOwner.trim())) {
      throw new Error("PUBLISH_OWNER_CONFIG_INVALID");
    }
    if (typeof value.publishKeyOwner === "string") res.publishKeyOwner = value.publishKeyOwner;
    if (typeof value.publishOwner === "string") res.publishKeyOwner = value.publishOwner;
    const rateLimit = value.publishRateLimit ?? value.rateLimit;
    if (isConfigRecord(rateLimit)) {
      if (typeof rateLimit.windowMs === "number") res.publishRateLimitWindowMs = rateLimit.windowMs;
      if (typeof rateLimit.max === "number") res.publishRateLimitMax = rateLimit.max;
    }
    if (typeof value.publishRateLimitWindowMs === "number") res.publishRateLimitWindowMs = value.publishRateLimitWindowMs;
    if (typeof value.publishRateLimitMax === "number") res.publishRateLimitMax = value.publishRateLimitMax;
    if (typeof value.publishRateLimitPath === "string") res.publishRateLimitPath = value.publishRateLimitPath;
    if (typeof value.rateLimitPath === "string") res.publishRateLimitPath = value.rateLimitPath;
    if (typeof value.publishRateLimitSqlitePath === "string") res.publishRateLimitSqlitePath = value.publishRateLimitSqlitePath;
    return res;
  },
};

export function loadConfigFile(filePath: string): Partial<PeerServerConfig> {
  try {
    return PeerServerConfigFileSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PUBLISH_")) throw error;
    const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
    throw new Error(`PEER_SERVER_CONFIG_INVALID${detail}`);
  }
}

export interface ResolvePeerServerConfigOptions {
  /**
   * Load `.env.local` / `.env` from `cwd` and its parents into `process.env` first. Default `true`
   * for direct callers; `WebMcpPeerServer` passes `false` unless its `loadEnvFiles` option is set.
   */
  readonly loadEnvFiles?: boolean;
}

/**
 * Resolves the peer-server configuration. Precedence per field: CLI flags (`argv`) > `options` >
 * JSON config file > environment variables > defaults. `argv` defaults to `process.argv.slice(2)`
 * for CLI entry points; `WebMcpPeerServer` passes only the `argv` it was given (none by default).
 */
export function resolvePeerServerConfig(
  options: {
    port?: number;
    host?: string;
    allowedOrigins?: string[];
    allowedHosts?: string[];
    configPath?: string;
    publishKey?: string;
    publishKeyOwner?: string;
    publishRateLimitWindowMs?: number;
    publishRateLimitMax?: number;
    publishRateLimitPath?: string;
    publishRateLimitSqlitePath?: string;
  } = {},
  argv: readonly string[] = process.argv.slice(2),
  cwd: string = process.cwd(),
  { loadEnvFiles = true }: ResolvePeerServerConfigOptions = {},
): PeerServerConfig {
  if (loadEnvFiles) autoLoadEnvFiles(cwd);
  const cli = parseCliArgs(argv);

  const explicitConfigPath = cli.configPath ?? options.configPath ?? process.env.PEER_SERVER_CONFIG;
  const resolvedConfigPath = findConfigFile(explicitConfigPath, cwd);
  if (explicitConfigPath && !resolvedConfigPath) {
    throw new Error("PEER_SERVER_CONFIG_NOT_FOUND");
  }
  const fileConfig = resolvedConfigPath ? loadConfigFile(resolvedConfigPath) : {};

  const envOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const envHosts = process.env.ALLOWED_HOSTS
    ? process.env.ALLOWED_HOSTS.split(",").map((s) => s.trim()).filter(Boolean)
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
    "127.0.0.1";

  const envPublishKey = process.env.FRAMEBOOK_PUBLISH_KEY
    ?? process.env.PEER_SERVER_PUBLISH_KEY
    ?? process.env.PUBLISH_KEY;
  const envPublishOwner = process.env.FRAMEBOOK_PUBLISH_OWNER
    ?? process.env.FRAMEBOOK_PUBLISH_KEY_OWNER
    ?? process.env.PEER_SERVER_PUBLISH_OWNER
    ?? process.env.PUBLISH_OWNER_ID;
  const parseEnvNumber = (value: string | undefined): number | undefined => {
    if (value === undefined || value.trim() === "") return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error("PUBLISH_RATE_LIMIT_NUMBER_INVALID");
    return parsed;
  };
  const publishKey =
    (typeof cli.publishKey === "string" ? cli.publishKey : undefined)
    ?? options.publishKey
    ?? fileConfig.publishKey
    ?? envPublishKey;
  const publishKeyOwner =
    (typeof cli.publishKeyOwner === "string" ? cli.publishKeyOwner : undefined)
    ?? options.publishKeyOwner
    ?? fileConfig.publishKeyOwner
    ?? envPublishOwner;
  if (publishKey !== undefined && (typeof publishKey !== "string" || !publishKey.trim())) throw new Error("PUBLISH_KEY_CONFIG_INVALID");
  if (publishKeyOwner !== undefined && (typeof publishKeyOwner !== "string" || !publishKeyOwner.trim())) throw new Error("PUBLISH_OWNER_CONFIG_INVALID");
  if (publishKeyOwner !== undefined && publishKey === undefined) throw new Error("PUBLISH_OWNER_REQUIRES_KEY");
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
    throw new Error("PUBLISH_RATE_LIMIT_WINDOW_INVALID");
  }
  if (configuredMax !== undefined && (!Number.isFinite(configuredMax) || configuredMax < 0)) {
    throw new Error("PUBLISH_RATE_LIMIT_MAX_INVALID");
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
  if (publishRateLimitPath !== undefined && (!publishRateLimitPath.trim() || publishRateLimitPath.includes("\u0000"))) {
    throw new Error("PUBLISH_RATE_LIMIT_PATH_INVALID");
  }
  const publishRateLimitSqlitePath =
    cli.publishRateLimitSqlitePath
    ?? options.publishRateLimitSqlitePath
    ?? fileConfig.publishRateLimitSqlitePath
    ?? publishRateLimitSqlitePathFromEnv(process.env);
  if (publishRateLimitSqlitePath !== undefined
    && (!publishRateLimitSqlitePath.trim() || publishRateLimitSqlitePath.includes("\u0000"))) {
    throw new Error("PUBLISH_RATE_LIMIT_SQLITE_PATH_INVALID");
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
    ...(publishKey?.trim() ? { publishKey: publishKey.trim() } : {}),
    ...(publishKeyOwner?.trim() ? { publishKeyOwner: publishKeyOwner.trim() } : {}),
    publishRateLimitWindowMs,
    publishRateLimitMax,
    ...(publishRateLimitPath?.trim() ? { publishRateLimitPath: resolve(cwd, publishRateLimitPath.trim()) } : {}),
    ...(publishRateLimitSqlitePath?.trim()
      ? { publishRateLimitSqlitePath: resolve(cwd, publishRateLimitSqlitePath.trim()) }
      : {}),
  };
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes("*")) return true;
  if (allowedOrigins.includes(origin)) return true;

  try {
    const u = new URL(origin);
    const hostname = u.hostname.toLowerCase();

    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
      return true;
    }

    if (
      hostname === "framebook-storyboard.pages.dev" ||
      hostname.endsWith(".framebook-storyboard.pages.dev")
    ) {
      return true;
    }

    for (const raw of allowedOrigins) {
      const rule = raw.trim();
      if (!rule) continue;
      if (rule === "*" || rule === origin) return true;

      if (rule.startsWith("*.")) {
        const suffix = rule.slice(2).toLowerCase();
        if (hostname === suffix || hostname.endsWith("." + suffix)) return true;
      } else if (rule.includes("://*.")) {
        const [ruleProto, ruleDomainPart] = rule.split("://*.");
        if (u.protocol.slice(0, -1) === ruleProto) {
          const ruleDomain = ruleDomainPart!.split(":")[0]!.toLowerCase();
          if (hostname === ruleDomain || hostname.endsWith("." + ruleDomain)) return true;
        }
      } else if (!rule.includes("://")) {
        const [domainPart, portPart] = rule.split(":");
        if (hostname === domainPart!.toLowerCase()) {
          if (!portPart || u.port === portPart) return true;
        }
      }
    }
  } catch {
    return false;
  }

  return false;
}

export function isHostAllowed(
  hostHeader: string | undefined,
  allowedHosts: string[],
  allowedOrigins: string[] = [],
): boolean {
  if (!hostHeader) return true;
  if (allowedHosts.includes("*")) return true;

  const rawHost = hostHeader.trim().toLowerCase();
  let hostWithoutPort = rawHost;
  let portPart = "";

  if (rawHost.startsWith("[")) {
    const closeIdx = rawHost.indexOf("]");
    if (closeIdx !== -1) {
      hostWithoutPort = rawHost.slice(0, closeIdx + 1);
      if (rawHost[closeIdx + 1] === ":") {
        portPart = rawHost.slice(closeIdx + 2);
      }
    }
  } else {
    const colonIdx = rawHost.lastIndexOf(":");
    if (colonIdx !== -1) {
      hostWithoutPort = rawHost.slice(0, colonIdx);
      portPart = rawHost.slice(colonIdx + 1);
    }
  }

  if (
    hostWithoutPort === "localhost" ||
    hostWithoutPort === "127.0.0.1" ||
    hostWithoutPort === "[::1]"
  ) {
    return true;
  }

  for (const rawRule of allowedHosts) {
    const rule = rawRule.trim().toLowerCase();
    if (!rule) continue;
    if (rule === "*" || rule === rawHost || rule === hostWithoutPort) return true;

    if (rule.startsWith("*.")) {
      const suffix = rule.slice(2);
      if (hostWithoutPort === suffix || hostWithoutPort.endsWith("." + suffix)) return true;
    } else if (rule.includes(":")) {
      const [ruleDomain, rulePort] = rule.split(":");
      if (hostWithoutPort === ruleDomain && (!rulePort || portPart === rulePort)) {
        return true;
      }
    }
  }

  for (const originRule of allowedOrigins) {
    try {
      if (originRule.startsWith("http://") || originRule.startsWith("https://")) {
        const u = new URL(originRule);
        if (u.hostname.toLowerCase() === hostWithoutPort) return true;
      }
    } catch {}
  }

  return false;
}
