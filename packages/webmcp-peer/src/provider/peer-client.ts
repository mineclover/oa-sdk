import {
  AiRunController,
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
  private expiryTimer?: any;
  private lastConnectOptions?: WebMcpPeerConnectOptions;

  private ws?: WebSocket;
  private providerToken: string | null = null;
  private pc?: RTCPeerConnection;
  private dataChannel?: RTCDataChannel;
  private listeners = new Set<(session: WebMcpPeerSessionInfo) => void>();
  private pingTimer?: any;
  private reconnectTimer?: any;
  private reconnectAttempts = 0;

  private activeTransport?: WebMcpCrdtTransport;
  private crdtListeners = new Set<(message: unknown) => void>();
  private detachTransportCarrier?: () => void;

  private frameSeq = 0;
  private framePending = new Map<number, { total: number; parts: string[]; received: number }>();
  private hostAdapter?: WebMcpHostAdapter;
  private shouldSuppressAutoReconnect: (location: { search?: string; pathname?: string }) => boolean;

  constructor(options: WebMcpPeerClientOptions = {}) {
    this.hostAdapter = options.hostAdapter;
    this.shouldSuppressAutoReconnect =
      options.shouldSuppressAutoReconnect ?? defaultShouldSuppressAutoReconnect;
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
   */
  syncTools(): boolean {
    const ws = this.ws;
    let sent = false;
    if (ws && ws.readyState === 1) {
      try {
        const rawTools = this.resolveHostAdapter()?.listTools?.() || [];
        ws.send(
          JSON.stringify({
            type: "register",
            alias: this.alias,
            tools: rawTools.map(toWireToolDescriptor),
          }),
        );
        sent = true;
      } catch {}
    }
    this.notify();
    return sent;
  }

  private resolveHostAdapter(): WebMcpHostAdapter | undefined {
    return this.hostAdapter ?? (globalThis as any).Framebook?.webMCP;
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
      const raw = localStorage.getItem(this.leaseStorageKey(serverUrl));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<SavedRoomLease>;
      const parsedRoomEpoch = parsed.roomEpoch;
      if (
        typeof parsed.serverUrl !== "string" ||
        typeof parsed.roomId !== "string" ||
        typeof parsed.leaseToken !== "string" ||
        !parsed.leaseToken ||
        !Number.isSafeInteger(parsedRoomEpoch) ||
        (parsedRoomEpoch as number) < 0 ||
        typeof parsed.expiresAt !== "number" ||
        !Number.isFinite(parsed.expiresAt)
      ) {
        return null;
      }
      if (parsed.expiresAt <= Date.now()) {
        localStorage.removeItem(this.leaseStorageKey(serverUrl));
        return null;
      }
      return parsed as SavedRoomLease;
    } catch {
      return null;
    }
  }

  private saveRoomLease(serverUrl: string, descriptor: Record<string, unknown>): void {
    const leaseToken = typeof descriptor.reconnectToken === "string" ? descriptor.reconnectToken : "";
    const roomId =
      typeof descriptor.roomId === "string"
        ? descriptor.roomId
        : typeof descriptor.id === "string"
          ? descriptor.id
          : "";
    const roomEpoch = typeof descriptor.roomEpoch === "number" ? descriptor.roomEpoch : -1;
    const expiresAt =
      typeof descriptor.reconnectTokenExpiresAt === "number"
        ? descriptor.reconnectTokenExpiresAt
        : typeof descriptor.expiresAt === "number"
          ? descriptor.expiresAt
          : 0;
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
          ...(typeof descriptor.alias === "string" ? { alias: descriptor.alias } : {}),
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
        if (result?.ok && result?.receipt?.status && result.receipt.status !== "outcome-unknown") {
          return "rolled-back" as const;
        }
        return result?.error?.code === "OUTCOME_UNKNOWN" || result?.receipt?.status === "outcome-unknown"
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

  async autoReconnectIfSaved(): Promise<boolean> {
    try {
      if (typeof window === "undefined" || this.shouldSuppressAutoReconnect(window.location ?? {})) {
        return false;
      }
      const auto = localStorage.getItem("webmcp:auto-reconnect");
      if (auto === "false") return false;

      const serverUrl = localStorage.getItem("webmcp:server-url");
      if (!serverUrl) return false;

      const alias = localStorage.getItem("webmcp:peer-alias") || this.alias;
      const publishKey = localStorage.getItem("webmcp:publish-key") || "local-development-only";
      const savedCrdt = localStorage.getItem("webmcp:crdt-enabled") === "true";

      const savedWrite = localStorage.getItem("webmcp:write-enabled");
      if (savedWrite !== "false") {
        this.setWriteEnabled(true);
      }

      console.log(`[WebMCP] Auto-reconnecting peer '${alias}' to ${serverUrl}...`);
      await this.connect({
        serverUrl,
        alias,
        publishKey,
        autoReconnect: true,
        enableWrite: savedWrite !== "false",
        enableCrdt: savedCrdt,
        reclaimLease: true,
      });
      return true;
    } catch (err: any) {
      console.warn("[WebMCP] Auto-reconnect failed or skipped:", err.message);
      return false;
    }
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

    let base = options.serverUrl.replace(/\/+$/, "");
    if (!base.startsWith("http://") && !base.startsWith("https://")) {
      base = `http://${base}`;
    }
    this.serverUrl = base;
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
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}: Failed to create signaling room`);
      }

      const created = await res.json();
      if (generation !== this.connectionGeneration) throw new Error("PEER_SESSION_SUPERSEDED");
      return this.attachCreatedRoom(created, options, generation);
    } catch (err: any) {
      if (generation !== this.connectionGeneration) throw err;
      this.state = "error";
      const raw = err.message || "Connection failed";
      if (raw.includes("Failed to fetch") || err.name === "TypeError") {
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
      const response = await fetch(`${this.serverUrl}/p/${encodeURIComponent(lease.roomId)}/reclaim`, {
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
        const reclaimed = await response.json();
        if (
          !reclaimed ||
          typeof reclaimed.providerToken !== "string" ||
          typeof reclaimed.descriptorUrl !== "string"
        ) {
          throw new Error("INVALID_RECLAIMED_ROOM_DESCRIPTOR");
        }
        return this.attachCreatedRoom(reclaimed, options, generation);
      }
      if (response.status === 409) {
        const body = await response.json().catch(() => ({}));
        if (body?.error === "ROOM_PROVIDER_ACTIVE" && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
          continue;
        }
        if (body?.error === "ROOM_PROVIDER_ACTIVE") throw new Error("ROOM_PROVIDER_ACTIVE");
      }
      if (response.status === 401 || response.status === 404 || response.status === 410) {
        this.clearSavedRoomLease(this.serverUrl);
      }
      return null;
    }
    return null;
  }

  private async attachCreatedRoom(
    created: any,
    options: WebMcpPeerConnectOptions,
    generation: number,
  ): Promise<string> {
    if (generation !== this.connectionGeneration) throw new Error("PEER_SESSION_SUPERSEDED");
    if (
      !created ||
      typeof created.id !== "string" ||
      typeof created.providerToken !== "string" ||
      typeof created.descriptorUrl !== "string"
    ) {
      throw new Error("INVALID_ROOM_DESCRIPTOR");
    }
    this.roomId = created.id;
    this.providerToken = created.providerToken;
    this.saveRoomLease(this.serverUrl, created);
    this.roomEpoch = typeof created.roomEpoch === "number" ? created.roomEpoch : null;
    this.crdtCapabilityEnabled =
      options.enableCrdt === true &&
      Array.isArray(created.capabilities) &&
      created.capabilities.includes("mcp-crdt");
    if (!this.carrierSessionId) this.carrierSessionId = `carrier-${this.replicaId}-${generation}`;
    this.bindActiveTransport();
    this.invitationUrl = `${created.descriptorUrl}#invite=${created.inviteToken}`;
    const serverExpiry = Number(created.expiresAt);
    this.expiresAt =
      Number.isFinite(serverExpiry) && serverExpiry > Date.now() ? serverExpiry : Date.now() + 30 * 60000;
    this.approvalState = "none";
    this.scheduleExpiry(generation, this.expiresAt);

    const wsUrl = `${this.serverUrl.replace(/^http/, "ws")}/p/${created.id}/provider`;
    const ws = new WebSocket(wsUrl, ["webmcp-peer.v1", `ticket.${created.providerToken}`]);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Signaling connection timeout")), 10000);
      ws.onmessage = (event) => {
        try {
          const m = JSON.parse(event.data);
          if (m.type === "ready") {
            clearTimeout(timer);
            this.state = "waiting";
            this.connectedAt = null;
            this.reconnectAttempts = 0;
            this.startKeepalive(ws);
            this.notify();
            try {
              const rawTools = this.resolveHostAdapter()?.listTools?.() || [];
              ws.send(
                JSON.stringify({
                  type: "register",
                  alias: this.alias,
                  tools: rawTools.map(toWireToolDescriptor),
                }),
              );
            } catch {}
            resolve();
          }
        } catch {}
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

    this.listenSignaling(ws, created.id, created.providerToken, options.iceServers, generation);
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
        const msg = JSON.parse(event.data);
        if (!msg || typeof msg.type !== "string") return;

        if (msg.type === "pong") return;

        if (msg.type === "mcp" && msg.message) {
          const rpcRes = await this.handleMcpRpc(msg.message);
          if (rpcRes && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "mcp", message: rpcRes }));
          }
          return;
        }

        if (msg.type === "approval.request") {
          const payload = msg.payload && typeof msg.payload === "object" ? msg.payload : msg;
          activeRequestId = String(payload.requestId || msg.requestId || "");
          this.clientLabel = payload.clientLabel || "AI Agent";
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
          this.setupPeerConnection(ws, msg.requestId || activeRequestId, iceServers, generation);
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
          if (!this.pc) {
            this.setupPeerConnection(ws, msg.requestId || activeRequestId, iceServers, generation);
          }
          const pc = this.pc!;
          await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
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

          ws.send(
            JSON.stringify({
              type: "answer",
              requestId: msg.requestId || activeRequestId,
              sdp: pc.localDescription?.sdp || answer.sdp,
            }),
          );
        }
      } catch (err: any) {
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
      if (this.autoReconnect && this.approvalState !== "expired" && this.state !== "idle") {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts - 1), 15000);
        console.log(`[WebMCP] WebSocket disconnected. Scheduling auto-reconnect in ${Math.round(delay)}ms...`);
        this.reconnectTimer = setTimeout(() => {
          void this.autoReconnectIfSaved();
        }, delay);
      }
    };
  }

  private startKeepalive(ws: WebSocket): void {
    this.stopKeepalive();
    this.pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
        } catch {}
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
    rawData: string,
    generation = this.connectionGeneration,
  ): void {
    if (
      generation !== this.connectionGeneration ||
      this.dataChannel !== channel ||
      this.approvalState !== "approved"
    ) {
      return;
    }
    try {
      const frame = JSON.parse(rawData);
      if (!frame || frame.v !== 1) return;
      if (
        !Number.isSafeInteger(frame.id) ||
        !Number.isSafeInteger(frame.total) ||
        frame.total <= 0 ||
        frame.total > 512
      ) {
        return;
      }
      if (!Number.isSafeInteger(frame.index) || frame.index < 0 || frame.index >= frame.total) return;
      if (typeof frame.data !== "string" || frame.data.length > 16384) return;

      let pending = this.framePending.get(frame.id);
      if (!pending) {
        if (this.framePending.size > 50) this.framePending.clear();
        pending = { total: frame.total, parts: new Array(frame.total), received: 0 };
        this.framePending.set(frame.id, pending);
      }

      if (pending.parts[frame.index] === undefined) {
        pending.parts[frame.index] = frame.data;
        pending.received++;
      }

      if (pending.received === pending.total) {
        this.framePending.delete(frame.id);
        const fullText = pending.parts.join("");
        const msg = JSON.parse(fullText);
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
    msg: any,
    generation = this.connectionGeneration,
  ): Promise<void> {
    if (!msg || typeof msg.type !== "string") return;
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
      const expiresAt = this.expiresAt ?? Date.now() + 30 * 60000;
      this.connectedAt = Date.now();
      this.expiresAt = expiresAt;
      this.scheduleExpiry(this.connectionGeneration, expiresAt);
      this.state = "connected";
      this.notify();

      await this.sendFrame(channel, {
        type: "grant",
        protocol: "webmcp-peer/1",
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
          ws.send(JSON.stringify({ type: "release", requestId }));
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
      if (this.activeTransport && rpc.method === "tools/call") {
        try {
          this.introduceRemotePeer(
            this.activeTransport,
            rpc.params?.arguments,
            rpc.params?._meta?.framebook?.aiTrace,
          );
        } catch {}
      }

      const rpcRes = await this.handleMcpRpc(rpc, generation);
      if (rpcRes) {
        await this.sendFrame(channel, {
          type: "mcp",
          message: rpcRes,
        });
      }
    }
  }

  private async handleMcpRpc(rpc: any, generation = this.connectionGeneration): Promise<any> {
    if (!rpc || rpc.jsonrpc !== "2.0") return null;
    const id = rpc.id;
    if (generation !== this.connectionGeneration) {
      return { jsonrpc: "2.0", id, error: { code: -32008, message: "PEER_SESSION_SUPERSEDED" } };
    }

    if (id === undefined) return null;

    if (this.approvalState !== "approved") {
      return { jsonrpc: "2.0", id, error: { code: -32003, message: "CLIENT_APPROVAL_REQUIRED" } };
    }

    const webMcp = this.resolveHostAdapter();
    const serverInfo = webMcp?.getServerInfo?.() ?? {
      name: "wireframe-storyboard-toolkit",
      version: "0.4.2",
    };

    if (rpc.method === "server/discover") {
      const tools = webMcp?.listTools?.() || [];
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
          tools: tools.map(toWireToolDescriptor),
        },
      };
    }

    if (rpc.method === "initialize") {
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

    if (rpc.method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    if (rpc.method === "tools/list") {
      const tools = webMcp?.listTools?.() || [];
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: tools.map(toWireToolDescriptor),
        },
      };
    }

    if (rpc.method === "tools/call") {
      const name = rpc.params?.name;
      const args = rpc.params?.arguments || {};
      const trace = rpc.params?._meta?.framebook?.aiTrace;
      const runId =
        typeof trace?.runId === "string" && trace.runId.trim() && trace.runId.trim().length <= 128
          ? trace.runId.trim()
          : `remote-webmcp-${this.roomId ? this.roomId.slice(0, 6) : "remote"}`;
      const stepIndex =
        Number.isSafeInteger(trace?.stepIndex) && trace.stepIndex >= 0 ? trace.stepIndex : 0;
      const requestId = `rpc-${generation}-${runId}-${++this.carrierMessageSequence}`;
      const durableRequestId =
        args?.context && typeof args.context.requestId === "string" ? args.context.requestId : undefined;
      if (this.aiRunLedger && durableRequestId) {
        const previous = await this.aiRunLedger.find(runId, durableRequestId);
        if (previous?.status === "outcome-unknown") {
          const error = {
            code: "RECONCILIATION_REQUIRED",
            message: "AI write outcome is unknown; reconcile its durable receipt before retrying.",
          };
          return {
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              content: [],
              structuredContent: { ok: false, error },
              data: { ok: false, error },
              error,
            },
          };
        }
        if (
          previous?.status === "durable" ||
          previous?.status === "replicating" ||
          previous?.status === "replicated"
        ) {
          const replay = { ok: true, receipt: previous.receipt, data: { replayed: true } };
          return {
            jsonrpc: "2.0",
            id,
            result: { isError: false, content: [], structuredContent: replay, data: replay },
          };
        }
      }
      const controller = new AbortController();
      const runSnapshot = this.aiRuns.begin(runId, typeof name === "string" ? name : "tools/call", stepIndex);
      if (
        runSnapshot.phase === "stopped" ||
        runSnapshot.phase === "completed" ||
        runSnapshot.phase === "failed" ||
        runSnapshot.phase === "rolled-back"
      ) {
        const error = { code: "AI_RUN_TERMINAL", message: "This AI run is already terminal." };
        return {
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [],
            structuredContent: { ok: false, error },
            data: { ok: false, error },
            error,
          },
        };
      }
      this.aiRuns.registerAction(runId, requestId, controller);
      try {
        const res = await webMcp?.invoke?.(name, args, { signal: controller.signal });
        const isObj = typeof res === "object" && res !== null;
        const structured = isObj ? res : { value: res };
        const receipt = isObj ? res.receipt : undefined;
        const operationId =
          receipt &&
          (receipt.status === "durable" ||
            receipt.status === "replicating" ||
            receipt.status === "replicated") &&
          typeof receipt.operationId === "string" &&
          receipt.operationId.trim()
            ? receipt.operationId
            : undefined;
        const transactionId =
          receipt && typeof receipt.transactionId === "string" && receipt.transactionId.trim()
            ? receipt.transactionId
            : undefined;
        if (this.aiRunLedger && isCommitReceipt(receipt)) {
          try {
            await this.aiRunLedger.recordReceipt({
              runId,
              actionId: typeof name === "string" ? name : "tools/call",
              stepIndex,
              receipt,
            });
          } catch (error) {
            console.warn("[WebMCP] AI run ledger rejected receipt:", error);
          }
        }
        if (generation !== this.connectionGeneration || !this.aiRuns.get(runId)) {
          return { jsonrpc: "2.0", id, error: { code: -32008, message: "OUTCOME_UNKNOWN" } };
        }
        this.aiRuns.settleAction(runId, requestId);
        this.aiRuns.recordStep(runId, {
          actionId: typeof name === "string" ? name : "tools/call",
          stepIndex,
          ...(operationId ? { operationId } : {}),
          ...(transactionId ? { transactionId } : {}),
          ...(isCommitReceipt(receipt) ? { requestId: receipt.requestId } : {}),
        });
        if (controller.signal.aborted) this.aiRuns.stop(runId, "stopped by host");
        else if (isObj && "ok" in res && !res.ok) {
          this.aiRuns.fail(runId, res.error?.message ?? "Tool call failed");
        } else if (trace?.phase === "completed") this.aiRuns.complete(runId);
        this.publishAiRunAwareness(this.aiRuns.get(runId)!);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [],
            structuredContent: structured,
            data: structured,
            isError: isObj && "ok" in res ? !res.ok : false,
          },
        };
      } catch (err: any) {
        const currentRun = this.aiRuns.get(runId);
        if (generation === this.connectionGeneration && currentRun) {
          this.aiRuns.settleAction(runId, requestId);
          if (controller.signal.aborted) this.aiRuns.stop(runId, "stopped by host");
          else this.aiRuns.fail(runId, err.message || "Tool execution error");
          const updated = this.aiRuns.get(runId);
          if (updated) this.publishAiRunAwareness(updated);
        } else {
          return { jsonrpc: "2.0", id, error: { code: -32008, message: "OUTCOME_UNKNOWN" } };
        }
        const errPayload = {
          ok: false,
          error: {
            code: -32603,
            message: err.message || "Tool execution error",
          },
        };
        return {
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [],
            structuredContent: errPayload,
            data: errPayload,
            error: {
              code: -32603,
              message: err.message || "Tool execution error",
            },
          },
        };
      }
    }

    return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
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

    this.detachTransportCarrier = transport.attachCarrier((msg) => {
      void this.sendCrdt(msg);
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

  private introduceRemotePeer(transport: WebMcpCrdtTransport, toolArgs?: any, trace?: any): void {
    if (this.roomEpoch !== null && !this.crdtCapabilityEnabled) return;
    const peerClientId = `webmcp-${this.roomId ? this.roomId.slice(0, 6) : "remote"}`;
    const slideId = toolArgs?.slideId;
    const nodeIds = toolArgs?.nodeId
      ? [toolArgs.nodeId].filter(
          (value: unknown): value is string => typeof value === "string" && value.length <= 128,
        )
      : Array.isArray(toolArgs?.nodeIds)
        ? toolArgs.nodeIds
            .filter((value: unknown): value is string => typeof value === "string" && value.length <= 128)
            .slice(0, 64)
        : undefined;
    const x = typeof toolArgs?.x === "number" ? toolArgs.x : undefined;
    const y = typeof toolArgs?.y === "number" ? toolArgs.y : undefined;
    const runId =
      typeof trace?.runId === "string" && trace.runId.length > 0 && trace.runId.length <= 128
        ? trace.runId
        : `remote-${peerClientId}`;
    const actionId =
      typeof trace?.actionId === "string" && trace.actionId.length > 0 && trace.actionId.length <= 128
        ? trace.actionId
        : "tools/call";
    const stepIndex =
      Number.isInteger(trace?.stepIndex) && trace.stepIndex >= 0 ? trace.stepIndex : 0;
    const operationId =
      typeof trace?.operationId === "string" && trace.operationId.length > 0
        ? trace.operationId
        : undefined;
    const phase =
      trace?.phase === "queued" ||
      trace?.phase === "running" ||
      trace?.phase === "paused" ||
      trace?.phase === "stopped" ||
      trace?.phase === "completed" ||
      trace?.phase === "failed" ||
      trace?.phase === "rolled-back"
        ? trace.phase
        : "running";
    const rawTrail = Array.isArray(trace?.cursorTrail)
      ? trace.cursorTrail
      : Array.isArray(trace?.path)
        ? trace.path
        : [];
    const cursorTrail = rawTrail.slice(-64).flatMap((point: any) => {
      const pointSlide = typeof point?.slideId === "string" ? point.slideId : slideId;
      const pointX = typeof point?.x === "number" ? point.x : undefined;
      const pointY = typeof point?.y === "number" ? point.y : undefined;
      const pointStep =
        Number.isInteger(point?.stepIndex) && point.stepIndex >= 0 ? point.stepIndex : stepIndex;
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
    this.sendApprovalDecision(requestId, "approved");
    this.approvalState = "approved";
    this.notify();
    return true;
  }

  rejectClient(requestId = this.approvalRequestId): boolean {
    if (!requestId || this.approvalState !== "pending" || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.sendApprovalDecision(requestId, "rejected", "CLIENT_REJECTED");
    this.approvalState = "revoked";
    this.approvalRequestId = null;
    this.notify();
    return true;
  }

  private sendApprovalDecision(requestId: string, decision: "approved" | "rejected", reason?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const now = new Date().toISOString();
    this.ws.send(
      JSON.stringify({
        protocol: "webmcp-peer/1",
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
      }),
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

    const response = await fetch(`${this.serverUrl.replace(/\/+$/, "")}/p/${previousRoomId}/rotate`, {
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
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${response.status}: Failed to rotate peer room`);
    }
    const replacement = await response.json();
    this.disconnect();
    const generation = ++this.connectionGeneration;
    this.roomGeneration += 1;
    this.carrierSessionId = `carrier-${this.replicaId}-${generation}`;
    this.remoteCarrierReplicaId = null;
    this.receivedCarrierMessages.clear();
    this.lastConnectOptions = nextOptions;
    this.serverUrl = nextOptions.serverUrl.replace(/\/+$/, "").replace(/^(?!https?:\/\/)/i, "http://");
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
        `${this.serverUrl.replace(/\/+$/, "")}/p/${revokeRoomId}/sessions/${encodeURIComponent(revokeSessionId)}/revoke`,
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
