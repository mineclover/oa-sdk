import { describe, expect, it } from 'vitest'

import { buildRuntimeSummary, deriveRuntimeState, type RuntimeSnapshot } from '../domain/index.js'

const baseSnapshot: RuntimeSnapshot = {
  startedAt: 100,
  uptimeMs: 900,
  shuttingDown: false,
  inFlight: [],
  metrics: {
    inFlight: 0,
    totalDispatched: 10,
    totalSucceeded: 8,
    totalFailed: 1,
    totalCancelled: 1,
    tokens: { input: 100, output: 50, total: 150 },
  },
  lastError: undefined,
  reloadCount: 0,
  lastReloadError: undefined,
}

describe('runtime summary view model', () => {
  it('derives runtime state from lifecycle fields', () => {
    expect(deriveRuntimeState({ ...baseSnapshot, startedAt: 0 })).toBe('stopped')
    expect(deriveRuntimeState({ ...baseSnapshot, shuttingDown: true })).toBe('stopping')
    expect(deriveRuntimeState({
      ...baseSnapshot,
      inFlight: [{
        issueId: '1',
        issueIid: '1',
        title: 'Issue',
        url: 'https://gitlab/issues/1',
        agent: 'codex',
        turnNumber: 1,
        attempt: 1,
        startedAt: 100,
        elapsedMs: 10,
        lastTurnStatus: undefined,
      }],
    })).toBe('running')
    expect(deriveRuntimeState(baseSnapshot)).toBe('idle')
  })

  it('sorts in-flight issues by age and surfaces errors', () => {
    const summary = buildRuntimeSummary({
      ...baseSnapshot,
      lastError: { msg: 'tick failed', at: 200 },
      inFlight: [
        {
          issueId: 'young',
          issueIid: '2',
          title: 'Young',
          url: 'https://gitlab/issues/2',
          agent: 'codex',
          turnNumber: 1,
          attempt: 1,
          startedAt: 900,
          elapsedMs: 100,
          lastTurnStatus: 'running',
        },
        {
          issueId: 'old',
          issueIid: '1',
          title: 'Old',
          url: 'https://gitlab/issues/1',
          agent: 'codex',
          turnNumber: 1,
          attempt: 1,
          startedAt: 100,
          elapsedMs: 900,
          lastTurnStatus: 'running',
        },
      ],
    }, { now: 1_000, topInFlightLimit: 1 })

    expect(summary.topInFlight.map((issue) => issue.issueId)).toEqual(['old'])
    expect(summary.health).toBe('error')
    expect(summary.warnings[0]?.message).toBe('tick failed')
  })
})
