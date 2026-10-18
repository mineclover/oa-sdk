export const WEBMCP_SUBPROTOCOL = "webmcp-peer.v1" as const;
export const WEBMCP_PEER_CONFIG_TYPE = "framebook.peer.config" as const;
export const DEFAULT_EXTERNAL_CONSENT_PREFIX = "webmcp:external-transmission-consent" as const;

export interface WebMcpPeerConfigProfile {
  readonly type: string;
  readonly version: 1;
  readonly serverUrl: string;
  readonly alias?: string;
  readonly protocol: "webmcp-peer/1";
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
  readonly defaults?: Readonly<Record<string, unknown>>;
}

export interface WebMcpParsedInvitationUrl {
  readonly serverUrl: string;
  readonly roomId: string;
  readonly descriptorUrl: string;
  readonly inviteToken: string;
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
    readonly roomTtlMs?: number;
  };
  readonly [key: string]: unknown;
}

export type PeerHealthState = "unknown" | "checking" | "healthy" | "unreachable" | "unhealthy";

export interface PeerHealthResult {
  readonly ok: boolean;
  readonly state: Exclude<PeerHealthState, "unknown" | "checking">;
  readonly status?: number | null;
  readonly message: string;
  readonly activeRooms?: number;
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
