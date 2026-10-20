/**
 * The tool-catalog contract of the WebMCP relay protocol, shared by every tier of the package.
 *
 * The relay checks a provider's catalog with it (`normalizeToolCatalog` in `./server`) and the agent
 * client checks every listing and catalog announcement with it (`normalizeTools` in `./client`), so
 * the relay never takes a catalog its clients refuse and a client never takes one the relay would
 * refuse, whichever path (a relayed listing page, another transport) the catalog arrives on.
 */
import { isJsonObject } from "./json.js";

/** The most tools a catalog may list. */
export const PEER_CATALOG_MAX_TOOLS = 128;

/** The longest tool name, in UTF-16 code units (`String#length`). */
export const PEER_CATALOG_MAX_TOOL_NAME_LENGTH = 256;

/**
 * Why a tool name is refused: `invalid` (empty, or with leading or trailing whitespace), `too-long`
 * (over {@link PEER_CATALOG_MAX_TOOL_NAME_LENGTH}) or `duplicate`. A name is never trimmed into a
 * valid one: `tools/call` names the tool exactly as listed, so a padded name would reach the
 * provider as a name it never listed.
 */
export type ToolNameViolation = "invalid" | "too-long" | "duplicate";

/**
 * What is wrong with `name` as the name of a catalog tool whose earlier tools are named `seen`, or
 * undefined when it is a valid, unique name (a name that is not a string is refused by the caller).
 * Internal to the package.
 */
export function toolNameViolation(name: string, seen: ReadonlySet<string>): ToolNameViolation | undefined {
  if (!name || name !== name.trim()) return "invalid";
  if (name.length > PEER_CATALOG_MAX_TOOL_NAME_LENGTH) return "too-long";
  return seen.has(name) ? "duplicate" : undefined;
}

/** True for a tool's `inputSchema` as MCP requires it: a JSON object of `type: "object"`. Internal. */
export function isToolInputSchema(value: unknown): value is Record<string, unknown> {
  return isJsonObject(value) && value.type === "object";
}
