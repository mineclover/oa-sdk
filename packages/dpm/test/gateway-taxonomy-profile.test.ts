import { describe, expect, it } from 'vitest'

import {
  DPM_PROFILE_CAPTURE_MODES,
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
import { getDpmGatewaySchemaValue } from './support/gateway-taxonomy-fixtures.js'
import { formatSchemaPath } from './support/schema-path.js'

const profileTaxonomyProjectionCases = [
  ['DpmProfileCoordinate', ['properties', 'kind', 'enum'], DPM_PROFILE_SOURCE_KINDS],
  ['DpmProfileSourceDescriptor', ['properties', 'kind', 'enum'], DPM_PROFILE_SOURCE_KINDS],
  ['DpmProfileSourceDescriptor', ['properties', 'captureMode', 'enum'], DPM_PROFILE_CAPTURE_MODES],
  ['DpmProfileNode', ['properties', 'kind', 'enum'], DPM_PROFILE_NODE_KINDS],
  ['DpmProfileEdge', ['properties', 'kind', 'enum'], DPM_PROFILE_EDGE_KINDS],
  ['DpmProfileMetric', ['properties', 'kind', 'enum'], DPM_PROFILE_METRIC_KINDS],
  ['DpmProfileRelationshipHintProposal', ['properties', 'status', 'enum'], DPM_PROFILE_RELATIONSHIP_HINT_STATUSES],
  ['DpmProfileKeyCandidate', ['properties', 'kind', 'enum'], DPM_PROFILE_KEY_CANDIDATE_KINDS],
  ['DpmProfileDriftSignal', ['properties', 'kind', 'enum'], DPM_PROFILE_DRIFT_SIGNAL_KINDS],
  ['DpmProfileRiskIndicator', ['properties', 'kind', 'enum'], DPM_PROFILE_RISK_INDICATOR_KINDS],
  ['DpmProfileProposalReviewRequest', ['properties', 'status', 'enum'], DPM_PROFILE_PROPOSAL_REVIEW_STATUSES],
] as const

describe('DPM gateway profile taxonomy projection', () => {
  it('projects profile runtime taxonomies into the gateway schema', () => {
    for (const [schemaName, path, expected] of profileTaxonomyProjectionCases) {
      expect(getDpmGatewaySchemaValue(schemaName, path), `${schemaName}.${formatSchemaPath(path)}`).toEqual([
        ...expected,
      ])
    }
  })
})
