export const WEBMCP_SUBPROTOCOL = "webmcp-peer.v1" as const;
export const WEBMCP_PEER_CONFIG_TYPE = "framebook.peer.config" as const;
export const DEFAULT_EXTERNAL_CONSENT_PREFIX = "webmcp:external-transmission-consent" as const;

export interface WebMcpPeerConfigProfile {
  readonly type: string;
  readonly version: 1;
  readonly serverUrl: string;
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

export interface WebMcpParsedInvitationUrl {
  readonly serverUrl: string;
  readonly roomId: string;
  readonly descriptorUrl: string;
  readonly inviteToken: string;
}

export type PeerHealthState = "unknown" | "checking" | "healthy" | "unreachable" | "unhealthy";

export interface PeerHealthResult {
  readonly ok: boolean;
  readonly state: Exclude<PeerHealthState, "unknown" | "checking">;
  readonly status?: number;
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
  readonly timeout?: (timeoutMs: number) => string;
  readonly unreachable?: string;
}

export interface PeerHealthProbeOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Optional caller-owned cancellation signal for superseded endpoint checks. */
  readonly signal?: AbortSignal;
  /** Optional custom localized messages for non-Framebook host products. */
  readonly messages?: PeerHealthMessages;
}

const DEFAULT_PEER_CONFIG = {
  approvalRequired: true,
  roomTtlMs: 2 * 60 * 60 * 1000,
} as const;

export function normalizePeerUrl(value: string): string {
  const trimmed = value.trim();
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

export function externalConsentKey(value: string, prefix: string = DEFAULT_EXTERNAL_CONSENT_PREFIX): string {
  try {
    const normalized = normalizePeerUrl(value);
    return `${prefix}:${new URL(normalized).origin}`;
  } catch {
    return `${prefix}:${value}`;
  }
}

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
    return {
      serverUrl,
      roomId,
      descriptorUrl: `${serverUrl}/p/${encodeURIComponent(roomId)}`,
      inviteToken,
    };
  } catch {
    return null;
  }
}

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
    : `${normalizePeerConfigUrl(input.serverUrl || "")}/p/${encodeURIComponent(roomId)}`;
  return `${baseDescriptor}#invite=${encodeURIComponent(inviteToken)}`;
}

export function createPeerConfigProfile(input: {
  serverUrl: string;
  roomId?: string;
  roomEpoch?: number | null;
  invitationUrl?: string | null;
  profileType?: string;
  defaults?: Readonly<Record<string, unknown>>;
}): WebMcpPeerConfigProfile {
  const serverUrl = normalizePeerConfigUrl(input.serverUrl);
  const roomId = input.roomId?.trim() || undefined;
  const profileType = input.profileType?.trim() || WEBMCP_PEER_CONFIG_TYPE;
  return {
    type: profileType,
    version: 1,
    serverUrl,
    protocol: "webmcp-peer/1",
    ...(roomId ? { roomId } : {}),
    ...(typeof input.roomEpoch === "number" ? { roomEpoch: input.roomEpoch } : {}),
    ...(input.invitationUrl ? { invitationUrl: input.invitationUrl } : {}),
    mcpEndpointTemplate: `${serverUrl}/p/{roomId}/mcp`,
    clientEndpointTemplate: `${serverUrl.replace(/^http/i, "ws")}/p/{roomId}/client`,
    roomEndpoint: `${serverUrl}/p`,
    defaults: { ...DEFAULT_PEER_CONFIG, ...(input.defaults ?? {}) },
  };
}

export function stringifyPeerConfigProfile(input: Parameters<typeof createPeerConfigProfile>[0]): string {
  return JSON.stringify(createPeerConfigProfile(input), null, 2);
}

export function parsePeerConfig(value: string): {
  serverUrl: string;
  roomId?: string;
  invitationUrl?: string;
} | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const invitationUrl = typeof parsed.invitationUrl === "string" ? parsed.invitationUrl : undefined;
    const serverUrl = typeof parsed.serverUrl === "string" ? parsed.serverUrl : undefined;
    const explicitRoomId = typeof parsed.roomId === "string" ? parsed.roomId.trim() : undefined;
    if (!serverUrl && !invitationUrl) return null;
    const parsedInvitation = invitationUrl ? parseInvitationUrl(invitationUrl) : null;
    const fromInvitation = invitationUrl ? new URL(invitationUrl) : null;
    const roomId = explicitRoomId || parsedInvitation?.roomId;
    return {
      serverUrl: normalizePeerConfigUrl(serverUrl || parsedInvitation?.serverUrl || fromInvitation?.origin || ""),
      ...(roomId ? { roomId } : {}),
      ...(invitationUrl ? { invitationUrl } : {}),
    };
  } catch {
    try {
      const parsedInvitation = parseInvitationUrl(raw);
      if (parsedInvitation) {
        return {
          serverUrl: parsedInvitation.serverUrl,
          roomId: parsedInvitation.roomId,
          invitationUrl: raw,
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

/**
 * Check the peer's public health route before creating a room. This is kept
 * separate from `WebMcpPeerClient.connect` so the settings UI or host product
 * can explain a dead/slow endpoint without creating a half-open room or
 * sending a publish request. The helper is injectable for deterministic tests.
 */
export async function probePeerHealth(value: string, options: PeerHealthProbeOptions = {}): Promise<PeerHealthResult> {
  const msgs = options.messages;
  const base = normalizePeerConfigUrl(value);
  if (!base) {
    return {
      ok: false,
      state: "unhealthy",
      message: msgs?.emptyUrl ?? "피어 시그널링 서버 주소를 입력하세요.",
    };
  }

  const fetchImpl = options.fetchImpl
    ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined);
  if (!fetchImpl) {
    return {
      ok: false,
      state: "unreachable",
      message: msgs?.fetchUnavailable ?? "이 브라우저에서는 피어 서버 상태 확인을 사용할 수 없습니다.",
    };
  }
  const timeoutMs = Math.max(250, options.timeoutMs ?? 5000);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const onExternalAbort = () => controller?.abort();
  if (options.signal?.aborted) {
    return {
      ok: false,
      state: "unreachable",
      message: msgs?.aborted ?? "피어 서버 상태 확인이 취소되었습니다.",
    };
  }
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  try {
    const request = fetchImpl(`${base}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      ...(controller ? { signal: controller.signal } : options.signal ? { signal: options.signal } : {}),
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller?.abort();
        reject(new Error("PEER_HEALTH_TIMEOUT"));
      }, timeoutMs);
    });
    const response = await Promise.race([request, timeout]);
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      return {
        ok: false,
        state: "unhealthy",
        status: response.status,
        message: msgs?.httpError
          ? msgs.httpError(response.status)
          : `피어 서버가 HTTP ${response.status}로 응답했습니다. 서버 상태와 주소를 확인하세요.`,
      };
    }
    if (body?.status !== "healthy") {
      return {
        ok: false,
        state: "unhealthy",
        status: response.status,
        message: msgs?.invalidFormat ?? "피어 서버 응답 형식이 올바르지 않습니다. 호환되는 Framebook peer 서버를 사용하세요.",
      };
    }
    return {
      ok: true,
      state: "healthy",
      status: response.status,
      message: msgs?.healthy ?? "피어 서버가 정상 응답했습니다.",
    };
  } catch (error: unknown) {
    const errObj = error as { name?: string } | null;
    const aborted = timedOut || (errObj?.name === "AbortError" && !options.signal?.aborted);
    return {
      ok: false,
      state: "unreachable",
      message: aborted
        ? (msgs?.timeout ? msgs.timeout(timeoutMs) : `피어 서버 응답 시간이 초과되었습니다 (${timeoutMs}ms). 서버가 실행 중인지 확인하세요.`)
        : options.signal?.aborted
          ? (msgs?.aborted ?? "피어 서버 상태 확인이 취소되었습니다.")
          : (msgs?.unreachable ?? "피어 서버에 연결할 수 없습니다. 주소, CORS, 네트워크를 확인하세요."),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

export async function fetchPeerServerConfig(
  value: string,
  options: Omit<PeerHealthProbeOptions, "messages"> = {},
): Promise<Record<string, unknown>> {
  const base = normalizePeerConfigUrl(value);
  if (!base) throw new Error("피어 시그널링 서버 주소를 입력하세요.");
  const fetchImpl = options.fetchImpl
    ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined);
  if (!fetchImpl) throw new Error("fetch를 사용할 수 없습니다.");
  const timeoutMs = Math.max(250, options.timeoutMs ?? 5000);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onExternalAbort = () => controller?.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  try {
    const request = fetchImpl(`${base}/config`, {
      method: "GET",
      headers: { Accept: "application/json" },
      ...(controller ? { signal: controller.signal } : options.signal ? { signal: options.signal } : {}),
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        reject(new Error(`피어 서버 설정 조회 시간 초과 (${timeoutMs}ms)`));
      }, timeoutMs);
    });
    const response = await Promise.race([request, timeout]);
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${response.status}`);
    }
    return body;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}
