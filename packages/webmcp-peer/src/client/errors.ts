import type { PeerMcpCatalogSnapshot } from "./types.js";

export class PeerMcpError extends Error {
  code: string;
  details?: unknown;

  constructor(message: string, code = "PEER_MCP_ERROR", details: unknown = undefined) {
    super(message);
    this.name = "PeerMcpError";
    this.code = code;
    this.details = details;
  }
}

export class PeerMcpRpcError extends PeerMcpError {
  rpcError?: unknown;
  response?: unknown;

  constructor(
    error: { code?: string | number; message?: string; [key: string]: unknown } | undefined,
    response: unknown = undefined,
  ) {
    const code = canonicalRpcErrorCode(error) ?? "MCP_RPC_ERROR";
    const message = error?.message || "Peer MCP request failed";
    super(message, code, error);
    this.name = "PeerMcpRpcError";
    this.rpcError = error;
    this.response = response;
  }
}

export class PeerMcpCatalogChangedError extends PeerMcpError {
  snapshot?: PeerMcpCatalogSnapshot;

  constructor(
    message = "Peer MCP catalog changed; refresh required",
    snapshot: PeerMcpCatalogSnapshot | undefined = undefined,
  ) {
    super(message, "CATALOG_CHANGED", snapshot);
    this.name = "PeerMcpCatalogChangedError";
    this.snapshot = snapshot;
  }
}

/**
 * JSON-RPC codes of the peer error registry that require a tools/list rediscovery. This relay sends
 * -32010 CATALOG_CHANGED. -32027 (SOURCE_CHANGED / RUNTIME_EPOCH_MISMATCH) and the name CATALOG_STALE
 * are reserved: this relay and provider never send them, nor use the code for anything else, and
 * they are classified as drift for relays that do. Likewise the `_meta.runtimeEpoch` the session
 * sends with every listing and call is information only: neither the relay nor the provider reads it.
 */
const CATALOG_REDISCOVERY_RPC_CODES: ReadonlySet<number> = new Set([
  -32010, // CATALOG_CHANGED / CATALOG_STALE
  -32027, // SOURCE_CHANGED / RUNTIME_EPOCH_MISMATCH (reserved)
]);
const CATALOG_REDISCOVERY_NAMES: ReadonlySet<string> = new Set([
  "CATALOG_CHANGED",
  "CATALOG_STALE",
  "SOURCE_CHANGED",
  "RUNTIME_EPOCH_MISMATCH",
]);
const CANONICAL_ERROR_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * Resolves the canonical error name of a JSON-RPC error object. Peer servers send numeric codes
 * with the canonical name as `message` (e.g. `{ code: -32001, message: "SESSION_INVALID" }`).
 */
export function canonicalRpcErrorCode(error: unknown): string | undefined {
  const errObj = error as { code?: unknown; message?: unknown; data?: { code?: unknown } } | null | undefined;
  if (typeof errObj?.code === "string" && errObj.code) return errObj.code;
  if (typeof errObj?.data?.code === "string" && CANONICAL_ERROR_NAME.test(errObj.data.code)) return errObj.data.code;
  if (typeof errObj?.message === "string" && CANONICAL_ERROR_NAME.test(errObj.message)) return errObj.message;
  return undefined;
}

/**
 * True only for catalog drift errors. Session/transport failures that share generic codes
 * (e.g. -32001 SESSION_INVALID, PROVIDER_UNAVAILABLE, MCP_REQUEST_TIMEOUT) are not drift and must
 * surface as-is instead of triggering a catalog refresh.
 */
export function isCatalogChangedRpcError(error: unknown): boolean {
  const errObj = error as { code?: unknown; data?: { code?: unknown } } | null;
  const numeric = typeof errObj?.code === "number" ? errObj.code : errObj?.data?.code;
  if (typeof numeric === "number") return CATALOG_REDISCOVERY_RPC_CODES.has(numeric);
  const name = canonicalRpcErrorCode(error);
  return name !== undefined && CATALOG_REDISCOVERY_NAMES.has(name);
}
