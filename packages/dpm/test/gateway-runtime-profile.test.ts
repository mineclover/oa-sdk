import { describe, expect, it } from 'vitest'

import { createDpmGatewayRuntime } from '../src/index.js'
import { compileGatewayComponentSchema } from './support/gateway-schema.js'
import { createKafkaProfileArtifact } from './support/gateway-runtime-fixtures.js'

describe('DPM gateway profile runtime adapter', () => {
  it('keeps profile inspection and analysis outputs aligned with gateway response schemas', async () => {
    const runtime = createDpmGatewayRuntime()
    const profileArtifact = createKafkaProfileArtifact()

    const inspection = await runtime.inspectDpmProfile({ profileArtifact })
    const analysis = await runtime.analyzeDpmProfile({ profileArtifact })
    const inspectionSchema = compileGatewayComponentSchema('DpmProfileInspectionResponse')
    const analysisSchema = compileGatewayComponentSchema('DpmProfileAnalysisResponse')

    expect(inspection.statusCode).toBe(200)
    expect(inspection.body.command).toBe('inspect-profile')
    expect(inspection.body.result.nodeCount).toBe(profileArtifact.nodes.length)
    expect(inspection.body.result.edgeCount).toBe(profileArtifact.edges.length)
    expect(inspection.body.result.metricCount).toBe(profileArtifact.metrics.length)
    expect(inspectionSchema(inspection.body.result), JSON.stringify(inspectionSchema.errors, null, 2)).toBe(true)

    expect(analysis.statusCode).toBe(200)
    expect(analysis.body.command).toBe('analyze-profile')
    expect(analysis.body.result.analysisReport.relationshipHints.length).toBeGreaterThan(0)
    expect(analysisSchema(analysis.body.result), JSON.stringify(analysisSchema.errors, null, 2)).toBe(true)
    expect(JSON.stringify(analysis.body.result)).not.toContain('rawSample')
    expect(JSON.stringify(analysis.body.result)).not.toContain('C-001')
  })

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
    expect(reviewSchema(response.body.result), JSON.stringify(reviewSchema.errors, null, 2)).toBe(true)
    expect(response.body.result).not.toHaveProperty('profileArtifact')
    expect(response.body.result).not.toHaveProperty('evidenceSources')
    expect(JSON.stringify(response.body.result)).not.toContain('rawSample')
  })
})
