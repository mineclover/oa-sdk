import { isReconnectableCloseCode, WEBMCP_CLOSE_CODES, WEBSOCKET_CLOSE_ABNORMAL } from "../config/close-codes.js";
import { peerRpcError } from "../config/errors.js";
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
  MCP_INITIALIZE_PROTOCOL_VERSIONS,
  MCP_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSIONS,
  negotiateInitializeProtocolVersion,
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
  encodeDataChannelMcpReply,
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
  type JsonRpcRequestId,
  type ProviderRpcResponse,
} from "./tool-call.js";
import {
  DATA_CHANNEL_SEND_CHUNK_CHARS,
  DataChannelChunkSchema,
  MAX_DATA_CHANNEL_FRAME_CHARS,
  PeerRoomDescriptorSchema,
  ProviderFrameSchema,
  SavedRoomLeaseSchema,
  type PeerRoomDescriptor,
  type ProviderFrame,
} from "./wire-schemas.js";

const CATALOG_INVALID_ERROR = "CATALOG_INVALID";
const CATALOG_TOO_LARGE_ERROR = "CATALOG_TOO_LARGE";
/** The relay's refusal of an `approval.decision`, and the session error a refusal of the host's latest one sets. */
const INVALID_APPROVAL_ERROR = "INVALID_APPROVAL";
/**
 * The session error of an auto-reconnect whose saved room lease the relay refused: the room is gone,
 * rotated or expired, or the lease is no longer its. Auto-reconnect stops there instead of opening a
 * new room, which would leave the agent on the old one and hand out a new invite nobody asked for.
 */
const ROOM_LEASE_LOST_ERROR = "ROOM_LEASE_LOST";
/**
 * The session error of a provider socket the relay closed because another one replaced it (4001
 * SUPERSEDED): that socket serves the room now, so this provider does not reconnect to take it back.
 */
const SESSION_SUPERSEDED_ERROR = "PEER_SESSION_SUPERSEDED";
/**
 * The session error of any other final close of the provider socket that no frame explained (a code
 * auto-reconnect does not retry, see `isReconnectableCloseCode`), such as a 1000 whose frame was lost.
 */
const SIGNALING_CLOSED_ERROR = "SIGNALING_CLOSED";
/**
 * The session error of a session whose approval request the relay rejected (`approval.rejected`),
 * the name the relay and the agent client give a rejected ticket.
 */
const CLIENT_APPROVAL_DENIED_ERROR = "CLIENT_APPROVAL_DENIED";

/** How a frame ends the provider's session: as revoked or as expired, with the session error. */
interface SessionEnd {
  readonly approvalState: "revoked" | "expired";
  readonly error: string;
}

/**
 * The relay frames that end the provider's session, and how each ends it. The relay ended the room's
 * ticket, whoever asked: a revocation (`session.revoked`) or the rejection of its approval request
 * (the `approval.rejected` echo of a rejection over HTTP or of the host's own) ends it as revoked;
 * the expiry of its approval request or session, or a rotation of the room, as expired. Each leaves
 * a room no agent can use any more (its one invite is spent, or the room is gone), see
 * `revokePeerSession` and `expirePeerSession`. A provider socket learns them from these frames, and
 * one that attaches after the ticket ended from the `ticketEnded` of the relay's `ready`.
 */
const SESSION_END_FRAMES: ReadonlyMap<string, SessionEnd> = new Map<string, SessionEnd>([
  ["approval.rejected", { approvalState: "revoked", error: CLIENT_APPROVAL_DENIED_ERROR }],
  ["session.revoked", { approvalState: "revoked", error: "SESSION_REVOKED" }],
  ["collaboration.revoked", { approvalState: "revoked", error: "SESSION_REVOKED" }],
  ["collaboration.role-updated", { approvalState: "revoked", error: "SESSION_REVOKED" }],
  ["collaboration.guest-linked", { approvalState: "revoked", error: "SESSION_REVOKED" }],
  ["approval.expired", { approvalState: "expired", error: "APPROVAL_EXPIRED" }],
  ["collaboration.expired", { approvalState: "expired", error: "SESSION_EXPIRED" }],
  ["room.rotated", { approvalState: "expired", error: "ROOM_ROTATED" }],
]);

/** The localStorage key of the host's write consent (see `WebMcpPeerClient.setWriteEnabled`). */
const WRITE_ENABLED_STORAGE_KEY = "webmcp:write-enabled";

/**
 * True for a reclaim status that refuses the lease itself, so that presenting it again cannot
 * succeed: none was sent (400), it is not one the relay accepts (401, 403), the room is gone (404),
 * it names another room epoch (409 other than ROOM_PROVIDER_ACTIVE), or the room expired, was
 * rotated or outlived the lease (410). Any other failure (a 5xx, 408, 429) may pass.
 */
function refusesRoomLease(status: number, error: unknown): boolean {
  if (status === 409) return error !== "ROOM_PROVIDER_ACTIVE";
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 410;
}

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
 * here. The relay closes a socket that sends a message over its limit (close code 1009), which
 * fails every agent request pending in the room with PROVIDER_DISCONNECTED. Some frames echo values
 * an agent chose (an answer repeats the offer's `requestId`), so the serialized frame is measured
 * instead of being assumed small: a frame over {@link RELAY_MAX_MESSAGE_BYTES} is not sent, with a
 * warning. Returns whether the frame was handed to the socket.
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
  /**
   * The host's latest `approval.decision`, taken as made when it was sent, until the relay settles it:
   * its echo, a new request, or the INVALID_APPROVAL that undoes it (see {@link undoRefusedDecision}).
   */
  private sentDecision: { readonly requestId: string; readonly decision: "approved" | "rejected" } | null = null;
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
   * The `requestId` of the agent's offer the provider last answered on the current peer connection,
   * so the session of the DataChannel opened on it: its `grant` and the relay `release` repeat it,
   * and the relay routes the release, as it did the answer, to the agent socket that offered.
   */
  private offerRequestId: string | null = null;
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
   * The relay passes a WebSocket agent's tools/list and server/discover to the provider, and in a
   * room that holds no catalog takes the tools of the reply as one, so those requests are answered
   * from the last frame sent here (see {@link relayCatalogTools}), never from the live host catalog:
   * a withheld catalog cannot reach the relay or its agents that way either.
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
   * `register` frame sent to the current room, which is the catalog the relay holds. A relay that
   * holds no catalog takes the tools of that reply as one, so answering with the live host catalog
   * would hand it a catalog withheld as too large: the relay would adopt it, or refuse it, and the
   * agent would be listed a catalog other than the one this provider registered (a relay that holds
   * a catalog answers the listing from it, whatever the provider replies).
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

  /**
   * Sets the host's write consent and saves the state it reports, so that an auto-reconnect, which
   * restores it (see {@link readAutoReconnectOptions}), enables writes only when the user did.
   */
  setWriteEnabled(enabled: boolean): boolean {
    const res = this.resolveHostAdapter()?.setWriteEnabled?.(enabled);
    const writeEnabled = res?.writeEnabled ?? enabled;
    this.saveWriteEnabled(writeEnabled);
    this.notify();
    return writeEnabled;
  }

  /** Toggles the host's write consent and saves the state it reports, as {@link setWriteEnabled} does. */
  toggleWrite(): boolean {
    const res = this.resolveHostAdapter()?.toggleWrite?.();
    const writeEnabled = res?.writeEnabled ?? false;
    this.saveWriteEnabled(writeEnabled);
    this.notify();
    return writeEnabled;
  }

  /**
   * Saves the write consent as localStorage `webmcp:write-enabled` (`"true"` or `"false"`), the one
   * key `connect()` and auto-reconnect read it from; nothing is saved outside a browser.
   */
  private saveWriteEnabled(enabled: boolean): void {
    try {
      if (typeof window !== "undefined") localStorage.setItem(WRITE_ENABLED_STORAGE_KEY, enabled ? "true" : "false");
    } catch {}
  }

  clearError(): void {
    this.error = null;
    if (this.state === "error") {
      this.state = "idle";
    }
    this.notify();
  }

  /**
   * Reconnects to the room a previous `connect()` saved, reclaiming its saved room lease; it never
   * opens a new room. Resolves false when auto-reconnect is suppressed, nothing is saved (no lease
   * for the saved relay included), or the connect failed: with the session error ROOM_LEASE_LOST
   * when the relay refused the lease, and with the session ended (and the lease forgotten) when the
   * relay's `ready` says the room's ticket ended while the provider was away, as the frame that
   * told so would end it (see `attachCreatedRoom`).
   */
  async autoReconnectIfSaved(): Promise<boolean> {
    return (await this.attemptAutoReconnect()) === "connected";
  }

  /**
   * The connect options a previous `connect()` saved, or null when auto-reconnect must not run: it
   * is suppressed or turned off, or no relay or no room lease for it is saved. Auto-reconnect
   * returns to the saved room, so with no lease there is nothing to return to; opening a new room
   * is the host's own call. Writes are enabled only when the saved write consent is `"true"`, the
   * rule `connect()` reads it by.
   */
  private readAutoReconnectOptions(): WebMcpPeerConnectOptions | null {
    if (typeof window === "undefined" || this.shouldSuppressAutoReconnect(window.location ?? {})) return null;
    if (localStorage.getItem("webmcp:auto-reconnect") === "false") return null;
    const serverUrl = localStorage.getItem("webmcp:server-url");
    if (!serverUrl || !this.readSavedRoomLease(serverUrl)) return null;
    return {
      serverUrl,
      alias: localStorage.getItem("webmcp:peer-alias") || this.alias,
      publishKey: localStorage.getItem("webmcp:publish-key") || "local-development-only",
      autoReconnect: true,
      enableWrite: localStorage.getItem(WRITE_ENABLED_STORAGE_KEY) === "true",
      enableCrdt: localStorage.getItem("webmcp:crdt-enabled") === "true",
      reclaimLease: true,
    };
  }

  /**
   * One auto-reconnect attempt: "skipped" when auto-reconnect is suppressed or nothing is saved,
   * "lease-lost" when the relay refused the saved lease (ROOM_LEASE_LOST: no room is opened and the
   * attempts stop), "failed" when the connect failed otherwise (a reclaimed room whose ticket ended
   * included: its session ended), "connected" when it succeeded.
   */
  private async attemptAutoReconnect(): Promise<"connected" | "skipped" | "failed" | "lease-lost"> {
    let options: WebMcpPeerConnectOptions | null;
    try {
      options = this.readAutoReconnectOptions();
    } catch (error) {
      console.warn("[WebMCP] Auto-reconnect skipped:", errorMessage(error, "storage unavailable"));
      return "skipped";
    }
    if (!options) return "skipped";
    console.log(`[WebMCP] Auto-reconnecting peer '${options.alias}' to ${options.serverUrl}...`);
    try {
      await this.openRoom(options, false);
      return "connected";
    } catch (error) {
      const message = errorMessage(error, "connect failed");
      console.warn("[WebMCP] Auto-reconnect failed:", message);
      return message === ROOM_LEASE_LOST_ERROR ? "lease-lost" : "failed";
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
    // Retry only a connect failure that may pass. A skipped attempt (auto-reconnect turned off,
    // nothing saved), a lease the relay refused, a room whose ticket ended (the session ended, so
    // it is "disconnected"), a manual disconnect ("idle") or a newer connect that superseded this
    // one (it owns the state, or has already scheduled its own retry) must not restart the loop.
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
   * Creates a relay room (or, with `reclaimLease`, reclaims the saved one, and creates a room when
   * the relay refuses it) and attaches the provider socket. Resolves to the invitation URL to hand
   * to an agent (`<descriptorUrl>#invite=<token>`); the full session state is available from
   * `getSession()` and `subscribe()`. A reclaimed room whose ticket ended meanwhile serves no agent:
   * the session then ends, the lease is forgotten, and this rejects with the session error.
   */
  async connect(options: WebMcpPeerConnectOptions): Promise<string> {
    return this.openRoom(options, true);
  }

  /**
   * `connect()`, which may create a room (`mayCreateRoom`), or, for auto-reconnect, may only
   * reclaim the saved one: a lease the relay refuses, or none saved, then fails with
   * ROOM_LEASE_LOST (see {@link tryReclaimSavedRoom}).
   */
  private async openRoom(options: WebMcpPeerConnectOptions, mayCreateRoom: boolean): Promise<string> {
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
    this.sentDecision = null;

    let enableWrite = false;
    try {
      enableWrite =
        options.enableWrite ??
        (typeof localStorage !== "undefined" ? localStorage.getItem(WRITE_ENABLED_STORAGE_KEY) === "true" : false);
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
      if (options.reclaimLease === true || !mayCreateRoom) {
        const reclaimed = await this.tryReclaimSavedRoom(options, generation, mayCreateRoom);
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

  /**
   * Reclaims the room of the lease saved for the current relay and attaches to it. Returns null to
   * have a room created instead, when that is allowed (`mayCreateRoom`): no lease is saved, the
   * relay refused it (see {@link refusesRoomLease}; the lease is then forgotten), or the reclaim
   * failed otherwise. When it is not, as for auto-reconnect, no lease or a refused one fails with
   * ROOM_LEASE_LOST, and any other failure with an error the next attempt may not get, the lease
   * kept. A provider socket the relay still holds (409 ROOM_PROVIDER_ACTIVE) is waited for, four
   * attempts 100, 200 and 300 ms apart, then fails with ROOM_PROVIDER_ACTIVE.
   */
  private async tryReclaimSavedRoom(
    options: WebMcpPeerConnectOptions,
    generation: number,
    mayCreateRoom: boolean,
  ): Promise<string | null> {
    const lease = this.readSavedRoomLease(this.serverUrl);
    if (!lease || lease.serverUrl.replace(/\/+$/, "") !== this.serverUrl.replace(/\/+$/, "")) {
      if (!mayCreateRoom) throw new Error(ROOM_LEASE_LOST_ERROR);
      return null;
    }
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
      const body = parseJsonObject(await readResponseText(response));
      if (response.status === 409 && body.error === "ROOM_PROVIDER_ACTIVE") {
        if (attempt === 3) throw new Error("ROOM_PROVIDER_ACTIVE");
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        continue;
      }
      if (refusesRoomLease(response.status, body.error)) {
        // The lease cannot be used again.
        this.clearSavedRoomLease(this.serverUrl);
        if (!mayCreateRoom) throw new Error(ROOM_LEASE_LOST_ERROR);
        return null;
      }
      if (!mayCreateRoom) {
        throw new Error(nonEmptyString(body.error) ?? `HTTP ${response.status}: Failed to reclaim the peer room`);
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
        const ready = parseProviderFrame(event.data);
        if (ready?.type !== "ready") return;
        clearTimeout(timer);
        if (generation !== this.connectionGeneration) {
          reject(new Error("PEER_SESSION_SUPERSEDED"));
          return;
        }
        // The room's ticket ended while no socket of this provider was attached (a reload, the
        // reconnect backoff): the relay names in `ready` the frame that told so, which it replays
        // after `ready`. The room serves no agent, so the session ends here as that frame ends it,
        // and the attach fails with its session error rather than resolving for a session that is
        // over before the frame after `ready` is read.
        const ended = typeof ready.ticketEnded === "string" ? SESSION_END_FRAMES.get(ready.ticketEnded) : undefined;
        if (ended) {
          this.endPeerSession(ended);
          reject(new Error(ended.error));
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
          // The relay stamps every request it forwards with the session of the ticket that sent it.
          const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : undefined;
          const rpcRes = await this.answerMcpRpc(msg.message, generation, "relay", sessionId);
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
          this.adoptRelayApproval(msg);
          return;
        }

        if (msg.type === "approval.request") {
          const payload = isJsonObject(msg.payload) ? msg.payload : msg;
          this.clientLabel = nonEmptyString(payload.clientLabel) ?? "AI Agent";
          this.approvalRequestId = nonEmptyString(payload.requestId) ?? nonEmptyString(msg.requestId) ?? null;
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
          // A new request supersedes whatever the host decided before.
          this.sentDecision = null;
          this.clearDecisionError();
          this.state = "waiting";
          this.notify();
          return;
        }

        if (msg.type === "approval.approved") {
          // The relay holds the ticket approved, whoever decided it. The echo of the host's own
          // approval confirms it; an approval made another way (over HTTP), which this provider
          // learns only from this echo, is adopted when the frame names this room's epoch and a
          // session (see adoptRelayApproval).
          if (this.approvalState === "approved") this.sentDecision = null;
          else if (!this.adoptRelayApproval(msg)) return;
          this.setupPeerConnection(ws, iceServers, generation);
          return;
        }

        // The relay ended the room's ticket, whoever asked (a revocation, or a rejection: the echo of
        // the host's own or of one over HTTP), its approval request or session expired, or the room
        // was rotated: the room is done (see SESSION_END_FRAMES).
        const end = SESSION_END_FRAMES.get(msg.type);
        if (end) {
          this.endPeerSession(end);
          return;
        }

        if (msg.type === "offer") {
          if (this.approvalState !== "approved") return;
          // An offer is answered under its own requestId, as the relay requires one: the relay routes
          // the answer, and the release that ends the relay session, to the agent socket that
          // offered by it. An offer without one could not be matched to its answer, so it is ignored.
          const offerRequestId = nonEmptyString(msg.requestId);
          if (!offerRequestId) return;
          if (!this.pc) {
            this.setupPeerConnection(ws, iceServers, generation);
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
          if (answered && this.pc === pc) {
            this.offerRequestId = offerRequestId;
          } else if (!answered && this.pc === pc) {
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

    ws.onclose = (event?: { code?: unknown }) => {
      if (generation !== this.connectionGeneration) return;
      this.stopKeepalive();
      if (this.signalingReleased) return;
      // The close code says whether the relay is done with this provider (see WEBMCP_CLOSE_CODES); a
      // close that reports none is a connection lost without a close frame.
      const code = typeof event?.code === "number" ? event.code : WEBSOCKET_CLOSE_ABNORMAL;
      if (code === WEBMCP_CLOSE_CODES.ROOM_EXPIRED) {
        // As the provider's own expiry timer would: the room takes no one any more.
        this.expirePeerSession("ROOM_EXPIRED");
        return;
      }
      if (!isReconnectableCloseCode(code)) {
        this.endSignaling(code === WEBMCP_CLOSE_CODES.SUPERSEDED ? SESSION_SUPERSEDED_ERROR : SIGNALING_CLOSED_ERROR);
        return;
      }
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
    if (message === INVALID_APPROVAL_ERROR) {
      this.undoRefusedDecision(frame);
      return;
    }
    console.warn("[WebMCP] Relay error:", frame.code, message || frame);
  }

  /**
   * An INVALID_APPROVAL error frame: the relay refused an `approval.decision`. When it names the
   * request of the host's latest decision and no echo settled that decision since, the decision did
   * not take effect (its request expired or was decided another way meanwhile, its ticket ended, or
   * the decision did not match the request): the approval state it set is undone, back to `pending`
   * for that request, and INVALID_APPROVAL becomes the session error. Any other refusal concerns a
   * decision the relay has settled since, and is only logged.
   */
  private undoRefusedDecision(frame: ProviderFrame): void {
    const decision = this.sentDecision;
    if (!decision || frame.requestId !== decision.requestId) {
      console.warn("[WebMCP] Relay error:", frame.code, INVALID_APPROVAL_ERROR);
      return;
    }
    this.sentDecision = null;
    this.approvalState = "pending";
    this.approvalRequestId = decision.requestId;
    this.error = INVALID_APPROVAL_ERROR;
    this.notify();
  }

  /** Clears an INVALID_APPROVAL session error once the approval state has moved on; the caller notifies. */
  private clearDecisionError(): void {
    if (this.error === INVALID_APPROVAL_ERROR) this.error = null;
  }

  /**
   * Takes the relay's word that the client ticket a frame names is approved: `approval.restored`,
   * after the relay reattached this provider (F5 / auto-reconnect lease reclaim), or the
   * `approval.approved` echo of an approval this provider did not make (one over HTTP). Only the relay can
   * vouch for the ticket, so its approval stands whatever this provider decided or saw before, instead
   * of the still-approved agent being refused with CLIENT_APPROVAL_REQUIRED. The frame must name this
   * room's epoch and a session, and a ticket expiry it reports must be in the future: the restored
   * ticket's `payload.expiresAt`, or an echo's `ticketExpiresAt` (an echo's `expiresAt` is the
   * request's). Returns whether the approval was taken.
   */
  private adoptRelayApproval(frame: ProviderFrame): boolean {
    const payload = isJsonObject(frame.payload) ? frame.payload : frame;
    const sessionId = nonEmptyString(payload.sessionId) ?? nonEmptyString(frame.sessionId);
    const roomEpoch = typeof payload.roomEpoch === "number" ? payload.roomEpoch : frame.roomEpoch;
    const roomId = payload.roomId ?? frame.roomId;
    const ticketExpiry = frame.type === "approval.restored" ? payload.expiresAt : (payload.ticketExpiresAt ?? frame.ticketExpiresAt);
    const expiresAt = typeof ticketExpiry === "number" ? ticketExpiry : undefined;
    if (!sessionId || this.roomEpoch === null || roomEpoch !== this.roomEpoch) return false;
    if (roomId !== undefined && roomId !== this.roomId) return false;
    if (expiresAt !== undefined && expiresAt <= Date.now()) return false;
    this.clientLabel = nonEmptyString(payload.clientLabel) ?? this.clientLabel ?? "AI Agent";
    this.approvalSessionId = sessionId;
    this.carrierSessionId = sessionId;
    this.bindActiveTransport();
    this.approvalRoomEpoch = this.roomEpoch;
    this.approvalEnvelope = true;
    this.approvalRequestId = null;
    this.approvalState = "approved";
    this.sentDecision = null;
    this.clearDecisionError();
    this.notify();
    return true;
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
    this.offerRequestId = null;
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

  /**
   * Ends the session as expired, for `reason`: its approval request or session expired, or its room
   * was rotated or expired. Each leaves a room no agent can use any more (its one invite is spent,
   * or the room is gone), so the saved lease is forgotten too: a reloaded host page does not
   * reclaim the room and show an invitation nobody can redeem (see `readAutoReconnectOptions`).
   */
  private expirePeerSession(reason: string): void {
    this.approvalState = "expired";
    this.approvalRequestId = null;
    this.sentDecision = null;
    this.state = "disconnected";
    this.error = reason;
    this.clearSavedRoomLease(this.serverUrl);
    this.terminatePeerTransport();
    this.notify();
  }

  /**
   * Ends the session after a final close of the provider socket that no frame explained: the
   * transport is released without a reconnect, and `reason` becomes the session error. The approval
   * state stays as it was, since only the relay's frames change it.
   */
  private endSignaling(reason: string): void {
    this.state = "disconnected";
    this.error = reason;
    this.terminatePeerTransport();
    this.notify();
  }

  /**
   * Ends the session as revoked, for `reason`: the relay revoked the room's ticket, whoever asked
   * (the agent itself, the host over HTTP, another tab), or rejected its approval request, whoever
   * decided. The room takes no other agent (its one invite is spent), so the saved lease is
   * forgotten and nothing reconnects to the room: the transport's generation ends, so its close
   * schedules nothing, and a reloaded host page finds no lease to reclaim. The host's auto-reconnect
   * preference is the host's own and stays as it was, for the rooms it opens next; only the host's
   * own `revokeClient()` turns it off.
   */
  private revokePeerSession(reason: string): void {
    this.approvalState = "revoked";
    this.approvalRequestId = null;
    this.sentDecision = null;
    this.state = "disconnected";
    this.error = reason;
    this.clearSavedRoomLease(this.serverUrl);
    this.terminatePeerTransport();
    this.notify();
  }

  /** Ends the session as a frame of {@link SESSION_END_FRAMES} says: revoked or expired, with its session error. */
  private endPeerSession(end: SessionEnd): void {
    if (end.approvalState === "revoked") this.revokePeerSession(end.error);
    else this.expirePeerSession(end.error);
  }

  /**
   * Prepares a new RTCPeerConnection for the approved agent, closing the one before, for the agent's
   * next offer. The DataChannel the agent opens on it is the session of the offer the provider
   * answered on it (see {@link offerRequestId}).
   */
  private setupPeerConnection(
    ws: WebSocket,
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
    this.offerRequestId = null;

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label !== "mcp") return;

      this.dataChannel = channel;

      channel.onmessage = (e) => {
        this.handleDataChannelFrame(channel, ws, e.data, generation);
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
        void this.handlePeerMessage(channel, ws, msg, generation).catch((error) => {
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
      // The session the agent offered for: its offer's requestId, which the relay routes the release by.
      const requestId = this.offerRequestId;

      await this.sendFrame(channel, {
        type: "grant",
        protocol: WEBMCP_PROTOCOL,
        ...(requestId ? { requestId } : {}),
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
          sendRelayFrame(ws, { type: "release", ...(requestId ? { requestId } : {}) }, "release");
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
        // A reply the framing cannot carry whole is answered with RESULT_TOO_LARGE instead.
        const reply = encodeDataChannelMcpReply(rpc, rpcRes);
        if (reply.oversizeCodeUnits !== undefined) {
          console.warn(
            `[WebMCP] A ${reply.oversizeCodeUnits}-code-unit DataChannel reply exceeds the ` +
              `${MAX_DATA_CHANNEL_FRAME_CHARS}-code-unit message limit; ` +
              (reply.frame !== undefined ? "answered RESULT_TOO_LARGE instead." : "dropped it."),
          );
        }
        if (reply.frame !== undefined) await this.sendFrame(channel, reply.frame);
      }
    }
  }

  /** {@link handleMcpRpc}, except that an unexpected exception still answers the request. */
  private async answerMcpRpc(
    rpc: unknown,
    generation: number,
    channel: McpRequestChannel,
    sessionId?: string,
  ): Promise<ProviderRpcResponse | null> {
    try {
      return await this.handleMcpRpc(rpc, generation, channel, sessionId);
    } catch (error) {
      console.error("[WebMCP] MCP request handling failed:", error);
      const id = rpcRequestId(rpc);
      return id === undefined ? null : { jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error" } };
    }
  }

  /**
   * Answers one JSON-RPC request. tools/list and server/discover list the live host catalog to a
   * DataChannel agent, which talks to the provider directly; on the relay socket they list the
   * catalog the relay holds (see {@link relayCatalogTools}), since a relay that holds none takes
   * their tools as its catalog.
   *
   * `initialize` negotiates its revision on every channel as the relay's HTTP route does
   * ({@link negotiateInitializeProtocolVersion}): the requested initialize-era revision, otherwise
   * 2025-11-25, never 2026-07-28, which has no `initialize`. A server/discover the relay forwards
   * reports the same negotiation within those revisions, as the relay's own discover result does, so
   * an agent gets the same negotiation whether the provider or the relay answers; over the DataChannel
   * it reports 2026-07-28 and every revision the provider speaks.
   *
   * A request on the relay socket is served only for the session this provider approved: the
   * `sessionId` the relay stamped on it (R-SIG-005) must be that session's. The relay issues one
   * client ticket per room (its invite is single-use), so a request of any other session, or one
   * without the stamp, is one the provider never approved.
   */
  private async handleMcpRpc(
    rpc: unknown,
    generation: number,
    channel: McpRequestChannel,
    sessionId?: string,
  ): Promise<ProviderRpcResponse | null> {
    if (!isJsonObject(rpc) || rpc.jsonrpc !== "2.0") return null;
    if (rpc.id === undefined) return null;
    // An id that is not a string or a number, null included (MCP: an id MUST NOT be null), makes
    // the message an invalid request, which is answered and never run.
    const id = rpcRequestId(rpc);
    if (id === undefined) {
      return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
    }
    if (generation !== this.connectionGeneration) {
      return { jsonrpc: "2.0", id, error: peerRpcError("PEER_SESSION_SUPERSEDED") };
    }

    // An agent the relay let through but this provider has not approved (an HTTP approval, a
    // reattach before `approval.restored`, a session other than the approved one) gets the relay's
    // own error for a ticket waiting for approval, code included.
    if (this.approvalState !== "approved" || (channel === "relay" && sessionId !== this.approvalSessionId)) {
      return { jsonrpc: "2.0", id, error: peerRpcError("CLIENT_APPROVAL_REQUIRED") };
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
      // The relay's own error for a request for a catalog it does not have, whose `catalogSource`
      // names the catalog that is missing: here the one this provider registers.
      if ("unavailable" in catalog) {
        return { jsonrpc: "2.0", id, error: peerRpcError("CATALOG_UNAVAILABLE", { catalogSource: "provider", reason: catalog.unavailable }) };
      }
      if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: catalog.tools } };
      const protocolVersion = channel === "relay" ? negotiateInitializeProtocolVersion(rpc.params) : MCP_PROTOCOL_VERSION;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          supportedProtocolVersions: channel === "relay" ? MCP_INITIALIZE_PROTOCOL_VERSIONS : MCP_PROTOCOL_VERSIONS,
          capabilities: { tools: { listChanged: true }, stateless: true },
          serverInfo: { name: serverInfo.name, version: serverInfo.version },
          instructions:
            serverInfo.instructions ??
            `Wireframe Storyboard Toolkit authoring and inspection tools (MCP ${protocolVersion} Stateless spec).`,
          tools: catalog.tools,
        },
      };
    }

    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: negotiateInitializeProtocolVersion(rpc.params),
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
    id: JsonRpcRequestId,
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
        return { jsonrpc: "2.0", id, error: peerRpcError("OUTCOME_UNKNOWN") };
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
        return { jsonrpc: "2.0", id, error: peerRpcError("OUTCOME_UNKNOWN") };
      }
      this.aiRuns.settleAction(runId, requestId);
      if (controller.signal.aborted) this.aiRuns.stop(runId, "stopped by host");
      else if (explicitRunId) this.aiRuns.fail(runId, message);
      const updated = this.aiRuns.get(runId);
      if (updated) this.publishAiRunAwareness(updated);
      return { jsonrpc: "2.0", id, result: toolErrorResult({ code: -32603, message }) };
    }
  }

  /**
   * Sends one frame over the DataChannel, `payload` or its JSON text, in chunks of
   * DATA_CHANNEL_SEND_CHUNK_CHARS UTF-16 code units, the framing an agent takes (at most
   * MAX_DATA_CHANNEL_CHUNKS chunks of at most MAX_DATA_CHANNEL_CHUNK_CHARS each). A frame longer than
   * MAX_DATA_CHANNEL_FRAME_CHARS would need more chunks than the agent assembles, so it is not sent,
   * with a warning; a reply is first replaced to fit (see `encodeDataChannelMcpReply`). Nothing is
   * sent on a channel that is not open.
   */
  private async sendFrame(channel: RTCDataChannel, payload: unknown): Promise<void> {
    if (channel.readyState !== "open") return;
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (text.length > MAX_DATA_CHANNEL_FRAME_CHARS) {
      console.warn(
        `[WebMCP] The ${text.length}-code-unit DataChannel frame exceeds the ` +
          `${MAX_DATA_CHANNEL_FRAME_CHARS}-code-unit message limit; it was not sent.`,
      );
      return;
    }
    const total = Math.max(1, Math.ceil(text.length / DATA_CHANNEL_SEND_CHUNK_CHARS));
    const id = ++this.frameSeq;

    for (let index = 0; index < total; index++) {
      const data = text.slice(index * DATA_CHANNEL_SEND_CHUNK_CHARS, (index + 1) * DATA_CHANNEL_SEND_CHUNK_CHARS);
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

  /**
   * Approves the pending request `requestId`. The provider is `approved` as soon as the decision is
   * sent, without waiting for the relay's echo (a `send` the relay may skip when this socket is
   * behind); a relay that refuses the decision with INVALID_APPROVAL undoes it (see
   * {@link undoRefusedDecision}).
   */
  approveClient(requestId = this.approvalRequestId): boolean {
    if (!requestId || this.approvalState !== "pending" || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    if (!this.sendApprovalDecision(this.ws, requestId, "approved")) return false;
    this.sentDecision = { requestId, decision: "approved" };
    this.clearDecisionError();
    this.approvalState = "approved";
    this.notify();
    return true;
  }

  /** Rejects the pending request `requestId`; like {@link approveClient}, a refused rejection is undone. */
  rejectClient(requestId = this.approvalRequestId): boolean {
    if (!requestId || this.approvalState !== "pending" || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    if (!this.sendApprovalDecision(this.ws, requestId, "rejected", "CLIENT_REJECTED")) return false;
    this.sentDecision = { requestId, decision: "rejected" };
    this.clearDecisionError();
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
      // The relay checks a roomEpoch it is sent (ROOM_BINDING_INVALID), so one the provider does
      // not know is left out rather than guessed.
      body: JSON.stringify({
        roomId: previousRoomId,
        ...(this.roomEpoch !== null ? { roomEpoch: this.roomEpoch } : {}),
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
    this.sentDecision = null;
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
          // Like refreshRoom: a roomEpoch the relay is sent must be the room's (SESSION_BINDING_INVALID),
          // so one the provider does not know is left out rather than guessed.
          body: JSON.stringify({
            roomId: revokeRoomId,
            ...(this.roomEpoch !== null ? { roomEpoch: this.roomEpoch } : {}),
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
    this.offerRequestId = null;
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
    this.sentDecision = null;
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
