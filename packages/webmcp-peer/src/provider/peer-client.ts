import { normalizePeerConfigUrl } from "../config/invitation.js";
import { isJsonObject, JsonObjectSchema, parseJsonObject, readResponseText } from "../config/json.js";
import { PEER_RELAY_MAX_CATALOG_BYTES, utf8ByteLength } from "../config/limits.js";
import { WEBMCP_PROTOCOL, WEBMCP_SUBPROTOCOL } from "../config/types.js";
import {
  AiRunController,
  AiRunLimitExceededError,
  type AiRollbackStepResult,
  type AiRunPoint,
  type AiRunSnapshot,
} from "./ai-run-controller.js";
import {
  AiRunLedger,
  AiRunLedgerError,
  InMemoryAiRunLedgerStore,
  type AiRunLedgerStore,
  type AiRunOperationRecord,
} from "./ai-run-ledger.js";
import {
  isCommitReceipt,
  MCP_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSIONS,
} from "./commit-receipt.js";
import {
  defaultShouldSuppressAutoReconnect,
  isCarrierEnvelope,
  isRecord,
  resolveDefaultSignalingUrl,
  toWireToolDescriptor,
  type CrdtCarrierEnvelope,
  type SavedRoomLease,
  type WebMcpCrdtTransport,
  type WebMcpHostAdapter,
  type WebMcpPeerApprovalState,
  type WebMcpPeerClientOptions,
  type WebMcpPeerConnectOptions,
  type WebMcpPeerSessionInfo,
  type WebMcpPeerState,
} from "./types.js";
import {
  RELAY_MAX_MESSAGE_BYTES,
  encodeRelayMcpReply,
  errorMessage,
  hostPayload,
  interpretHostResult,
  isAiRunPhase,
  nonEmptyString,
  readAiTrace,
  rpcRequestId,
  toolErrorResult,
  traceRunId,
  traceStepIndex,
  type JsonRpcId,
  type ProviderRpcResponse,
} from "./tool-call.js";
import {
  DataChannelChunkSchema,
  PeerRoomDescriptorSchema,
  ProviderFrameSchema,
  SavedRoomLeaseSchema,
  type PeerRoomDescriptor,
  type ProviderFrame,
} from "./wire-schemas.js";

const CATALOG_INVALID_ERROR = "CATALOG_INVALID";
const CATALOG_TOO_LARGE_ERROR = "CATALOG_TOO_LARGE";
/** The JSON-RPC error the relay itself answers a catalog request with when the room has no catalog. */
const CATALOG_UNAVAILABLE_RPC_ERROR = { code: -32090, message: "CATALOG_UNAVAILABLE" } as const;

/** True for a session error that reports a catalog the relay will not serve. */
function isCatalogError(error: string | null): boolean {
  return error !== null && (error.startsWith(CATALOG_INVALID_ERROR) || error.startsWith(CATALOG_TOO_LARGE_ERROR));
}

/** Which channel a JSON-RPC request reached the provider on. */
type McpRequestChannel = "relay" | "data-channel";

/**
 * The last `register` frame the provider sent to one relay room, kept as sent. The relay serves
 * the catalog it last accepted from the provider, and it keeps a room's catalog while the provider
 * reconnects, so this is the catalog the relay holds for that room unless it refused this frame.
 */
interface RegisteredCatalog {
  readonly serverUrl: string;
  readonly roomId: string;
  readonly registerSeq: number;
  /** The serialized `register` frame. */
  readonly frame: string;
  /**
   * Why the relay refused the frame (its CATALOG_INVALID or CATALOG_TOO_LARGE rejection), when it
   * did. The relay then still serves an older catalog, which the provider does not know.
   */
  refusal?: string;
}

/**
 * Sends one frame on the relay signaling socket; every frame the provider sends there goes through
 * here. The relay closes a socket that sends a message over its limit (close code 1009), and a
 * closed provider socket drops every agent of the room. Some frames echo values an agent chose (an
 * answer repeats the offer's `requestId`), so the serialized frame is measured instead of being
 * assumed small: a frame over {@link RELAY_MAX_MESSAGE_BYTES} is not sent, with a warning. Returns
 * whether the frame was handed to the socket.
 */
function sendRelayFrame(ws: WebSocket, frame: string | Record<string, unknown>, label: string): boolean {
  const text = typeof frame === "string" ? frame : JSON.stringify(frame);
  const bytes = utf8ByteLength(text);
  if (bytes > RELAY_MAX_MESSAGE_BYTES) {
    console.warn(
      `[WebMCP] The ${bytes}-byte ${label} frame exceeds the relay's ${RELAY_MAX_MESSAGE_BYTES}-byte message limit; it was not sent.`,
    );
    return false;
  }
  try {
    ws.send(text);
    return true;
  } catch {
    return false;
  }
}

/** Parses one signaling frame; anything that is not a JSON object with a string `type` is ignored. */
function parseProviderFrame(data: unknown): ProviderFrame | null {
  if (typeof data !== "string") return null;
  try {
    return ProviderFrameSchema.parse(JSON.parse(data));
  } catch {
    return null;
  }
}

/**
 * The relay URL of room `roomId`'s `route` (`/provider`, `/rotate`, ...), built like the agent
 * client builds its own (`websocketUrl`): the room id URL-encoded, and for a socket the scheme
 * `http`/`https` turned into `ws`/`wss` whatever its case. `serverUrl` is already normalized.
 */
function relayRoomUrl(serverUrl: string, roomId: string, route: string, socket = false): string {
  const base = socket ? serverUrl.replace(/^http/i, "ws") : serverUrl;
  return `${base}/p/${encodeURIComponent(roomId)}${route}`;
}

/**
 * How long the provider assumes a room lives when its descriptor names no `expiresAt` (30 minutes).
 * This relay always sends `expiresAt`, so the fallback is only for a relay that does not.
 */
const ROOM_EXPIRY_FALLBACK_MS = 30 * 60_000;

/** Parses a relay room descriptor, reporting any malformed one under `invalidCode`. */
function readRoomDescriptor(text: string, invalidCode: string): PeerRoomDescriptor {
  try {
    return PeerRoomDescriptorSchema.parse(JSON.parse(text));
  } catch {
    throw new Error(invalidCode);
  }
}

const HOST_ADAPTER_METHODS = [
  "listTools",
  "invoke",
  "getStatus",
  "setWriteEnabled",
  "toggleWrite",
  "getContext",
  "getServerInfo",
  "getUndoToolName",
] as const;

/** An object whose adapter members, where present, are functions. */
function isHostAdapter(value: unknown): value is WebMcpHostAdapter {
  return (
    isJsonObject(value) &&
    HOST_ADAPTER_METHODS.every((member) => value[member] === undefined || typeof value[member] === "function")
  );
}

/** The adapter a host page exposes as `globalThis.Framebook.webMCP` instead of passing it in. */
function globalHostAdapter(): WebMcpHostAdapter | undefined {
  const framebook: unknown = Reflect.get(globalThis, "Framebook");
  const adapter = isJsonObject(framebook) ? framebook.webMCP : undefined;
  return isHostAdapter(adapter) ? adapter : undefined;
}

export class WebMcpPeerClient {
  private static instance?: WebMcpPeerClient;

  private state: WebMcpPeerState = "idle";
  private serverUrl = resolveDefaultSignalingUrl();
  private alias = "wireframe-local";
  private autoReconnect = true;
  private invitationUrl: string | null = null;
  private roomId: string | null = null;
  private clientLabel: string | null = null;
  private error: string | null = null;
  private connectedAt: number | null = null;
  private expiresAt: number | null = null;
  private approvalState: WebMcpPeerApprovalState = "none";
  private approvalRequestId: string | null = null;
  private approvalSessionId: string | null = null;
  private approvalRoomEpoch: number | null = null;
  private approvalEnvelope = false;
  private roomEpoch: number | null = null;
  private roomGeneration = 0;
  private connectionGeneration = 0;
  private signalingReleased = false;
  private readonly replicaId = this.createReplicaId();
  private crdtCapabilityEnabled = false;
  private carrierSessionId: string | null = null;
  private carrierMessageSequence = 0;
  private remoteCarrierReplicaId: string | null = null;
  private readonly receivedCarrierMessages = new Set<string>();
  private readonly aiRuns = new AiRunController();
  private readonly aiRunSelections = new Map<string, { slideId: string; nodeIds: string[] }>();
  private aiRunLedger?: AiRunLedger;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private lastConnectOptions?: WebMcpPeerConnectOptions;

  private ws?: WebSocket;
  private providerToken: string | null = null;
  private pc?: RTCPeerConnection;
  private dataChannel?: RTCDataChannel;
  private listeners = new Set<(session: WebMcpPeerSessionInfo) => void>();
  private pingTimer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;

  private activeTransport?: WebMcpCrdtTransport;
  private crdtListeners = new Set<(message: unknown) => void>();
  private detachTransportCarrier?: () => void;

  private frameSeq = 0;
  /**
   * The `registerSeq` of the latest catalog sync: the last `register` frame sent, or one withheld
   * as too large. The relay echoes it in a rejection, so a rejection of an older catalog is told apart.
   */
  private registerSeq = 0;
  /** The last catalog sent to a relay room; relay-forwarded catalog requests are answered from it. */
  private registeredCatalog?: RegisteredCatalog;
  private framePending = new Map<number, { total: number; parts: string[]; received: number }>();
  private hostAdapter?: WebMcpHostAdapter;
  private shouldSuppressAutoReconnect: (location: { search?: string; pathname?: string }) => boolean;

  constructor(options: WebMcpPeerClientOptions = {}) {
    this.hostAdapter = options.hostAdapter;
    this.shouldSuppressAutoReconnect =
      options.shouldSuppressAutoReconnect ?? defaultShouldSuppressAutoReconnect;
    // The controller evicts idle runs at its run limit; drop the selection state of any run it no
    // longer tracks so the map stays bounded by the controller.
    this.aiRuns.subscribe(() => {
      for (const runId of this.aiRunSelections.keys()) {
        if (!this.aiRuns.get(runId)) this.aiRunSelections.delete(runId);
      }
    });
  }

  static getShared(): WebMcpPeerClient {
    if (!WebMcpPeerClient.instance) {
      WebMcpPeerClient.instance = new WebMcpPeerClient();
      queueMicrotask(() => {
        void WebMcpPeerClient.instance?.autoReconnectIfSaved();
      });
    }
    return WebMcpPeerClient.instance;
  }

  static peekShared(): WebMcpPeerClient | undefined {
    return WebMcpPeerClient.instance;
  }

  setHostAdapter(adapter: WebMcpHostAdapter | undefined): void {
    this.hostAdapter = adapter;
    this.syncTools();
  }

  getHostAdapter(): WebMcpHostAdapter | undefined {
    return this.resolveHostAdapter();
  }

  /**
   * Broadcasts the latest host tool catalog (`type: 'register'`) over the active
   * provider signaling socket and updates local session listeners in real time.
   * Call it whenever the host catalog changes: agents behind the relay (over HTTP, and a WebSocket
   * agent's tools/list and server/discover) are served the catalog last sent this way; only a
   * DataChannel agent lists the live host catalog. Returns false when no catalog was sent: no open
   * socket, a host `listTools` that threw, or a catalog withheld as CATALOG_TOO_LARGE.
   */
  syncTools(): boolean {
    const ws = this.ws;
    const errorBefore = this.error;
    const sent = ws !== undefined && ws.readyState === 1 && this.sendRegister(ws);
    // sendRegister notifies a session error it changed; otherwise only the tool count may differ.
    if (this.error === errorBefore) this.notify();
    return sent;
  }

  /**
   * Sends the host catalog as a `register` frame stamped with a new `registerSeq`. The relay never
   * acknowledges an accepted catalog and answers a rejected one with a CATALOG_INVALID or
   * CATALOG_TOO_LARGE error frame that echoes the frame's `registerSeq` (see
   * {@link handleRelayError}), so a previous rejection is cleared once a new catalog is on its way
   * and a rejection of that catalog sets it again.
   *
   * A frame over {@link PEER_RELAY_MAX_CATALOG_BYTES} is withheld: the relay could not announce it
   * and list it to WebSocket agents within its message limit, and a frame over the limit itself
   * would make it close this socket (dropping every agent of the room) on every auto-reconnect.
   * The session error is CATALOG_TOO_LARGE and the socket stays open, but the relay is not told:
   * it keeps announcing and serving the last catalog it accepted from this provider, agents are not
   * told that catalog is stale, and a call to a tool the host added since is answered TOOL_NOT_FOUND
   * (a room that never had a catalog answers tools/list with CATALOG_UNAVAILABLE). This lasts until
   * a catalog that fits is synced.
   *
   * The relay passes a WebSocket agent's tools/list and server/discover to the provider and takes
   * the tools of the reply as a catalog announcement, so those requests are answered from the last
   * frame sent here (see {@link relayCatalogTools}), never from the live host catalog: a withheld
   * catalog cannot reach the relay or its agents that way either.
   *
   * Subscribers are notified of every change this makes to the session error.
   */
  private sendRegister(ws: WebSocket): boolean {
    let frame: string;
    let toolCount: number;
    const registerSeq = this.registerSeq + 1;
    try {
      const rawTools = this.resolveHostAdapter()?.listTools?.() || [];
      toolCount = rawTools.length;
      frame = JSON.stringify({
        type: "register",
        alias: this.alias,
        registerSeq,
        tools: rawTools.map(toWireToolDescriptor),
      });
    } catch {
      return false;
    }
    // From here on this is the latest catalog, sent or withheld: a rejection of an older one is stale.
    this.registerSeq = registerSeq;
    const bytes = utf8ByteLength(frame);
    if (bytes > PEER_RELAY_MAX_CATALOG_BYTES) {
      const tools = `${toolCount} tool${toolCount === 1 ? "" : "s"}`;
      this.setSessionError(
        `${CATALOG_TOO_LARGE_ERROR}: the register frame for ${tools} is ${bytes} bytes, ` +
          `over the relay protocol's ${PEER_RELAY_MAX_CATALOG_BYTES}-byte catalog limit`,
      );
      console.warn(`[WebMCP] ${this.error}; the catalog was not sent.`);
      return false;
    }
    if (!sendRelayFrame(ws, frame, "register")) return false;
    if (this.roomId !== null) {
      this.registeredCatalog = { serverUrl: this.serverUrl, roomId: this.roomId, registerSeq, frame };
    }
    if (isCatalogError(this.error)) this.setSessionError(null);
    return true;
  }

  /**
   * The tools to answer a relay-forwarded tools/list or server/discover with: those of the last
   * `register` frame sent to the current room, which is the catalog the relay holds. The relay
   * takes the tools of that reply as a catalog announcement, so answering with the live host
   * catalog would hand it a catalog withheld as too large: the relay would adopt it, or (over its
   * announcement limit) refuse it and forward it unstamped, so the agent would hold a catalog the
   * relay does not and every tools/call would fail with CATALOG_CHANGED.
   *
   * There is nothing to answer with when no frame was sent to this room, or the relay refused the
   * last one; the request is then answered CATALOG_UNAVAILABLE, with the reason, as the relay
   * itself answers a request for a catalog it does not have.
   */
  private relayCatalogTools(): { tools: unknown } | { unavailable: string } {
    const registered = this.registeredCatalog;
    if (!registered || registered.roomId !== this.roomId || registered.serverUrl !== this.serverUrl) {
      const error = this.error;
      return {
        unavailable:
          error !== null && isCatalogError(error) ? error : "the provider has not registered a tool catalog with this relay room",
      };
    }
    if (registered.refusal !== undefined) return { unavailable: registered.refusal };
    return { tools: JsonObjectSchema.parse(JSON.parse(registered.frame)).tools };
  }

  /** Sets the session error, notifying subscribers when it changed. */
  private setSessionError(error: string | null): void {
    if (this.error === error) return;
    this.error = error;
    this.notify();
  }

  private resolveHostAdapter(): WebMcpHostAdapter | undefined {
    return this.hostAdapter ?? globalHostAdapter();
  }

  getSession(): WebMcpPeerSessionInfo {
    const host = this.resolveHostAdapter();
    const tools = host?.listTools?.() || [];
    const writeEnabled = Boolean(host?.getStatus?.()?.writeEnabled);
    return {
      state: this.state,
      serverUrl: this.serverUrl,
      invitationUrl: this.invitationUrl,
      roomId: this.roomId,
      clientLabel: this.clientLabel,
      alias: this.alias,
      autoReconnect: this.autoReconnect,
      error: this.error,
      toolsCount: tools.length,
      writeEnabled,
      connectedAt: this.connectedAt,
      expiresAt: this.expiresAt,
      approvalState: this.approvalState,
      approvalRequestId: this.approvalRequestId,
      roomEpoch: this.roomEpoch ?? undefined,
      roomGeneration: this.roomGeneration,
      replicaId: this.replicaId,
      crdtCapability: this.crdtCapabilityEnabled,
    };
  }

  private createReplicaId(): string {
    try {
      if (typeof window !== "undefined") {
        const saved = window.sessionStorage.getItem("framebook:tab-replica-id");
        if (saved && /^tab-[A-Za-z0-9_-]{8,}$/.test(saved)) return saved;
      }
    } catch {}
    try {
      const replica = globalThis.crypto?.randomUUID
        ? `tab-${globalThis.crypto.randomUUID()}`
        : `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      try {
        if (typeof window !== "undefined") window.sessionStorage.setItem("framebook:tab-replica-id", replica);
      } catch {}
      return replica;
    } catch {}
    const random = Math.random().toString(36).slice(2);
    return `tab-${Date.now().toString(36)}-${random}`;
  }

  private leaseStorageKey(serverUrl = this.serverUrl): string {
    return `webmcp:room-lease:${encodeURIComponent(serverUrl.replace(/\/+$/, ""))}:${encodeURIComponent(this.replicaId)}`;
  }

  private readSavedRoomLease(serverUrl = this.serverUrl): SavedRoomLease | null {
    try {
      if (typeof window === "undefined") return null;
      const key = this.leaseStorageKey(serverUrl);
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const lease = SavedRoomLeaseSchema.parse(JSON.parse(raw));
      if (lease.expiresAt <= Date.now()) {
        localStorage.removeItem(key);
        return null;
      }
      return lease;
    } catch {
      return null;
    }
  }

  private saveRoomLease(serverUrl: string, descriptor: PeerRoomDescriptor): void {
    const leaseToken = descriptor.reconnectToken ?? "";
    const roomId = descriptor.id;
    const roomEpoch = descriptor.roomEpoch ?? -1;
    const expiresAt = descriptor.reconnectTokenExpiresAt ?? descriptor.expiresAt ?? 0;
    if (!leaseToken || !roomId || !Number.isSafeInteger(roomEpoch) || roomEpoch < 0 || expiresAt <= Date.now()) {
      return;
    }
    try {
      if (typeof window === "undefined") return;
      localStorage.setItem(
        this.leaseStorageKey(serverUrl),
        JSON.stringify({
          serverUrl: serverUrl.replace(/\/+$/, ""),
          roomId,
          roomEpoch,
          leaseToken,
          expiresAt,
          ...(descriptor.alias !== undefined ? { alias: descriptor.alias } : {}),
        } satisfies SavedRoomLease),
      );
    } catch {}
  }

  private clearSavedRoomLease(serverUrl = this.serverUrl): void {
    try {
      if (typeof window !== "undefined") localStorage.removeItem(this.leaseStorageKey(serverUrl));
    } catch {}
  }

  isWriteEnabled(): boolean {
    return Boolean(this.resolveHostAdapter()?.getStatus?.()?.writeEnabled);
  }

  getReplicaId(): string {
    return this.replicaId;
  }

  getAiRun(runId: string): AiRunSnapshot | undefined {
    return this.aiRuns.get(runId);
  }

  getAiRuns(): readonly AiRunSnapshot[] {
    return this.aiRuns.getAll();
  }

  subscribeAiRuns(listener: (runs: readonly AiRunSnapshot[]) => void): () => void {
    return this.aiRuns.subscribe(() => listener(this.aiRuns.getAll()));
  }

  setAiRunLedger(store: AiRunLedgerStore | AiRunLedger | undefined): void {
    this.aiRunLedger = store instanceof AiRunLedger ? store : store ? new AiRunLedger(store) : undefined;
  }

  stopAiRun(runId: string, reason = "stopped by host"): AiRunSnapshot | undefined {
    const run = this.aiRuns.get(runId);
    if (!run) return undefined;
    const stopped = this.aiRuns.stop(runId, reason);
    this.publishAiRunAwareness(stopped);
    return stopped;
  }

  async rollbackAiRun(
    runId: string,
    undo?: (
      operationId: string,
      index: number,
    ) => Promise<"rolled-back" | "outcome-unknown" | "failed"> | "rolled-back" | "outcome-unknown" | "failed",
  ): Promise<AiRunSnapshot | undefined> {
    if (!this.aiRuns.get(runId)) return undefined;
    const callback =
      undo ??
      (async (operationId: string) => {
        const run = this.aiRuns.get(runId);
        const transactionId = run?.transactionIds[operationId];
        const webMcp = this.resolveHostAdapter();
        if (!transactionId || typeof webMcp?.invoke !== "function" || typeof webMcp?.getContext !== "function") {
          return "outcome-unknown" as const;
        }
        const context = webMcp.getContext();
        const requestId = `ai-rollback-${runId}-${operationId}`;
        const undoToolName = webMcp.getUndoToolName?.() || "storyboard_history_undo";
        const result = await webMcp.invoke(
          undoToolName,
          { context: { ...context, requestId } },
          { expectedHistoryTransactionId: transactionId },
        );
        const payload = hostPayload(result);
        const receipt = isJsonObject(payload.receipt) ? payload.receipt : undefined;
        const error = isJsonObject(payload.error) ? payload.error : undefined;
        if (payload.ok && receipt?.status && receipt.status !== "outcome-unknown") {
          return "rolled-back" as const;
        }
        return error?.code === "OUTCOME_UNKNOWN" || receipt?.status === "outcome-unknown"
          ? ("outcome-unknown" as const)
          : ("failed" as const);
      });
    const result = await this.aiRuns.rollback(runId, async (operationId, index) => {
      const status = await callback(operationId, index);
      const run = this.aiRuns.get(runId);
      const requestId = run?.requestIds[operationId];
      if (this.aiRunLedger && requestId) {
        try {
          await this.aiRunLedger.recordRollback({ runId, requestId, status });
        } catch (error) {
          console.warn("[WebMCP] AI run ledger rejected rollback:", error);
          return status === "rolled-back" ? ("outcome-unknown" as const) : status;
        }
      }
      return status;
    });
    this.publishAiRunAwareness(result);
    return result;
  }

  setWriteEnabled(enabled: boolean): boolean {
    const res = this.resolveHostAdapter()?.setWriteEnabled?.(enabled);
    this.notify();
    return res?.writeEnabled ?? enabled;
  }

  toggleWrite(): boolean {
    const res = this.resolveHostAdapter()?.toggleWrite?.();
    this.notify();
    return res?.writeEnabled ?? false;
  }

  clearError(): void {
    this.error = null;
    if (this.state === "error") {
      this.state = "idle";
    }
    this.notify();
  }

  /**
   * Reconnects from the settings a previous `connect()` saved, reclaiming the saved room lease.
   * Resolves false when auto-reconnect is suppressed, nothing is saved, or the connect failed.
   */
  async autoReconnectIfSaved(): Promise<boolean> {
    return (await this.attemptAutoReconnect()) === "connected";
  }

  /** The connect options a previous `connect()` saved, or null when auto-reconnect must not run. */
  private readAutoReconnectOptions(): WebMcpPeerConnectOptions | null {
    if (typeof window === "undefined" || this.shouldSuppressAutoReconnect(window.location ?? {})) return null;
    if (localStorage.getItem("webmcp:auto-reconnect") === "false") return null;
    const serverUrl = localStorage.getItem("webmcp:server-url");
    if (!serverUrl) return null;
    return {
      serverUrl,
      alias: localStorage.getItem("webmcp:peer-alias") || this.alias,
      publishKey: localStorage.getItem("webmcp:publish-key") || "local-development-only",
      autoReconnect: true,
      enableWrite: localStorage.getItem("webmcp:write-enabled") !== "false",
      enableCrdt: localStorage.getItem("webmcp:crdt-enabled") === "true",
      reclaimLease: true,
    };
  }

  /**
   * One auto-reconnect attempt: "skipped" when auto-reconnect is suppressed or nothing is saved,
   * "failed" when the connect itself failed, "connected" otherwise.
   */
  private async attemptAutoReconnect(): Promise<"connected" | "skipped" | "failed"> {
    let options: WebMcpPeerConnectOptions | null;
    try {
      options = this.readAutoReconnectOptions();
    } catch (error) {
      console.warn("[WebMCP] Auto-reconnect skipped:", errorMessage(error, "storage unavailable"));
      return "skipped";
    }
    if (!options) return "skipped";
    if (options.enableWrite) this.setWriteEnabled(true);
    console.log(`[WebMCP] Auto-reconnecting peer '${options.alias}' to ${options.serverUrl}...`);
    try {
      await this.connect(options);
      return "connected";
    } catch (error) {
      console.warn("[WebMCP] Auto-reconnect failed:", errorMessage(error, "connect failed"));
      return "failed";
    }
  }

  /**
   * Schedules the next auto-reconnect attempt with exponential backoff (1 s, 1.5 s, 2.25 s, ...,
   * capped at 15 s). A failed attempt schedules the next one, so the provider keeps retrying while
   * the relay is unreachable; a successful attempt resets the backoff when the relay sends `ready`.
   */
  private scheduleAutoReconnect(): void {
    if (!this.autoReconnect || this.approvalState === "expired" || this.state === "idle") return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempts += 1;
    const attempts = this.reconnectAttempts;
    const delay = Math.min(1000 * Math.pow(1.5, attempts - 1), 15000);
    console.log(`[WebMCP] WebSocket disconnected. Scheduling auto-reconnect in ${Math.round(delay)}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.runScheduledReconnect(attempts);
    }, delay);
  }

  private async runScheduledReconnect(attempts: number): Promise<void> {
    const outcome = await this.attemptAutoReconnect();
    // Retry only a genuine connect failure. A skipped attempt (auto-reconnect turned off, nothing
    // saved), a manual disconnect ("idle") or a newer connect that superseded this one (it owns
    // the state, or has already scheduled its own retry) must not restart the loop.
    if (outcome !== "failed" || this.state !== "error" || !this.autoReconnect || this.reconnectTimer) return;
    // connect() -> disconnect() reset the counter; restore it so the backoff keeps growing.
    this.reconnectAttempts = attempts;
    this.scheduleAutoReconnect();
  }

  subscribe(listener: (session: WebMcpPeerSessionInfo) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSession());
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    const session = this.getSession();
    for (const l of this.listeners) {
      try {
        l(session);
      } catch {}
    }
  }

  /**
   * Creates a relay room (or, with `reclaimLease`, reclaims the saved one) and attaches the
   * provider socket. Resolves to the invitation URL to hand to an agent
   * (`<descriptorUrl>#invite=<token>`); the full session state is available from `getSession()`
   * and `subscribe()`.
   */
  async connect(options: WebMcpPeerConnectOptions): Promise<string> {
    this.disconnect();
    const generation = ++this.connectionGeneration;
    this.signalingReleased = false;
    this.roomGeneration += 1;
    this.carrierSessionId = `carrier-${this.replicaId}-${generation}`;
    this.remoteCarrierReplicaId = null;
    this.receivedCarrierMessages.clear();
    this.lastConnectOptions = { ...options };
    this.approvalState = "none";
    this.approvalRequestId = null;
    this.approvalSessionId = null;
    this.approvalRoomEpoch = null;
    this.approvalEnvelope = false;

    let enableWrite = false;
    try {
      enableWrite =
        options.enableWrite ??
        (typeof localStorage !== "undefined" ? localStorage.getItem("webmcp:write-enabled") === "true" : false);
    } catch {
      enableWrite = options.enableWrite ?? false;
    }
    if (enableWrite) {
      this.setWriteEnabled(true);
    }

    // Normalized as `refreshRoom` and the agent client do: trimmed, no trailing `/`, and `http://`
    // in front unless it already has an `http://` or `https://` scheme, in any case.
    this.serverUrl = normalizePeerConfigUrl(options.serverUrl);
    if (options.alias) this.alias = options.alias;
    if (options.autoReconnect !== undefined) this.autoReconnect = options.autoReconnect;

    if (options.reclaimLease !== true) this.clearSavedRoomLease(this.serverUrl);

    const publishKey = options.publishKey || "local-development-only";

    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("webmcp:server-url", this.serverUrl);
        localStorage.setItem("webmcp:peer-alias", this.alias);
        localStorage.setItem("webmcp:publish-key", publishKey);
        localStorage.setItem("webmcp:auto-reconnect", this.autoReconnect ? "true" : "false");
        localStorage.setItem("webmcp:crdt-enabled", options.enableCrdt === true ? "true" : "false");
      }
    } catch {}

    this.state = "creating";
    this.error = null;
    this.notify();

    try {
      if (options.reclaimLease === true) {
        const reclaimed = await this.tryReclaimSavedRoom(options, generation);
        if (reclaimed) return reclaimed;
      }

      const roomTitle =
        options.title || this.resolveHostAdapter()?.getServerInfo?.()?.name || "Framebook Storyboard Studio";
      const res = await fetch(`${this.serverUrl}/p`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${publishKey}`,
        },
        body: JSON.stringify({
          alias: this.alias,
          title: roomTitle,
          capabilities: options.enableCrdt === true ? ["mcp-control", "mcp-crdt"] : ["mcp-control"],
        }),
      });

      if (!res.ok) {
        if (res.status >= 520 && res.status <= 526) {
          throw new Error(
            `Cloudflare 에지 연결 오류 (${res.status}): 시그널링 서버 및 터널 라우팅 상태를 확인하세요.`,
          );
        }
        const errData = parseJsonObject(await readResponseText(res));
        throw new Error(nonEmptyString(errData.error) ?? `HTTP ${res.status}: Failed to create signaling room`);
      }

      const created = readRoomDescriptor(await readResponseText(res), "INVALID_ROOM_DESCRIPTOR");
      if (generation !== this.connectionGeneration) throw new Error("PEER_SESSION_SUPERSEDED");
      return this.attachCreatedRoom(created, options, generation);
    } catch (err) {
      if (generation !== this.connectionGeneration) throw err;
      this.state = "error";
      const raw = errorMessage(err, "Connection failed");
      if (raw.includes("Failed to fetch") || (err instanceof Error && err.name === "TypeError")) {
        this.error = `시그널링 서버 연결 실패 (${this.serverUrl}): 서버가 응답하지 않습니다. 포트(8787) 및 네트워크를 확인하세요.`;
      } else if (raw.includes("520") || raw.includes("521") || raw.includes("522") || raw.includes("524")) {
        this.error = `Cloudflare 에지 연결 오류: ${raw}`;
      } else {
        this.error = raw;
      }
      this.notify();
      throw err;
    }
  }

  private async tryReclaimSavedRoom(options: WebMcpPeerConnectOptions, generation: number): Promise<string | null> {
    const lease = this.readSavedRoomLease(this.serverUrl);
    if (!lease || lease.serverUrl.replace(/\/+$/, "") !== this.serverUrl.replace(/\/+$/, "")) return null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(relayRoomUrl(this.serverUrl, lease.roomId, "/reclaim"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: lease.roomId,
          roomEpoch: lease.roomEpoch,
          leaseToken: lease.leaseToken,
        }),
      });
      if (generation !== this.connectionGeneration) throw new Error("PEER_SESSION_SUPERSEDED");
      if (response.ok) {
        const reclaimed = readRoomDescriptor(await readResponseText(response), "INVALID_RECLAIMED_ROOM_DESCRIPTOR");
        return this.attachCreatedRoom(reclaimed, options, generation);
      }
      if (response.status === 409) {
        const body = parseJsonObject(await readResponseText(response));
        if (body.error === "ROOM_PROVIDER_ACTIVE" && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
          continue;
        }
        if (body.error === "ROOM_PROVIDER_ACTIVE") throw new Error("ROOM_PROVIDER_ACTIVE");
      }
      if (response.status === 401 || response.status === 404 || response.status === 410) {
        this.clearSavedRoomLease(this.serverUrl);
      }
      return null;
    }
    return null;
  }

  private async attachCreatedRoom(
    created: PeerRoomDescriptor,
    options: WebMcpPeerConnectOptions,
    generation: number,
  ): Promise<string> {
    if (generation !== this.connectionGeneration) throw new Error("PEER_SESSION_SUPERSEDED");
    this.roomId = created.id;
    this.providerToken = created.providerToken;
    this.saveRoomLease(this.serverUrl, created);
    this.roomEpoch = created.roomEpoch ?? null;
    this.crdtCapabilityEnabled = options.enableCrdt === true && (created.capabilities?.includes("mcp-crdt") ?? false);
    if (!this.carrierSessionId) this.carrierSessionId = `carrier-${this.replicaId}-${generation}`;
    this.bindActiveTransport();
    this.invitationUrl = `${created.descriptorUrl}#invite=${created.inviteToken}`;
    const serverExpiry = created.expiresAt;
    this.expiresAt =
      serverExpiry !== undefined && serverExpiry > Date.now() ? serverExpiry : Date.now() + ROOM_EXPIRY_FALLBACK_MS;
    this.approvalState = "none";
    this.scheduleExpiry(generation, this.expiresAt);

    const ws = new WebSocket(relayRoomUrl(this.serverUrl, created.id, "/provider", true), [
      WEBMCP_SUBPROTOCOL,
      `ticket.${created.providerToken}`,
    ]);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Signaling connection timeout")), 10000);
      ws.onmessage = (event) => {
        if (parseProviderFrame(event.data)?.type !== "ready") return;
        clearTimeout(timer);
        if (generation !== this.connectionGeneration) {
          reject(new Error("PEER_SESSION_SUPERSEDED"));
          return;
        }
        this.state = "waiting";
        this.connectedAt = null;
        this.reconnectAttempts = 0;
        this.startKeepalive(ws);
        this.notify();
        // Notifies on its own when it changes the session error (a withheld catalog).
        this.sendRegister(ws);
        // Install the steady-state handlers before the next frame is read: the relay follows
        // `ready` with approval frames (pending re-sends, restored approvals) that can arrive in
        // the same network read, before a promise continuation would run.
        this.listenSignaling(ws, created.id, created.providerToken, options.iceServers, generation);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Signaling WebSocket error"));
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (this.state === "creating" || ws !== this.ws || generation !== this.connectionGeneration) {
          reject(new Error("Signaling socket closed unexpectedly"));
        }
      };
    });

    return this.invitationUrl || "";
  }

  private listenSignaling(
    ws: WebSocket,
    _roomId: string,
    _providerToken: string,
    iceServers?: RTCIceServer[],
    generation = this.connectionGeneration,
  ): void {
    let activeRequestId = "";

    ws.onmessage = async (event) => {
      try {
        if (generation !== this.connectionGeneration) return;
        const msg = parseProviderFrame(event.data);
        if (!msg) return;

        if (msg.type === "pong") return;

        if (msg.type === "error") {
          this.handleRelayError(msg);
          return;
        }

        if (msg.type === "mcp" && msg.message) {
          const rpcRes = await this.answerMcpRpc(msg.message, generation, "relay");
          if (rpcRes && ws.readyState === WebSocket.OPEN) {
            // A reply over the relay's message limit would make it close this socket and drop
            // every agent of the room; it is answered with RESULT_TOO_LARGE instead.
            const reply = encodeRelayMcpReply(msg.message, rpcRes);
            if (reply.oversizeBytes !== undefined) {
              console.warn(
                `[WebMCP] A ${reply.oversizeBytes}-byte reply exceeds the relay's message limit; ` +
                  (reply.frame !== undefined ? "answered RESULT_TOO_LARGE instead." : "dropped it."),
              );
            }
            if (reply.frame !== undefined) sendRelayFrame(ws, reply.frame, "mcp reply");
          }
          return;
        }

        if (msg.type === "approval.restored") {
          this.restoreApprovedSession(msg);
          return;
        }

        if (msg.type === "approval.request") {
          const payload = isJsonObject(msg.payload) ? msg.payload : msg;
          activeRequestId = nonEmptyString(payload.requestId) ?? nonEmptyString(msg.requestId) ?? "";
          this.clientLabel = nonEmptyString(payload.clientLabel) ?? "AI Agent";
          this.approvalRequestId = activeRequestId || null;
          this.approvalSessionId =
            typeof payload.sessionId === "string"
              ? payload.sessionId
              : typeof msg.sessionId === "string"
                ? msg.sessionId
                : null;
          if (this.approvalSessionId) this.carrierSessionId = this.approvalSessionId;
          this.bindActiveTransport();
          this.approvalRoomEpoch =
            typeof payload.roomEpoch === "number"
              ? payload.roomEpoch
              : typeof msg.roomEpoch === "number"
                ? msg.roomEpoch
                : this.roomEpoch;
          this.approvalEnvelope = true;
          this.approvalState = "pending";
          this.state = "waiting";
          this.notify();
          return;
        }

        if (msg.type === "approval.approved") {
          if (this.approvalState !== "approved") return;
          this.setupPeerConnection(ws, nonEmptyString(msg.requestId) ?? activeRequestId, iceServers, generation);
          return;
        }

        if (msg.type === "approval.rejected") {
          this.approvalState = "revoked";
          this.approvalRequestId = null;
          this.state = "waiting";
          this.notify();
          return;
        }

        if (msg.type === "approval.expired" || msg.type === "collaboration.expired") {
          this.expirePeerSession(msg.type === "collaboration.expired" ? "SESSION_EXPIRED" : "APPROVAL_EXPIRED");
          return;
        }

        if (msg.type === "room.rotated") {
          this.expirePeerSession("ROOM_ROTATED");
          return;
        }

        if (
          msg.type === "session.revoked" ||
          msg.type === "collaboration.revoked" ||
          msg.type === "collaboration.role-updated" ||
          msg.type === "collaboration.guest-linked"
        ) {
          this.revokePeerSession("SESSION_REVOKED");
          return;
        }

        if (msg.type === "offer") {
          if (this.approvalState !== "approved") return;
          const offerRequestId = nonEmptyString(msg.requestId) ?? activeRequestId;
          if (!this.pc) {
            this.setupPeerConnection(ws, offerRequestId, iceServers, generation);
          }
          const pc = this.pc;
          if (!pc) return;
          await pc.setRemoteDescription({ type: "offer", sdp: typeof msg.sdp === "string" ? msg.sdp : undefined });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          if (pc.iceGatheringState !== "complete") {
            await new Promise<void>((resolve) => {
              const check = () => {
                if (pc.iceGatheringState === "complete") {
                  pc.removeEventListener("icegatheringstatechange", check);
                  resolve();
                }
              };
              pc.addEventListener("icegatheringstatechange", check);
              setTimeout(resolve, 2000);
            });
          }

          const answered = sendRelayFrame(
            ws,
            { type: "answer", requestId: offerRequestId, sdp: pc.localDescription?.sdp || answer.sdp },
            "answer",
          );
          if (!answered && this.pc === pc) {
            // The answer was not sent (the offer's requestId takes it over the relay's limit, or the
            // socket refused it), so drop the half-negotiated connection: a later offer starts afresh.
            this.pc = undefined;
            try {
              pc.close();
            } catch {}
          }
        }
      } catch (err) {
        console.error("[WebMCP] Signaling error:", err);
      }
    };

    ws.onclose = () => {
      if (generation !== this.connectionGeneration) return;
      this.stopKeepalive();
      if (this.signalingReleased) return;
      if (this.state === "connected" || this.state === "waiting") {
        this.state = "disconnected";
        this.notify();
      }
      this.scheduleAutoReconnect();
    };
  }

  /**
   * Relay error frames. A CATALOG_INVALID or CATALOG_TOO_LARGE reply means the relay refused a
   * `register` and agents still see the previous (or no) catalog, so it is surfaced as the session
   * error. The relay echoes the refused frame's `registerSeq`: the refusal of a catalog older than
   * the latest one is stale (the relay may well have accepted the newer catalog, which it never
   * acknowledges) and is ignored. A refusal without `registerSeq`, from a relay that predates it,
   * is taken to answer the latest catalog.
   *
   * A refusal of the last frame sent is recorded on {@link registeredCatalog} even when a newer
   * catalog was withheld since (the session error then stays the withheld catalog's): the relay
   * does not hold the refused catalog, so relay-forwarded catalog requests are not answered with it.
   */
  private handleRelayError(frame: ProviderFrame): void {
    const message = nonEmptyString(frame.message) ?? "";
    if (message === CATALOG_INVALID_ERROR || message === CATALOG_TOO_LARGE_ERROR) {
      const refusal = `${message}: ${nonEmptyString(frame.reason) ?? "relay rejected the tool catalog"}`;
      const registered = this.registeredCatalog;
      if (registered && (frame.registerSeq === undefined || frame.registerSeq === registered.registerSeq)) {
        registered.refusal = refusal;
      }
      if (frame.registerSeq !== undefined && frame.registerSeq !== this.registerSeq) return;
      this.setSessionError(refusal);
      return;
    }
    console.warn("[WebMCP] Relay error:", frame.code, message || frame);
  }

  /**
   * `approval.restored`: the relay reattached this provider (F5 / auto-reconnect lease reclaim)
   * and reports a client ticket it already approved. Only the relay can vouch for that, so the
   * provider adopts it instead of refusing the still-approved agent with CLIENT_APPROVAL_REQUIRED.
   */
  private restoreApprovedSession(frame: ProviderFrame): void {
    const payload = isJsonObject(frame.payload) ? frame.payload : frame;
    const sessionId = nonEmptyString(payload.sessionId) ?? nonEmptyString(frame.sessionId);
    const roomEpoch = typeof payload.roomEpoch === "number" ? payload.roomEpoch : frame.roomEpoch;
    const roomId = payload.roomId ?? frame.roomId;
    const expiresAt = typeof payload.expiresAt === "number" ? payload.expiresAt : undefined;
    if (!sessionId || this.roomEpoch === null || roomEpoch !== this.roomEpoch) return;
    if (roomId !== undefined && roomId !== this.roomId) return;
    if (expiresAt !== undefined && expiresAt <= Date.now()) return;
    this.clientLabel = nonEmptyString(payload.clientLabel) ?? this.clientLabel ?? "AI Agent";
    this.approvalSessionId = sessionId;
    this.carrierSessionId = sessionId;
    this.bindActiveTransport();
    this.approvalRoomEpoch = this.roomEpoch;
    this.approvalEnvelope = true;
    this.approvalRequestId = null;
    this.approvalState = "approved";
    this.notify();
  }

  private startKeepalive(ws: WebSocket): void {
    this.stopKeepalive();
    this.pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        sendRelayFrame(ws, { type: "ping", timestamp: Date.now() }, "ping");
      } else {
        this.stopKeepalive();
      }
    }, 25000);
  }

  private stopKeepalive(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  private terminatePeerTransport(): void {
    this.connectionGeneration += 1;
    this.stopKeepalive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = undefined;
    }
    try {
      this.activeTransport?.invalidateCarrier?.("transport-released");
    } catch {}
    try {
      this.dataChannel?.close();
    } catch {}
    try {
      this.pc?.close();
    } catch {}
    try {
      this.ws?.close();
    } catch {}
    this.dataChannel = undefined;
    this.pc = undefined;
    this.ws = undefined;
    this.providerToken = null;
    this.framePending.clear();
    this.carrierSessionId = null;
    this.remoteCarrierReplicaId = null;
    this.receivedCarrierMessages.clear();
    try {
      this.activeTransport?.clearPeers?.();
    } catch {}
    this.signalingReleased = false;
  }

  private expirePeerSession(reason: string): void {
    this.approvalState = "expired";
    this.approvalRequestId = null;
    this.state = "disconnected";
    this.error = reason;
    this.terminatePeerTransport();
    this.notify();
  }

  private revokePeerSession(reason: string): void {
    this.approvalState = "revoked";
    this.approvalRequestId = null;
    this.state = "disconnected";
    this.error = reason;
    this.autoReconnect = false;
    try {
      if (typeof window !== "undefined") localStorage.setItem("webmcp:auto-reconnect", "false");
    } catch {}
    this.terminatePeerTransport();
    this.notify();
  }

  private setupPeerConnection(
    ws: WebSocket,
    requestId: string,
    iceServers?: RTCIceServer[],
    generation = this.connectionGeneration,
  ): void {
    if (generation !== this.connectionGeneration || this.approvalState !== "approved") return;
    if (typeof RTCPeerConnection === "undefined") return;
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
    }

    const pc = new RTCPeerConnection({
      iceServers: iceServers || [{ urls: "stun:stun.l.google.com:19302" }],
      bundlePolicy: "max-bundle",
    });
    this.pc = pc;

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label !== "mcp") return;

      this.dataChannel = channel;

      channel.onmessage = (e) => {
        this.handleDataChannelFrame(channel, ws, requestId, e.data, generation);
      };

      channel.onclose = () => {
        if (generation !== this.connectionGeneration || this.dataChannel !== channel) return;
        this.state = "disconnected";
        if (this.approvalState === "approved") this.approvalState = "revoked";
        this.dataChannel = undefined;
        this.notify();
      };
    };
  }

  private handleDataChannelFrame(
    channel: RTCDataChannel,
    ws: WebSocket,
    requestId: string,
    rawData: unknown,
    generation = this.connectionGeneration,
  ): void {
    if (
      generation !== this.connectionGeneration ||
      this.dataChannel !== channel ||
      this.approvalState !== "approved"
    ) {
      return;
    }
    if (typeof rawData !== "string") return;
    try {
      const frame = DataChannelChunkSchema.parse(JSON.parse(rawData));

      let pending = this.framePending.get(frame.id);
      if (!pending || pending.total !== frame.total) {
        if (!pending && this.framePending.size > 50) this.framePending.clear();
        pending = { total: frame.total, parts: new Array<string>(frame.total), received: 0 };
        this.framePending.set(frame.id, pending);
      }

      if (pending.parts[frame.index] === undefined) {
        pending.parts[frame.index] = frame.data;
        pending.received++;
      }

      if (pending.received === pending.total) {
        this.framePending.delete(frame.id);
        const fullText = pending.parts.join("");
        const msg = ProviderFrameSchema.parse(JSON.parse(fullText));
        void this.handlePeerMessage(channel, ws, requestId, msg, generation).catch((error) => {
          console.warn("[WebMCP] peer message handling failed:", error);
        });
      }
    } catch (e) {
      console.error("[WebMCP] Frame parse error:", e);
    }
  }

  private async handlePeerMessage(
    channel: RTCDataChannel,
    ws: WebSocket,
    requestId: string,
    msg: ProviderFrame,
    generation = this.connectionGeneration,
  ): Promise<void> {
    if (generation !== this.connectionGeneration || this.dataChannel !== channel) return;
    if (this.approvalState !== "approved" && msg.type !== "hello") return;

    if (msg.type === "hello") {
      if (this.approvalState !== "approved") return;
      const sessionId = this.approvalSessionId ?? this.carrierSessionId;
      if (!sessionId) return;
      this.carrierSessionId = sessionId;
      this.remoteCarrierReplicaId = null;
      this.receivedCarrierMessages.clear();
      this.bindActiveTransport();
      const expiresAt = this.expiresAt ?? Date.now() + ROOM_EXPIRY_FALLBACK_MS;
      this.connectedAt = Date.now();
      this.expiresAt = expiresAt;
      this.scheduleExpiry(this.connectionGeneration, expiresAt);
      this.state = "connected";
      this.notify();

      await this.sendFrame(channel, {
        type: "grant",
        protocol: WEBMCP_PROTOCOL,
        requestId,
        sessionId,
        expiresAt,
      });

      if (this.activeTransport) {
        try {
          this.activeTransport.broadcastAwareness();
          this.introduceRemotePeer(this.activeTransport);
        } catch (e) {
          console.warn("[WebMCP] Initial CRDT announcement error:", e);
        }
      }

      try {
        if (ws.readyState === WebSocket.OPEN) {
          this.signalingReleased = true;
          // The DataChannel carries the session from here on, so the socket closes either way.
          sendRelayFrame(ws, { type: "release", requestId }, "release");
          ws.close();
        }
      } catch {}
      return;
    }

    if (msg.type === "crdt" && msg.message) {
      this.handleIncomingCrdt(msg.message);
      return;
    }

    if (msg.type === "mcp" && msg.message) {
      const rpc = msg.message;
      if (this.activeTransport && isJsonObject(rpc) && rpc.method === "tools/call") {
        const params = isJsonObject(rpc.params) ? rpc.params : {};
        try {
          this.introduceRemotePeer(this.activeTransport, params.arguments, readAiTrace(params._meta));
        } catch {}
      }

      const rpcRes = await this.answerMcpRpc(rpc, generation, "data-channel");
      if (rpcRes) {
        await this.sendFrame(channel, {
          type: "mcp",
          message: rpcRes,
        });
      }
    }
  }

  /** {@link handleMcpRpc}, except that an unexpected exception still answers the request. */
  private async answerMcpRpc(
    rpc: unknown,
    generation: number,
    channel: McpRequestChannel,
  ): Promise<ProviderRpcResponse | null> {
    try {
      return await this.handleMcpRpc(rpc, generation, channel);
    } catch (error) {
      console.error("[WebMCP] MCP request handling failed:", error);
      const id = rpcRequestId(rpc);
      return id === undefined ? null : { jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error" } };
    }
  }

  /**
   * Answers one JSON-RPC request. tools/list and server/discover list the live host catalog to a
   * DataChannel agent, which talks to the provider directly; on the relay socket they list the
   * catalog the relay holds (see {@link relayCatalogTools}), since the relay takes their tools as a
   * catalog announcement.
   */
  private async handleMcpRpc(
    rpc: unknown,
    generation: number,
    channel: McpRequestChannel,
  ): Promise<ProviderRpcResponse | null> {
    if (!isJsonObject(rpc) || rpc.jsonrpc !== "2.0") return null;
    if (rpc.id === undefined) return null;
    const id = rpcRequestId(rpc);
    if (id === undefined) {
      return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
    }
    if (generation !== this.connectionGeneration) {
      return { jsonrpc: "2.0", id, error: { code: -32008, message: "PEER_SESSION_SUPERSEDED" } };
    }

    if (this.approvalState !== "approved") {
      return { jsonrpc: "2.0", id, error: { code: -32003, message: "CLIENT_APPROVAL_REQUIRED" } };
    }

    const method = typeof rpc.method === "string" ? rpc.method : "";
    const params = isJsonObject(rpc.params) ? rpc.params : {};
    const webMcp = this.resolveHostAdapter();
    const serverInfo = webMcp?.getServerInfo?.() ?? {
      name: "wireframe-storyboard-toolkit",
      version: "0.4.2",
    };

    if (method === "tools/list" || method === "server/discover") {
      const catalog =
        channel === "relay"
          ? this.relayCatalogTools()
          : { tools: (webMcp?.listTools?.() || []).map(toWireToolDescriptor) };
      if ("unavailable" in catalog) {
        return { jsonrpc: "2.0", id, error: { ...CATALOG_UNAVAILABLE_RPC_ERROR, data: { reason: catalog.unavailable } } };
      }
      if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: catalog.tools } };
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          supportedProtocolVersions: MCP_PROTOCOL_VERSIONS,
          capabilities: { tools: { listChanged: true }, stateless: true },
          serverInfo: { name: serverInfo.name, version: serverInfo.version },
          instructions:
            serverInfo.instructions ??
            `Wireframe Storyboard Toolkit authoring and inspection tools (MCP ${MCP_PROTOCOL_VERSION} Stateless spec).`,
          tools: catalog.tools,
        },
      };
    }

    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: true }, stateless: true },
          serverInfo: { name: serverInfo.name, version: serverInfo.version },
          instructions: serverInfo.instructions ?? "Wireframe Storyboard Toolkit authoring tools.",
        },
      };
    }

    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    if (method === "tools/call") {
      return this.handleToolCall(id, params, generation, webMcp);
    }

    return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
  }

  /** The AI run that tool calls without `_meta.framebook.aiTrace.runId` share. */
  private implicitAiRunId(): string {
    return `remote-webmcp-${this.roomId ? this.roomId.slice(0, 6) : "remote"}`;
  }

  private async handleToolCall(
    id: JsonRpcId,
    params: Record<string, unknown>,
    generation: number,
    webMcp: WebMcpHostAdapter | undefined,
  ): Promise<ProviderRpcResponse> {
    const name = nonEmptyString(params.name);
    if (!name) return { jsonrpc: "2.0", id, error: { code: -32602, message: "tools/call params are invalid" } };
    const args = isJsonObject(params.arguments) ? params.arguments : {};
    const trace = readAiTrace(params._meta);
    // Calls without a trace (stock MCP clients, PeerMcpSession) all share one implicit run. A
    // call's outcome may fail or complete only a run its caller named: failing the shared run
    // would turn every later untraced call into AI_RUN_TERMINAL until the provider reconnects.
    const explicitRunId = traceRunId(trace);
    const runId = explicitRunId ?? this.implicitAiRunId();
    const stepIndex = traceStepIndex(trace) ?? 0;
    const requestId = `rpc-${generation}-${runId}-${++this.carrierMessageSequence}`;
    const context = isJsonObject(args.context) ? args.context : undefined;
    const durableRequestId = nonEmptyString(context?.requestId);
    if (this.aiRunLedger && durableRequestId) {
      const previous = await this.aiRunLedger.find(runId, durableRequestId);
      if (previous?.status === "outcome-unknown") {
        return {
          jsonrpc: "2.0",
          id,
          result: toolErrorResult({
            code: "RECONCILIATION_REQUIRED",
            message: "AI write outcome is unknown; reconcile its durable receipt before retrying.",
          }),
        };
      }
      if (
        previous?.status === "durable" ||
        previous?.status === "replicating" ||
        previous?.status === "replicated"
      ) {
        const replay = { ok: true, receipt: previous.receipt, data: { replayed: true } };
        return { jsonrpc: "2.0", id, result: interpretHostResult(replay).result };
      }
    }
    const controller = new AbortController();
    let runSnapshot: AiRunSnapshot;
    try {
      runSnapshot = this.aiRuns.begin(runId, name, stepIndex);
    } catch (error) {
      // Every tracked run still has work in flight. Answer now: a throw here would leave the
      // relayed request unanswered until the relay's own timeout.
      return {
        jsonrpc: "2.0",
        id,
        result: toolErrorResult({
          code: error instanceof AiRunLimitExceededError ? error.code : "AI_RUN_REJECTED",
          message: errorMessage(error, "AI run could not be started"),
        }),
      };
    }
    if (
      runSnapshot.phase === "stopped" ||
      runSnapshot.phase === "completed" ||
      runSnapshot.phase === "failed" ||
      runSnapshot.phase === "rolled-back"
    ) {
      return {
        jsonrpc: "2.0",
        id,
        result: toolErrorResult({ code: "AI_RUN_TERMINAL", message: "This AI run is already terminal." }),
      };
    }
    this.aiRuns.registerAction(runId, requestId, controller);
    try {
      const res = await webMcp?.invoke?.(name, args, { signal: controller.signal });
      const outcome = interpretHostResult(res);
      const receipt = isCommitReceipt(outcome.receipt) ? outcome.receipt : undefined;
      if (outcome.receipt !== undefined && !receipt) {
        console.warn(
          "[WebMCP] Host returned an invalid CommitReceipt; ledger idempotency and rollback are skipped:",
          outcome.receipt,
        );
      }
      // Only a receipt that passes the guard may make an operation rollback-eligible.
      const operationId =
        receipt &&
        (receipt.status === "durable" || receipt.status === "replicating" || receipt.status === "replicated") &&
        typeof receipt.operationId === "string" &&
        receipt.operationId.trim()
          ? receipt.operationId
          : undefined;
      const transactionId =
        receipt && "transactionId" in receipt && typeof receipt.transactionId === "string" && receipt.transactionId.trim()
          ? receipt.transactionId
          : undefined;
      if (this.aiRunLedger && receipt) {
        try {
          await this.aiRunLedger.recordReceipt({ runId, actionId: name, stepIndex, receipt });
        } catch (error) {
          console.warn("[WebMCP] AI run ledger rejected receipt:", error);
        }
      }
      if (generation !== this.connectionGeneration || !this.aiRuns.get(runId)) {
        return { jsonrpc: "2.0", id, error: { code: -32008, message: "OUTCOME_UNKNOWN" } };
      }
      this.aiRuns.settleAction(runId, requestId);
      this.aiRuns.recordStep(runId, {
        actionId: name,
        stepIndex,
        ...(operationId ? { operationId } : {}),
        ...(transactionId ? { transactionId } : {}),
        ...(receipt ? { requestId: receipt.requestId } : {}),
      });
      if (controller.signal.aborted) this.aiRuns.stop(runId, "stopped by host");
      else if (explicitRunId && outcome.failed) this.aiRuns.fail(runId, outcome.failureMessage);
      else if (explicitRunId && trace?.phase === "completed") this.aiRuns.complete(runId);
      const updated = this.aiRuns.get(runId);
      if (updated) this.publishAiRunAwareness(updated);
      return { jsonrpc: "2.0", id, result: outcome.result };
    } catch (err) {
      const message = errorMessage(err, "Tool execution error");
      if (generation !== this.connectionGeneration || !this.aiRuns.get(runId)) {
        return { jsonrpc: "2.0", id, error: { code: -32008, message: "OUTCOME_UNKNOWN" } };
      }
      this.aiRuns.settleAction(runId, requestId);
      if (controller.signal.aborted) this.aiRuns.stop(runId, "stopped by host");
      else if (explicitRunId) this.aiRuns.fail(runId, message);
      const updated = this.aiRuns.get(runId);
      if (updated) this.publishAiRunAwareness(updated);
      return { jsonrpc: "2.0", id, result: toolErrorResult({ code: -32603, message }) };
    }
  }

  private async sendFrame(channel: RTCDataChannel, payload: unknown): Promise<void> {
    if (channel.readyState !== "open") return;
    const text = JSON.stringify(payload);
    const chunkSize = 2048;
    const total = Math.max(1, Math.ceil(text.length / chunkSize));
    const id = ++this.frameSeq;

    for (let index = 0; index < total; index++) {
      const data = text.slice(index * chunkSize, (index + 1) * chunkSize);
      channel.send(JSON.stringify({ v: 1, id, index, total, data }));
    }
  }

  private makeCarrierEnvelope(value: unknown): CrdtCarrierEnvelope | null {
    if (isCarrierEnvelope(value)) return value;
    const message = isRecord(value) ? value : null;
    const roomId = this.roomId;
    const roomEpoch = this.roomEpoch ?? 0;
    const documentId =
      typeof message?.documentId === "string" ? message.documentId : this.activeTransport?.documentId;
    if (!roomId || roomEpoch === null || !documentId) return null;
    const sessionId =
      this.carrierSessionId ||
      this.approvalSessionId ||
      `carrier-${this.replicaId}-${this.connectionGeneration}`;
    this.carrierSessionId = sessionId;
    return {
      kind: "crdt",
      protocolVersion: "1.0.0",
      message: value,
      roomId,
      roomEpoch,
      sessionId,
      replicaId: this.replicaId,
      transportGeneration: this.connectionGeneration,
      messageId: `crdt-${this.replicaId}-${this.connectionGeneration}-${++this.carrierMessageSequence}`,
      documentId,
    };
  }

  private bindActiveTransport(): void {
    if (!this.crdtCapabilityEnabled || !this.activeTransport || !this.roomId || this.roomEpoch === null) {
      return;
    }
    const transport = this.activeTransport;
    const binding = {
      roomId: this.roomId,
      roomEpoch: this.roomEpoch,
      sessionId:
        this.carrierSessionId ??
        this.approvalSessionId ??
        `carrier-${this.replicaId}-${this.connectionGeneration}`,
      replicaId: this.replicaId,
      transportGeneration: this.connectionGeneration,
    };
    if (typeof transport.bindCarrier === "function") transport.bindCarrier.call(transport, binding);
    else transport.setCarrierBinding?.call(transport, binding);
  }

  private isCurrentCarrierEnvelope(value: unknown): value is CrdtCarrierEnvelope {
    if (!isCarrierEnvelope(value)) return false;
    if (
      this.roomId === null ||
      this.roomEpoch === null ||
      value.roomId !== this.roomId ||
      value.roomEpoch !== this.roomEpoch
    ) {
      return false;
    }
    if (value.transportGeneration !== this.connectionGeneration) return false;
    const documentId = this.activeTransport?.documentId;
    if (documentId && value.documentId !== documentId) return false;
    if (
      this.carrierSessionId &&
      value.sessionId !== this.carrierSessionId &&
      value.sessionId !== this.approvalSessionId
    ) {
      return false;
    }
    if (this.remoteCarrierReplicaId && value.replicaId !== this.remoteCarrierReplicaId) return false;
    if (this.receivedCarrierMessages.has(value.messageId)) return false;
    return true;
  }

  private handleIncomingCrdt(value: unknown): void {
    if (this.roomEpoch !== null && !this.crdtCapabilityEnabled) return;
    const transport = this.activeTransport;
    if (
      !isCarrierEnvelope(value) &&
      (this.roomEpoch === null || typeof transport?.receiveVerified !== "function")
    ) {
      if (isRecord(value)) transport?.receiveExternal(value);
      return;
    }
    if (!this.isCurrentCarrierEnvelope(value)) return;
    this.remoteCarrierReplicaId ??= value.replicaId;
    this.receivedCarrierMessages.add(value.messageId);
    if (this.receivedCarrierMessages.size > 4096) {
      const oldest = this.receivedCarrierMessages.values().next().value;
      if (typeof oldest === "string") this.receivedCarrierMessages.delete(oldest);
    }
    try {
      if (typeof transport?.receiveVerified === "function") {
        const result = transport.receiveVerified(value);
        if (result && typeof (result as Promise<boolean>).catch === "function") {
          void (result as Promise<boolean>).catch((error) =>
            console.warn("[WebMCP] CRDT carrier rejected:", error),
          );
        }
        return;
      }
      const payload = value.message;
      for (const listener of this.crdtListeners) listener(payload);
    } catch (error) {
      console.warn("[WebMCP] CRDT carrier rejected:", error);
    }
  }

  attachCrdtTransport(transport: WebMcpCrdtTransport): () => void {
    this.detachTransportCarrier?.();
    this.activeTransport = transport;
    this.bindActiveTransport();

    // Nobody awaits a carrier send, so its failure (a message JSON cannot serialize, a DataChannel
    // that closes or overflows mid-frame) is reported here instead of as an unhandled rejection.
    this.detachTransportCarrier = transport.attachCarrier((msg) => {
      void this.sendCrdt(msg).catch((error: unknown) => console.warn("[WebMCP] CRDT send failed:", error));
    });

    const crdtListener = (msg: unknown) => {
      this.handleIncomingCrdt(msg);
    };
    this.crdtListeners.add(crdtListener);

    if (this.state === "connected" && this.dataChannel && this.dataChannel.readyState === "open") {
      try {
        transport.broadcastAwareness();
        this.introduceRemotePeer(transport);
      } catch (err) {
        console.warn("[WebMCP] Failed to announce initial awareness:", err);
      }
    }

    return () => {
      this.detachTransportCarrier?.();
      this.detachTransportCarrier = undefined;
      this.crdtListeners.delete(crdtListener);
      if (this.activeTransport === transport) {
        this.activeTransport = undefined;
      }
    };
  }

  async sendCrdt(message: unknown): Promise<void> {
    const legacyUnbound = this.roomEpoch === null;
    if (!legacyUnbound && !this.crdtCapabilityEnabled) return;
    const envelope = this.makeCarrierEnvelope(message);
    if (!envelope) return;
    if (this.dataChannel && this.dataChannel.readyState === "open" && this.approvalState === "approved") {
      await this.sendFrame(this.dataChannel, {
        type: "crdt",
        message: legacyUnbound ? message : envelope,
      });
    }
  }

  private introduceRemotePeer(transport: WebMcpCrdtTransport, toolArgs?: unknown, traceInput?: unknown): void {
    if (this.roomEpoch !== null && !this.crdtCapabilityEnabled) return;
    const args = isJsonObject(toolArgs) ? toolArgs : {};
    const trace = isJsonObject(traceInput) ? traceInput : {};
    const peerClientId = `webmcp-${this.roomId ? this.roomId.slice(0, 6) : "remote"}`;
    const isBoundedId = (value: unknown): value is string => typeof value === "string" && value.length <= 128;
    const isCoordinate = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
    const slideId = nonEmptyString(args.slideId);
    const nodeIds = args.nodeId
      ? [args.nodeId].filter(isBoundedId)
      : Array.isArray(args.nodeIds)
        ? args.nodeIds.filter(isBoundedId).slice(0, 64)
        : undefined;
    const x = isCoordinate(args.x) ? args.x : undefined;
    const y = isCoordinate(args.y) ? args.y : undefined;
    const runId = traceRunId(trace) ?? this.implicitAiRunId();
    const actionId =
      typeof trace.actionId === "string" && trace.actionId.length > 0 && trace.actionId.length <= 128
        ? trace.actionId
        : "tools/call";
    const stepIndex = traceStepIndex(trace) ?? 0;
    const operationId = nonEmptyString(trace.operationId);
    const phase = isAiRunPhase(trace.phase) ? trace.phase : "running";
    const rawTrail: readonly unknown[] = Array.isArray(trace.cursorTrail)
      ? trace.cursorTrail
      : Array.isArray(trace.path)
        ? trace.path
        : [];
    const cursorTrail: AiRunPoint[] = rawTrail.slice(-64).flatMap((entry) => {
      const point = isJsonObject(entry) ? entry : {};
      const pointSlide = nonEmptyString(point.slideId) ?? slideId;
      const pointX = isCoordinate(point.x) ? point.x : undefined;
      const pointY = isCoordinate(point.y) ? point.y : undefined;
      const pointStep = traceStepIndex(point) ?? stepIndex;
      if (!pointSlide || pointX === undefined || pointY === undefined) return [];
      return [
        {
          slideId: pointSlide,
          x: pointX,
          y: pointY,
          stepIndex: pointStep,
          ...(operationId ? { operationId } : {}),
        },
      ];
    });
    if (slideId && x !== undefined && y !== undefined && cursorTrail.length === 0) {
      cursorTrail.push({ slideId, x, y, stepIndex, ...(operationId ? { operationId } : {}) });
    }

    this.aiRuns.begin(runId, actionId, stepIndex);
    if (slideId && nodeIds) this.aiRunSelections.set(runId, { slideId, nodeIds: [...nodeIds] });
    const run = this.aiRuns.recordStep(runId, { actionId, stepIndex, cursorTrail });
    const projectedTrail = run.cursorTrail;

    const awareness = {
      type: "presence.awareness",
      protocolVersion: "1.0.0",
      documentId: transport.documentId,
      clientId: peerClientId,
      user: {
        name: this.clientLabel || "AI Agent (WebMCP)",
        color: "var(--status-info)",
      },
      cursor: slideId && x !== undefined && y !== undefined ? { slideId, x, y } : undefined,
      selection: slideId && nodeIds ? { slideId, nodeIds } : undefined,
      agent: {
        kind: "ai",
        runId,
        actionId,
        stepIndex,
        phase: run.phase === "stopped" ? "stopped" : phase,
        ...(operationId ? { operationId } : {}),
      },
      ...(projectedTrail.length ? { cursorTrail: projectedTrail } : {}),
      timestamp: Date.now(),
    };
    if (this.roomEpoch === null) {
      transport.receiveExternal(awareness);
      return;
    }
    const envelope = this.makeCarrierEnvelope({ ...awareness, clientId: peerClientId });
    if (!envelope) return;
    if (typeof transport.receiveVerified === "function") {
      const result = transport.receiveVerified({ ...envelope, replicaId: peerClientId });
      if (result && typeof (result as Promise<boolean>).catch === "function") {
        void (result as Promise<boolean>).catch((error) =>
          console.warn("[WebMCP] Synthetic awareness rejected:", error),
        );
      }
    } else {
      transport.receiveExternal(awareness);
    }
  }

  private publishAiRunAwareness(run: AiRunSnapshot): void {
    if (!this.activeTransport || this.state !== "connected" || this.approvalState !== "approved") return;
    const latestPoint = run.cursorTrail[run.cursorTrail.length - 1];
    const selection = this.aiRunSelections.get(run.runId);
    this.introduceRemotePeer(
      this.activeTransport,
      latestPoint
        ? {
            slideId: latestPoint.slideId,
            x: latestPoint.x,
            y: latestPoint.y,
            ...(selection ? { nodeIds: selection.nodeIds } : {}),
          }
        : selection,
      {
        runId: run.runId,
        actionId: run.actionId,
        stepIndex: run.stepIndex,
        phase: run.phase,
        cursorTrail: run.cursorTrail,
      },
    );
  }

  approveClient(requestId = this.approvalRequestId): boolean {
    if (!requestId || this.approvalState !== "pending" || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    if (!this.sendApprovalDecision(this.ws, requestId, "approved")) return false;
    this.approvalState = "approved";
    this.notify();
    return true;
  }

  rejectClient(requestId = this.approvalRequestId): boolean {
    if (!requestId || this.approvalState !== "pending" || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    if (!this.sendApprovalDecision(this.ws, requestId, "rejected", "CLIENT_REJECTED")) return false;
    this.approvalState = "revoked";
    this.approvalRequestId = null;
    this.notify();
    return true;
  }

  /** Sends the host's approval decision; false when it could not be sent (the request stays pending). */
  private sendApprovalDecision(
    ws: WebSocket,
    requestId: string,
    decision: "approved" | "rejected",
    reason?: string,
  ): boolean {
    const now = new Date().toISOString();
    return sendRelayFrame(
      ws,
      {
        protocol: WEBMCP_PROTOCOL,
        messageId: `approval-${requestId}-${Date.now()}`,
        type: "approval.decision",
        roomId: this.roomId,
        roomEpoch: this.approvalRoomEpoch ?? this.roomEpoch ?? 0,
        ...(this.approvalSessionId ? { sessionId: this.approvalSessionId } : {}),
        requestId,
        sentAt: now,
        payload: {
          requestId,
          sessionId: this.approvalSessionId || "",
          roomId: this.roomId || "",
          roomEpoch: this.approvalRoomEpoch ?? this.roomEpoch ?? 0,
          decision,
          decidedAt: now,
          ...(reason ? { reason } : {}),
        },
      },
      "approval.decision",
    );
  }

  revokeClient(): void {
    this.disconnect(true);
  }

  async refreshRoom(overrides: Partial<WebMcpPeerConnectOptions> = {}): Promise<string> {
    const base = this.lastConnectOptions;
    if (!base) throw new Error("PEER_SESSION_NOT_CONFIGURED");
    const nextOptions = { ...base, ...overrides };
    const previousRoomId = this.roomId;
    const previousProviderToken = this.providerToken;
    if (!previousRoomId || !previousProviderToken) return this.connect(nextOptions);

    const response = await fetch(relayRoomUrl(this.serverUrl, previousRoomId, "/rotate"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${previousProviderToken}`,
      },
      body: JSON.stringify({
        roomId: previousRoomId,
        roomEpoch: this.roomEpoch ?? 0,
        requestedAt: new Date().toISOString(),
        alias: nextOptions.alias || this.alias,
      }),
    });
    if (!response.ok) {
      const body = parseJsonObject(await readResponseText(response));
      throw new Error(nonEmptyString(body.error) ?? `HTTP ${response.status}: Failed to rotate peer room`);
    }
    const replacement = readRoomDescriptor(await readResponseText(response), "INVALID_ROOM_DESCRIPTOR");
    this.disconnect();
    const generation = ++this.connectionGeneration;
    this.roomGeneration += 1;
    this.carrierSessionId = `carrier-${this.replicaId}-${generation}`;
    this.remoteCarrierReplicaId = null;
    this.receivedCarrierMessages.clear();
    this.lastConnectOptions = nextOptions;
    this.serverUrl = normalizePeerConfigUrl(nextOptions.serverUrl);
    if (nextOptions.alias) this.alias = nextOptions.alias;
    this.approvalState = "none";
    this.approvalRequestId = null;
    this.approvalSessionId = null;
    this.approvalRoomEpoch = null;
    this.approvalEnvelope = false;
    this.state = "creating";
    this.error = null;
    this.notify();
    return this.attachCreatedRoom(replacement, nextOptions, generation);
  }

  private scheduleExpiry(generation: number, expiresAt: number): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    const delay = Math.max(0, expiresAt - Date.now());
    this.expiryTimer = setTimeout(() => {
      if (generation !== this.connectionGeneration) return;
      this.expirePeerSession("SESSION_EXPIRED");
    }, delay);
  }

  disconnect(userRevoked = false): void {
    this.connectionGeneration += 1;
    this.aiRuns.clear(userRevoked ? "AI session revoked" : "AI session released");
    this.aiRunSelections.clear();
    this.signalingReleased = false;
    const revokeRoomId = this.roomId;
    const revokeProviderToken = this.providerToken;
    const revokeSessionId = this.approvalSessionId;
    if (
      userRevoked &&
      revokeRoomId &&
      revokeProviderToken &&
      revokeSessionId &&
      typeof fetch === "function"
    ) {
      void fetch(
        relayRoomUrl(this.serverUrl, revokeRoomId, `/sessions/${encodeURIComponent(revokeSessionId)}/revoke`),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${revokeProviderToken}`,
          },
          body: JSON.stringify({
            roomId: revokeRoomId,
            roomEpoch: this.roomEpoch ?? 0,
            sessionId: revokeSessionId,
            requestedAt: new Date().toISOString(),
            reason: "provider-request",
          }),
        },
      ).catch(() => {});
    }
    this.stopKeepalive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.reconnectAttempts = 0;
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = undefined;
    }

    try {
      this.activeTransport?.invalidateCarrier?.(userRevoked ? "session-revoked" : "transport-released");
    } catch {}

    if (userRevoked) {
      this.autoReconnect = false;
      this.clearSavedRoomLease(this.serverUrl);
      try {
        if (typeof window !== "undefined") {
          localStorage.setItem("webmcp:auto-reconnect", "false");
        }
      } catch {}
    }

    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch {}
      this.dataChannel = undefined;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
      this.pc = undefined;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = undefined;
      this.providerToken = null;
    }

    this.framePending.clear();
    this.carrierSessionId = null;
    this.remoteCarrierReplicaId = null;
    this.receivedCarrierMessages.clear();
    this.state = "idle";
    this.approvalState = userRevoked ? "revoked" : "none";
    this.approvalRequestId = null;
    this.approvalSessionId = null;
    this.approvalRoomEpoch = null;
    this.approvalEnvelope = false;
    this.invitationUrl = null;
    this.roomId = null;
    this.roomEpoch = null;
    this.expiresAt = null;
    this.clientLabel = null;
    this.connectedAt = null;
    this.error = null;
    this.notify();
  }
}
