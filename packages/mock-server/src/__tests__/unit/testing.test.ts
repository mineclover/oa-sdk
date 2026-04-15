import { describe, it, expect } from 'vitest'
import { createCallbackTracker, createCoverageTracker } from '../../testing.js'

describe('createCoverageTracker', () => {
  it('onRequest로 operationId 추적', () => {
    const tracker = createCoverageTracker()
    tracker.onRequest({ operationId: 'listUsers' })
    tracker.onRequest({ operationId: 'getUser' })
    expect(tracker.called.has('listUsers')).toBe(true)
    expect(tracker.called.has('getUser')).toBe(true)
  })

  it('operationId 없으면 무시', () => {
    const tracker = createCoverageTracker()
    tracker.onRequest({})
    expect(tracker.called.size).toBe(0)
  })

  it('uncalled — 호출 안 된 목록', () => {
    const tracker = createCoverageTracker()
    tracker.onRequest({ operationId: 'listUsers' })
    const uncalled = tracker.uncalled(['listUsers', 'getUser', 'createUser'])
    expect(uncalled).toEqual(['getUser', 'createUser'])
  })

  it('coverage 비율', () => {
    const tracker = createCoverageTracker()
    tracker.onRequest({ operationId: 'a' })
    tracker.onRequest({ operationId: 'b' })
    expect(tracker.coverage(['a', 'b', 'c'])).toBeCloseTo(2 / 3)
  })

  it('빈 목록 → coverage 1', () => {
    const tracker = createCoverageTracker()
    expect(tracker.coverage([])).toBe(1)
  })

  it('reset', () => {
    const tracker = createCoverageTracker()
    tracker.onRequest({ operationId: 'a' })
    tracker.reset()
    expect(tracker.called.size).toBe(0)
  })

  it('중복 호출은 1회로 카운트', () => {
    const tracker = createCoverageTracker()
    tracker.onRequest({ operationId: 'a' })
    tracker.onRequest({ operationId: 'a' })
    expect(tracker.called.size).toBe(1)
  })
})

describe('createCallbackTracker', () => {
  it('captures callback attempts and resets them', () => {
    const tracker = createCallbackTracker()
    tracker.onCallback({
      callbackName: 'onData',
      expression: '{$request.query.callbackUrl}',
      method: 'post',
      resolved: true,
      url: 'https://client.test/hooks',
      contentType: 'application/json',
      headers: { 'Content-Type': 'application/json' },
      body: { ok: true },
    })

    expect(tracker.attempts).toHaveLength(1)
    expect(tracker.attempts[0]?.url).toBe('https://client.test/hooks')
    tracker.reset()
    expect(tracker.attempts).toHaveLength(0)
  })
})
