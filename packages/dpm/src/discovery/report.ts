import type {
  RelationshipDiscoveryReport,
  RelationshipDiscoveryReportInput,
} from './discovery-report-types.js'
import {
  normalizeDiscoveryThresholds,
} from './classification.js'
import {
  compareDiscoveryEvidence,
  copyDiscoveryEvidence,
  copyExcludedRelationshipCandidate,
} from './copy.js'
import { normalizeRelationshipCandidate } from './candidate.js'

export { classifyRelationshipCandidate } from './classification.js'

export const DISCOVERY_REPORT_KIND = 'dpm.relationship.discovery-report.v1' as const

export function createRelationshipDiscoveryReport(
  input: RelationshipDiscoveryReportInput,
): RelationshipDiscoveryReport {
  const thresholds = normalizeDiscoveryThresholds(input.thresholds)
  const candidates = input.candidates
    .map(candidate => normalizeRelationshipCandidate(candidate, thresholds))
    .sort((left, right) => left.id.localeCompare(right.id))
  const exclusions = [...(input.exclusions ?? [])].map(copyExcludedRelationshipCandidate).sort((left, right) => left.id.localeCompare(right.id))
  const diagnostics = [...(input.diagnostics ?? [])].map(copyDiscoveryEvidence).sort(compareDiscoveryEvidence)

  return {
    kind: DISCOVERY_REPORT_KIND,
    datasetId: input.datasetId,
    ...(input.generatedAt ? { generatedAt: input.generatedAt } : {}),
    autoApproveEnabled: false,
    thresholds,
    candidates,
    exclusions,
    diagnostics,
    summary: {
      candidateCount: candidates.length,
      reviewCount: candidates.filter(candidate => candidate.recommendation === 'review').length,
      rejectCount: candidates.filter(candidate => candidate.recommendation === 'reject').length,
      excludedCount: exclusions.length,
    },
  }
}
