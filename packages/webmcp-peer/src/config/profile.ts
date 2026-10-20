import {
  buildInvitationUrl,
  normalizePeerConfigUrl,
  parseInvitationUrl,
} from "./invitation.js";
import { isJsonObject, type PeerJsonSchema } from "./json.js";
import {
  WEBMCP_PEER_CONFIG_TYPE,
  WEBMCP_PROTOCOL,
  type CreatePeerConfigProfileOptions,
  type ParsePeerConfigResult,
  type WebMcpPeerConfigProfile,
} from "./types.js";

/**
 * The defaults a profile carries when the caller passes none. `roomTtlMs` is the TTL a room asks for
 * (the relay's default request), not the TTL it gets: the relay clamps it to its `maxRoomTtlMs`,
 * which this client-side library cannot know. A profile with the relay's actual values takes them
 * from `GET /config` (`fetchPeerServerConfig(...).defaults`) as `options.defaults`.
 */
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

/**
 * Builds a shareable, secret-free peer config profile. `defaults` is `{approvalRequired: true,
 * roomTtlMs: 7200000}` overlaid with `input.defaults` (minus secret keys); pass the `defaults` of the
 * relay's `GET /config` to get the values the relay applies, since 7200000 is only the TTL a room
 * asks for before the relay clamps it to its `maxRoomTtlMs`.
 */
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
    protocol: WEBMCP_PROTOCOL,
    ...(roomId ? { roomId } : {}),
    ...(typeof input.roomEpoch === "number" ? { roomEpoch: input.roomEpoch } : {}),
    ...(invitationUrl ? { invitationUrl } : {}),
    mcpEndpointTemplate: `${serverUrl}/p/{roomId}/mcp`,
    clientEndpointTemplate: `${serverUrl.replace(/^http/i, "ws")}/p/{roomId}/client`,
    roomEndpoint: `${serverUrl}/p`,
    defaults: sanitizeProfileDefaults(input.defaults),
  };
}

/** The members of a pasted JSON peer config document that `parsePeerConfig` reads. */
interface PeerConfigDocument {
  readonly invitationUrl?: string;
  readonly serverUrl?: string;
  readonly roomId?: string;
  readonly alias?: string;
}

/**
 * A pasted peer config (`createPeerConfigProfile` output or a hand-written subset). It must be a
 * JSON object; an optional member with the wrong type is dropped rather than rejecting the whole
 * document, and string members are trimmed.
 */
const PeerConfigDocumentSchema: PeerJsonSchema<PeerConfigDocument> = {
  parse(value) {
    if (!isJsonObject(value)) throw new TypeError("Peer config must be a JSON object");
    const text = (member: unknown): string | undefined => (typeof member === "string" ? member.trim() : undefined);
    const invitationUrl = text(value.invitationUrl);
    const serverUrl = text(value.serverUrl);
    const roomId = text(value.roomId);
    const alias = text(value.alias);
    return {
      ...(invitationUrl !== undefined ? { invitationUrl } : {}),
      ...(serverUrl !== undefined ? { serverUrl } : {}),
      ...(roomId !== undefined ? { roomId } : {}),
      ...(alias ? { alias } : {}),
    };
  },
};

export function stringifyPeerConfigProfile(input: CreatePeerConfigProfileOptions = {}): string {
  return JSON.stringify(createPeerConfigProfile(input), null, 2);
}

export function parsePeerConfig(value: string): ParsePeerConfigResult {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const { invitationUrl, serverUrl, roomId: explicitRoomId, alias } = PeerConfigDocumentSchema.parse(JSON.parse(raw));
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
