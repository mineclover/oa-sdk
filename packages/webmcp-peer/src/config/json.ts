/**
 * Runtime validation primitives shared by every tier of the package.
 *
 * Every JSON document this package receives (HTTP bodies, signaling frames, DataChannel chunks,
 * persisted caches) crosses a process boundary. Each one is parsed through a named schema before
 * it becomes a domain type, so a malformed or hostile document cannot hand callers fields of an
 * unexpected type. A schema either returns the validated value or throws a TypeError.
 */

/** A named runtime validator: `parse` returns the validated value or throws a TypeError. */
export interface PeerJsonSchema<T> {
  parse(value: unknown): T;
}

/** True for a JSON object: not null, not an array. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Any JSON object. It guarantees only the object shape, so every member read from the result must
 * still be narrowed (`typeof body.error === "string"`, ...).
 */
export const JsonObjectSchema: PeerJsonSchema<Record<string, unknown>> = {
  parse(value) {
    if (!isJsonObject(value)) throw new TypeError("Expected a JSON object");
    return value;
  },
};

/**
 * Parses text as a JSON object, yielding `{}` for an empty, malformed or non-object document.
 * Meant for best-effort bodies such as HTTP error payloads, where only optional fields are read.
 */
export function parseJsonObject(text: string): Record<string, unknown> {
  try {
    return JsonObjectSchema.parse(JSON.parse(text));
  } catch {
    return {};
  }
}

/** Reads an HTTP body as text; a body that cannot be read yields an empty string. */
export async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
