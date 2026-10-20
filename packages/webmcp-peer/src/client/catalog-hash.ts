import { createHash } from "node:crypto";
import {
  isToolInputSchema,
  PEER_CATALOG_MAX_TOOL_NAME_LENGTH,
  PEER_CATALOG_MAX_TOOLS,
  toolNameViolation,
} from "../config/catalog.js";
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

/**
 * Validates a tools/list result (or a catalog announcement) against the protocol's catalog contract
 * (`../config/catalog.ts`), the same rules the relay's `normalizeToolCatalog` applies: an array of
 * at most 128 tools (INVALID_TOOLS_LIST), each a JSON object with a non-empty name that has no
 * leading or trailing whitespace (INVALID_TOOL_DESCRIPTOR; a padded name is refused, not trimmed),
 * of at most 256 UTF-16 code units (TOOL_NAME_TOO_LONG), unique (DUPLICATE_TOOL), and an
 * `inputSchema` object of `type: "object"` (INVALID_TOOL_DESCRIPTOR). Returns shallow copies.
 */
export function normalizeTools(value: unknown): PeerMcpTool[] {
  const obj = isJsonObject(value) ? value : {};
  const result = obj.result ?? value;
  const tools = isJsonObject(result) ? result.tools : undefined;
  if (!Array.isArray(tools)) {
    throw new PeerMcpError("Peer tools/list response did not contain an array", "INVALID_TOOLS_LIST", value);
  }
  if (tools.length > PEER_CATALOG_MAX_TOOLS) {
    throw new PeerMcpError(
      `Peer tools/list lists ${tools.length} tools, over the catalog limit of ${PEER_CATALOG_MAX_TOOLS}`,
      "INVALID_TOOLS_LIST",
      value,
    );
  }
  const names = new Set<string>();
  return tools.map((tool: unknown) => {
    if (!isJsonObject(tool) || typeof tool.name !== "string") {
      throw new PeerMcpError("Peer tools/list returned an invalid tool descriptor", "INVALID_TOOL_DESCRIPTOR", tool);
    }
    const toolName = tool.name;
    const violation = toolNameViolation(toolName, names);
    if (violation === "invalid") {
      throw new PeerMcpError(
        `Peer tool name must be non-empty without leading or trailing whitespace: ${JSON.stringify(toolName)}`,
        "INVALID_TOOL_DESCRIPTOR",
        tool,
      );
    }
    if (violation === "too-long") {
      throw new PeerMcpError(
        `Peer tool name exceeds ${PEER_CATALOG_MAX_TOOL_NAME_LENGTH} characters: ${toolName}`,
        "TOOL_NAME_TOO_LONG",
        tool,
      );
    }
    if (violation === "duplicate") {
      throw new PeerMcpError(`Peer tools/list contains duplicate tool name: ${toolName}`, "DUPLICATE_TOOL", tool);
    }
    names.add(toolName);
    const inputSchema = tool.inputSchema;
    if (!isToolInputSchema(inputSchema)) {
      throw new PeerMcpError(`Peer tool inputSchema must be an object: ${toolName}`, "INVALID_TOOL_DESCRIPTOR", tool);
    }
    return {
      ...tool,
      name: toolName,
      inputSchema,
    };
  });
}
