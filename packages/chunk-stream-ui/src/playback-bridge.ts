import {
  createRuntimeEnvelope,
  ResidencyController,
  type ResourceLease,
  type ResidencyRecord,
  type RuntimeChunkEnvelope,
  type RuntimeChunkEnvelopeDescriptor,
} from "@oa-sdk/chunk-stream";
import type {
  ContentPort,
  PlaybackSnapshot,
  UiActionConsumeResult,
} from "./types.js";
import {
  LatestRequestCoordinator,
  type BeginRequestOptions,
  type LatestRequestResult,
} from "./revision-fence.js";
import { UiActionAdapter } from "./ui-action.js";

export interface ChunkPlaybackLoadRequest {
  readonly streamId: string;
  readonly revision: string;
  readonly frame: number;
  readonly cueId?: string | undefined;
  readonly signal: AbortSignal;
}

export type ChunkPlaybackLoadResult =
  | RuntimeChunkEnvelope
  | RuntimeChunkEnvelopeDescriptor
  | null
  | undefined;

export type ChunkPlaybackLoader = (request: ChunkPlaybackLoadRequest) =>
  Promise<ChunkPlaybackLoadResult> | ChunkPlaybackLoadResult;

export interface ChunkPlaybackPrepareContext {
  readonly frame: number;
  readonly revision: string;
  readonly cueId?: string | undefined;
  readonly signal: AbortSignal;
}

export interface ChunkPlaybackConsumeContext {
  readonly frame: number;
  readonly revision: string;
  readonly cueId?: string | undefined;
  readonly signal: AbortSignal;
  readonly previous: PlaybackSnapshot;
  readonly dispatchActions?: (() => Promise<UiActionConsumeResult>) | undefined;
}

export interface ChunkPlaybackBinding {
  readonly prepare?: ((envelope: RuntimeChunkEnvelope, context: ChunkPlaybackPrepareContext) =>
    Promise<ResourceLease> | ResourceLease) | undefined;
  readonly consume: (envelope: RuntimeChunkEnvelope, context: ChunkPlaybackConsumeContext) =>
    Promise<PlaybackSnapshot> | PlaybackSnapshot;
}

export interface ChunkPlaybackError {
  readonly code: string;
  readonly message: string;
}

export type ChunkPlaybackPhase = "idle" | "preparing" | "consuming" | "ready" | "failed" | "closed";

export interface ChunkPlaybackBridgeState {
  readonly phase: ChunkPlaybackPhase;
  readonly playback: PlaybackSnapshot;
  readonly requestedFrame: number | null;
  readonly displayedFrame: number;
  readonly inFlightFrame: number | null;
  readonly currentChunkId?: string | undefined;
  readonly error: ChunkPlaybackError | null;
}

export interface ChunkPlaybackSeekOptions {
  readonly cueId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface ChunkPlaybackSeekResult {
  readonly status: "completed" | "stale" | "failed" | "cancelled" | "timeout";
  readonly requestId: string;
  readonly playback: PlaybackSnapshot;
  readonly chunkId?: string | undefined;
  readonly error?: ChunkPlaybackError | undefined;
}

export interface ChunkPlaybackBridgeOptions {
  readonly streamId: string;
  readonly revision: string;
  readonly initialSnapshot: PlaybackSnapshot;
  readonly load: ChunkPlaybackLoader;
  readonly binding: ChunkPlaybackBinding;
  readonly contentPort?: ContentPort | undefined;
  readonly residency?: ResidencyController | undefined;
  readonly onCommit?: ((snapshot: PlaybackSnapshot, envelope: RuntimeChunkEnvelope) => void) | undefined;
  readonly onState?: ((state: ChunkPlaybackBridgeState) => void) | undefined;
}

export class ChunkPlaybackBridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "ChunkPlaybackBridgeError";
    this.code = code;
  }
}

export function assertPlaybackSnapshot(value: unknown): asserts value is PlaybackSnapshot {
  if (!value || typeof value !== "object") {
    throw new ChunkPlaybackBridgeError("E_PLAYBACK_SNAPSHOT", "Playback snapshot must be a non-null object.");
  }
  const snap = value as Record<string, unknown>;
  if (snap.schemaVersion !== "playback.v1") {
    throw new ChunkPlaybackBridgeError("E_PLAYBACK_SNAPSHOT", "Playback snapshot schemaVersion must be 'playback.v1'.");
  }
  if (typeof snap.streamId !== "string" || !snap.streamId) {
    throw new ChunkPlaybackBridgeError("E_PLAYBACK_SNAPSHOT", "Playback snapshot streamId must be a non-empty string.");
  }
  if (typeof snap.revision !== "string" || !snap.revision) {
    throw new ChunkPlaybackBridgeError("E_PLAYBACK_SNAPSHOT", "Playback snapshot revision must be a non-empty string.");
  }
  if (!Number.isSafeInteger(snap.frame) || (snap.frame as number) < 0) {
    throw new ChunkPlaybackBridgeError("E_PLAYBACK_SNAPSHOT", "Playback snapshot frame must be a non-negative integer.");
  }
  if (!snap.cursor || typeof snap.cursor !== "object") {
    throw new ChunkPlaybackBridgeError("E_PLAYBACK_SNAPSHOT", "Playback snapshot cursor must be an object.");
  }
  if (!snap.semanticState || typeof snap.semanticState !== "object") {
    throw new ChunkPlaybackBridgeError("E_PLAYBACK_SNAPSHOT", "Playback snapshot semanticState must be an object.");
  }
}

const safeFrame = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function copySnapshot(value: PlaybackSnapshot): PlaybackSnapshot {
  return structuredClone(value);
}

function errorValue(value: unknown, fallbackCode: string): ChunkPlaybackBridgeError {
  if (value instanceof ChunkPlaybackBridgeError) return value;
  if (value instanceof Error) {
    const code = typeof (value as Error & { code?: unknown }).code === "string"
      ? (value as Error & { code: string }).code
      : fallbackCode;
    return new ChunkPlaybackBridgeError(code, value.message);
  }
  return new ChunkPlaybackBridgeError(fallbackCode, String(value));
}

function defaultLease(id: string): ResourceLease {
  return { id: `noop:${id}`, release: () => undefined };
}

/**
 * Dependency-free bridge from a Chunk Stream runtime to a playback projection.
 * Manages the state lifecycle: load -> prepare -> consume -> commit.
 */
export class ChunkPlaybackBridge {
  readonly requests: LatestRequestCoordinator;
  readonly residency: ResidencyController;

  private readonly streamId: string;
  private readonly revision: string;
  private readonly load: ChunkPlaybackLoader;
  private readonly binding: ChunkPlaybackBinding;
  private readonly contentPort?: ContentPort | undefined;
  private readonly onCommit?: ChunkPlaybackBridgeOptions["onCommit"] | undefined;
  private readonly onState?: ChunkPlaybackBridgeOptions["onState"] | undefined;
  private playbackState: PlaybackSnapshot;
  private phase: ChunkPlaybackPhase = "idle";
  private requestedFrame: number | null = null;
  private inFlightFrame: number | null = null;
  private currentChunkId?: string | undefined;
  private errorState: ChunkPlaybackError | null = null;
  private closed = false;
  private readonly claims = new Map<string, Set<string>>();

  constructor(options: ChunkPlaybackBridgeOptions) {
    if (!options || typeof options !== "object") {
      throw new TypeError("ChunkPlaybackBridge options are required.");
    }
    if (typeof options.streamId !== "string" || options.streamId.trim() === "") {
      throw new TypeError("streamId is required.");
    }
    if (typeof options.revision !== "string" || options.revision.trim() === "") {
      throw new TypeError("revision is required.");
    }
    assertPlaybackSnapshot(options.initialSnapshot);
    if (options.initialSnapshot.streamId !== options.streamId || options.initialSnapshot.revision !== options.revision) {
      throw new ChunkPlaybackBridgeError("E_PLAYBACK_IDENTITY", "initialSnapshot streamId/revision must match the bridge.");
    }
    if (typeof options.load !== "function") throw new TypeError("load callback is required.");
    if (!options.binding || typeof options.binding.consume !== "function") {
      throw new TypeError("binding.consume callback is required.");
    }

    this.streamId = options.streamId;
    this.revision = options.revision;
    this.load = options.load;
    this.binding = options.binding;
    this.contentPort = options.contentPort;
    this.onCommit = options.onCommit;
    this.onState = options.onState;
    this.residency = options.residency ?? new ResidencyController();
    this.requests = new LatestRequestCoordinator(this.revision);
    this.playbackState = copySnapshot(options.initialSnapshot);
  }

  get playback(): PlaybackSnapshot { return copySnapshot(this.playbackState); }
  get state(): ChunkPlaybackBridgeState { return this.snapshot(); }
  get isClosed(): boolean { return this.closed; }

  snapshot(): ChunkPlaybackBridgeState {
    return {
      phase: this.phase,
      playback: this.playback,
      requestedFrame: this.requestedFrame,
      displayedFrame: this.playbackState.frame,
      inFlightFrame: this.inFlightFrame,
      ...(this.currentChunkId !== undefined ? { currentChunkId: this.currentChunkId } : {}),
      error: this.errorState ? { ...this.errorState } : null,
    };
  }

  async seek(frame: number, options: ChunkPlaybackSeekOptions = {}): Promise<ChunkPlaybackSeekResult> {
    const requestId = options.requestId ?? `chunk-seek:${this.streamId}:${frame}`;
    if (this.closed) {
      return this.result("failed", requestId, new ChunkPlaybackBridgeError("E_CLOSED", "Chunk playback bridge is closed."));
    }
    if (!safeFrame(frame)) {
      return this.result("failed", requestId, new ChunkPlaybackBridgeError("E_FRAME", "frame must be a non-negative safe integer."));
    }
    if (options.signal?.aborted) {
      return this.result("cancelled", requestId, new ChunkPlaybackBridgeError("E_CANCELLED", "seek was cancelled before preparation."));
    }

    this.requestedFrame = frame;
    this.errorState = null;
    this.inFlightFrame = frame;

    const outcome: LatestRequestResult<{ snapshot: PlaybackSnapshot; chunkId: string }> = await this.requests.run(
      async (context) => {
        this.setPhase("preparing", context.request.requestId);
        if (!context.isCurrent()) {
          throw new ChunkPlaybackBridgeError("E_STALE", "seek was superseded before preparation started.");
        }
        let envelope: RuntimeChunkEnvelope | undefined;
        let lease: ResourceLease | undefined;
        let mounted = false;
        try {
          const loaded = await this.load({
            streamId: this.streamId,
            revision: this.revision,
            frame,
            ...(options.cueId !== undefined ? { cueId: options.cueId } : {}),
            signal: context.signal,
          });
          if (!context.isCurrent()) {
            throw new ChunkPlaybackBridgeError("E_STALE", "seek was superseded before the chunk loaded.");
          }
          if (loaded === null || loaded === undefined) {
            throw new ChunkPlaybackBridgeError("E_CHUNK_MISSING", `No chunk covers frame ${frame}.`);
          }
          const targetEnvelope = createRuntimeEnvelope(loaded);
          envelope = targetEnvelope;
          if (targetEnvelope.streamId !== this.streamId) {
            throw new ChunkPlaybackBridgeError("E_STREAM", "chunk streamId does not match the playback bridge.");
          }
          if (!targetEnvelope.containsFrame(frame)) {
            throw new ChunkPlaybackBridgeError("E_CHUNK_RANGE", `Chunk ${targetEnvelope.id} does not cover frame ${frame}.`);
          }

          const existing = this.residency.get(targetEnvelope.id);
          if (existing && (existing.sequence !== targetEnvelope.sequence || existing.prepared === false)) {
            throw new ChunkPlaybackBridgeError("E_CHUNK_IDENTITY", `Resident chunk ${targetEnvelope.id} conflicts with the loaded envelope.`);
          }
          if (!existing) {
            lease = this.binding.prepare
              ? await this.binding.prepare(targetEnvelope, {
                  frame,
                  revision: this.revision,
                  ...(options.cueId !== undefined ? { cueId: options.cueId } : {}),
                  signal: context.signal,
                })
              : defaultLease(targetEnvelope.id);
            if (!lease || typeof lease.release !== "function") {
              throw new ChunkPlaybackBridgeError("E_LEASE", "prepare must return a resource lease with release().");
            }
            if (!context.isCurrent()) {
              throw new ChunkPlaybackBridgeError("E_STALE", "seek was superseded during preparation.");
            }
          }

          this.residency.mount(targetEnvelope, () => lease ?? defaultLease(targetEnvelope.id));
          mounted = true;
          this.claim(targetEnvelope.id, context.request.requestId);
          this.residency.markPrepared(targetEnvelope.id);
          this.setPhase("consuming", context.request.requestId);

          const actionAdapter = this.contentPort ? new UiActionAdapter(this.contentPort, { streamId: this.streamId }) : undefined;
          const next = await this.binding.consume(targetEnvelope, {
            frame,
            revision: this.revision,
            ...(options.cueId !== undefined ? { cueId: options.cueId } : {}),
            signal: context.signal,
            previous: this.playback,
            ...(actionAdapter ? { dispatchActions: () => actionAdapter.consume(targetEnvelope) } : {}),
          });
          assertPlaybackSnapshot(next);
          if (next.streamId !== this.streamId || next.revision !== this.revision || next.frame !== frame) {
            throw new ChunkPlaybackBridgeError("E_PLAYBACK_SNAPSHOT", "consumer returned a snapshot for the wrong stream, revision, or frame.");
          }
          if (!context.isCurrent()) {
            throw new ChunkPlaybackBridgeError("E_STALE", "seek was superseded before commit.");
          }

          if (!context.markCommitted()) {
            throw new ChunkPlaybackBridgeError("E_STALE", "seek was superseded at the commit boundary.");
          }
          const previousChunkId = this.currentChunkId;
          this.playbackState = copySnapshot(next);
          this.currentChunkId = targetEnvelope.id;
          this.residency.markConsumed(targetEnvelope.id);
          this.releaseClaim(targetEnvelope.id, context.request.requestId);
          if (previousChunkId && previousChunkId !== targetEnvelope.id) {
            try { this.residency.requestEviction(previousChunkId); } catch { /* already discarded */ }
          }
          this.errorState = null;
          this.requestedFrame = frame;
          this.inFlightFrame = null;
          this.setPhase("ready", context.request.requestId);
          const committedSnapshot = this.playback;
          try { this.onCommit?.(copySnapshot(committedSnapshot), targetEnvelope); } catch { /* observers cannot roll back */ }
          return { snapshot: committedSnapshot, chunkId: targetEnvelope.id };
        } catch (reason) {
          const failure = errorValue(reason, "E_PLAYBACK_CONSUME");
          if (mounted && envelope) {
            this.releaseClaim(envelope.id, context.request.requestId);
          } else if (lease && typeof lease.release === "function") {
            try { lease.release(); } catch { /* preserve original error */ }
          }
          throw failure;
        }
      },
      {
        revision: this.revision,
        requestId,
        signal: options.signal,
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      } satisfies BeginRequestOptions,
    );

    if (outcome.status === "completed" && outcome.value) {
      return {
        status: "completed",
        requestId: outcome.request.requestId,
        playback: copySnapshot(outcome.value.snapshot),
        chunkId: outcome.value.chunkId,
      };
    }
    const failure = outcome.status === "timeout"
      ? new ChunkPlaybackBridgeError("E_TIMEOUT", "seek timed out before the playback commit barrier.")
      : outcome.status === "cancelled"
        ? new ChunkPlaybackBridgeError("E_CANCELLED", "seek was cancelled before the playback commit barrier.")
        : errorValue(outcome.error, outcome.status === "stale" ? "E_STALE" : "E_PLAYBACK");

    const isCurrent = this.requests.latestRequest?.requestId === outcome.request.requestId;
    if (isCurrent && !this.closed) {
      this.inFlightFrame = null;
      this.errorState = { code: failure.code, message: failure.message };
      this.setPhase(outcome.status === "stale" ? "idle" : "failed", outcome.request.requestId);
    }
    const status = outcome.status === "stale" || outcome.status === "cancelled" || outcome.status === "timeout"
      ? outcome.status
      : "failed";
    return this.result(status, outcome.request.requestId, failure);
  }

  close(): void {
    if (this.closed) return;
    const latest = this.requests.latestRequest;
    if (latest?.status === "pending") latest.cancel("bridge closed");
    this.closed = true;
    this.inFlightFrame = null;
    this.errorState = null;
    this.setPhase("closed");
    this.residency.dispose();
  }

  private result(
    status: ChunkPlaybackSeekResult["status"],
    requestId: string,
    failure?: ChunkPlaybackBridgeError | undefined
  ): ChunkPlaybackSeekResult {
    return {
      status,
      requestId,
      playback: this.playback,
      ...(failure ? { error: { code: failure.code, message: failure.message } } : {}),
    };
  }

  private setPhase(phase: ChunkPlaybackPhase, requestId?: string | undefined): void {
    void requestId;
    this.phase = phase;
    try { this.onState?.(this.snapshot()); } catch { /* observers cannot break playback */ }
  }

  private claim(chunkId: string, requestId: string): void {
    const owners = this.claims.get(chunkId) ?? new Set<string>();
    owners.add(requestId);
    this.claims.set(chunkId, owners);
  }

  private releaseClaim(chunkId: string, requestId: string): void {
    const owners = this.claims.get(chunkId);
    if (owners) {
      owners.delete(requestId);
      if (owners.size > 0) return;
      this.claims.delete(chunkId);
    }
    if (this.currentChunkId === chunkId) return;
    const resident = this.residency.get(chunkId);
    if (!resident) return;
    try {
      if (resident.consumed) this.residency.requestEviction(chunkId);
      else this.residency.discard(chunkId);
    } catch { /* disposal races are already fail-closed */ }
  }
}
