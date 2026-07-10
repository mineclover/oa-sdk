import { resolveSpecLensTypeSpecSourceReadBudget } from '@oa-sdk/codegen/spec-lens'
import { describe, expect, it, vi } from 'vitest'
import {
  createStreamingSourceReadTracker,
  readResponseBytesBounded,
  resolveSourceReadBudget,
  withSourceReadConcurrency,
} from '../infrastructure/source-adapters/source-read-budget.js'

const budget = resolveSpecLensTypeSpecSourceReadBudget()
const revision = {
  id: 'a'.repeat(40),
  shortId: 'aaaaaaa',
  timestamp: 1,
  message: 'test',
  source: 'local-git' as const,
}

describe('source read budget contract', () => {
  it('accepts the canonical policy or a stricter budget and rejects upward overrides', () => {
    expect(resolveSourceReadBudget({
      revision,
      sourceRoot: 'typespec',
      sourceKind: 'typespec-bundle',
      readBudget: budget,
    })).toEqual(budget)

    expect(() => resolveSourceReadBudget({
      revision,
      sourceRoot: 'typespec',
      sourceKind: 'typespec-bundle',
      readBudget: { ...budget, maxFileBytes: budget.maxFileBytes + 1 },
    })).toThrow('must not exceed canonical maximum')
  })

  it('stops assigning queued reads after the first task failure', async () => {
    const started: number[] = []
    const finished: number[] = []
    const queued = Array.from({ length: 8 }, (_, index) => vi.fn(async () => {
      started.push(index)
      if (index === 0) throw new Error('read failed')
      await new Promise(resolveWait => setTimeout(resolveWait, 10))
      finished.push(index)
      return index
    }))

    await expect(withSourceReadConcurrency(queued, 2)).rejects.toThrow('read failed')
    expect(started).toEqual([0, 1])
    expect(finished).toEqual([1])
    expect(queued.slice(2).every(task => task.mock.calls.length === 0)).toBe(true)
  })

  it('cancels active response readers and rejects their leases after a peer fails', async () => {
    const tinyBudget = {
      ...budget,
      maxFiles: 2,
      maxFileBytes: 4,
      maxTotalBytes: 4,
      maxConcurrency: 2,
    }
    const tracker = createStreamingSourceReadTracker(tinyBudget, 'test source read')
    let markPullStarted: (() => void) | undefined
    const pullStarted = new Promise<void>(resolveWait => { markPullStarted = resolveWait })
    let releasePull: (() => void) | undefined
    let cancellations = 0
    const activeBody = new ReadableStream<Uint8Array>({
      type: 'bytes',
      pull() {
        markPullStarted?.()
        return new Promise<void>(resolveWait => { releasePull = resolveWait })
      },
      cancel() {
        cancellations++
        releasePull?.()
      },
    } as never)
    const activeRead = readResponseBytesBounded(
      new Response(activeBody, { headers: { 'content-length': '4' } }),
      4,
      'active response',
      { tracker, relativePath: 'active.tsp' },
    )
    const activeFailure = expect(activeRead).rejects.toThrow('Content-Length exceeds 4 bytes')
    await pullStarted

    await expect(readResponseBytesBounded(
      new Response(new Uint8Array(5), { headers: { 'content-length': '5' } }),
      4,
      'failing response',
      { tracker, relativePath: 'failing.tsp' },
    )).rejects.toThrow('Content-Length exceeds 4 bytes')

    await vi.waitFor(() => expect(cancellations).toBe(1))
    await activeFailure
  })
})
