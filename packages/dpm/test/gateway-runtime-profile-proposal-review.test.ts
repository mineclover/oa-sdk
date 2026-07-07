import { describe, expect, it } from 'vitest'

import { createDpmGatewayRuntime } from '../src/index.js'
import { createKafkaProfileArtifact } from './support/gateway-runtime-profile-artifact-fixtures.js'
import {
  GATEWAY_PROFILE_PROPOSAL_REVIEW_EXCLUDED_PROPERTIES,
  GATEWAY_PROFILE_RUNTIME_UNSAFE_RESULT_FRAGMENTS,
} from './support/gateway-runtime-profile-safety-fixtures.js'
import { compileGatewayComponentSchema } from './support/gateway-schema.js'

describe('DPM gateway profile proposal review runtime adapter', () => {
  it('keeps profile proposal review output editor-safe and schema-valid', async () => {
    const runtime = createDpmGatewayRuntime()
    const profileArtifact = createKafkaProfileArtifact()
    const analysis = await runtime.analyzeDpmProfile({ profileArtifact })
    const relationshipHint = analysis.body.result.analysisReport.relationshipHints[0]
    const coordinate = profileArtifact.nodes.find(node => node.id === relationshipHint?.fromNodeId)?.coordinate
    if (!relationshipHint || !coordinate) throw new Error('expected relationship hint and source coordinate')

    const response = await runtime.reviewDpmProfileProposal({
      proposalId: relationshipHint.id,
      status: 'accepted',
      reviewedBy: 'privacy-reviewer',
      reason: 'reviewed as a logical relationship candidate',
      reviewedAt: '2026-07-04T00:00:00.000Z',
      coordinate,
      relationshipHint,
    })
    const reviewSchema = compileGatewayComponentSchema('DpmProfileProposalReviewResponse')

    expect(response.statusCode).toBe(200)
    expect(response.body.command).toBe('review-profile-proposal')
    expect(
      reviewSchema(response.body.result),
      JSON.stringify(reviewSchema.errors, null, 2),
    ).toBe(true)

    for (const propertyName of GATEWAY_PROFILE_PROPOSAL_REVIEW_EXCLUDED_PROPERTIES) {
      expect(response.body.result).not.toHaveProperty(propertyName)
    }

    const serialized = JSON.stringify(response.body.result)
    for (const unsafeFragment of GATEWAY_PROFILE_RUNTIME_UNSAFE_RESULT_FRAGMENTS) {
      expect(serialized).not.toContain(unsafeFragment)
    }
  })

  it('rejects relationship hint reviews that target a different proposal id', async () => {
    const runtime = createDpmGatewayRuntime()
    const profileArtifact = createKafkaProfileArtifact()
    const analysis = await runtime.analyzeDpmProfile({ profileArtifact })
    const relationshipHint = analysis.body.result.analysisReport.relationshipHints[0]
    const coordinate = profileArtifact.nodes.find(node => node.id === relationshipHint?.fromNodeId)?.coordinate
    if (!relationshipHint || !coordinate) throw new Error('expected relationship hint and source coordinate')

    const response = await runtime.reviewDpmProfileProposal({
      proposalId: 'proposal:edge:relationship-hint:unexpected',
      status: 'accepted',
      reviewedBy: 'privacy-reviewer',
      reason: 'reviewed as a logical relationship candidate',
      reviewedAt: '2026-07-04T00:00:00.000Z',
      coordinate,
      relationshipHint,
    })
    const reviewSchema = compileGatewayComponentSchema('DpmProfileProposalReviewResponse')

    expect(response.statusCode).toBe(400)
    expect(
      reviewSchema(response.body.result),
      JSON.stringify(reviewSchema.errors, null, 2),
    ).toBe(true)
    expect(response.body.result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'PROF201',
      coordinate,
      evidenceIds: relationshipHint.evidenceIds,
    }))

    const serialized = JSON.stringify(response.body.result)
    for (const unsafeFragment of GATEWAY_PROFILE_RUNTIME_UNSAFE_RESULT_FRAGMENTS) {
      expect(serialized).not.toContain(unsafeFragment)
    }
  })
})
