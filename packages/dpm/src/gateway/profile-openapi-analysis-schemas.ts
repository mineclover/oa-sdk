import {
  DPM_PROFILE_ANALYSIS_REPORT_KIND,
} from '../profile/analysis-report-types.js'
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
  ref,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmProfileAnalysisGatewaySchemas() {
  return {
    DpmProfileAnalysisRequest: requiredObjectSchema({
      profileArtifact: ref('DpmProfileArtifact'),
      previousProfileArtifact: ref('DpmProfileArtifact'),
      reportId: stringSchema(),
      analyzedAt: stringSchema(),
    }, ['profileArtifact']),
    DpmProfileAnalysisResponse: requiredObjectSchema({
      analysisReport: ref('DpmProfileAnalysisReport'),
    }),
    DpmProfileAnalysisReport: requiredObjectSchema({
      kind: { type: 'string', const: DPM_PROFILE_ANALYSIS_REPORT_KIND },
      reportId: stringSchema(),
      profileId: stringSchema(),
      datasetId: stringSchema(),
      profileVersion: stringSchema(),
      analyzedAt: stringSchema(),
      profileVersionHash: stringSchema(),
      coverage: ref('DpmProfileAnalysisCoverage'),
      relationshipHints: arrayOf(ref('DpmProfileRelationshipHintProposal')),
      keyCandidates: arrayOf(ref('DpmProfileKeyCandidate')),
      driftSignals: arrayOf(ref('DpmProfileDriftSignal')),
      riskIndicators: arrayOf(ref('DpmProfileRiskIndicator')),
      diagnostics: arrayOf(ref('DpmProfileDiagnostic')),
      summary: ref('DpmProfileAnalysisSummary'),
      freshness: ref('DpmProfileAnalysisFreshness'),
    }),
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
    DpmProfileAnalysisSummary: requiredObjectSchema({
      nodeCount: integerSchema(),
      edgeCount: integerSchema(),
      metricCount: integerSchema(),
      diagnosticCount: integerSchema(),
      relationshipHintCount: integerSchema(),
      keyCandidateCount: integerSchema(),
      riskIndicatorCount: integerSchema(),
      driftSignalCount: integerSchema(),
    }),
    DpmProfileAnalysisFreshness: requiredObjectSchema({
      reportHash: stringSchema(),
      profileVersionHash: stringSchema(),
      previousProfileVersionHash: stringSchema(),
    }, ['reportHash', 'profileVersionHash']),
  } as const
}
