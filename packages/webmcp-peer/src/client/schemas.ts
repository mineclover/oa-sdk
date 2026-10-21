/**
 * Named validators for the documents the agent-side client receives from the relay or reads from
 * its own cache. Each `parse` returns the validated value or throws (a TypeError for a shape
 * violation; `normalizeTools` reports an invalid catalog as a PeerMcpError).
 */
import { isJsonObject, type PeerJsonSchema } from "../config/json.js";
import { normalizeTools } from "./catalog-hash.js";
import type {
  PeerClientTicket,
  PeerMcpCallToolResult,
  PeerMcpCatalogCache,
  PeerMcpContentBlock,
} from "./types.js";

function isContentBlock(value: unknown): value is PeerMcpContentBlock {
  return isJsonObject(value) && typeof value.type === "string";
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** The `result` of a successful `tools/call` (see {@link PeerMcpCallToolResult}). */
export const PeerMcpCallToolResultSchema: PeerJsonSchema<PeerMcpCallToolResult> = {
  parse(value) {
    if (!isJsonObject(value)) throw new TypeError("tools/call result must be a JSON object");
    const { content, structuredContent, isError } = value;
    if (content !== undefined && !(Array.isArray(content) && content.every(isContentBlock))) {
      throw new TypeError("tools/call result content must be an array of content blocks");
    }
    if (structuredContent !== undefined && !isJsonObject(structuredContent)) {
      throw new TypeError("tools/call result structuredContent must be a JSON object");
    }
    if (isError !== undefined && typeof isError !== "boolean") {
      throw new TypeError("tools/call result isError must be a boolean");
    }
    return {
      ...value,
      ...(content !== undefined ? { content } : {}),
      ...(structuredContent !== undefined ? { structuredContent } : {}),
      ...(isError !== undefined ? { isError } : {}),
    };
  },
};

/** The client ticket returned by `POST /p/:id/join` (before the client adds its endpoint URLs). */
export const PeerClientTicketSchema: PeerJsonSchema<PeerClientTicket> = {
  parse(value) {
    if (!isJsonObject(value)) throw new TypeError("Join response must be a JSON object");
    const {
      roomId,
      roomEpoch,
      clientToken,
      sessionId,
      issuedAt,
      expiresAt,
      approvalRequired,
      capabilities,
      approvalState,
      state,
      approvalRequestId,
    } = value;
    if (!isNonEmptyString(roomId)) throw new TypeError("Join response roomId must be a string");
    if (!isSafeNonNegativeInteger(roomEpoch)) throw new TypeError("Join response roomEpoch must be a non-negative integer");
    if (!isNonEmptyString(clientToken)) throw new TypeError("Join response clientToken must be a string");
    if (!isNonEmptyString(sessionId)) throw new TypeError("Join response sessionId must be a string");
    if (!isFiniteNumber(issuedAt) || !isFiniteNumber(expiresAt)) {
      throw new TypeError("Join response issuedAt/expiresAt must be numbers");
    }
    if (typeof approvalRequired !== "boolean") throw new TypeError("Join response approvalRequired must be a boolean");
    if (!Array.isArray(capabilities) || !capabilities.every((item): item is string => typeof item === "string")) {
      throw new TypeError("Join response capabilities must be an array of strings");
    }
    if (typeof approvalState !== "string" || typeof state !== "string") {
      throw new TypeError("Join response approvalState/state must be strings");
    }
    if (approvalRequestId !== undefined && typeof approvalRequestId !== "string") {
      throw new TypeError("Join response approvalRequestId must be a string");
    }
    return {
      ...value,
      roomId,
      roomEpoch,
      clientToken,
      sessionId,
      issuedAt,
      expiresAt,
      approvalRequired,
      capabilities: [...capabilities],
      approvalState,
      state,
      ...(approvalRequestId !== undefined ? { approvalRequestId } : {}),
    };
  },
};

/** `GET /p/:id/sessions/:sessionId`: a JSON object whose `state` is a string. */
export interface PeerSessionStatus {
  state: string;
  roomEpoch?: number;
  [key: string]: unknown;
}

export const PeerSessionStatusSchema: PeerJsonSchema<PeerSessionStatus> = {
  parse(value) {
    if (!isJsonObject(value)) throw new TypeError("Session status must be a JSON object");
    const { state, roomEpoch } = value;
    if (typeof state !== "string") throw new TypeError("Session status state must be a string");
    if (roomEpoch !== undefined && !isSafeNonNegativeInteger(roomEpoch)) {
      throw new TypeError("Session status roomEpoch must be a non-negative integer");
    }
    return { ...value, state, ...(roomEpoch !== undefined ? { roomEpoch } : {}) };
  },
};

/**
 * A persisted catalog cache. `cachedTools` must pass the same descriptor validation as a live
 * `tools/list`; a missing or malformed version falls back to 0 and a missing timestamp to null.
 */
export const PeerMcpCatalogCacheSchema: PeerJsonSchema<PeerMcpCatalogCache> = {
  parse(value) {
    if (!isJsonObject(value) || !Array.isArray(value.cachedTools)) {
      throw new TypeError("Peer catalog cache must contain a cachedTools array");
    }
    const cachedTools = normalizeTools({ result: { tools: value.cachedTools } });
    const { catalogVersion, catalogHash, updatedAt } = value;
    return {
      cachedTools,
      catalogVersion:
        isFiniteNumber(catalogVersion) || (typeof catalogVersion === "string" && catalogVersion.trim())
          ? catalogVersion
          : 0,
      ...(typeof catalogHash === "string" ? { catalogHash } : {}),
      updatedAt: typeof updatedAt === "string" ? updatedAt : null,
    };
  },
};
