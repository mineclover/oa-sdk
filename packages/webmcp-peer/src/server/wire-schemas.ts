/**
 * Named runtime validators for everything the relay deserializes from the network: HTTP JSON
 * bodies and WebSocket frames. A parsed document only becomes a typed value after one of these
 * schemas checked the shape the relay then relies on; `parse` throws a `TypeError` otherwise.
 */

/** A named runtime validator: `parse` returns the validated value or throws a TypeError. */
export interface WireSchema<T> {
  parse(value: unknown): T;
}

export type JsonObject = Record<string, unknown>;

/** A relay WebSocket frame: a JSON object whose `type` names the frame. */
export interface PeerFrame extends JsonObject {
  readonly type: string;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPeerFrame(value: unknown): value is PeerFrame {
  return isJsonObject(value) && typeof value.type === "string";
}

/** An HTTP request body that must be a JSON object. */
export const JsonObjectBodySchema: WireSchema<JsonObject> = {
  parse(value) {
    if (!isJsonObject(value)) throw new TypeError("BODY_OBJECT_REQUIRED");
    return value;
  },
};

/** A WebSocket text frame sent to the relay by a provider or a client. */
export const PeerFrameSchema: WireSchema<PeerFrame> = {
  parse(value) {
    if (!isPeerFrame(value)) throw new TypeError("PEER_FRAME_INVALID");
    return value;
  },
};
