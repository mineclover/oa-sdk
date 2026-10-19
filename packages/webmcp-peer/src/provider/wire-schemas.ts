/**
 * Named validators for every document the browser/host provider receives: relay HTTP responses,
 * signaling frames, DataChannel chunks and the room lease it persisted itself. Each `parse` returns
 * the validated value or throws a TypeError.
 */
import { isJsonObject, type PeerJsonSchema } from "../config/json.js";
import type { SavedRoomLease } from "./types.js";

/** A signaling or DataChannel control frame: a JSON object with a string `type`. */
export interface ProviderFrame {
  readonly type: string;
  readonly [key: string]: unknown;
}

export const ProviderFrameSchema: PeerJsonSchema<ProviderFrame> = {
  parse(value) {
    if (!isJsonObject(value) || typeof value.type !== "string") {
      throw new TypeError("Provider frame must be a JSON object with a string type");
    }
    return { ...value, type: value.type };
  },
};

/** Most chunks one framed DataChannel message may be split into. */
export const MAX_DATA_CHANNEL_CHUNKS = 512;
/** Most characters one DataChannel chunk may carry. */
export const MAX_DATA_CHANNEL_CHUNK_CHARS = 16384;

/** One chunk of a framed DataChannel message (`{ v: 1, id, index, total, data }`). */
export interface DataChannelChunk {
  readonly id: number;
  readonly index: number;
  readonly total: number;
  readonly data: string;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export const DataChannelChunkSchema: PeerJsonSchema<DataChannelChunk> = {
  parse(value) {
    if (!isJsonObject(value) || value.v !== 1) throw new TypeError("DataChannel chunk must be a v1 frame");
    const { id, index, total, data } = value;
    if (!isSafeInteger(id)) throw new TypeError("DataChannel chunk id must be an integer");
    if (!isSafeInteger(total) || total <= 0 || total > MAX_DATA_CHANNEL_CHUNKS) {
      throw new TypeError("DataChannel chunk total is out of range");
    }
    if (!isSafeInteger(index) || index < 0 || index >= total) {
      throw new TypeError("DataChannel chunk index is out of range");
    }
    if (typeof data !== "string" || data.length > MAX_DATA_CHANNEL_CHUNK_CHARS) {
      throw new TypeError("DataChannel chunk data must be a bounded string");
    }
    return { id, index, total, data };
  },
};

/** A room descriptor from `POST /p`, `POST /p/:id/reclaim` or `POST /p/:id/rotate`. */
export interface PeerRoomDescriptor {
  readonly id: string;
  readonly providerToken: string;
  readonly descriptorUrl: string;
  readonly inviteToken: string;
  readonly roomEpoch?: number;
  readonly capabilities?: readonly string[];
  readonly expiresAt?: number;
  readonly reconnectToken?: string;
  readonly reconnectTokenExpiresAt?: number;
  readonly alias?: string;
}

/** Room ids are interpolated into relay URL paths, so only a URL-safe id is accepted. */
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * The identity members (`id`, `providerToken`, `descriptorUrl`, `inviteToken`) are required; an
 * optional member with the wrong type is dropped, which leaves the provider on its documented
 * fallback (no lease, legacy unbound epoch, default expiry).
 */
export const PeerRoomDescriptorSchema: PeerJsonSchema<PeerRoomDescriptor> = {
  parse(value) {
    if (!isJsonObject(value)) throw new TypeError("Room descriptor must be a JSON object");
    const { id, providerToken, descriptorUrl, inviteToken } = value;
    if (typeof id !== "string" || !ROOM_ID_PATTERN.test(id)) throw new TypeError("Room descriptor id is invalid");
    if (!nonEmpty(providerToken)) throw new TypeError("Room descriptor providerToken is required");
    if (!nonEmpty(descriptorUrl)) throw new TypeError("Room descriptor descriptorUrl is required");
    if (!nonEmpty(inviteToken)) throw new TypeError("Room descriptor inviteToken is required");
    const roomEpoch =
      isSafeInteger(value.roomEpoch) && value.roomEpoch >= 0 ? value.roomEpoch : undefined;
    const capabilities = Array.isArray(value.capabilities)
      ? value.capabilities.filter((item): item is string => typeof item === "string")
      : undefined;
    const expiresAt = finiteNumber(value.expiresAt);
    const reconnectTokenExpiresAt = finiteNumber(value.reconnectTokenExpiresAt);
    return {
      id,
      providerToken,
      descriptorUrl,
      inviteToken,
      ...(roomEpoch !== undefined ? { roomEpoch } : {}),
      ...(capabilities !== undefined ? { capabilities } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(nonEmpty(value.reconnectToken) ? { reconnectToken: value.reconnectToken } : {}),
      ...(reconnectTokenExpiresAt !== undefined ? { reconnectTokenExpiresAt } : {}),
      ...(typeof value.alias === "string" ? { alias: value.alias } : {}),
    };
  },
};

/** The room lease the provider saved in localStorage for F5 reclaim. Expiry is checked by the caller. */
export const SavedRoomLeaseSchema: PeerJsonSchema<SavedRoomLease> = {
  parse(value) {
    if (!isJsonObject(value)) throw new TypeError("Saved room lease must be a JSON object");
    const { serverUrl, roomId, roomEpoch, leaseToken, expiresAt, alias } = value;
    if (typeof serverUrl !== "string" || typeof roomId !== "string") {
      throw new TypeError("Saved room lease serverUrl/roomId must be strings");
    }
    if (!nonEmpty(leaseToken)) throw new TypeError("Saved room lease leaseToken is required");
    if (!isSafeInteger(roomEpoch) || roomEpoch < 0) throw new TypeError("Saved room lease roomEpoch is invalid");
    if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
      throw new TypeError("Saved room lease expiresAt is invalid");
    }
    return {
      serverUrl,
      roomId,
      roomEpoch,
      leaseToken,
      expiresAt,
      ...(typeof alias === "string" ? { alias } : {}),
    };
  },
};
