import { describe, expect, it } from 'vitest'

import { normalizeContextSearchResponse } from '../domain/index.js'

describe('context search summary view model', () => {
  it('deduplicates, sorts, and normalizes search rows', () => {
    const summary = normalizeContextSearchResponse({
      cursor: 'page=2',
      results: [
        {
          id: 'gitlab://project/1/issues/1',
          kind: 'issue',
          title: 'Issue',
          score: 0.3,
          updatedAt: '2026-05-10T00:00:00.000Z',
          metadata: {},
        },
        {
          id: 'gitlab://project/1/releases/v1',
          kind: 'release',
          title: 'Release',
          score: 0.9,
          updatedAt: '2026-05-09T00:00:00.000Z',
          metadata: {},
        },
        {
          id: 'gitlab://project/1/issues/1',
          kind: 'issue',
          title: 'Duplicate',
          metadata: {},
        },
      ],
      warnings: [],
    })

    expect(summary.items.map((item) => item.kind)).toEqual(['release', 'issue'])
    expect(summary.hasNextPage).toBe(true)
  })

  it('counts warning severities', () => {
    const summary = normalizeContextSearchResponse({
      results: [],
      warnings: [
        { kind: 'discussion', code: 'unsupported_kind', message: 'unsupported' },
        { kind: 'pipeline', code: 'request_failed', message: 'failed', status: 500 },
      ],
    })

    expect(summary.warningCounts).toEqual({ info: 0, warning: 1, error: 1 })
    expect(summary.warnings.map((warning) => warning.severity)).toEqual(['warning', 'error'])
  })
})
