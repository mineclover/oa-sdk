import { existsSync, readFileSync } from "node:fs";
import { BlockList, isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { publishRateLimitSqlitePathFromEnv } from "./rate-limit.js";

export interface PeerServerConfig {
  port: number;
  host: string;
  /**
   * The browser origins the relay serves: the configured lists (options, config file,
   * `ALLOWED_ORIGINS`, CLI) merged, or, when none is configured, the relay's own origin and
   * `DEFAULT_ALLOWED_ORIGINS`. A configured list replaces the default policy whole.
   */
  allowedOrigins: string[];
  /**
   * The hosts requests may be addressed to (`Host`, or `X-Forwarded-Host` from a trusted proxy):
   * the relay's own `host` and `host:port`, plus the configured lists merged or, when none is
   * configured, `DEFAULT_ALLOWED_HOSTS`.
   */
  allowedHosts: string[];
  /**
   * True when the relay refuses a request addressed to a host outside `allowedHosts` (403
   * HOST_NOT_ALLOWED), which guards against DNS rebinding: `allowedHosts` was configured, or the
   * relay binds a loopback address. Otherwise the host only picks the base URL of descriptors.
   */
  enforceAllowedHosts: boolean;
  /**
   * Which peers the relay takes `X-Forwarded-Proto`, `X-Forwarded-Host` and `X-Forwarded-For` from:
   * `false` (the default) none, `true` its own peer, one proxy in front of it, or the listed IP
   * addresses and CIDR ranges of trusted proxies (see `createProxyTrust`).
   */
  trustProxy: boolean | string[];
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
  trustProxy?: boolean | string[];
  help?: boolean;
}

/**
 * The browser origins the relay allows when no `allowedOrigins` is configured: a page on the
 * loopback interface, of any scheme and port, and the Framebook storyboard app with its
 * subdomains. Together with the relay's own origin it is the default policy, and a configured
 * list (options, config file, `ALLOWED_ORIGINS`, CLI) replaces it whole, so an operator can allow
 * exactly the origins they name. Nothing is allowed outside the effective list.
 */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "*.framebook-storyboard.pages.dev",
]);

/**
 * The hosts a request may be addressed to, besides the relay's own `host`, when no `allowedHosts`
 * is configured; a configured list replaces it, as `allowedOrigins` does `DEFAULT_ALLOWED_ORIGINS`.
 */
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
    } else if (arg === "--trust-proxy") {
      const val = trustProxyFromText(args[++i]);
      if (val !== undefined) parsed.trustProxy = val;
    } else if (arg.startsWith("--trust-proxy=")) {
      const val = trustProxyFromText(arg.slice("--trust-proxy=".length));
      if (val !== undefined) parsed.trustProxy = val;
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

/** The entries of a comma-separated list, trimmed, or undefined when it names none. */
function listFromText(text: string | undefined): string[] | undefined {
  const entries = text?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  return entries.length > 0 ? entries : undefined;
}

/**
 * A `trustProxy` setting written as text (`--trust-proxy`, `PEER_SERVER_TRUST_PROXY`): `true` or
 * `false` in any case, or a comma-separated list of proxy addresses; undefined for an empty text.
 */
function trustProxyFromText(text: string | undefined): boolean | string[] | undefined {
  const value = text?.trim();
  if (!value) return undefined;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  return listFromText(value) ?? [];
}

/**
 * Whether the relay takes the word of a hop of a request's path about where the request came
 * from: hop 0 is the relay's own peer (the socket's remote address), hop n the n-th address from
 * the end of `X-Forwarded-For`, the one hop n − 1 reports it received the request from.
 */
export type ProxyTrust = (address: string, hop: number) => boolean;

/**
 * The trust a `trustProxy` setting places in the hops in front of the relay. `false` trusts none:
 * the `X-Forwarded-*` headers are ignored. `true` trusts the relay's own peer only, one proxy in
 * front of it, and never an address that proxy reports, which the caller may have written. A list
 * trusts each listed IPv4 or IPv6 address or CIDR range (`10.0.0.0/8`), wherever it is in the
 * path; an IPv4-mapped IPv6 address matches its IPv4 entry. Throws TRUST_PROXY_INVALID for a
 * setting that is not a boolean or a list of such entries.
 */
export function createProxyTrust(setting: boolean | readonly string[]): ProxyTrust {
  if (setting === false) return () => false;
  if (setting === true) return (_address, hop) => hop === 0;
  if (!Array.isArray(setting)) throw new Error("TRUST_PROXY_INVALID");
  const trusted = new BlockList();
  for (const raw of setting as readonly unknown[]) {
    if (typeof raw !== "string") throw new Error("TRUST_PROXY_INVALID");
    const [address = "", prefix, extra] = raw.trim().split("/");
    const family = isIP(address);
    const type = family === 6 ? "ipv6" : "ipv4";
    if (family === 0 || extra !== undefined) throw new Error("TRUST_PROXY_INVALID");
    if (prefix === undefined) {
      trusted.addAddress(address, type);
      continue;
    }
    const bits = /^\d{1,3}$/.test(prefix) ? Number(prefix) : Number.NaN;
    if (!(bits <= (family === 6 ? 128 : 32))) throw new Error("TRUST_PROXY_INVALID");
    trusted.addSubnet(address, bits, type);
  }
  return (address) => {
    const family = isIP(address);
    return family !== 0 && trusted.check(address, family === 6 ? "ipv6" : "ipv4");
  };
}

/** The addresses of the loopback interface: 127.0.0.0/8 and ::1 (IPv4-mapped forms included). */
const LOOPBACK_ADDRESSES = new BlockList();
LOOPBACK_ADDRESSES.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK_ADDRESSES.addAddress("::1", "ipv6");

/**
 * True for a host the relay may bind that is the loopback interface: `localhost` (and the
 * `.localhost` names RFC 6761 reserves for it) or a loopback address, bracketed or not.
 */
export function isLoopbackHost(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  const family = isIP(name);
  return family !== 0 && LOOPBACK_ADDRESSES.check(name, family === 6 ? "ipv6" : "ipv4");
}

/**
 * `value` as `host[:port]`, lowercased: an IPv6 literal keeps its brackets (`[::1]:4500` is host
 * `[::1]`, port `4500`), as the WHATWG URL `hostname` and the `Host` header write it.
 */
function splitHostPort(value: string): { host: string; port: string } {
  const text = value.trim().toLowerCase();
  if (text.startsWith("[")) {
    const close = text.indexOf("]");
    if (close !== -1) return { host: text.slice(0, close + 1), port: text[close + 1] === ":" ? text.slice(close + 2) : "" };
    return { host: text, port: "" };
  }
  const colon = text.lastIndexOf(":");
  return colon === -1 ? { host: text, port: "" } : { host: text.slice(0, colon), port: text.slice(colon + 1) };
}

/**
 * Named validator for a peer-server JSON config file. It returns only the recognised, well-typed
 * fields; a document that is not an object contributes nothing, an empty or non-string
 * `publishKey` / `publishKeyOwner` throws, and so does a `trustProxy` that is neither a boolean
 * nor a list of strings (TRUST_PROXY_INVALID).
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
    if (typeof value.trustProxy === "boolean") res.trustProxy = value.trustProxy;
    else if (Array.isArray(value.trustProxy) && value.trustProxy.every((entry) => typeof entry === "string")) {
      res.trustProxy = [...value.trustProxy];
    } else if (value.trustProxy !== undefined) throw new Error("TRUST_PROXY_INVALID");
    return res;
  },
};

export function loadConfigFile(filePath: string): Partial<PeerServerConfig> {
  try {
    return PeerServerConfigFileSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
  } catch (error) {
    if (error instanceof Error && /^(?:PUBLISH|TRUST_PROXY)_/.test(error.message)) throw error;
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
    trustProxy?: boolean | readonly string[];
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

  const envOrigins = listFromText(process.env.ALLOWED_ORIGINS);
  const envHosts = listFromText(process.env.ALLOWED_HOSTS);

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
  // On by default, with or without a publish key: every room costs the relay memory until it is
  // deleted, so anonymous room creation is throttled too. A configured max below 1 turns it off.
  const publishRateLimitMax = configuredMax !== undefined
    ? Math.floor(configuredMax)
    : DEFAULT_PUBLISH_RATE_LIMIT_MAX;
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

  // A list configured anywhere replaces the default policy whole (the lists of several sources
  // are merged), so an operator can allow exactly the origins or hosts they name.
  const configuredOrigins = [fileConfig.allowedOrigins, envOrigins, options.allowedOrigins, cli.allowedOrigins]
    .filter((list): list is string[] => list !== undefined);
  const allowedOriginsSet = new Set<string>(configuredOrigins.length > 0
    ? configuredOrigins.flat()
    : [`http://${host}:${port}`, ...DEFAULT_ALLOWED_ORIGINS]);

  // The relay's own address is always a host requests may name; a configured list replaces only
  // the defaults beside it. Configuring one, or binding the loopback interface (whose services a
  // DNS-rebound page would otherwise reach), makes the relay refuse every other host.
  const configuredHosts = [fileConfig.allowedHosts, envHosts, options.allowedHosts, cli.allowedHosts]
    .filter((list): list is string[] => list !== undefined);
  const allowedHostsSet = new Set<string>([
    host,
    `${host}:${port}`,
    ...(configuredHosts.length > 0 ? configuredHosts.flat() : DEFAULT_ALLOWED_HOSTS),
  ]);

  const trustProxy =
    cli.trustProxy
    ?? options.trustProxy
    ?? fileConfig.trustProxy
    ?? trustProxyFromText(process.env.PEER_SERVER_TRUST_PROXY)
    ?? false;
  // Checked here, so a bad entry fails the configuration rather than every request.
  createProxyTrust(trustProxy);

  return {
    port,
    host,
    allowedOrigins: Array.from(allowedOriginsSet),
    allowedHosts: Array.from(allowedHostsSet),
    enforceAllowedHosts: configuredHosts.length > 0 || isLoopbackHost(host),
    trustProxy: typeof trustProxy === "boolean" ? trustProxy : [...trustProxy],
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

/**
 * True when a request with `origin` may be served under `allowedOrigins`: a request without an
 * Origin (not from a browser page), or one the list allows. A list entry allows the exact origin
 * it equals, every origin (`*`), a host and its subdomains of any scheme and port (`*.suffix`),
 * those of one scheme (`proto://*.suffix`, an entry's port ignored), or one host (`host`, any
 * scheme and port; `host:port`, that port only, and only when the origin names a port that is not
 * its scheme's default). An IPv6 host is written in brackets (`[::1]`). An origin that is not a
 * URL (`null` included) is allowed only by `*` or an entry that equals it.
 */
export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes("*")) return true;
  if (allowedOrigins.includes(origin)) return true;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const hostname = url.hostname.toLowerCase();

  for (const raw of allowedOrigins) {
    const rule = raw.trim();
    if (!rule) continue;
    if (rule === "*" || rule === origin) return true;

    if (rule.startsWith("*.")) {
      const suffix = rule.slice(2).toLowerCase();
      if (hostname === suffix || hostname.endsWith("." + suffix)) return true;
    } else if (rule.includes("://*.")) {
      const [ruleProto, ruleDomainPart] = rule.split("://*.");
      if (url.protocol.slice(0, -1) === ruleProto) {
        const ruleDomain = splitHostPort(ruleDomainPart!).host;
        if (hostname === ruleDomain || hostname.endsWith("." + ruleDomain)) return true;
      }
    } else if (!rule.includes("://")) {
      const { host: ruleHost, port: rulePort } = splitHostPort(rule);
      if (hostname === ruleHost && (!rulePort || url.port === rulePort)) return true;
    }
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
  const { host: hostWithoutPort, port: portPart } = splitHostPort(rawHost);

  // A host naming the loopback interface is always allowed: a DNS-rebound page sends its own
  // name, never one of these, so only a client on the relay's machine (or one addressing the
  // loopback itself) sends them.
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
    } else {
      const { host: ruleHost, port: rulePort } = splitHostPort(rule);
      if (rulePort && hostWithoutPort === ruleHost && portPart === rulePort) return true;
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
