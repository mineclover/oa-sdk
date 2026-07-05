import type { DpmProfileRiskIndicator } from './analysis-types.js'
import {
  byId,
  evidenceIdsForNode,
  isIdentifierLikeNode,
} from './analysis-utils.js'
import type { DpmProfileArtifact } from './types.js'

export function analyzeRiskIndicators(profile: DpmProfileArtifact): DpmProfileRiskIndicator[] {
  const risks = new Map<string, DpmProfileRiskIndicator>()

  for (const node of profile.nodes) {
    if (!isIdentifierLikeNode(node)) continue
    risks.set(`risk:${node.id}:identifier_like_field`, {
      id: `risk:${node.id}:identifier_like_field`,
      kind: 'identifier_like_field',
      severity: 'warning',
      nodeId: node.id,
      evidenceIds: evidenceIdsForNode(profile, node.id),
      explanation: 'Profile coordinate resembles an identifier-like field and should be reviewed before publishing.',
    })
  }

  for (const metric of profile.metrics) {
    if (metric.kind === 'null_ratio' && typeof metric.value === 'number' && metric.value >= 0.5) {
      risks.set(`risk:${metric.id}:high_null_ratio`, {
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
      risks.set(`risk:${metric.id}:low_presence_ratio`, {
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

  return [...risks.values()].sort(byId)
}
