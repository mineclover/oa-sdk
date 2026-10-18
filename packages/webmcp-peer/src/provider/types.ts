export interface WebMcpCrdtTransport {
  readonly documentId?: string;
  attachCarrier(sender: (message: unknown) => void): () => void;
  broadcastAwareness(): void;
  receiveExternal(message: unknown): void;
  receiveVerified?: (envelope: unknown) => boolean | Promise<boolean>;
  invalidateCarrier?: (reason?: string) => void;
  isCarrierActive?: () => boolean;
  bindCarrier?: (binding: Record<string, unknown>) => void;
  setCarrierBinding?: (binding: Record<string, unknown>) => void;
  clearPeers?: () => void;
}

export interface CrdtCarrierEnvelope {
  readonly kind: "crdt";
  readonly protocolVersion: "1.0.0";
  readonly message: unknown;
  readonly roomId: string;
  readonly roomEpoch: number;
  readonly sessionId: string;
  readonly replicaId: string;
  readonly transportGeneration: number;
  readonly messageId: string;
  readonly documentId: string;
}

export function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isCarrierEnvelope(value: unknown): value is CrdtCarrierEnvelope {
  if (!isRecord(value) || value.kind !== "crdt" || value.protocolVersion !== "1.0.0" || !isRecord(value.message)) {
    return false;
  }
  return (
    typeof value.roomId === "string" &&
    value.roomId.length > 0 &&
    Number.isSafeInteger(value.roomEpoch) &&
    value.roomEpoch >= 0 &&
    typeof value.sessionId === "string" &&
    value.sessionId.length > 0 &&
    typeof value.replicaId === "string" &&
    value.replicaId.length > 0 &&
    Number.isSafeInteger(value.transportGeneration) &&
    value.transportGeneration >= 0 &&
    typeof value.messageId === "string" &&
    value.messageId.length > 0 &&
    typeof value.documentId === "string" &&
    value.documentId.length > 0
  );
}

export function defaultShouldSuppressAutoReconnect(location: { search?: string; pathname?: string }): boolean {
  try {
    const params = new URLSearchParams(location.search || "");
    const demoParam = (params.get("demo") || "").trim().toLowerCase();
    if (demoParam === "1" || demoParam === "true" || demoParam === "board") return true;
    const boardParam = (params.get("board") || "").trim();
    if (boardParam === "demo") return true;
    if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(boardParam)) return true;
    const pathname = location.pathname || "";
    if (/^\/b\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/?$/.test(pathname)) return true;
    if (/^\/boards\/?$/.test(pathname)) return true;
    const view = (params.get("view") || "").trim().toLowerCase();
    if (view === "boards" || view === "public-boards") return true;
  } catch {}
  return false;
}

export type WebMcpPeerState = "idle" | "creating" | "waiting" | "connected" | "disconnected" | "error";
export type WebMcpPeerApprovalState = "none" | "pending" | "approved" | "revoked" | "expired";

export interface WebMcpPeerSessionInfo {
  state: WebMcpPeerState;
  serverUrl: string;
  invitationUrl: string | null;
  roomId: string | null;
  clientLabel: string | null;
  error: string | null;
  toolsCount: number;
  writeEnabled: boolean;
  alias: string;
  autoReconnect: boolean;
  connectedAt: number | null;
  expiresAt: number | null;
  approvalState?: WebMcpPeerApprovalState;
  approvalRequestId?: string | null;
  roomEpoch?: number;
  roomGeneration?: number;
  replicaId?: string;
  crdtCapability?: boolean;
}

export interface WebMcpToolSummary {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

/** MCP tool descriptor as the provider publishes it on every channel. */
export interface WebMcpWireToolDescriptor {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

const EMPTY_INPUT_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({ type: "object", properties: {} });

/**
 * The single serialization of a host tool for `register` frames, `tools/list` and
 * `server/discover`. The relay hashes whatever it receives, so every channel must publish the
 * identical descriptor or the catalog version flaps between shapes and agents see spurious
 * CATALOG_CHANGED errors.
 */
export function toWireToolDescriptor(tool: WebMcpToolSummary): WebMcpWireToolDescriptor {
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    description: tool.description,
    inputSchema: tool.inputSchema ?? { ...EMPTY_INPUT_SCHEMA },
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  };
}

export interface WebMcpHostServerInfo {
  name: string;
  version: string;
  instructions?: string;
}

export interface WebMcpHostAdapter {
  listTools?: () => readonly WebMcpToolSummary[];
  invoke?: (name: string, args?: Record<string, unknown>, options?: Record<string, unknown>) => Promise<any>;
  getStatus?: () => { writeEnabled?: boolean; [key: string]: unknown };
  setWriteEnabled?: (enabled: boolean) => { writeEnabled?: boolean; [key: string]: unknown } | void;
  toggleWrite?: () => { writeEnabled?: boolean; [key: string]: unknown } | void;
  getContext?: () => Record<string, unknown>;
  getServerInfo?: () => WebMcpHostServerInfo;
  getUndoToolName?: () => string;
}

export interface WebMcpPeerConnectOptions {
  serverUrl: string;
  alias?: string;
  title?: string;
  autoReconnect?: boolean;
  publishKey?: string;
  enableWrite?: boolean;
  enableCrdt?: boolean;
  iceServers?: RTCIceServer[];
  reclaimLease?: boolean;
}

export interface WebMcpPeerClientOptions {
  hostAdapter?: WebMcpHostAdapter;
  shouldSuppressAutoReconnect?: (location: { search?: string; pathname?: string }) => boolean;
}

export interface SavedRoomLease {
  readonly serverUrl: string;
  readonly roomId: string;
  readonly roomEpoch: number;
  readonly leaseToken: string;
  readonly expiresAt: number;
  readonly alias?: string;
}

export const FRAMEBOOK_PRODUCTION_SIGNALING_URL = "https://framebook-peer.suggestions.cc";

export function resolveDefaultSignalingUrl(): string {
  if (typeof window !== "undefined") {
    if ((window as any).__FRAMEBOOK_SIGNALING_URL__) {
      return (window as any).__FRAMEBOOK_SIGNALING_URL__;
    }
    const isPagesOrigin = (() => {
      try {
        return Boolean(window.location?.hostname.endsWith(".pages.dev"));
      } catch {
        return false;
      }
    })();
    try {
      const saved =
        localStorage.getItem("webmcp:server-url") || localStorage.getItem("framebook_webmcp_server");
      const isLoopback = Boolean(
        saved && /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(saved),
      );
      if (
        saved &&
        (saved === "https://framebook-peer-production.astralclover.workers.dev" ||
          saved.includes("yourdomain.workers.dev"))
      ) {
        try {
          localStorage.removeItem("webmcp:server-url");
          localStorage.removeItem("framebook_webmcp_server");
        } catch {}
        return isPagesOrigin ? FRAMEBOOK_PRODUCTION_SIGNALING_URL : "http://127.0.0.1:8787";
      }
      if (saved && !(isPagesOrigin && isLoopback)) return saved;
    } catch {}
    if (isPagesOrigin) return FRAMEBOOK_PRODUCTION_SIGNALING_URL;
  }
  const procEnv = (globalThis as any).process?.env;
  if (procEnv?.VITE_SIGNALING_URL || procEnv?.SIGNALING_URL) {
    return procEnv.VITE_SIGNALING_URL || procEnv.SIGNALING_URL;
  }
  return "http://127.0.0.1:8787";
}
