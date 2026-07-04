import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DPM_PROFILE_ANALYSIS_REPORT_KIND,
  createDpmProfileAnalysisReport,
  profileKafkaTopicFixture,
  type DpmKafkaTopicProfileFixture,
} from '../src/index.js'

const profileFixturesRoot = new URL('./fixtures/profile/', import.meta.url)

function readProfileFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(profileFixturesRoot.pathname, name), 'utf8')) as T
}

function createKafkaProfile() {
  const fixture = readProfileFixture<DpmKafkaTopicProfileFixture>('kafka-orders-created.json')
  const result = profileKafkaTopicFixture(fixture)
  if (!result.profileArtifact) throw new Error('expected Kafka profile artifact')
  return result.profileArtifact
}

describe('DPM profile analysis report', () => {
  it('creates deterministic analysis reports for identical profile artifacts', () => {
    const profile = createKafkaProfile()
    const first = createDpmProfileAnalysisReport({ profileArtifact: profile })
    const second = createDpmProfileAnalysisReport({ profileArtifact: profile })

    expect(first.kind).toBe(DPM_PROFILE_ANALYSIS_REPORT_KIND)
    expect(first.freshness.reportHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(second.freshness.reportHash).toBe(first.freshness.reportHash)
    expect(second.summary).toEqual(first.summary)
  })

  it('reports coverage, key candidates, and privacy risk indicators without raw values', () => {
    const report = createDpmProfileAnalysisReport({ profileArtifact: createKafkaProfile() })
    const serializedRisks = JSON.stringify(report.riskIndicators)

    expect(report.coverage.nodeKindCounts.message_field).toBeGreaterThanOrEqual(5)
    expect(report.coverage.metricKindCounts.presence_ratio).toBeGreaterThanOrEqual(4)
    expect(report.coverage.measuredNodeRatio).toBeGreaterThan(0)
    expect(report.keyCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'message_key',
        nodeId: 'node:key:orders.created',
        confidence: 0.998,
      }),
      expect.objectContaining({
        kind: 'identifier_like_field',
        nodeId: 'node:field:orders.created.value.customer.customer_no',
      }),
    ]))
    expect(report.riskIndicators).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'identifier_like_field',
        nodeId: 'node:field:orders.created.value.customer.customer_no',
      }),
      expect.objectContaining({
        kind: 'high_null_ratio',
        metricId: 'metric:orders.created.value.order.promo_code.null',
      }),
    ]))
    expect(serializedRisks).not.toContain('rawSample')
    expect(serializedRisks).not.toContain('C-001')
  })

  it('emits relationship hints as reviewer proposals, not registry relationships', () => {
    const report = createDpmProfileAnalysisReport({ profileArtifact: createKafkaProfile() })
    const hint = report.relationshipHints.find(candidate => candidate.id === 'proposal:edge:relationship-hint:hint:orders-created-customer')

    expect(hint).toMatchObject({
      status: 'review',
      fromNodeId: 'node:field:orders.created.value.customer.customer_no',
      hintNodeId: 'node:relationship-hint:hint:orders-created-customer',
      targetRef: 'catalog://commerce/public.customers.customer_no',
      confidence: 0.93,
    })
    expect(hint?.evidenceIds).toEqual(['evidence:kafka:orders.created.relationship_hint.hint:orders-created-customer'])
    expect(hint?.explanation).toContain('orders.created customer_no')
    expect(JSON.stringify(hint)).not.toContain('"status":"approved"')
    expect(JSON.stringify(report)).not.toContain('registryVersion')
  })

  it('reports drift signals when profile evidence changes', () => {
    const fixture = readProfileFixture<DpmKafkaTopicProfileFixture>('kafka-orders-created.json')
    const previousResult = profileKafkaTopicFixture(fixture)
    const currentResult = profileKafkaTopicFixture({
      ...fixture,
      topic: {
        ...fixture.topic,
        value: {
          fields: fixture.topic.value.fields.map(field =>
            field.name === 'customer'
              ? {
                  ...field,
                  fields: field.fields?.map(child =>
                    child.name === 'customer_no'
                      ? { ...child, presenceRatio: 0.91 }
                      : child,
                  ),
                }
              : field,
          ),
        },
      },
    })

    if (!previousResult.profileArtifact || !currentResult.profileArtifact) throw new Error('expected profile artifacts')
    const report = createDpmProfileAnalysisReport({
      profileArtifact: currentResult.profileArtifact,
      previousProfileArtifact: previousResult.profileArtifact,
    })

    expect(report.driftSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'profile_hash_changed',
        severity: 'warning',
      }),
      expect.objectContaining({
        kind: 'metric_value_changed',
        metricId: 'metric:orders.created.value.customer.customer_no.presence',
        previousValue: 0.997,
        currentValue: 0.91,
      }),
    ]))
    expect(report.summary.driftSignalCount).toBeGreaterThan(0)
  })
})
