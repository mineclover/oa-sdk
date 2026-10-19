import { createHash } from "node:crypto";
import { isJsonObject } from "../config/json.js";
import { PeerMcpError } from "./errors.js";
import { asCatalogVersion } from "./transport.js";
import type { PeerMcpTool } from "./types.js";

function stableValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().reduce<Record<string, unknown>>((result, key) => {
    // defineProperty, not assignment: an own `__proto__` key (JSON.parse creates one) would
    // otherwise set the prototype and drop out of the hash, as it would in the relay's hash.
    Object.defineProperty(result, key, { value: stableValue(record[key]), enumerable: true, writable: true, configurable: true });
    return result;
  }, {});
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function catalogToolName(tool: unknown): string {
  return isJsonObject(tool) ? String(tool.name ?? "") : "";
}

/**
 * Orders tools by name in UTF-16 code-unit order, as the relay's `hashDeploymentCatalog` does.
 * `localeCompare` follows the runtime locale (Danish sorts `aa` after `z`), so a hash built on it
 * would differ between machines and from the relay's `catalogHash`.
 */
function compareToolNames(left: unknown, right: unknown): number {
  const leftName = catalogToolName(left);
  const rightName = catalogToolName(right);
  return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
}

/**
 * Order- and locale-independent SHA-256 of a tool catalog: tools sorted by name in code-unit
 * order, object keys sorted recursively. It equals the relay's `catalogHash` for the same tools
 * (`hashDeploymentCatalog` in `./server`), so a cached or locally computed hash can be compared
 * with the one the relay reports.
 */
export function hashTools(tools: readonly PeerMcpTool[] | unknown): string {
  const canonicalTools = Array.isArray(tools) ? [...tools].sort(compareToolNames) : tools;
  return createHash("sha256").update(stableStringify(canonicalTools)).digest("hex");
}

export function extractCatalogVersion(
  response: Record<string, unknown> | undefined,
  previousVersion: number | string | undefined,
  previousHash: string | undefined,
  nextHash: string,
): number | string {
  const result = (response?.result ?? {}) as Record<string, unknown>;
  const resultMeta = (result._meta ?? {}) as Record<string, unknown>;
  const respMeta = (response?._meta ?? {}) as Record<string, unknown>;
  const candidate = asCatalogVersion(result.catalogVersion ?? resultMeta.catalogVersion ?? respMeta.catalogVersion);
  if (candidate !== undefined) return candidate;
  if (previousHash !== nextHash) {
    return typeof previousVersion === "number" ? previousVersion + 1 : 1;
  }
  return previousVersion ?? 0;
}

export function normalizeTools(value: unknown): PeerMcpTool[] {
  const obj = (value ?? {}) as Record<string, unknown>;
  const result = (obj.result ?? value) as Record<string, unknown> | undefined;
  const tools = result?.tools;
  if (!Array.isArray(tools) || tools.length > 128) {
    throw new PeerMcpError("Peer tools/list response did not contain an array", "INVALID_TOOLS_LIST", value);
  }
  const names = new Set<string>();
  return tools.map((tool: unknown) => {
    const t = tool as Record<string, unknown> | null;
    if (!t || typeof t !== "object" || typeof t.name !== "string" || !t.name.trim()) {
      throw new PeerMcpError("Peer tools/list returned an invalid tool descriptor", "INVALID_TOOL_DESCRIPTOR", tool);
    }
    const toolName = t.name.trim();
    if (toolName.length > 256) {
      throw new PeerMcpError(`Peer tool name exceeds 256 characters: ${toolName}`, "TOOL_NAME_TOO_LONG", tool);
    }
    if (names.has(toolName)) {
      throw new PeerMcpError(`Peer tools/list contains duplicate tool name: ${toolName}`, "DUPLICATE_TOOL", tool);
    }
    names.add(toolName);
    const inputSchema = t.inputSchema as Record<string, unknown> | null;
    if (!inputSchema || typeof inputSchema !== "object" || inputSchema.type !== "object") {
      throw new PeerMcpError(`Peer tool inputSchema must be an object: ${toolName}`, "INVALID_TOOL_DESCRIPTOR", tool);
    }
    return {
      ...t,
      name: toolName,
      inputSchema,
    };
  });
}
