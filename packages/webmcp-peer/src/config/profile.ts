import {
  buildInvitationUrl,
  normalizePeerConfigUrl,
  parseInvitationUrl,
} from "./invitation.js";
import {
  WEBMCP_PEER_CONFIG_TYPE,
  type CreatePeerConfigProfileOptions,
  type ParsePeerConfigResult,
  type WebMcpPeerConfigProfile,
} from "./types.js";

const DEFAULT_PEER_CONFIG = {
  approvalRequired: true,
  roomTtlMs: 2 * 60 * 60 * 1000,
} as const;

const FORBIDDEN_PROFILE_SECRET_KEYS = new Set([
  "publishKey",
  "providerToken",
  "reconnectToken",
  "leaseToken",
  "clientToken",
  "inviteToken",
]);

function sanitizeProfileDefaults(defaults?: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...DEFAULT_PEER_CONFIG };
  if (!defaults) return merged;
  for (const [key, value] of Object.entries(defaults)) {
    if (FORBIDDEN_PROFILE_SECRET_KEYS.has(key)) continue;
    merged[key] = value;
  }
  return merged;
}

export function createPeerConfigProfile(
  input: CreatePeerConfigProfileOptions = {},
): WebMcpPeerConfigProfile {
  const parsedInvite = input.invitationUrl ? parseInvitationUrl(input.invitationUrl) : null;
  const rawServerUrl = input.serverUrl || parsedInvite?.serverUrl || "http://127.0.0.1:8787";
  const serverUrl = normalizePeerConfigUrl(rawServerUrl);
  const roomId = (input.roomId ?? parsedInvite?.roomId ?? "").trim() || undefined;
  const inviteToken = (input.inviteToken ?? parsedInvite?.inviteToken ?? "").trim() || undefined;
  const invitationUrl =
    input.invitationUrl?.trim() ||
    (roomId && inviteToken ? buildInvitationUrl({ serverUrl, roomId, inviteToken }) : undefined);
  const profileType = input.profileType?.trim() || WEBMCP_PEER_CONFIG_TYPE;
  const alias = input.alias?.trim() || undefined;

  return {
    type: profileType,
    version: 1,
    serverUrl,
    ...(alias ? { alias } : {}),
    protocol: "webmcp-peer/1",
    ...(roomId ? { roomId } : {}),
    ...(typeof input.roomEpoch === "number" ? { roomEpoch: input.roomEpoch } : {}),
    ...(invitationUrl ? { invitationUrl } : {}),
    mcpEndpointTemplate: `${serverUrl}/p/{roomId}/mcp`,
    clientEndpointTemplate: `${serverUrl.replace(/^http/i, "ws")}/p/{roomId}/client`,
    roomEndpoint: `${serverUrl}/p`,
    defaults: sanitizeProfileDefaults(input.defaults),
  };
}

export function stringifyPeerConfigProfile(input: CreatePeerConfigProfileOptions = {}): string {
  return JSON.stringify(createPeerConfigProfile(input), null, 2);
}

export function parsePeerConfig(value: string): ParsePeerConfigResult {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const invitationUrl = typeof parsed.invitationUrl === "string" ? parsed.invitationUrl.trim() : undefined;
    const serverUrl = typeof parsed.serverUrl === "string" ? parsed.serverUrl.trim() : undefined;
    const explicitRoomId = typeof parsed.roomId === "string" ? parsed.roomId.trim() : undefined;
    const alias = typeof parsed.alias === "string" && parsed.alias.trim() ? parsed.alias.trim() : undefined;
    if (!serverUrl && !invitationUrl) return null;
    const parsedInvitation = invitationUrl ? parseInvitationUrl(invitationUrl) : null;
    const fromInvitation = invitationUrl ? new URL(invitationUrl) : null;
    const roomId = explicitRoomId || parsedInvitation?.roomId;
    const inviteToken = parsedInvitation?.inviteToken;
    return {
      serverUrl: normalizePeerConfigUrl(serverUrl || parsedInvitation?.serverUrl || fromInvitation?.origin || ""),
      ...(alias ? { alias } : {}),
      ...(roomId ? { roomId } : {}),
      ...(invitationUrl ? { invitationUrl } : {}),
      ...(inviteToken ? { inviteToken } : {}),
    };
  } catch {
    try {
      const parsedInvitation = parseInvitationUrl(raw);
      if (parsedInvitation) {
        return {
          serverUrl: parsedInvitation.serverUrl,
          roomId: parsedInvitation.roomId,
          invitationUrl: raw,
          inviteToken: parsedInvitation.inviteToken,
        };
      }
      const parsed = new URL(raw);
      const roomMatch = parsed.pathname.match(/\/p\/([^/]+)(?:\/mcp)?\/?$/);
      const roomId = roomMatch?.[1] ? decodeURIComponent(roomMatch[1]) : undefined;
      return {
        serverUrl: normalizePeerConfigUrl(parsed.origin),
        ...(roomId ? { roomId } : {}),
        invitationUrl: raw,
      };
    } catch {
      return null;
    }
  }
}
