import { describe, expect, it } from 'vitest'

import {
  DISCOVERY_CANDIDATE_RECOMMENDATIONS,
  DPM_COMPILED_PLAN_VERSIONS,
  DPM_DIAGNOSTIC_CODES,
  DPM_PLAN_STALE_REASONS,
  DPM_PROFILE_DRIFT_SIGNAL_KINDS,
  DPM_PROFILE_EDGE_KINDS,
  DPM_PROFILE_KEY_CANDIDATE_KINDS,
  DPM_PROFILE_METRIC_KINDS,
  DPM_PROFILE_NODE_KINDS,
  DPM_PROFILE_PROPOSAL_REVIEW_STATUSES,
  DPM_PROFILE_RELATIONSHIP_HINT_STATUSES,
  DPM_PROFILE_RISK_INDICATOR_KINDS,
  DPM_PROFILE_SOURCE_KINDS,
  DPM_RELATIONSHIP_STEP_CARDINALITIES,
  REGISTRY_ORPHAN_POLICIES,
  REGISTRY_RELATIONSHIP_KINDS,
  REGISTRY_RELATIONSHIP_STATUSES,
  REGISTRY_TRANSFORM_STRATEGIES,
  getDpmGatewayOpenApiDocument,
} from '../src/index.js'

describe('DPM gateway taxonomy projection', () => {
  it('projects the runtime diagnostic code taxonomy into the gateway schema', () => {
    const document = getDpmGatewayOpenApiDocument()
    const diagnosticSchema = document.components?.schemas?.DpmDiagnostic as Record<string, any>

    expect(diagnosticSchema.properties.code.enum).toEqual([...DPM_DIAGNOSTIC_CODES])
  })

  it('projects compiled plan runtime taxonomies into the gateway schema', () => {
    const document = getDpmGatewayOpenApiDocument()
    const compiledPlanSchema = document.components?.schemas?.DpmCompiledPlan as Record<string, any>

    expect(compiledPlanSchema.properties.planVersion.enum).toEqual([...DPM_COMPILED_PLAN_VERSIONS])
    expect(compiledPlanSchema.properties.staleReasons.items.enum).toEqual([...DPM_PLAN_STALE_REASONS])
  })

  it('projects workflow response runtime taxonomies into the gateway schema', () => {
    const document = getDpmGatewayOpenApiDocument()
    const discoverySchema = document.components?.schemas?.DpmRelationshipDiscoveryReport as Record<string, any>
    const registrySchema = document.components?.schemas?.DpmRegistrySnapshotResponse as Record<string, any>

    expect(discoverySchema.properties.candidates.items.properties.recommendation.enum).toEqual([
      ...DISCOVERY_CANDIDATE_RECOMMENDATIONS,
    ])
    expect(registrySchema.properties.relationships.items.properties.status.enum).toEqual([
      ...REGISTRY_RELATIONSHIP_STATUSES,
    ])
  })

  it('projects relationship step runtime taxonomies into the gateway schema', () => {
    const document = getDpmGatewayOpenApiDocument()
    const relationshipStepSchema = document.components?.schemas?.DpmRelationshipStep as Record<string, any>

    expect(relationshipStepSchema.properties.relationshipType.enum).toEqual([...REGISTRY_RELATIONSHIP_KINDS])
    expect(relationshipStepSchema.properties.cardinality.enum).toEqual([...DPM_RELATIONSHIP_STEP_CARDINALITIES])
    expect(relationshipStepSchema.properties.transformStrategy.enum).toEqual([...REGISTRY_TRANSFORM_STRATEGIES])
    expect(relationshipStepSchema.properties.orphanPolicy.enum).toEqual([...REGISTRY_ORPHAN_POLICIES])
  })

  it('projects profile runtime taxonomies into the gateway schema', () => {
    const document = getDpmGatewayOpenApiDocument()
    const coordinateSchema = document.components?.schemas?.DpmProfileCoordinate as Record<string, any>
    const sourceSchema = document.components?.schemas?.DpmProfileSourceDescriptor as Record<string, any>
    const nodeSchema = document.components?.schemas?.DpmProfileNode as Record<string, any>
    const edgeSchema = document.components?.schemas?.DpmProfileEdge as Record<string, any>
    const metricSchema = document.components?.schemas?.DpmProfileMetric as Record<string, any>
    const hintSchema = document.components?.schemas?.DpmProfileRelationshipHintProposal as Record<string, any>
    const keySchema = document.components?.schemas?.DpmProfileKeyCandidate as Record<string, any>
    const driftSchema = document.components?.schemas?.DpmProfileDriftSignal as Record<string, any>
    const riskSchema = document.components?.schemas?.DpmProfileRiskIndicator as Record<string, any>
    const reviewSchema = document.components?.schemas?.DpmProfileProposalReviewRequest as Record<string, any>

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
