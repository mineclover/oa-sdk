import { DPM_PROFILE_ANALYSIS_REPORT_KIND } from '../profile/analysis-report-types.js'
import {
  arrayOf,
  integerSchema,
  ref,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmProfileAnalysisReportGatewaySchemas() {
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
