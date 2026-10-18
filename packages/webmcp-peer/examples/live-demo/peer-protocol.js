// Wire-level constants and helpers shared by the demo's Tier 1 and Tier 3 runtimes.
// Uses only Web-standard APIs (URL, crypto.subtle) so the same module runs in the browser and Node.

export const WS_SUBPROTOCOL = "webmcp-peer.v1";
export const PEER_PROTOCOL = "webmcp-peer/1";

/** JSON-RPC codes from the peer error registry that the demo reacts to. */
export const RPC_CODES = Object.freeze({
  CATALOG_CHANGED: -32010,
  ROOM_ROTATED: -32057,
});

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function toWsOrigin(origin) {
  return origin.replace(/^http/, "ws");
}

export function buildInvitationUrl(descriptorUrl, inviteToken) {
  return `${descriptorUrl.replace(/#.*$/, "")}#invite=${encodeURIComponent(inviteToken)}`;
}

/** The agent only receives the invitation URL; room id and invite token are recovered from it. */
export function parseInvitation(url) {
  const parsed = new URL(url);
  const roomId = parsed.pathname.match(/\/p\/([^/]+)/)?.[1];
  const inviteToken = new URLSearchParams(parsed.hash.slice(1)).get("invite");
  if (!roomId || !inviteToken) throw new Error("INVALID_INVITATION_URL");
  return { origin: parsed.origin, roomId: decodeURIComponent(roomId), inviteToken };
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
}

/**
 * Order-independent SHA-256 catalog hash, byte-compatible with the server's `catalogHash()` and
 * the client library's `hashTools()`: tools sorted by name, object keys sorted recursively.
 * Lets the agent independently prove the catalogHash reported by the relay.
 */
export async function computeCatalogHash(tools) {
  const ordered = [...tools].sort((left, right) => String(left?.name ?? "").localeCompare(String(right?.name ?? "")));
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(ordered)));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const SECRET_KEYS = new Set(["providerToken", "inviteToken", "clientToken", "reconnectToken", "leaseToken"]);

/** Replaces credential-like fields before a frame is surfaced to any log or screen. */
export function redactSecrets(value) {
  return JSON.parse(
    JSON.stringify(value ?? {}, (key, inner) =>
      SECRET_KEYS.has(key) && typeof inner === "string" ? `${inner.slice(0, 4)}…(redacted)` : inner,
    ),
  );
}

/** Polls `predicate` until it returns a truthy value or the timeout elapses. */
export async function waitUntil(predicate, { timeoutMs = 5000, intervalMs = 50, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`${label} 대기 시간 초과`);
    await sleep(intervalMs);
  }
}
