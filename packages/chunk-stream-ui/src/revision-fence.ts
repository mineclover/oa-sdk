import type { PlaybackSnapshot } from "./types.js";

let uidCounter = 0;
function defaultUid(prefix = "req"): string {
  return `${prefix}_${Date.now().toString(36)}_${(++uidCounter).toString(36)}`;
}

export type RequestStatus = "pending" | "completed" | "cancelled" | "timeout" | "stale" | "failed";

export interface RevisionReceipt {
  readonly requestId: string;
  readonly revision: string;
  readonly sequence: number;
  readonly status: RequestStatus;
  readonly current: boolean;
  readonly committed: boolean;
  readonly cancelledAfterCommit: boolean;
  readonly staleAfterCommit: boolean;
  readonly reason?: string | undefined;
}

export interface BeginRequestOptions {
  readonly revision?: string | undefined;
  readonly requestId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
}

/** Request state shared with its RevisionRequest handle. */
interface RevisionState {
  readonly requestId: string;
  readonly controller: AbortController;
  readonly sequence: number;
  readonly expectedRevision: string;
  status: RequestStatus;
  reason?: string | undefined;
  committed: boolean;
  cancelledAfterCommit: boolean;
  staleAfterCommit: boolean;
  terminalCurrent: boolean;
  commitRevision?: string | undefined;
  detachExternal?: (() => void) | undefined;
}

interface RevisionRecord extends RevisionState {
  readonly request: RevisionRequest;
}

export class RevisionRequest {
  constructor(private readonly owner: RevisionFence, private readonly record: RevisionState) {}

  get requestId(): string { return this.record.requestId; }
  get id(): string { return this.record.requestId; }
  get revision(): string { return this.record.expectedRevision; }
  get sequence(): number { return this.record.sequence; }
  get signal(): AbortSignal { return this.record.controller.signal; }
  get status(): RequestStatus { return this.record.status; }
  get committed(): boolean { return this.record.committed; }
  get cancelledAfterCommit(): boolean { return this.record.cancelledAfterCommit; }
  get staleAfterCommit(): boolean { return this.record.staleAfterCommit; }

  isCurrent(): boolean { return this.owner.isCurrent(this); }
  complete(): RevisionReceipt { return this.owner.complete(this); }
  cancel(reason = "cancelled"): RevisionReceipt { return this.owner.cancel(this, reason); }
  timeout(reason = "timeout"): RevisionReceipt { return this.owner.timeout(this, reason); }
  fail(reason = "failed"): RevisionReceipt { return this.owner.fail(this, reason); }
  markCommitted(): boolean { return this.owner.markCommitted(this); }
  commit(): boolean { return this.markCommitted(); }
  receipt(): RevisionReceipt { return this.owner.receipt(this); }
}

export interface RevisionFenceOptions {
  readonly initialRevision?: string | undefined;
  readonly getRevision?: (() => string) | undefined;
  readonly idFactory?: ((prefix: string) => string) | undefined;
}

function normalizeRevision(value: string | undefined): string {
  return typeof value === "string" && value.length > 0 ? value : "revision:initial";
}

function normalizeBegin(value?: string | BeginRequestOptions | undefined, options?: BeginRequestOptions | undefined): BeginRequestOptions {
  if (typeof value === "string") return { ...options, revision: value };
  return { ...value, ...options };
}

export class RevisionFence {
  private readonly source?: (() => string) | undefined;
  private manualRevision: string;
  private readonly idFactory: (prefix: string) => string;
  private sequence = 0;
  private latest?: RevisionRequest | undefined;
  private readonly records = new Map<string, RevisionRecord>();

  constructor(initial?: string | (() => string) | undefined, options: RevisionFenceOptions = {}) {
    if (typeof initial === "function") {
      this.source = initial;
      this.manualRevision = normalizeRevision(options.initialRevision);
    } else {
      this.manualRevision = normalizeRevision(initial ?? options.initialRevision);
      this.source = options.getRevision;
    }
    this.idFactory = options.idFactory ?? ((prefix: string) => defaultUid(prefix));
  }

  get revision(): string {
    if (!this.source) return this.manualRevision;
    try {
      return normalizeRevision(this.source());
    } catch {
      return this.manualRevision;
    }
  }

  get currentRevision(): string { return this.revision; }
  get latestRequest(): RevisionRequest | undefined { return this.latest; }

  setRevision(revision: string): void {
    this.manualRevision = normalizeRevision(revision);
    for (const record of this.records.values()) {
      if (record.status === "pending" && record.expectedRevision !== this.revision) {
        this.transition(record, "stale", "revision changed");
      }
    }
  }

  begin(value?: string | BeginRequestOptions | undefined, options?: BeginRequestOptions | undefined): RevisionRequest {
    const config = normalizeBegin(value, options);
    const expectedRevision = normalizeRevision(config.revision ?? this.revision);
    const requestId = config.requestId && config.requestId.length > 0 ? config.requestId : this.idFactory("action-request");
    const seq = ++this.sequence;
    const controller = new AbortController();

    const existing = this.records.get(requestId);
    const finalId = existing && existing.status === "pending" ? `${requestId}:${seq}` : requestId;
    const state: RevisionState = {
      controller,
      sequence: seq,
      expectedRevision,
      status: "pending",
      committed: false,
      cancelledAfterCommit: false,
      staleAfterCommit: false,
      terminalCurrent: true,
      requestId: finalId,
    };
    const request = new RevisionRequest(this, state);
    // Object.assign keeps the identity the request handle already references.
    const record: RevisionRecord = Object.assign(state, { request });
    this.records.set(finalId, record);

    const previous = this.latest;
    if (previous && previous.status === "pending") {
      const previousRecord = this.records.get(previous.requestId);
      if (previousRecord) this.transition(previousRecord, "stale", "superseded by a newer request");
    }
    this.latest = request;

    if (config.signal) {
      const onAbort = (): void => {
        this.cancel(request, typeof config.signal?.reason === "string" ? config.signal.reason : "cancelled");
      };
      config.signal.addEventListener("abort", onAbort, { once: true });
      record.detachExternal = () => config.signal?.removeEventListener("abort", onAbort);
      if (config.signal.aborted) onAbort();
    }
    if (config.timeoutMs !== undefined) {
      const timeout = config.timeoutMs;
      if (!Number.isFinite(timeout) || timeout < 0) this.timeout(request, "invalid timeout");
      else if (timeout === 0) this.timeout(request, "timeout");
      else {
        const timer = setTimeout(() => this.timeout(request, "timeout"), timeout);
        const oldDetach = record.detachExternal;
        record.detachExternal = () => { oldDetach?.(); clearTimeout(timer); };
      }
    }
    if (expectedRevision !== this.revision && record.status === "pending") {
      this.transition(record, "stale", "revision mismatch");
    }
    return request;
  }

  isCurrent(value: RevisionRequest | string): boolean {
    const request = typeof value === "string" ? this.records.get(value)?.request : value;
    if (!request) return false;
    const record = this.records.get(request.requestId);
    return !!record && record.status === "pending" && this.latest === request &&
      record.expectedRevision === this.revision && record.terminalCurrent;
  }

  markCommitted(value: RevisionRequest | string): boolean {
    const record = this.record(value);
    if (!record || record.status !== "pending" || !this.isCurrent(record.request)) return false;
    record.committed = true;
    record.commitRevision = this.revision;
    return true;
  }

  complete(value: RevisionRequest | string): RevisionReceipt {
    const record = this.record(value);
    if (!record) return this.missingReceipt(typeof value === "string" ? value : "unknown");
    if (record.committed) {
      this.transition(record, "completed", record.reason);
      return this.receipt(record.request);
    }
    if (record.status === "pending") {
      if (this.isCurrent(record.request)) this.transition(record, "completed");
      else this.transition(record, "stale", "request is no longer current");
    }
    return this.receipt(record.request);
  }

  cancel(value: RevisionRequest | string, reason = "cancelled"): RevisionReceipt {
    const record = this.record(value);
    if (!record) return this.missingReceipt(typeof value === "string" ? value : "unknown");
    if (record.committed) {
      this.transition(record, "cancelled", reason);
      return this.receipt(record.request);
    }
    if (record.status === "pending") this.transition(record, "cancelled", reason);
    return this.receipt(record.request);
  }

  timeout(value: RevisionRequest | string, reason = "timeout"): RevisionReceipt {
    const record = this.record(value);
    if (!record) return this.missingReceipt(typeof value === "string" ? value : "unknown");
    if (record.committed) {
      this.transition(record, "timeout", reason);
      return this.receipt(record.request);
    }
    if (record.status === "pending") this.transition(record, "timeout", reason);
    return this.receipt(record.request);
  }

  fail(value: RevisionRequest | string, reason = "failed"): RevisionReceipt {
    const record = this.record(value);
    if (!record) return this.missingReceipt(typeof value === "string" ? value : "unknown");
    if (record.committed) {
      record.reason = reason;
      this.transition(record, "completed", reason);
      return this.receipt(record.request);
    }
    if (record.status === "pending") this.transition(record, "failed", reason);
    return this.receipt(record.request);
  }

  receipt(value: RevisionRequest | string): RevisionReceipt {
    const record = this.record(value);
    if (!record) return this.missingReceipt(typeof value === "string" ? value : "unknown");
    return {
      requestId: record.requestId,
      revision: record.expectedRevision,
      sequence: record.sequence,
      status: record.status,
      current: record.status === "pending" ? this.isCurrent(record.request) : record.terminalCurrent,
      committed: record.committed,
      cancelledAfterCommit: record.cancelledAfterCommit,
      staleAfterCommit: record.staleAfterCommit,
      ...(record.reason !== undefined ? { reason: record.reason } : {}),
    };
  }

  private record(value: RevisionRequest | string): RevisionRecord | undefined {
    return typeof value === "string" ? this.records.get(value) : this.records.get(value.requestId);
  }

  private missingReceipt(requestId: string): RevisionReceipt {
    return {
      requestId,
      revision: this.revision,
      sequence: -1,
      status: "stale",
      current: false,
      committed: false,
      cancelledAfterCommit: false,
      staleAfterCommit: false,
      reason: "unknown request",
    };
  }

  private transition(record: RevisionRecord, status: RequestStatus, reason?: string | undefined): void {
    if (record.status !== "pending" && !(record.committed && status === "completed")) return;
    const wasCurrent = this.isCurrent(record.request);
    record.status = status;
    record.reason = reason;
    record.terminalCurrent = wasCurrent;
    if (record.committed && (status === "stale" || status === "cancelled" || status === "timeout")) {
      record.staleAfterCommit ||= status === "stale";
      record.cancelledAfterCommit ||= status === "cancelled" || status === "timeout";
      record.status = "completed";
    }
    record.detachExternal?.();
    record.detachExternal = undefined;
    if (status !== "completed") this.abort(record, reason);
  }

  private abort(record: RevisionRecord, reason?: string | undefined): void {
    if (!record.controller.signal.aborted) {
      try { record.controller.abort(reason); } catch { record.controller.abort(); }
    }
  }
}

export interface LatestRequestContext {
  readonly request: RevisionRequest;
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
  readonly markCommitted: () => boolean;
}

export interface LatestRequestResult<T> {
  readonly status: RequestStatus;
  readonly request: RevisionReceipt;
  readonly value?: T | undefined;
  readonly error?: unknown | undefined;
}

export class LatestRequestCoordinator {
  readonly fence: RevisionFence;

  constructor(source?: string | (() => string) | undefined, options: RevisionFenceOptions = {}) {
    this.fence = new RevisionFence(source, options);
  }

  get revision(): string { return this.fence.revision; }
  get latestRequest(): RevisionRequest | undefined { return this.fence.latestRequest; }
  begin(value?: string | BeginRequestOptions | undefined, options?: BeginRequestOptions | undefined): RevisionRequest {
    return this.fence.begin(value, options);
  }
  isCurrent(request: RevisionRequest | string): boolean { return this.fence.isCurrent(request); }
  markCommitted(request: RevisionRequest | string): boolean { return this.fence.markCommitted(request); }
  complete(request: RevisionRequest | string): RevisionReceipt { return this.fence.complete(request); }
  cancel(request: RevisionRequest | string, reason?: string | undefined): RevisionReceipt {
    return this.fence.cancel(request, reason);
  }
  timeout(request: RevisionRequest | string, reason?: string | undefined): RevisionReceipt {
    return this.fence.timeout(request, reason);
  }

  async run<T>(
    work: (context: LatestRequestContext) => Promise<T> | T,
    value?: string | BeginRequestOptions | undefined,
    options?: BeginRequestOptions | undefined,
  ): Promise<LatestRequestResult<T>> {
    const request = this.begin(value, options);
    if (request.status !== "pending") return { status: request.status, request: request.receipt() };
    try {
      const result = await work({
        request,
        signal: request.signal,
        isCurrent: () => request.isCurrent(),
        markCommitted: () => request.markCommitted(),
      });
      const receipt = request.complete();
      return {
        status: receipt.status,
        request: receipt,
        value: receipt.status === "completed" ? result : undefined,
      };
    } catch (error) {
      const receipt = request.status === "pending"
        ? request.fail(error instanceof Error ? error.message : "failed")
        : request.receipt();
      return { status: receipt.status, request: receipt, error };
    }
  }
}

export interface SeekRequest {
  readonly streamId: string;
  readonly revision: string;
  readonly frame: number;
  readonly cueId?: string | undefined;
}

export class SeekCoordinator {
  readonly requests: LatestRequestCoordinator;

  constructor(revision: string) {
    this.requests = new LatestRequestCoordinator(revision);
  }

  seek<T>(
    request: SeekRequest,
    work: (signal: AbortSignal) => Promise<T> | T,
    options?: Omit<BeginRequestOptions, "revision"> | undefined
  ): Promise<LatestRequestResult<T>> {
    return this.requests.run((context) => work(context.signal), {
      ...options,
      revision: request.revision,
      requestId: `seek:${request.streamId}:${request.frame}`,
    });
  }

  snapshot(request: SeekRequest): PlaybackSnapshot {
    return {
      schemaVersion: "playback.v1",
      streamId: request.streamId,
      revision: request.revision,
      frame: request.frame,
      cursor: { sequence: 0, ...(request.cueId !== undefined ? { cueId: request.cueId } : {}) },
      semanticState: {},
    };
  }
}
