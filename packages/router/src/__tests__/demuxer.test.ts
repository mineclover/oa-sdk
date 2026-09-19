import { describe, it, expect, vi } from 'vitest'
import { demuxChunkStream } from '../chunk-stream/demuxer.js'

describe('Router demuxChunkStream Pipeline', () => {
  it('demuxes clean NDJSON stream into typed objects', async () => {
    const ndjson = [
      JSON.stringify({ id: 'c000', sequence: 0, cues: [{ id: '1' }] }) + '\n',
      JSON.stringify({ id: 'c001', sequence: 1, cues: [{ id: '2' }] }) + '\n',
    ]

    async function* source() {
      for (const chunk of ndjson) {
        yield new TextEncoder().encode(chunk)
      }
    }

    const results = []
    for await (const item of demuxChunkStream(source())) {
      results.push(item)
    }

    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ id: 'c000', sequence: 0, cues: [{ id: '1' }] })
    expect(results[1]).toEqual({ id: 'c001', sequence: 1, cues: [{ id: '2' }] })
  })

  it('recovers from corrupt line by yielding synthetic empty chunk without breaking stream', async () => {
    const invalidListener = vi.fn()
    const ndjson = [
      JSON.stringify({ id: 'c000', sequence: 0, valid: true }) + '\n',
      'CORRUPT_NON_JSON_DATA\n',
      JSON.stringify({ id: 'c002', sequence: 2, valid: true }) + '\n',
    ]

    async function* source() {
      for (const chunk of ndjson) {
        yield new TextEncoder().encode(chunk)
      }
    }

    const results = []
    for await (const item of demuxChunkStream(source(), { onInvalidChunk: invalidListener })) {
      results.push(item)
    }

    expect(results).toHaveLength(3)
    expect(results[0]).toEqual({ id: 'c000', sequence: 0, valid: true })

    // Second chunk is synthetic empty chunk
    const emptyChunk = results[1] as Record<string, unknown>
    expect(emptyChunk.id).toBe('c001')
    expect(emptyChunk.sequence).toBe(1)
    expect(emptyChunk.residentBytes).toBe(0)
    expect(emptyChunk.state).toMatchObject({
      empty: true,
      synthetic: true,
      fallback: true,
      attempts: 1,
    })
    expect(invalidListener).toHaveBeenCalledTimes(1)

    // Third chunk resumed cleanly
    expect(results[2]).toEqual({ id: 'c002', sequence: 2, valid: true })
  })
})
