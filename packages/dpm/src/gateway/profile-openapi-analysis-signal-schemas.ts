import {
  DPM_PROFILE_DRIFT_SIGNAL_KINDS,
  DPM_PROFILE_KEY_CANDIDATE_KINDS,
  DPM_PROFILE_RELATIONSHIP_HINT_STATUSES,
  DPM_PROFILE_RISK_INDICATOR_KINDS,
} from '../profile/analysis-taxonomy.js'
import {
  DPM_PROFILE_METRIC_KINDS,
  DPM_PROFILE_NODE_KINDS,
  DPM_PROFILE_SOURCE_KINDS,
} from '../profile/types.js'
import {
  arrayOf,
  countRecordSchema,
  integerSchema,
  numberSchema,
  ratioSchema,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmProfileAnalysisSignalGatewaySchemas() {
  return {
    DpmProfileAnalysisCoverage: requiredObjectSchema({
      sourceKindCounts: countRecordSchema(DPM_PROFILE_SOURCE_KINDS),
      nodeKindCounts: countRecordSchema(DPM_PROFILE_NODE_KINDS),
      metricKindCounts: countRecordSchema(DPM_PROFILE_METRIC_KINDS),
      measuredNodeCount: integerSchema(),
      measuredNodeRatio: ratioSchema(),
    }),
    DpmProfileRelationshipHintProposal: requiredObjectSchema({
      id: stringSchema(),
      status: { type: 'string', enum: [...DPM_PROFILE_RELATIONSHIP_HINT_STATUSES] },
      fromNodeId: stringSchema(),
      hintNodeId: stringSchema(),
      targetRef: stringSchema(),
      confidence: ratioSchema(),
      evidenceIds: arrayOf(stringSchema()),
      explanation: stringSchema(),
    }, ['id', 'status', 'fromNodeId', 'hintNodeId', 'confidence', 'evidenceIds', 'explanation']),
    DpmProfileKeyCandidate: requiredObjectSchema({
      id: stringSchema(),
      kind: { type: 'string', enum: [...DPM_PROFILE_KEY_CANDIDATE_KINDS] },
      nodeId: stringSchema(),
      confidence: ratioSchema(),
      reason: stringSchema(),
      evidenceIds: arrayOf(stringSchema()),
    }),
    DpmProfileDriftSignal: requiredObjectSchema({
      id: stringSchema(),
      kind: { type: 'string', enum: [...DPM_PROFILE_DRIFT_SIGNAL_KINDS] },
      severity: { type: 'string', enum: ['warning', 'info'] },
      nodeId: stringSchema(),
      metricId: stringSchema(),
      sourceId: stringSchema(),
      previousValue: { oneOf: [numberSchema(), stringSchema()] },
      currentValue: { oneOf: [numberSchema(), stringSchema()] },
      explanation: stringSchema(),
    }, ['id', 'kind', 'severity', 'explanation']),
    DpmProfileRiskIndicator: requiredObjectSchema({
      id: stringSchema(),
      kind: { type: 'string', enum: [...DPM_PROFILE_RISK_INDICATOR_KINDS] },
      severity: { type: 'string', enum: ['warning', 'info'] },
      nodeId: stringSchema(),
      metricId: stringSchema(),
      evidenceIds: arrayOf(stringSchema()),
      explanation: stringSchema(),
    }, ['id', 'kind', 'severity', 'evidenceIds', 'explanation']),
  } as const
}
