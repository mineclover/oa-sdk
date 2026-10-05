import type { StreamingBody } from '../contracts/handler-contract.js'

export interface SyntheticEmptyChunk {
  readonly id: string
  readonly sequence: number
  readonly streamId: string
  readonly fromFrame: number
  readonly toFrame: number
  readonly payloadFormat: string
  readonly data: unknown
  readonly state: {
    readonly empty: true
    readonly synthetic: true
    readonly fallback: true
    readonly attempts: number
    readonly lastError: string
    readonly failedAt: number
  }
  readonly resources: readonly unknown[]
  readonly residentBytes: number
}

export interface DemuxChunkStreamOptions<TItem = unknown> {
  signal?: AbortSignal
  guard?: (data: unknown) => data is TItem
  onInvalidChunk?: (raw: unknown, error: Error) => void
  defaultPayloadFormat?: string
}

function synthesizeRouterEmptyChunk(
  seq: number,
  error: Error,
  format: string = 'ui-action@v1',
): SyntheticEmptyChunk {
  let emptyData: unknown = null
  if (format.startsWith('ui-action')) {
    emptyData = { cues: [], targets: {} }
  } else if (format.startsWith('time-series')) {
    emptyData = { type: 'time-series', channels: [], samples: [] }
  } else if (format.startsWith('crdt-delta')) {
    emptyData = { cues: [] }
  }

  return {
    id: `c${String(seq).padStart(3, '0')}`,
    sequence: seq,
    streamId: '',
    fromFrame: seq * 30,
    toFrame: (seq + 1) * 30,
    payloadFormat: format,
    data: emptyData,
    state: {
      empty: true,
      synthetic: true,
      fallback: true,
      attempts: 1,
      lastError: error.message,
      failedAt: Date.now(),
    },
    resources: [],
    residentBytes: 0,
  }
}

async function* toAsyncIterable(body: StreamingBody): AsyncIterable<Uint8Array | string> {
  if (body instanceof Uint8Array) {
    yield body
    return
  }
  // JavaScript callers can pass a value outside StreamingBody, such as the null
  // `Response.body` of a 204 or HEAD response. Like any body without a stream
  // interface it yields no chunks; the `in` checks below would throw on it.
  if (body === null || (typeof body !== 'object' && typeof body !== 'function')) return
  if (Symbol.asyncIterator in body && typeof body[Symbol.asyncIterator] === 'function') {
    yield* body
    return
  }
  if ('getReader' in body && typeof body.getReader === 'function') {
    const reader = body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) yield value
      }
    } finally {
      reader.releaseLock()
    }
  }
}

/**
 * Demuxes an incoming byte stream or string chunk stream into typed stream chunks.
 * Handles framing, JSON parsing, standalone type guard validation, and automatic
 * empty-chunk fallback on persistent framing/validation errors.
 */
export async function* demuxChunkStream<TItem = unknown>(
  stream: StreamingBody,
  options: DemuxChunkStreamOptions<TItem> = {},
): AsyncGenerator<TItem | SyntheticEmptyChunk> {
  const {
    signal,
    guard,
    onInvalidChunk,
    defaultPayloadFormat = 'ui-action@v1',
  } = options

  const decoder = new TextDecoder()
  let buffer = ''
  let sequence = 0

  for await (const chunk of toAsyncIterable(stream)) {
    if (signal?.aborted) break

    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    buffer += text
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const seq = sequence++

      try {
        const parsed = JSON.parse(trimmed)
        if (guard && !guard(parsed)) {
          throw new TypeError(`Guard rejected stream chunk at sequence ${seq}`)
        }
        yield parsed as TItem
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        onInvalidChunk?.(trimmed, error)
        yield synthesizeRouterEmptyChunk(seq, error, defaultPayloadFormat)
      }
    }
  }

  buffer += decoder.decode()
  const finalLine = buffer.trim()
  if (finalLine) {
    const seq = sequence++
    try {
      const parsed = JSON.parse(finalLine)
      if (!guard || guard(parsed)) {
        yield parsed as TItem
      } else {
        throw new TypeError(`Guard rejected final stream chunk at sequence ${seq}`)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      onInvalidChunk?.(finalLine, error)
      yield synthesizeRouterEmptyChunk(seq, error, defaultPayloadFormat)
    }
  }
}
