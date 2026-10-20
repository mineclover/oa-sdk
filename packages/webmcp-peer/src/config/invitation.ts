import {
  DEFAULT_EXTERNAL_CONSENT_PREFIX,
  type WebMcpParsedInvitationUrl,
} from "./types.js";

export function normalizePeerUrl(value?: string, fallback = ""): string {
  const trimmed = (value ?? "").trim() || fallback.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export function normalizePeerConfigUrl(value: string): string {
  return normalizePeerUrl(value).replace(/\/+$/, "");
}

export function isLocalPeerUrl(value: string): boolean {
  try {
    const normalized = normalizePeerUrl(value);
    const host = new URL(normalized).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

export function isSecurePeerTransport(value: string): boolean {
  const normalized = normalizePeerUrl(value);
  if (!normalized) return false;
  if (isLocalPeerUrl(normalized)) return true;
  try {
    return new URL(normalized).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Percent-decodes an invite token for masking. A token with malformed percent-encoding (which
 * `parseInvitationUrl` still accepts, because URLSearchParams decodes leniently) is masked in its
 * raw form instead of throwing: a redaction helper used for logging must never crash its caller.
 */
function decodeInviteToken(token: string): string {
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

export function redactInvitationUrl(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  const maskToken = (token: string): string => {
    if (token.length <= 6) return "****";
    return `${token.slice(0, 4)}...${token.slice(-2)}`;
  };
  return raw
    .replace(/(#invite=)([^&\s]+)/i, (_m, prefix, token) => `${prefix}${maskToken(decodeInviteToken(token))}`)
    .replace(/([?&]invite=)([^&#\s]+)/i, (_m, prefix, token) => `${prefix}${maskToken(decodeInviteToken(token))}`);
}

export function externalConsentKey(value: string, prefix: string = DEFAULT_EXTERNAL_CONSENT_PREFIX): string {
  try {
    const normalized = normalizePeerUrl(value);
    return `${prefix}:${new URL(normalized).origin}`;
  } catch {
    return `${prefix}:${value}`;
  }
}

/**
 * Reads an invitation URL: `<origin>/p/<roomId>` or `<origin>/p/<roomId>/mcp` (a trailing `/`
 * allowed) with the invite token in `#invite=` (or `?invite=`). Both forms give the same result,
 * whose `descriptorUrl` is the relay's room descriptor route `<origin>/p/<roomId>/mcp`, the URL the
 * relay reports as `descriptorUrl` and the provider shares, and also the room's `mcpEndpoint`.
 * Null when the URL names no room or carries no invite token.
 */
export function parseInvitationUrl(value: string): WebMcpParsedInvitationUrl | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const match = parsed.pathname.match(/\/p\/([^/]+)(?:\/mcp)?\/?$/);
    const roomId = match?.[1] ? decodeURIComponent(match[1]) : "";
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    const inviteToken = (hashParams.get("invite") || parsed.searchParams.get("invite") || "").trim();
    if (!roomId || !inviteToken) return null;
    const serverUrl = normalizePeerConfigUrl(parsed.origin);
    const roomEndpoint = `${serverUrl}/p/${encodeURIComponent(roomId)}/mcp`;
    return {
      serverUrl,
      roomId,
      descriptorUrl: roomEndpoint,
      inviteToken,
      mcpEndpoint: roomEndpoint,
    };
  } catch {
    return null;
  }
}

/**
 * Builds `<descriptorUrl>#invite=<token>`. `descriptorUrl` (its fragment and trailing `/` removed)
 * is used as given, typically the relay's `descriptorUrl`; without one it is the room descriptor
 * route `<serverUrl>/p/<roomId>/mcp` (`serverUrl` default `http://127.0.0.1:8787`).
 */
export function buildInvitationUrl(input: {
  descriptorUrl?: string;
  serverUrl?: string;
  roomId: string;
  inviteToken: string;
}): string {
  const roomId = input.roomId.trim();
  const inviteToken = input.inviteToken.trim();
  if (!roomId || !inviteToken) {
    throw new Error("roomId and inviteToken are required to build an invitation URL");
  }
  const baseDescriptor = input.descriptorUrl?.trim()
    ? input.descriptorUrl.trim().replace(/#.*$/, "").replace(/\/+$/, "")
    : `${normalizePeerConfigUrl(input.serverUrl || "http://127.0.0.1:8787")}/p/${encodeURIComponent(roomId)}/mcp`;
  return `${baseDescriptor}#invite=${encodeURIComponent(inviteToken)}`;
}
