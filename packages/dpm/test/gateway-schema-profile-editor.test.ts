import { describe, expect, it } from 'vitest'

import { profileArtifact, profileCoordinate } from './support/gateway-profile-fixtures.js'
import { relationshipHint } from './support/gateway-proposal-fixtures.js'
import { compileGatewayComponentSchema } from './support/gateway-schema.js'

describe('DPM gateway profile editor schemas', () => {
  it('rejects incomplete profile analysis payloads and editor evidence mutation patches', () => {
    const analysisRequestSchema = compileGatewayComponentSchema('DpmProfileAnalysisRequest')
    const analysisResponseSchema = compileGatewayComponentSchema('DpmProfileAnalysisResponse')
    const reviewRequestSchema = compileGatewayComponentSchema('DpmProfileProposalReviewRequest')

    expect(analysisRequestSchema({
      profileArtifact: {},
    }), 'DpmProfileAnalysisRequest unexpectedly accepted an incomplete profile artifact').toBe(false)
    expect(analysisResponseSchema({
      analysisReport: {
        kind: 'dpm.profile.analysis-report.v1',
        reportId: 'profile-analysis:orders.created',
      },
    }), 'DpmProfileAnalysisResponse unexpectedly accepted an incomplete analysis report').toBe(false)
    expect(reviewRequestSchema({
      proposalId: relationshipHint.id,
      status: 'accepted',
      reviewedBy: 'privacy-reviewer',
      reason: 'reviewed against catalog evidence',
      rawPatch: { evidenceSources: {} },
    }), 'DpmProfileProposalReviewRequest unexpectedly accepted a raw evidence patch').toBe(false)
    expect(reviewRequestSchema({
      proposalId: relationshipHint.id,
      status: 'accepted',
      reviewedBy: 'privacy-reviewer',
      reason: 'reviewed against catalog evidence',
      profileArtifact,
    }), 'DpmProfileProposalReviewRequest unexpectedly accepted a profile artifact overwrite').toBe(false)
    expect(reviewRequestSchema({
      proposalId: relationshipHint.id,
      status: 'review',
      reviewedBy: 'privacy-reviewer',
      reason: 'reviewed against catalog evidence',
    }), 'DpmProfileProposalReviewRequest unexpectedly accepted the pre-decision relationship hint status').toBe(false)
    expect(reviewRequestSchema({
      proposalId: relationshipHint.id,
      status: 'accepted',
      reviewedBy: 'privacy-reviewer',
      reason: 'reviewed against catalog evidence',
      coordinate: profileCoordinate,
      relationshipHint,
    }), 'DpmProfileProposalReviewRequest unexpectedly accepted a duplicate body proposal id').toBe(false)
  })
})
