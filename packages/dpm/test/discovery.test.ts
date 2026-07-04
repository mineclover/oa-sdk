import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DISCOVERY_REPORT_KIND,
  classifyRelationshipCandidate,
  createRelationshipDiscoveryReport,
  type RelationshipDiscoveryReportInput,
} from '../src/index.js'

const fixturesRoot = new URL('./fixtures/discovery/', import.meta.url)

function readFixture<T>(name: string): T {
  const fixturePath = join(fixturesRoot.pathname, name)
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T
}

describe('DPM relationship discovery report', () => {
  it('creates a reviewable report without approving or executing candidates', () => {
    const report = createRelationshipDiscoveryReport(
      readFixture<RelationshipDiscoveryReportInput>('commerce-candidates.json'),
    )

    expect(report.kind).toBe(DISCOVERY_REPORT_KIND)
    expect(report.autoApproveEnabled).toBe(false)
    expect(report.summary).toEqual({
      candidateCount: 2,
      reviewCount: 1,
      rejectCount: 1,
      excludedCount: 1,
    })
    expect(report.candidates[0]).toMatchObject({
      id: 'candidate:orders_customer',
      confidence: {
        score: 0.998,
        level: 'high',
      },
      recommendation: 'review',
      executable: false,
    })
    expect('status' in report.candidates[0]!).toBe(false)
    expect('approved' in report.candidates[0]!).toBe(false)
  })

  it('preserves optional query log and ORM evidence without making it required', () => {
    const report = createRelationshipDiscoveryReport(
      readFixture<RelationshipDiscoveryReportInput>('commerce-candidates.json'),
    )
    const evidenceKinds = report.candidates[0]?.evidence.map(evidence => evidence.kind)

    expect(evidenceKinds).toEqual([
      'column_name_similarity',
      'orm_metadata',
      'query_log',
      'unique_candidate',
    ])
    expect(report.candidates[0]?.evidence.find(evidence => evidence.kind === 'query_log')?.metadata).toEqual({
      sampleCount: 128,
    })
  })

  it('marks low-confidence and ambiguous candidates for rejection instead of approval', () => {
    const report = createRelationshipDiscoveryReport(
      readFixture<RelationshipDiscoveryReportInput>('commerce-candidates.json'),
    )
    const lowConfidence = report.candidates.find(candidate => candidate.id === 'candidate:orders_status')

    expect(lowConfidence).toMatchObject({
      confidence: {
        score: 0.72,
        level: 'low',
      },
      recommendation: 'reject',
      executable: false,
    })
    expect(lowConfidence?.warnings).toEqual(['ambiguous-status-column', 'low-confidence'])
  })

  it('classifies high confidence candidates as review because auto-approval is out of scope', () => {
    expect(classifyRelationshipCandidate(0.999)).toEqual({
      level: 'high',
      recommendation: 'review',
    })
    expect(classifyRelationshipCandidate(0.5)).toEqual({
      level: 'low',
      recommendation: 'reject',
    })
  })
})
