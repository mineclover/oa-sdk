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

  it('does not promote unresolved candidate relationship edges into reviewer proposals', () => {
    const profileArtifact = createKafkaProfileArtifact()
    const report = createDpmProfileAnalysisReport({
      profileArtifact: {
        ...profileArtifact,
        edges: [
          ...profileArtifact.edges,
          {
            id: 'edge:relationship-hint:missing-source',
            kind: 'candidate_relationship',
            fromNodeId: 'node:field:orders.created.value.customer.missing_field',
            toNodeId: 'node:relationship-hint:hint:orders-created-customer',
            confidence: 0.72,
            evidenceIds: [...expectedKafkaRelationshipHintEvidenceIds],
          },
          {
            id: 'edge:relationship-hint:missing-hint-node',
            kind: 'candidate_relationship',
            fromNodeId: 'node:field:orders.created.value.customer.customer_no',
            toNodeId: 'node:relationship-hint:missing',
            confidence: 0.71,
            evidenceIds: [...expectedKafkaRelationshipHintEvidenceIds],
          },
        ],
      },
    })

    expect(report.relationshipHints).toContainEqual(expect.objectContaining({
      id: 'proposal:edge:relationship-hint:hint:orders-created-customer',
    }))
    expect(report.relationshipHints).not.toContainEqual(expect.objectContaining({
      id: 'proposal:edge:relationship-hint:missing-source',
    }))
    expect(report.relationshipHints).not.toContainEqual(expect.objectContaining({
      id: 'proposal:edge:relationship-hint:missing-hint-node',
    }))
  })
})
