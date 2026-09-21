import type {
  ChunkFetchDescriptor,
  ChunkStreamReaderOptions,
  ChunkStreamState,
  RuntimeChunkEnvelopeDescriptor,
  FallbackChunkState,
} from "./types.js";
import {
  createResilientChunkReader,
  createResilientNdjsonReader,
} from "./reader.js";

export interface ChunkStreamStore<TItem = unknown> {
  getState(): ChunkStreamState<TItem>;
  subscribe(listener: (state: ChunkStreamState<TItem>) => void): () => void;
  start(): Promise<void>;
  abort(): void;
}

/**
 * Creates a zero-runtime-dependency reactive store for a chunk stream.
 * Compatible with React's `useSyncExternalStore`, Svelte, Vue, or Vanilla JS.
 */
export function createChunkStreamStore<TItem = unknown>(
  streamSource:
    | string
    | {
        fetchChunk: (descriptor: ChunkFetchDescriptor, signal?: AbortSignal) => Promise<TItem>;
        descriptors: readonly ChunkFetchDescriptor[];
      },
  options: ChunkStreamReaderOptions<TItem> = {}
): ChunkStreamStore<TItem> {
  const listeners = new Set<(state: ChunkStreamState<TItem>) => void>();
  let controller: AbortController | null = null;

  let state: ChunkStreamState<TItem> = {
    chunks: [],
    isStreaming: false,
    error: null,
    activeChunkCount: 0,
    emptyChunkCount: 0,
    fallbackCount: 0,
  };

  function emit() {
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        /* listener error isolation */
      }
    }
  }

  function update(patch: Partial<ChunkStreamState<TItem>>) {
    state = { ...state, ...patch };
    emit();
  }

  return {
    getState() {
      return state;
    },

    subscribe(listener: (state: ChunkStreamState<TItem>) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async start() {
      if (state.isStreaming) return;

      controller = new AbortController();
      const signal = options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal;

      update({
        chunks: [],
        isStreaming: true,
        error: null,
        activeChunkCount: 0,
        emptyChunkCount: 0,
        fallbackCount: 0,
      });

      try {
        let generator: AsyncGenerator<
          TItem | (RuntimeChunkEnvelopeDescriptor<unknown, FallbackChunkState> & { state: FallbackChunkState })
        >;

        if (typeof streamSource === "string") {
          const res = await fetch(streamSource, {
            signal,
            headers: {
              Accept: "application/x-ndjson",
              ...options.headers,
            },
          });

          if (!res.ok) {
            throw new Error(`Stream HTTP error: ${res.status} ${res.statusText}`);
          }
          if (!res.body) {
            throw new Error("Stream response body is empty");
          }

          generator = createResilientNdjsonReader<TItem>(res.body, {
            ...options,
            signal,
          });
        } else {
          generator = createResilientChunkReader<TItem>(
            streamSource.fetchChunk,
            streamSource.descriptors,
            {
              ...options,
              signal,
            }
          );
        }

        const collected: (TItem | RuntimeChunkEnvelopeDescriptor<unknown, FallbackChunkState>)[] = [];
        let active = 0;
        let empty = 0;
        let fallback = 0;

        for await (const item of generator) {
          collected.push(item);

          const envelope = item as { state?: { empty?: boolean; fallback?: boolean } };
          if (envelope.state?.fallback) {
            fallback++;
          }
          if (envelope.state?.empty) {
            empty++;
          } else {
            active++;
          }

          update({
            chunks: [...collected],
            activeChunkCount: active,
            emptyChunkCount: empty,
            fallbackCount: fallback,
          });
        }

        update({ isStreaming: false });
      } catch (err: unknown) {
        if (signal.aborted) {
          update({ isStreaming: false });
          return;
        }
        const error = err instanceof Error ? err : new Error(String(err));
        update({ isStreaming: false, error });
      }
    },

    abort() {
      if (controller) {
        controller.abort();
        controller = null;
      }
      update({ isStreaming: false });
    },
  };
}
