import { relationshipHint } from './gateway-proposal-fixtures.js'

export const profileAnalysisReport = {
  kind: 'dpm.profile.analysis-report.v1',
  reportId: 'profile-analysis:orders.created',
  profileId: 'profile:kafka:orders.created',
  datasetId: 'commerce_ai',
  profileVersion: '2026-07-04',
  analyzedAt: '2026-07-04T00:00:00.000Z',
  profileVersionHash: 'sha256:profile',
  coverage: {
    sourceKindCounts: { kafka_topic_bundle: 1 },
    nodeKindCounts: { message_field: 1 },
    metricKindCounts: {},
    measuredNodeCount: 0,
    measuredNodeRatio: 0,
  },
  relationshipHints: [relationshipHint],
  keyCandidates: [],
  driftSignals: [],
  riskIndicators: [],
  diagnostics: [],
  summary: {
    nodeCount: 1,
    edgeCount: 0,
    metricCount: 0,
    diagnosticCount: 0,
    relationshipHintCount: 1,
    keyCandidateCount: 0,
    riskIndicatorCount: 0,
    driftSignalCount: 0,
  },
  freshness: {
    reportHash: 'sha256:analysis',
    profileVersionHash: 'sha256:profile',
  },
}
