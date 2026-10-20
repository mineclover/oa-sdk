/**
 * Core type declarations for the Monomorphic Chunk Stream Runtime.
 * Compliant with Single Wire Schema Draft 2020-12 (schemaVersion: 1)
 * and Monomorphic Playback Runtime Plane.
 */

export interface FallbackChunkState {
  readonly empty: true;
  readonly synthetic: true;
  readonly fallback: true;
  readonly attempts: number;
  readonly lastError?: string | undefined;
  readonly failedAt: number;
  readonly [key: string]: unknown;
}

export interface RuntimeResourceRef {
  readonly id: string;
  readonly type: string;
  readonly byteLength?: number | undefined;
  readonly [key: string]: unknown;
}

export interface ResourceLease {
  readonly id: string;
  readonly resourceId?: string | undefined;
  readonly byteLength?: number | undefined;
  readonly acquiredAt?: number | undefined;
  readonly expiresAt?: number | undefined;
  release?(): void;
}

export interface ResidencyRecord {
  readonly chunkId: string;
  readonly sequence: number;
  readonly prepared: boolean;
  readonly consumed: boolean;
  readonly evictionPending: boolean;
}

export interface RuntimeChunkEnvelopeDescriptor<TData = unknown, TState = unknown> {
  readonly schemaVersion?: 1 | undefined;
  id: string;
  sequence: number;
  streamId?: string | undefined;
  fromFrame: number;
  toFrame: number;
  payloadFormat?: string | undefined;
  data?: TData | undefined;
  state?: TState | undefined;
  resources?: readonly RuntimeResourceRef[] | undefined;
  residentBytes?: number | undefined;
}

export interface ChunkFetchDescriptor {
  readonly id: string;
  readonly sequence: number;
  readonly streamId?: string | undefined;
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly payloadFormat?: string | undefined;
}

export interface ChunkStreamReaderOptions<TItem = unknown> {
  /** Maximum retry attempts before falling back to empty chunk (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms before first retry (default: 200) */
  initialDelayMs?: number;
  /** Maximum backoff delay in ms (default: 5000) */
  maxDelayMs?: number;
  /** Exponential backoff multiplier (default: 2.0) */
  backoffFactor?: number;
  /** Abort signal to cancel streaming */
  signal?: AbortSignal;
  /** Custom Type Guard or AJV Standalone Guard to validate decoded chunk item */
  guard?: (data: unknown) => data is TItem;
  /** Callback fired on each retry attempt */
  onRetry?: (attempt: number, error: Error, delayMs: number, chunkId: string) => void;
  /** Callback fired when all retries are exhausted and an empty chunk is synthesized */
  onFallback?: (emptyChunk: RuntimeChunkEnvelopeDescriptor<unknown, FallbackChunkState>, error: Error) => void;
  /** Optional custom HTTP request headers */
  headers?: Record<string, string>;
}

export interface ChunkStreamState<TItem = unknown> {
  chunks: readonly (TItem | RuntimeChunkEnvelopeDescriptor<unknown, FallbackChunkState>)[];
  isStreaming: boolean;
  error: Error | null;
  activeChunkCount: number;
  emptyChunkCount: number;
  fallbackCount: number;
}

export interface StreamManifestEntry {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly sequence: number;
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly payloadFormat: string;
  readonly cueCount?: number | undefined;
  readonly resourcesCount?: number | undefined;
  readonly byteLength?: number | undefined;
}

export type ChunkPresetName =
  | "ultra-low-latency"
  | "optimal-web"
  | "standard-buffer"
  | "initcwnd-burst"
  | "large-payload"
  | "heavy-media"
  | "bulk-data";

export type MemoryPresetName = "mobile" | "standard" | "highperf";

export type ChunkStreamMode = "adaptive" | "eager" | "manual";

export interface ChunkStreamConfigInput {
  readonly preset?: ChunkPresetName | undefined;
  readonly targetChunkBytes?: number | undefined;
  readonly memoryPreset?: MemoryPresetName | undefined;
  readonly maxResidentBytes?: number | undefined;
  readonly maxL1MemoryBytes?: number | undefined;
  readonly payloadFormat?: string | undefined;
  readonly fps?: number | undefined;
  readonly chunkFrames?: number | undefined;
  readonly mode?: ChunkStreamMode | undefined;
  readonly lookaheadFrames?: number | undefined;
  readonly retentionFrames?: number | undefined;
}

export interface ResolvedChunkStreamConfig {
  readonly schemaVersion: 1;
  readonly preset: ChunkPresetName;
  readonly targetChunkBytes: number;
  readonly memoryPreset: MemoryPresetName;
  readonly maxResidentBytes: number;
  readonly maxL1MemoryBytes: number;
  readonly payloadFormat: string;
  readonly fps: number;
  readonly chunkFrames: number;
  readonly mode: ChunkStreamMode;
  readonly lookaheadFrames: number;
  readonly retentionFrames: number;
}

export interface StreamManifest {
  readonly schemaVersion: 1;
  readonly streamId: string;
  readonly revision: string;
  readonly fps: number;
  readonly totalFrames: number;
  readonly totalDurationSec: number;
  readonly chunkCount: number;
  readonly chunks: readonly StreamManifestEntry[];
  readonly preset?: ChunkPresetName | undefined;
  readonly memoryPreset?: MemoryPresetName | undefined;
  readonly targetChunkBytes?: number | undefined;
}

export interface PlaybackVirtualizerOptions {
  readonly lookaheadFrames?: number | undefined;
  readonly retentionFrames?: number | undefined;
  readonly maxResidentBytes?: number | undefined;
  readonly memoryPreset?: MemoryPresetName | undefined;
  readonly maxActiveChunks?: number | undefined;
  readonly onEvict?: ((chunkId: string, reason: "retention" | "budget" | "seek") => void) | undefined;
  readonly onTierHit?: ((tier: "L1" | "L2" | "L3", chunkId: string) => void) | undefined;
}

export interface StorageTierOptions {
  /** L1 (memory) byte budget. Wins over `memoryPreset` when both are given. */
  readonly maxL1MemoryBytes?: number | undefined;
  /**
   * Derives the L1 budget from a memory preset with the same rule as
   * `defineChunkStreamConfig` (50% of the preset's resident budget). With
   * neither option the L1 budget is 32 MiB.
   */
  readonly memoryPreset?: MemoryPresetName | undefined;
  readonly l2DatabaseName?: string | undefined;
  readonly fetchRemoteChunk?: ((id: string, signal?: AbortSignal) => Promise<ArrayBuffer | Uint8Array | string>) | undefined;
}

export interface ForecasterProfile {
  readonly peakMultiplier: number;
  readonly peakOverhead: number;
  readonly residentMultiplier: number;
  readonly residentBase: number;
  readonly aliases: readonly string[];
}

