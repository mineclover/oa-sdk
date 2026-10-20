/**
 * The name of the WebMCP relay protocol: the `protocol` member of the relay's control frames and the
 * provider's frames, of `GET /config` and of a config profile. A WebSocket peer offers the same
 * protocol as {@link WEBMCP_SUBPROTOCOL}, since a subprotocol is a token (RFC 6455 §4.1) and a token
 * cannot contain `/`.
 */
export const WEBMCP_PROTOCOL = "webmcp-peer/1" as const;
/**
 * The WebSocket subprotocol of {@link WEBMCP_PROTOCOL}, offered next to the `ticket.<token>` entry,
 * and the `protocol` member of the room descriptor (`GET /p/:id/mcp`) and of `GET /mcp/catalog`.
 */
export const WEBMCP_SUBPROTOCOL = "webmcp-peer.v1" as const;
/**
 * The syntax of a room id, without anchors, for building the relay's route patterns. Internal to the
 * package: {@link WEBMCP_ROOM_ID_PATTERN} is its public form.
 */
export const WEBMCP_ROOM_ID_SYNTAX = "[A-Za-z0-9_-]{1,128}";
/**
 * The room id grammar of the protocol: 1 to 128 characters of `A-Z`, `a-z`, `0-9`, `_` and `-`, so an
 * id stands in a URL path as it is. Every relay route and upgrade path, the provider's descriptor
 * check and the agent client's `parseRoomId` accept exactly these ids. This relay issues 32 lowercase
 * hex characters; peers accept any id of the grammar, so they also work with a relay that issues
 * others.
 */
export const WEBMCP_ROOM_ID_PATTERN = new RegExp(`^${WEBMCP_ROOM_ID_SYNTAX}$`);
export const WEBMCP_PEER_CONFIG_TYPE = "framebook.peer.config" as const;
export const DEFAULT_EXTERNAL_CONSENT_PREFIX = "webmcp:external-transmission-consent" as const;

export interface WebMcpPeerConfigProfile {
  readonly type: string;
  readonly version: 1;
  readonly serverUrl: string;
  readonly alias?: string;
  readonly protocol: typeof WEBMCP_PROTOCOL;
  readonly roomId?: string;
  readonly roomEpoch?: number;
  readonly invitationUrl?: string;
  readonly mcpEndpointTemplate: string;
  readonly clientEndpointTemplate: string;
  /** Public room creation endpoint from GET /config. */
  readonly roomEndpoint: string;
  /** Public, secret-free defaults from GET /config. */
  readonly defaults: Readonly<Record<string, unknown>>;
}

export interface CreatePeerConfigProfileOptions {
  readonly serverUrl?: string;
  readonly alias?: string;
  readonly roomId?: string | null;
  readonly roomEpoch?: number | null;
  readonly invitationUrl?: string | null;
  readonly inviteToken?: string | null;
  readonly profileType?: string;
  /**
   * The profile's defaults over `{approvalRequired: true, roomTtlMs: 7200000}`. Pass the relay's
   * `GET /config` `defaults` here: 7200000 is the TTL a room asks for, which the relay clamps to its
   * `maxRoomTtlMs`.
   */
  readonly defaults?: Readonly<Record<string, unknown>>;
}

export interface WebMcpParsedInvitationUrl {
  readonly serverUrl: string;
  readonly roomId: string;
  /** The room descriptor route `<serverUrl>/p/<roomId>/mcp`, as the relay reports `descriptorUrl`. */
  readonly descriptorUrl: string;
  readonly inviteToken: string;
  /** The room's Streamable HTTP MCP endpoint, the same route as `descriptorUrl`. */
  readonly mcpEndpoint: string;
}

export interface ParsedPeerConfig {
  readonly serverUrl: string;
  readonly alias?: string;
  readonly roomId?: string;
  readonly invitationUrl?: string;
  readonly inviteToken?: string;
}

export type ParsePeerConfigResult = ParsedPeerConfig | null;

export interface PeerServerPublicConfig {
  readonly type?: string;
  readonly version?: number;
  readonly serverUrl?: string;
  readonly protocol?: string;
  readonly mcpEndpointTemplate?: string;
  readonly clientEndpointTemplate?: string;
  readonly roomEndpoint?: string;
  readonly defaults?: {
    readonly approvalRequired?: boolean;
    /** The TTL a room gets when `POST /p` names none, already bounded by `maxRoomTtlMs`. */
    readonly roomTtlMs?: number;
    /** The relay's upper bound for a room TTL: `POST /p` and rotate clamp a larger `ttlMs` to it. */
    readonly maxRoomTtlMs?: number;
  };
  readonly [key: string]: unknown;
}

export type PeerHealthState = "unknown" | "checking" | "healthy" | "unreachable" | "unhealthy";

export interface PeerHealthResult {
  readonly ok: boolean;
  readonly state: Exclude<PeerHealthState, "unknown" | "checking">;
  readonly status?: number | null;
  readonly message: string;
  /** The relay's live rooms, neither expired nor rotated (`/health`'s `activeRooms`). */
  readonly activeRooms?: number;
  /** The expired and rotated rooms the relay still retains (`/health`'s `retainedRooms`). */
  readonly retainedRooms?: number;
  readonly uptimeSec?: number;
}

export interface PeerHealthMessages {
  readonly emptyUrl?: string;
  readonly fetchUnavailable?: string;
  readonly aborted?: string;
  readonly httpError?: (status: number) => string;
  readonly invalidFormat?: string;
  readonly healthy?: string;
  readonly timeout?: string | ((timeoutMs: number) => string);
  readonly unreachable?: string | ((detail: string) => string);
  readonly unhealthy?: (detail: string) => string;
}

export interface PeerHealthProbeOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Optional caller-owned cancellation signal for superseded endpoint checks. */
  readonly signal?: AbortSignal;
  /** Optional custom localized messages for host products. */
  readonly messages?: PeerHealthMessages;
}
