import type {
  ChunkFetchDescriptor,
  ChunkStreamReaderOptions,
  FallbackChunkState,
  RuntimeChunkEnvelopeDescriptor,
} from './types.js'

/**
 * Parses the HTTP Retry-After header into milliseconds.
 * Supports both delta-seconds (e.g. "120") and HTTP-date formats.
 */
export function retryAfterMs(value: string | null | undefined, now: number = Date.now()): number {
  if (!value) return 0
  const trimmed = value.trim()
  if (!trimmed) return 0

  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000)
  }

  const dateMs = Date.parse(trimmed)
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - now)
  }

  return 0
}

/**
 * Helper to pause execution with abort signal support.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error('Aborted'))
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      reject(signal?.reason ?? new Error('Aborted'))
    }

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Synthesizes an empty chunk conforming to the Monomorphic Playback Runtime Plane
 * and Single Wire Schema Draft 2020-12 (schemaVersion: 1).
 *
 * Marks `state` with diagnostic fallback metadata:
 * `{ empty: true, synthetic: true, fallback: true, attempts, lastError, failedAt }`
 */
export function synthesizeEmptyChunk<TData = unknown>(
  descriptor: ChunkFetchDescriptor,
  error: Error,
  attempts: number,
): RuntimeChunkEnvelopeDescriptor<TData, FallbackChunkState> & { state: FallbackChunkState } {
  const format = descriptor.payloadFormat || 'ui-action@v1'
  let emptyData: unknown = null

  if (format.startsWith('ui-action')) {
    emptyData = { cues: [], targets: {} }
  } else if (format.startsWith('time-series')) {
    emptyData = { type: 'time-series', channels: [], samples: [] }
  } else if (format.startsWith('crdt-delta')) {
    emptyData = { cues: [] }
  }

  const fallbackState: FallbackChunkState = {
    empty: true,
    synthetic: true,
    fallback: true,
    attempts,
    lastError: error.message,
    failedAt: Date.now(),
  }

  return {
    id: descriptor.id,
    sequence: descriptor.sequence,
    streamId: descriptor.streamId ?? '',
    fromFrame: descriptor.fromFrame,
    toFrame: descriptor.toFrame,
    payloadFormat: format,
    data: emptyData as TData,
    state: fallbackState,
    resources: [],
    residentBytes: 0,
  }
}

/**
 * Resilient sequential chunk stream reader.
 *
 * For each chunk:
 * 1. Attempts retrieval via `fetchChunk(descriptor, signal)`.
 * 2. On failure, triggers an exponential backoff retry loop respecting `Retry-After`.
 * 3. If retries are exhausted (`attempts >= maxRetries`), synthesizes an Empty Chunk
 *    and yields it to avoid stalling the playback/synchronization virtualizer.
 */
export async function* createResilientChunkReader<TItem = unknown>(
  fetchChunk: (descriptor: ChunkFetchDescriptor, signal?: AbortSignal) => Promise<TItem>,
  chunkDescriptors: readonly ChunkFetchDescriptor[],
  options: ChunkStreamReaderOptions<TItem> = {},
): AsyncGenerator<TItem | RuntimeChunkEnvelopeDescriptor<unknown, FallbackChunkState>> {
  const {
    maxRetries = 3,
    initialDelayMs = 200,
    maxDelayMs = 5000,
    backoffFactor = 2.0,
    signal,
    guard,
    onRetry,
    onFallback,
  } = options

  for (const descriptor of chunkDescriptors) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error('Aborted')
    }

    let attempts = 0
    let lastError: Error | null = null
    let retrieved: TItem | null = null

    while (attempts <= maxRetries) {
      if (signal?.aborted) {
        throw signal.reason ?? new Error('Aborted')
      }

      try {
        const item = await fetchChunk(descriptor, signal)
        if (guard && !guard(item)) {
          throw new TypeError(`Chunk validation failed for chunk id "${descriptor.id}"`)
        }
        retrieved = item
        break
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (signal?.aborted) {
          throw signal.reason ?? lastError
        }

        if (attempts >= maxRetries) {
          break
        }

        attempts++
        const errorRecord = lastError as unknown as Record<string, unknown>
        const retryAfter = typeof errorRecord.retryAfterMs === 'number'
          ? (errorRecord.retryAfterMs as number)
          : 0

        const computedDelay = Math.min(
          maxDelayMs,
          initialDelayMs * Math.pow(backoffFactor, attempts - 1) * (0.8 + Math.random() * 0.4),
        )
        const delayMs = Math.max(computedDelay, retryAfter)

        onRetry?.(attempts, lastError, delayMs, descriptor.id)
        await sleep(delayMs, signal)
      }
    }

    if (retrieved !== null) {
      yield retrieved
    } else {
      // Retries exhausted: synthesize empty chunk fallback
      const error = lastError ?? new Error(`Failed to load chunk ${descriptor.id}`)
      const emptyChunk = synthesizeEmptyChunk(descriptor, error, attempts)
      onFallback?.(emptyChunk, error)
      yield emptyChunk
    }
  }
}

/**
 * Resilient live NDJSON stream reader.
 * Streams lines from an HTTP NDJSON endpoint. If an individual line fails parsing
 * or validation, it recovers by synthesizing an empty chunk and continuing the stream.
 */
export async function* createResilientNdjsonReader<TItem = unknown>(
  url: string,
  options: ChunkStreamReaderOptions<TItem> = {},
): AsyncGenerator<TItem | RuntimeChunkEnvelopeDescriptor<unknown, FallbackChunkState>> {
  const {
    maxRetries = 3,
    initialDelayMs = 200,
    maxDelayMs = 5000,
    backoffFactor = 2.0,
    signal,
    guard,
    onRetry,
    onFallback,
    headers = {},
  } = options

  let attempt = 0
  let res: Response | null = null

  while (attempt <= maxRetries) {
    if (signal?.aborted) throw signal.reason ?? new Error('Aborted')
    try {
      const init: RequestInit = {
        headers: { Accept: 'application/x-ndjson', ...headers },
      }
      if (signal) {
        init.signal = signal
      }
      res = await fetch(url, init)
      if (!res.ok) {
        const retryHeader = res.headers.get('Retry-After')
        const headerDelay = retryAfterMs(retryHeader)
        const err = Object.assign(new Error(`HTTP ${res.status} ${res.statusText}`), {
          status: res.status,
          retryAfterMs: headerDelay,
        })
        throw err
      }
      break
    } catch (err) {
      if (signal?.aborted) throw signal.reason ?? err
      if (attempt >= maxRetries) throw err
      attempt++
      const error = err instanceof Error ? err : new Error(String(err))
      const errRec = error as unknown as Record<string, unknown>
      const retryDelay = typeof errRec.retryAfterMs === 'number' ? errRec.retryAfterMs : 0
      const computedDelay = Math.min(
        maxDelayMs,
        initialDelayMs * Math.pow(backoffFactor, attempt - 1),
      )
      const delayMs = Math.max(computedDelay, retryDelay)
      onRetry?.(attempt, error, delayMs, 'stream-connect')
      await sleep(delayMs, signal)
    }
  }

  if (!res || !res.body) return

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sequence = 0

  try {
    while (true) {
      if (signal?.aborted) break
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const seq = sequence++
        try {
          const parsed = JSON.parse(trimmed)
          if (guard && !guard(parsed)) {
            throw new TypeError(`Guard rejected payload at sequence ${seq}`)
          }
          yield parsed as TItem
        } catch (err) {
          const parseError = err instanceof Error ? err : new Error(String(err))
          const emptyFallback = synthesizeEmptyChunk(
            {
              id: `c${String(seq).padStart(3, '0')}`,
              sequence: seq,
              fromFrame: seq * 30,
              toFrame: (seq + 1) * 30,
              payloadFormat: 'ui-action@v1',
            },
            parseError,
            1,
          )
          onFallback?.(emptyFallback, parseError)
          yield emptyFallback
        }
      }
    }

    buffer += decoder.decode()
    if (buffer.trim()) {
      const seq = sequence++
      try {
        const parsed = JSON.parse(buffer.trim())
        if (!guard || guard(parsed)) {
          yield parsed as TItem
        }
      } catch (err) {
        const parseError = err instanceof Error ? err : new Error(String(err))
        const emptyFallback = synthesizeEmptyChunk(
          {
            id: `c${String(seq).padStart(3, '0')}`,
            sequence: seq,
            fromFrame: seq * 30,
            toFrame: (seq + 1) * 30,
            payloadFormat: 'ui-action@v1',
          },
          parseError,
          1,
        )
        onFallback?.(emptyFallback, parseError)
        yield emptyFallback
      }
    }
  } finally {
    reader.releaseLock()
  }
}
