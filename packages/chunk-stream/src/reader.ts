import type {
  ChunkFetchDescriptor,
  ChunkStreamReaderOptions,
  FallbackChunkState,
  RuntimeChunkEnvelopeDescriptor,
} from "./types.js";

/**
 * Parses the HTTP Retry-After header into milliseconds.
 * Supports both delta-seconds (e.g. "120") and HTTP-date formats.
 */
export function retryAfterMs(value: string | null | undefined, now: number = Date.now()): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - now);
  }

  return 0;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("Aborted"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason ?? new Error("Aborted"));
    };

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Synthesizes an empty chunk conforming to the Monomorphic Playback Runtime Plane
 * and Single Wire Schema Draft 2020-12 (schemaVersion: 1).
 */
export function synthesizeEmptyChunk<TData = unknown>(
  descriptor: ChunkFetchDescriptor,
  error: Error,
  attempts: number
): RuntimeChunkEnvelopeDescriptor<TData, FallbackChunkState> & { state: FallbackChunkState } {
  const format = descriptor.payloadFormat || "ui-action@v1";
  let emptyData: unknown = null;

  if (format.startsWith("ui-action")) {
    emptyData = { cues: [], targets: {} };
  } else if (format.startsWith("time-series")) {
    emptyData = { type: "time-series", channels: [], samples: [] };
  } else if (format.startsWith("crdt-delta")) {
    emptyData = { cues: [] };
  }

  const fallbackState: FallbackChunkState = {
    empty: true,
    synthetic: true,
    fallback: true,
    attempts,
    lastError: error.message,
    failedAt: Date.now(),
  };

  return {
    id: descriptor.id,
    sequence: descriptor.sequence,
    streamId: descriptor.streamId ?? "",
    fromFrame: descriptor.fromFrame,
    toFrame: descriptor.toFrame,
    payloadFormat: format,
    data: emptyData as TData,
    state: fallbackState,
    resources: [],
    residentBytes: 0,
  };
}

/**
 * Creates an async generator yielding decoded chunks from a stream descriptor list.
 * Implements exponential backoff with full jitter, Retry-After header parsing,
 * and graceful fallback to monomorphic empty chunks.
 */
export async function* createResilientChunkReader<TItem = unknown>(
  fetchChunk: (descriptor: ChunkFetchDescriptor, signal?: AbortSignal) => Promise<TItem>,
  descriptors: readonly ChunkFetchDescriptor[],
  options: ChunkStreamReaderOptions<TItem> = {}
): AsyncGenerator<TItem | (RuntimeChunkEnvelopeDescriptor<unknown, FallbackChunkState> & { state: FallbackChunkState })> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelay = options.initialDelayMs ?? 200;
  const maxDelay = options.maxDelayMs ?? 5000;
  const factor = options.backoffFactor ?? 2.0;
  const signal = options.signal;

  for (const descriptor of descriptors) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error("Aborted");
    }

    let attempt = 0;
    let success = false;
    let lastError: Error | null = null;

    while (attempt <= maxRetries && !success) {
      if (signal?.aborted) {
        throw signal.reason ?? new Error("Aborted");
      }

      try {
        const item = await fetchChunk(descriptor, signal);

        if (options.guard && !options.guard(item)) {
          throw new Error(`Chunk ${descriptor.id} failed Type Guard validation`);
        }

        yield item;
        success = true;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        lastError = error;
        attempt++;

        if (signal?.aborted) {
          throw signal.reason ?? new Error("Aborted");
        }

        if (attempt <= maxRetries) {
          let delayMs = 0;
          const retryHeader = (error as { retryAfter?: string }).retryAfter;
          const parsedRetry = retryAfterMs(retryHeader);

          if (parsedRetry > 0) {
            delayMs = Math.min(parsedRetry, maxDelay);
          } else {
            const exponential = initialDelay * Math.pow(factor, attempt - 1);
            const capped = Math.min(exponential, maxDelay);
            delayMs = Math.round(Math.random() * capped);
          }

          options.onRetry?.(attempt, error, delayMs, descriptor.id);
          await sleep(delayMs, signal);
        }
      }
    }

    if (!success) {
      const err = lastError ?? new Error(`Failed to fetch chunk ${descriptor.id} after ${maxRetries} attempts`);
      const fallback = synthesizeEmptyChunk(descriptor, err, attempt);
      options.onFallback?.(fallback, err);
      yield fallback;
    }
  }
}

/**
 * Creates an async generator yielding items from a live NDJSON stream.
 */
export async function* createResilientNdjsonReader<TItem = unknown>(
  stream: ReadableStream<Uint8Array>,
  options: ChunkStreamReaderOptions<TItem> = {}
): AsyncGenerator<TItem> {
  const signal = options.signal;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        throw signal.reason ?? new Error("Aborted");
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const parsed = JSON.parse(trimmed);
        if (options.guard && !options.guard(parsed)) {
          throw new Error("NDJSON chunk item failed Type Guard validation");
        }
        yield parsed as TItem;
      }
    }

    if (buffer.trim()) {
      const parsed = JSON.parse(buffer.trim());
      if (options.guard && !options.guard(parsed)) {
        throw new Error("Trailing NDJSON chunk item failed Type Guard validation");
      }
      yield parsed as TItem;
    }
  } finally {
    reader.releaseLock();
  }
}
