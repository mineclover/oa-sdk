import type {
  ChunkFetchDescriptor,
  ChunkStreamReaderOptions,
  ChunkStreamState,
  FallbackChunkState,
  RuntimeChunkEnvelopeDescriptor,
} from './types.js'
import {
  createResilientChunkReader,
  createResilientNdjsonReader,
} from './resilient-chunk-reader.js'

export interface ChunkStreamStore<TItem = unknown> {
  getState(): ChunkStreamState<TItem>
  subscribe(listener: (state: ChunkStreamState<TItem>) => void): () => void
  start(): Promise<void>
  abort(): void
}

/**
 * Creates a zero-runtime-dependency reactive store for a chunk stream.
 * Compatible with React's `useSyncExternalStore`, Svelte, Vue, or Vanilla JS.
 */
export function createChunkStreamStore<TItem = unknown>(
  streamSource: string | {
    fetchChunk: (descriptor: ChunkFetchDescriptor, signal?: AbortSignal) => Promise<TItem>
    descriptors: readonly ChunkFetchDescriptor[]
  },
  options: ChunkStreamReaderOptions<TItem> = {},
): ChunkStreamStore<TItem> {
  const listeners = new Set<(state: ChunkStreamState<TItem>) => void>()
  let controller: AbortController | null = null

  let state: ChunkStreamState<TItem> = {
    chunks: [],
    isStreaming: false,
    error: null,
    activeChunkCount: 0,
    emptyChunkCount: 0,
    fallbackCount: 0,
  }

  function emit() {
    for (const listener of listeners) {
      try {
        listener(state)
      } catch {
        /* listener error isolation */
      }
    }
  }

  function update(patch: Partial<ChunkStreamState<TItem>>) {
    state = { ...state, ...patch }
    emit()
  }

  return {
    getState() {
      return state
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async start() {
      if (state.isStreaming) return
      controller = new AbortController()
      const effectiveSignal = options.signal ?? controller.signal

      update({
        chunks: [],
        isStreaming: true,
        error: null,
        activeChunkCount: 0,
        emptyChunkCount: 0,
        fallbackCount: 0,
      })

      try {
        const stream = typeof streamSource === 'string'
          ? createResilientNdjsonReader<TItem>(streamSource, { ...options, signal: effectiveSignal })
          : createResilientChunkReader<TItem>(
              streamSource.fetchChunk,
              streamSource.descriptors,
              { ...options, signal: effectiveSignal },
            )

        for await (const chunk of stream) {
          if (effectiveSignal.aborted) break

          const isFallback = Boolean(
            (chunk as RuntimeChunkEnvelopeDescriptor<unknown, FallbackChunkState>).state?.fallback,
          )

          const chunks = [...state.chunks, chunk]
          const fallbackCount = state.fallbackCount + (isFallback ? 1 : 0)
          const emptyChunkCount = state.emptyChunkCount + (isFallback ? 1 : 0)
          const activeChunkCount = state.activeChunkCount + (isFallback ? 0 : 1)

          update({
            chunks,
            fallbackCount,
            emptyChunkCount,
            activeChunkCount,
          })
        }
      } catch (err) {
        if (!effectiveSignal.aborted) {
          const error = err instanceof Error ? err : new Error(String(err))
          update({ error })
        }
      } finally {
        if (!effectiveSignal.aborted) {
          update({ isStreaming: false })
        }
      }
    },
    abort() {
      controller?.abort()
      controller = null
      update({ isStreaming: false })
    },
  }
}

/**
 * Generates type-safe React hooks for consuming chunk streams with automatic retry and empty fallback.
 */
export function generateChunkStreamReactHooks(options: {
  reactImport?: string
  clientImport?: string
  banner?: boolean
} = {}): string {
  const {
    reactImport = 'react',
    clientImport = '@oa-sdk/client',
    banner = true,
  } = options

  const lines: string[] = []
  if (banner) {
    lines.push('// Auto-generated React Chunk Stream hooks. Do not edit.')
    lines.push('// @oa-sdk/client')
    lines.push("'use client'")
    lines.push('')
  }

  lines.push(`import { useState, useEffect, useSyncExternalStore, useMemo } from ${JSON.stringify(reactImport)}
import {
  createChunkStreamStore,
  type ChunkStreamReaderOptions,
  type ChunkStreamState,
  type ChunkFetchDescriptor,
} from ${JSON.stringify(clientImport)}

export function useResilientChunkStream<TItem = unknown>(
  streamSource: string | {
    fetchChunk: (descriptor: ChunkFetchDescriptor, signal?: AbortSignal) => Promise<TItem>
    descriptors: readonly ChunkFetchDescriptor[]
  },
  options: ChunkStreamReaderOptions<TItem> = {},
): ChunkStreamState<TItem> & { abort: () => void; restart: () => void } {
  const store = useMemo(() => createChunkStreamStore<TItem>(streamSource, options), [streamSource])
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)

  useEffect(() => {
    store.start()
    return () => store.abort()
  }, [store])

  return {
    ...state,
    abort: store.abort,
    restart: () => {
      store.abort()
      store.start()
    },
  }
}
`)

  return lines.join('\n')
}
