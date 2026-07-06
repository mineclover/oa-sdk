import type { DpmProfileRiskIndicator } from './analysis-signal-types.js'
import type { DpmProfileArtifact } from './profile-artifact-types.js'

export function analyzeMetricRatioRisks(profile: DpmProfileArtifact): DpmProfileRiskIndicator[] {
  const risks: DpmProfileRiskIndicator[] = []

  for (const metric of profile.metrics) {
    if (metric.kind === 'null_ratio' && typeof metric.value === 'number' && metric.value >= 0.5) {
      risks.push({
        id: `risk:${metric.id}:high_null_ratio`,
        kind: 'high_null_ratio',
        severity: 'info',
        metricId: metric.id,
        nodeId: metric.subjectId,
        evidenceIds: [...metric.evidenceIds].sort(),
        explanation: 'High null ratio can weaken relationship confidence and downstream analysis coverage.',
      })
    }
    if (metric.kind === 'presence_ratio' && typeof metric.value === 'number' && metric.value < 0.95) {
      risks.push({
        id: `risk:${metric.id}:low_presence_ratio`,
        kind: 'low_presence_ratio',
        severity: 'warning',
        metricId: metric.id,
        nodeId: metric.subjectId,
        evidenceIds: [...metric.evidenceIds].sort(),
        explanation: 'Low field presence can reduce relationship evidence reliability.',
      })
    }
  }

  return risks
}
