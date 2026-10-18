import { normalizePeerConfigUrl } from "./invitation.js";
import type {
  PeerHealthProbeOptions,
  PeerHealthResult,
  PeerServerPublicConfig,
} from "./types.js";

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
          : msgs?.unhealthy
            ? msgs.unhealthy(`HTTP ${response.status}`)
            : `피어 서버가 HTTP ${response.status}로 응답했습니다. 서버 상태와 주소를 확인하세요.`,
      };
    }
    if (body?.status !== "healthy") {
      return {
        ok: false,
        state: "unhealthy",
        status: response.status,
        message: msgs?.invalidFormat
          ?? (msgs?.unhealthy ? msgs.unhealthy("invalid health payload") : "피어 서버 응답 형식이 올바르지 않습니다. 호환되는 Framebook peer 서버를 사용하세요."),
      };
    }
    return {
      ok: true,
      state: "healthy",
      status: response.status,
      message: msgs?.healthy ?? "피어 서버가 정상 응답했습니다.",
      ...(typeof body.activeRooms === "number" ? { activeRooms: body.activeRooms } : {}),
      ...(typeof body.uptimeSec === "number" ? { uptimeSec: body.uptimeSec } : {}),
    };
  } catch (error: unknown) {
    const errObj = error as { name?: string; message?: string } | null;
    const aborted = timedOut || (errObj?.name === "AbortError" && !options.signal?.aborted);
    const timeoutMsg = typeof msgs?.timeout === "function"
      ? msgs.timeout(timeoutMs)
      : msgs?.timeout ?? `피어 서버 응답 시간이 초과되었습니다 (${timeoutMs}ms). 서버가 실행 중인지 확인하세요.`;
    const unreachableMsg = typeof msgs?.unreachable === "function"
      ? msgs.unreachable(errObj?.message || "network error")
      : msgs?.unreachable ?? "피어 서버에 연결할 수 없습니다. 주소, CORS, 네트워크를 확인하세요.";
    return {
      ok: false,
      state: "unreachable",
      status: null,
      message: aborted
        ? timeoutMsg
        : options.signal?.aborted
          ? (msgs?.aborted ?? "피어 서버 상태 확인이 취소되었습니다.")
          : unreachableMsg,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

export async function fetchPeerServerConfig(
  value: string,
  options: Omit<PeerHealthProbeOptions, "messages"> = {},
): Promise<PeerServerPublicConfig> {
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
    const body = await response.json().catch(() => ({})) as PeerServerPublicConfig;
    if (!response.ok) {
      throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${response.status}`);
    }
    return body;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}
