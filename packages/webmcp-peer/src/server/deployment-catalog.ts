import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isToolInputSchema, PEER_CATALOG_MAX_TOOLS, toolNameViolation } from "../config/catalog.js";

export interface DeploymentCatalogSnapshot {
  readonly tools: readonly Record<string, unknown>[];
  readonly catalogVersion: number;
  readonly catalogHash: string;
  readonly catalogUpdatedAt: number;
  readonly source: "deployment" | "empty" | "injected";
}

export interface DeploymentCatalogInput {
  tools: readonly unknown[];
  catalogVersion?: number;
  catalogHash?: string;
  catalogUpdatedAt?: number;
}

function isCatalogRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stableCatalogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableCatalogValue);
  if (!isCatalogRecord(value)) return value;
  return Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
    // defineProperty, not assignment: an own `__proto__` key (JSON.parse creates one) would
    // otherwise set the prototype and drop out of the hash.
    Object.defineProperty(result, key, { value: stableCatalogValue(value[key]), enumerable: true, writable: true, configurable: true });
    return result;
  }, {});
}

function catalogToolName(tool: unknown): string {
  return isCatalogRecord(tool) ? String(tool.name ?? "") : "";
}

/**
 * Orders tool names by UTF-16 code units. `localeCompare` follows the process/browser locale
 * (Danish sorts `aa` after `z`, Czech sorts `ch` after `h`) and treats canonically equivalent or
 * soft-hyphenated names as equal, so it cannot back a hash that every runtime must reproduce.
 */
function compareToolNames(left: unknown, right: unknown): number {
  const leftName = catalogToolName(left);
  const rightName = catalogToolName(right);
  return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
}

/**
 * Deterministic, order- and locale-independent SHA-256 of a tool catalog: tools sorted by name
 * (code-unit order), object keys sorted recursively. The relay's room catalog hash uses it too.
 */
export function hashDeploymentCatalog(tools: readonly unknown[]): string {
  const ordered = [...tools].sort(compareToolNames);
  return createHash("sha256").update(JSON.stringify(stableCatalogValue(ordered))).digest("hex");
}

/**
 * Validates a tool catalog against the protocol's catalog contract (`../config/catalog.ts`), which
 * the peer MCP client (`normalizeTools`) enforces too: at most 128 tools, unique non-empty names of
 * at most 256 UTF-16 code units without leading or trailing whitespace, and an `inputSchema` object
 * of `type: "object"` on every tool (required by MCP). The relay must never accept a catalog its
 * clients would reject, or the two sides would disagree on catalogVersion/catalogHash.
 * Returns a deep copy, or `null` when any descriptor is invalid.
 */
export function normalizeToolCatalog(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.length > PEER_CATALOG_MAX_TOOLS) return null;
  const names = new Set<string>();
  const tools: Record<string, unknown>[] = [];
  for (const candidate of value) {
    if (!isCatalogRecord(candidate)) return null;
    const name = candidate.name;
    if (typeof name !== "string" || toolNameViolation(name, names) !== undefined) return null;
    names.add(name);
    if (!isToolInputSchema(candidate.inputSchema)) return null;
    try { tools.push(structuredClone(candidate)); } catch { return null; }
  }
  return tools;
}

/**
 * Freezes the catalog `tools` (as `normalizeToolCatalog` returns it, plain JSON data), every tool
 * and every value in it, and returns it. The relay holds each catalog frozen, so one catalog can be
 * shared by every listing, announcement and room that names it instead of being copied for each:
 * a catalog is replaced, never changed in place.
 */
export function freezeToolCatalog<T extends readonly unknown[]>(tools: T): T {
  const visited = new WeakSet<object>();
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    Object.freeze(value);
    for (const member of Object.values(value)) freeze(member);
  };
  freeze(tools);
  return tools;
}

/**
 * Named validator for a deployment catalog artifact (`api/webmcp-tools.json`): a JSON object whose
 * `tools` (default `[]`) are then checked by `normalizeToolCatalog`, with `catalogVersion` default 1.
 */
const DeploymentCatalogFileSchema = {
  parse(value: unknown): DeploymentCatalogInput {
    if (!isCatalogRecord(value)) throw new TypeError("DEPLOYMENT_CATALOG_FILE_INVALID");
    return {
      tools: Array.isArray(value.tools) ? value.tools : [],
      catalogVersion: typeof value.catalogVersion === "number" ? value.catalogVersion : 1,
    };
  },
};

function buildCatalogSnapshot(input: DeploymentCatalogInput, source: DeploymentCatalogSnapshot["source"]): DeploymentCatalogSnapshot {
  const tools = normalizeToolCatalog(input.tools) ?? [];
  const computedHash = hashDeploymentCatalog(tools);
  const hash = typeof input.catalogHash === "string" && input.catalogHash === computedHash
    ? input.catalogHash
    : computedHash;
  const version = Number.isSafeInteger(input.catalogVersion) && (input.catalogVersion ?? 0) > 0
    ? input.catalogVersion as number
    : tools.length ? 1 : 0;
  return Object.freeze({
    tools: freezeToolCatalog(tools),
    catalogVersion: version,
    catalogHash: hash,
    catalogUpdatedAt: Number.isFinite(input.catalogUpdatedAt) ? input.catalogUpdatedAt as number : source === "deployment" ? 0 : Date.now(),
    source,
  });
}

/**
 * The relay's deployment catalog: `injected` when given (source `injected`), otherwise the first of
 * `$WEBMCP_CATALOG_PATH`, `$FRAMEBOOK_MCP_CATALOG_PATH`, `<cwd>/api/webmcp-tools.json` and
 * `<cwd>/../../api/webmcp-tools.json` that exists and lists at least one valid tool (source
 * `deployment`), otherwise an empty catalog (source `empty`). Relative paths, the environment's
 * included, are resolved against `cwd` (the relay passes its `cwd` option).
 */
export function loadDeploymentCatalog(injected?: DeploymentCatalogInput, cwd: string = process.cwd()): DeploymentCatalogSnapshot {
  if (injected) return buildCatalogSnapshot(injected, "injected");
  const candidates = [
    process.env.WEBMCP_CATALOG_PATH,
    process.env.FRAMEBOOK_MCP_CATALOG_PATH,
    "api/webmcp-tools.json",
    "../../api/webmcp-tools.json",
  ].filter((value): value is string => Boolean(value)).map((value) => resolve(cwd, value));
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    try {
      const result = buildCatalogSnapshot(DeploymentCatalogFileSchema.parse(JSON.parse(readFileSync(filePath, "utf8"))), "deployment");
      if (result.tools.length > 0) return result;
    } catch {
      // Malformed deployment artifact must not become an executable fallback.
    }
  }
  return buildCatalogSnapshot({ tools: [] }, "empty");
}
