import { describe, expect, it } from 'vitest'

import {
  DPM_PROFILE_DRIFT_SIGNAL_KINDS,
  DPM_PROFILE_EDGE_KINDS,
  DPM_PROFILE_KEY_CANDIDATE_KINDS,
  DPM_PROFILE_METRIC_KINDS,
  DPM_PROFILE_NODE_KINDS,
  DPM_PROFILE_PROPOSAL_REVIEW_STATUSES,
  DPM_PROFILE_RELATIONSHIP_HINT_STATUSES,
  DPM_PROFILE_RISK_INDICATOR_KINDS,
  DPM_PROFILE_SOURCE_KINDS,
} from '../src/index.js'
import { getDpmGatewaySchema } from './support/gateway-taxonomy-fixtures.js'

describe('DPM gateway profile taxonomy projection', () => {
  it('projects profile runtime taxonomies into the gateway schema', () => {
    const coordinateSchema = getDpmGatewaySchema('DpmProfileCoordinate')
    const sourceSchema = getDpmGatewaySchema('DpmProfileSourceDescriptor')
    const nodeSchema = getDpmGatewaySchema('DpmProfileNode')
    const edgeSchema = getDpmGatewaySchema('DpmProfileEdge')
    const metricSchema = getDpmGatewaySchema('DpmProfileMetric')
    const hintSchema = getDpmGatewaySchema('DpmProfileRelationshipHintProposal')
    const keySchema = getDpmGatewaySchema('DpmProfileKeyCandidate')
    const driftSchema = getDpmGatewaySchema('DpmProfileDriftSignal')
    const riskSchema = getDpmGatewaySchema('DpmProfileRiskIndicator')
    const reviewSchema = getDpmGatewaySchema('DpmProfileProposalReviewRequest')

    expect(coordinateSchema.properties.kind.enum).toEqual([...DPM_PROFILE_SOURCE_KINDS])
    expect(sourceSchema.properties.kind.enum).toEqual([...DPM_PROFILE_SOURCE_KINDS])
    expect(nodeSchema.properties.kind.enum).toEqual([...DPM_PROFILE_NODE_KINDS])
    expect(edgeSchema.properties.kind.enum).toEqual([...DPM_PROFILE_EDGE_KINDS])
    expect(metricSchema.properties.kind.enum).toEqual([...DPM_PROFILE_METRIC_KINDS])
    expect(hintSchema.properties.status.enum).toEqual([...DPM_PROFILE_RELATIONSHIP_HINT_STATUSES])
    expect(keySchema.properties.kind.enum).toEqual([...DPM_PROFILE_KEY_CANDIDATE_KINDS])
    expect(driftSchema.properties.kind.enum).toEqual([...DPM_PROFILE_DRIFT_SIGNAL_KINDS])
    expect(riskSchema.properties.kind.enum).toEqual([...DPM_PROFILE_RISK_INDICATOR_KINDS])
    expect(reviewSchema.properties.status.enum).toEqual([...DPM_PROFILE_PROPOSAL_REVIEW_STATUSES])
  })
})
