/**
 * Type declarations for Resilient Chunk Stream Consumer Pipeline.
 * Compliant with Single Wire Schema Draft 2020-12 (schemaVersion: 1)
 * and Monomorphic Playback Runtime Plane (RuntimeChunkEnvelope).
 */

export interface FallbackChunkState {
  readonly empty: true
  readonly synthetic: true
  readonly fallback: true
  readonly attempts: number
  readonly lastError?: string
  readonly failedAt: number
  readonly [key: string]: unknown
}

export interface RuntimeChunkEnvelopeDescriptor<TData = unknown, TState = unknown> {
  id: string
  sequence: number
  streamId?: string
  fromFrame: number
  toFrame: number
  payloadFormat?: string
  data?: TData
  state?: TState
  resources?: readonly unknown[]
  residentBytes?: number
}

export interface ChunkFetchDescriptor {
  readonly id: string
  readonly sequence: number
  readonly streamId?: string
  readonly fromFrame: number
  readonly toFrame: number
  readonly payloadFormat?: string
}

export interface ChunkStreamReaderOptions<TItem = unknown> {
  /** Maximum retry attempts before falling back to empty chunk (default: 3) */
  maxRetries?: number
  /** Initial delay in ms before first retry (default: 200) */
  initialDelayMs?: number
  /** Maximum backoff delay in ms (default: 5000) */
  maxDelayMs?: number
  /** Exponential backoff multiplier (default: 2.0) */
  backoffFactor?: number
  /** Abort signal to cancel streaming */
  signal?: AbortSignal
  /** Custom Type Guard or AJV Standalone Guard to validate decoded chunk item */
  guard?: (data: unknown) => data is TItem
  /** Callback fired on each retry attempt */
  onRetry?: (attempt: number, error: Error, delayMs: number, chunkId: string) => void
  /** Callback fired when all retries are exhausted and an empty chunk is synthesized */
  onFallback?: (emptyChunk: RuntimeChunkEnvelopeDescriptor<unknown, FallbackChunkState>, error: Error) => void
  /** Optional custom HTTP request headers */
  headers?: Record<string, string>
}

export interface ChunkStreamState<TItem = unknown> {
  chunks: readonly (TItem | RuntimeChunkEnvelopeDescriptor<unknown, FallbackChunkState>)[]
  isStreaming: boolean
  error: Error | null
  activeChunkCount: number
  emptyChunkCount: number
  fallbackCount: number
}
