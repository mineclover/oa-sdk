import { describe, it, expect, vi } from 'vitest'
import {
  retryAfterMs,
  synthesizeEmptyChunk,
  createResilientChunkReader,
  createChunkStreamStore,
} from '../chunk-stream/index.js'
import type { ChunkFetchDescriptor } from '../chunk-stream/types.js'

describe('Resilient Chunk Stream Consumer Pipeline', () => {
  describe('retryAfterMs header parser', () => {
    it('parses integer delta-seconds into milliseconds', () => {
      expect(retryAfterMs('120')).toBe(120000)
      expect(retryAfterMs('0')).toBe(0)
      expect(retryAfterMs('5')).toBe(5000)
    })

    it('parses HTTP-date format relative to now', () => {
      const now = Date.parse('Wed, 21 Oct 2026 07:28:00 GMT')
      const target = 'Wed, 21 Oct 2026 07:28:30 GMT'
      expect(retryAfterMs(target, now)).toBe(30000)
    })

    it('returns 0 for null, undefined, empty, or negative values', () => {
      expect(retryAfterMs(null)).toBe(0)
      expect(retryAfterMs(undefined)).toBe(0)
      expect(retryAfterMs('')).toBe(0)
      expect(retryAfterMs('   ')).toBe(0)
      expect(retryAfterMs('-10')).toBe(0)
    })
  })

  describe('synthesizeEmptyChunk conforming to Single Wire Schema & Runtime Plane', () => {
    it('synthesizes empty UI Action chunk with empty cues and targets', () => {
      const descriptor: ChunkFetchDescriptor = {
        id: 'c001',
        sequence: 1,
        streamId: 'stream-alpha',
        fromFrame: 30,
        toFrame: 60,
        payloadFormat: 'ui-action@v1',
      }
      const err = new Error('HTTP 500 Gateway Timeout')
      const empty = synthesizeEmptyChunk(descriptor, err, 3)

      expect(empty.id).toBe('c001')
      expect(empty.sequence).toBe(1)
      expect(empty.streamId).toBe('stream-alpha')
      expect(empty.fromFrame).toBe(30)
      expect(empty.toFrame).toBe(60)
      expect(empty.payloadFormat).toBe('ui-action@v1')
      expect(empty.residentBytes).toBe(0)
      expect(empty.resources).toEqual([])

      // Data format check
      expect(empty.data).toEqual({ cues: [], targets: {} })

      // Fallback state metadata check
      expect(empty.state).toMatchObject({
        empty: true,
        synthetic: true,
        fallback: true,
        attempts: 3,
        lastError: 'HTTP 500 Gateway Timeout',
      })
      expect(typeof empty.state.failedAt).toBe('number')
    })

    it('synthesizes empty Time Series chunk with empty channels and samples', () => {
      const descriptor: ChunkFetchDescriptor = {
        id: 'c002',
        sequence: 2,
        fromFrame: 60,
        toFrame: 90,
        payloadFormat: 'time-series@v1',
      }
      const err = new Error('Network drop')
      const empty = synthesizeEmptyChunk(descriptor, err, 2)

      expect(empty.data).toEqual({ type: 'time-series', channels: [], samples: [] })
      expect(empty.state.empty).toBe(true)
      expect(empty.state.fallback).toBe(true)
    })

    it('synthesizes empty CRDT Delta chunk with empty cues', () => {
      const descriptor: ChunkFetchDescriptor = {
        id: 'c003',
        sequence: 3,
        fromFrame: 90,
        toFrame: 120,
        payloadFormat: 'crdt-delta@v1',
      }
      const err = new Error('Verification failure')
      const empty = synthesizeEmptyChunk(descriptor, err, 1)

      expect(empty.data).toEqual({ cues: [] })
      expect(empty.state.empty).toBe(true)
    })
  })

  describe('createResilientChunkReader', () => {
    it('yields successfully when fetch succeeds on first attempt', async () => {
      const descriptors: ChunkFetchDescriptor[] = [
        { id: 'c000', sequence: 0, fromFrame: 0, toFrame: 30, payloadFormat: 'ui-action@v1' },
        { id: 'c001', sequence: 1, fromFrame: 30, toFrame: 60, payloadFormat: 'ui-action@v1' },
      ]

      const fetchFn = vi.fn().mockImplementation(async (d: ChunkFetchDescriptor) => ({
        id: d.id,
        sequence: d.sequence,
        data: { cues: [{ id: `cue-${d.id}` }] },
      }))

      const reader = createResilientChunkReader(fetchFn, descriptors)
      const results = []
      for await (const chunk of reader) {
        results.push(chunk)
      }

      expect(results).toHaveLength(2)
      expect(fetchFn).toHaveBeenCalledTimes(2)
      expect(results[0]).toEqual({ id: 'c000', sequence: 0, data: { cues: [{ id: 'cue-c000' }] } })
      expect(results[1]).toEqual({ id: 'c001', sequence: 1, data: { cues: [{ id: 'cue-c001' }] } })
    })

    it('retries on failure and recovers when a subsequent attempt succeeds', async () => {
      const descriptors: ChunkFetchDescriptor[] = [
        { id: 'c000', sequence: 0, fromFrame: 0, toFrame: 30, payloadFormat: 'ui-action@v1' },
      ]

      let callCount = 0
      const retryListener = vi.fn()

      const fetchFn = vi.fn().mockImplementation(async (d: ChunkFetchDescriptor) => {
        callCount++
        if (callCount < 3) {
          throw new Error(`Simulated transient network drop #${callCount}`)
        }
        return { id: d.id, sequence: d.sequence, ok: true }
      })

      const reader = createResilientChunkReader(fetchFn, descriptors, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 50,
        onRetry: retryListener,
      })

      const results = []
      for await (const chunk of reader) {
        results.push(chunk)
      }

      expect(results).toHaveLength(1)
      expect(results[0]).toEqual({ id: 'c000', sequence: 0, ok: true })
      expect(fetchFn).toHaveBeenCalledTimes(3)
      expect(retryListener).toHaveBeenCalledTimes(2)
      expect(retryListener).toHaveBeenNthCalledWith(1, 1, expect.any(Error), expect.any(Number), 'c000')
      expect(retryListener).toHaveBeenNthCalledWith(2, 2, expect.any(Error), expect.any(Number), 'c000')
    })

    it('falls back to synthetic empty chunk when retries are exhausted, continuing stream', async () => {
      const descriptors: ChunkFetchDescriptor[] = [
        { id: 'c000', sequence: 0, fromFrame: 0, toFrame: 30, payloadFormat: 'ui-action@v1' },
        { id: 'c001', sequence: 1, fromFrame: 30, toFrame: 60, payloadFormat: 'ui-action@v1' },
      ]

      const fallbackListener = vi.fn()

      const fetchFn = vi.fn().mockImplementation(async (d: ChunkFetchDescriptor) => {
        if (d.id === 'c000') {
          throw new Error('Persistent 500 server outage')
        }
        return { id: d.id, sequence: d.sequence, ok: true }
      })

      const reader = createResilientChunkReader(fetchFn, descriptors, {
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 30,
        onFallback: fallbackListener,
      })

      const results = []
      for await (const chunk of reader) {
        results.push(chunk)
      }

      expect(results).toHaveLength(2)

      // c000 fell back to empty chunk
      const c0 = results[0] as Record<string, unknown>
      expect(c0.id).toBe('c000')
      expect(c0.residentBytes).toBe(0)
      expect(c0.data).toEqual({ cues: [], targets: {} })
      expect(c0.state).toMatchObject({
        empty: true,
        synthetic: true,
        fallback: true,
        attempts: 2,
        lastError: 'Persistent 500 server outage',
      })
      expect(fallbackListener).toHaveBeenCalledTimes(1)

      // c001 proceeded normally
      expect(results[1]).toEqual({ id: 'c001', sequence: 1, ok: true })
    })

    it('cancels immediately when AbortSignal is triggered', async () => {
      const controller = new AbortController()
      const descriptors: ChunkFetchDescriptor[] = [
        { id: 'c000', sequence: 0, fromFrame: 0, toFrame: 30 },
      ]

      const fetchFn = vi.fn().mockImplementation(async () => {
        controller.abort(new Error('User cancelled seek'))
        throw new Error('Fetch failed')
      })

      const reader = createResilientChunkReader(fetchFn, descriptors, {
        signal: controller.signal,
        initialDelayMs: 100,
      })

      await expect(async () => {
        for await (const _ of reader) {
          // should abort
        }
      }).rejects.toThrow('User cancelled seek')
    })
  })

  describe('createChunkStreamStore reactive state', () => {
    it('aggregates activeChunkCount, emptyChunkCount, and fallbackCount accurately', async () => {
      const descriptors: ChunkFetchDescriptor[] = [
        { id: 'c000', sequence: 0, fromFrame: 0, toFrame: 30, payloadFormat: 'ui-action@v1' },
        { id: 'c001', sequence: 1, fromFrame: 30, toFrame: 60, payloadFormat: 'ui-action@v1' },
      ]

      const fetchFn = vi.fn().mockImplementation(async (d: ChunkFetchDescriptor) => {
        if (d.id === 'c000') {
          throw new Error('Failure')
        }
        return { id: d.id, sequence: d.sequence, valid: true }
      })

      const store = createChunkStreamStore(
        { fetchChunk: fetchFn, descriptors },
        { maxRetries: 1, initialDelayMs: 5 },
      )

      await store.start()

      const state = store.getState()
      expect(state.isStreaming).toBe(false)
      expect(state.chunks).toHaveLength(2)
      expect(state.activeChunkCount).toBe(1)
      expect(state.emptyChunkCount).toBe(1)
      expect(state.fallbackCount).toBe(1)
      expect(state.error).toBeNull()
    })
  })
})
