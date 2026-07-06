import { describe, expect, it } from 'vitest'

import {
  createDpmProfileAnalysisReport,
} from '../src/index.js'
import {
  createKafkaProfileArtifact,
  expectedKafkaRelationshipHintEvidenceIds,
} from './support/profile-analysis-fixtures.js'

describe('DPM profile analysis relationship hints', () => {
  it('emits relationship hints as reviewer proposals, not registry relationships', () => {
    const report = createDpmProfileAnalysisReport({
      profileArtifact: createKafkaProfileArtifact(),
    })
    const hint = report.relationshipHints.find(candidate =>
      candidate.id === 'proposal:edge:relationship-hint:hint:orders-created-customer'
    )

    expect(hint).toMatchObject({
      status: 'review',
      fromNodeId: 'node:field:orders.created.value.customer.customer_no',
      hintNodeId: 'node:relationship-hint:hint:orders-created-customer',
      targetRef: 'catalog://commerce/public.customers.customer_no',
      confidence: 0.93,
    })
    expect(hint?.evidenceIds).toEqual([...expectedKafkaRelationshipHintEvidenceIds])
    expect(hint?.explanation).toContain('orders.created customer_no')
    expect(JSON.stringify(hint)).not.toContain('"status":"approved"')
    expect(JSON.stringify(report)).not.toContain('registryVersion')
  })
})
