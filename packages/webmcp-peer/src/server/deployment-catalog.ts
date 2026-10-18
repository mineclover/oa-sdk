import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MAX_CATALOG_TOOLS = 128;

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
    result[key] = stableCatalogValue(value[key]);
    return result;
  }, {});
}

export function hashDeploymentCatalog(tools: readonly Record<string, unknown>[]): string {
  const ordered = [...tools].sort((left, right) => String(left.name ?? "").localeCompare(String(right.name ?? "")));
  return createHash("sha256").update(JSON.stringify(stableCatalogValue(ordered))).digest("hex");
}

const MAX_TOOL_NAME_LENGTH = 256;

/**
 * Validates a tool catalog against the contract the peer MCP client enforces (`normalizeTools`):
 * at most 128 tools, unique trimmed names of at most 256 characters, and an `inputSchema` object
 * of `type: "object"` on every tool (required by MCP). The relay must never accept a catalog its
 * clients would reject, or the two sides would disagree on catalogVersion/catalogHash.
 * Returns a deep copy, or `null` when any descriptor is invalid.
 */
export function normalizeToolCatalog(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.length > MAX_CATALOG_TOOLS) return null;
  const names = new Set<string>();
  const tools: Record<string, unknown>[] = [];
  for (const candidate of value) {
    if (!isCatalogRecord(candidate) || typeof candidate.name !== "string") return null;
    const name = candidate.name;
    if (!name || name !== name.trim() || name.length > MAX_TOOL_NAME_LENGTH || names.has(name)) return null;
    names.add(name);
    if (!isCatalogRecord(candidate.inputSchema) || candidate.inputSchema.type !== "object") return null;
    try { tools.push(structuredClone(candidate)); } catch { return null; }
  }
  return tools;
}

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
    tools: Object.freeze(tools),
    catalogVersion: version,
    catalogHash: hash,
    catalogUpdatedAt: Number.isFinite(input.catalogUpdatedAt) ? input.catalogUpdatedAt as number : source === "deployment" ? 0 : Date.now(),
    source,
  });
}

export function loadDeploymentCatalog(injected?: DeploymentCatalogInput): DeploymentCatalogSnapshot {
  if (injected) return buildCatalogSnapshot(injected, "injected");
  const candidates = [
    process.env.WEBMCP_CATALOG_PATH,
    process.env.FRAMEBOOK_MCP_CATALOG_PATH,
    resolve(process.cwd(), "api/webmcp-tools.json"),
    resolve(process.cwd(), "../../api/webmcp-tools.json"),
    resolve(process.cwd(), "packages/peer-server/api/webmcp-tools.json"),
  ].filter((value): value is string => Boolean(value));
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
      if (!isCatalogRecord(parsed)) continue;
      const result = buildCatalogSnapshot({
        tools: Array.isArray(parsed.tools) ? parsed.tools : [],
        catalogVersion: typeof parsed.catalogVersion === "number" ? parsed.catalogVersion : 1,
      }, "deployment");
      if (result.tools.length > 0) return result;
    } catch {
      // Malformed deployment artifact must not become an executable fallback.
    }
  }
  return buildCatalogSnapshot({ tools: [] }, "empty");
}
