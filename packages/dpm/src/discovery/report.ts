import type {
  DiscoveryCandidateRecommendation,
  DiscoveryConfidenceLevel,
  DiscoveryEvidence,
  DiscoveryThresholds,
  ExcludedRelationshipCandidate,
  RelationshipCandidate,
  RelationshipCandidateInput,
  RelationshipDiscoveryEndpoint,
  RelationshipDiscoveryReport,
  RelationshipDiscoveryReportInput,
} from './types.js'

export const DISCOVERY_REPORT_KIND = 'dpm.relationship.discovery-report.v1' as const

const DEFAULT_THRESHOLDS: DiscoveryThresholds = {
  reviewMin: 0.9,
  rejectBelow: 0.9,
  highConfidenceMin: 0.995,
  maxOrphanRatioBlocking: 0.001,
}

export function createRelationshipDiscoveryReport(
  input: RelationshipDiscoveryReportInput,
): RelationshipDiscoveryReport {
  const thresholds = normalizeThresholds(input.thresholds)
  const candidates = input.candidates
    .map(candidate => normalizeCandidate(candidate, thresholds))
    .sort((left, right) => left.id.localeCompare(right.id))
  const exclusions = [...(input.exclusions ?? [])].map(copyExclusion).sort((left, right) => left.id.localeCompare(right.id))
  const diagnostics = [...(input.diagnostics ?? [])].map(copyEvidence).sort(byEvidence)

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

export function classifyRelationshipCandidate(
  score: number,
  thresholds: DiscoveryThresholds = DEFAULT_THRESHOLDS,
): {
  level: DiscoveryConfidenceLevel
  recommendation: DiscoveryCandidateRecommendation
} {
  if (score < thresholds.rejectBelow) {
    return { level: 'low', recommendation: 'reject' }
  }
  if (score >= thresholds.highConfidenceMin) {
    return { level: 'high', recommendation: 'review' }
  }
  return { level: 'review', recommendation: 'review' }
}

function normalizeCandidate(
  candidate: RelationshipCandidateInput,
  thresholds: DiscoveryThresholds,
): RelationshipCandidate {
  const classification = classifyRelationshipCandidate(candidate.confidenceScore, thresholds)
  const warnings = normalizeWarnings(candidate, classification.level)

  return {
    id: candidate.id,
    relationshipName: candidate.relationshipName,
    type: candidate.type,
    parent: copyEndpoint(candidate.parent),
    child: copyEndpoint(candidate.child),
    confidence: {
      score: candidate.confidenceScore,
      level: classification.level,
    },
    evidence: candidate.evidence.map(copyEvidence).sort(byEvidence),
    warnings,
    recommendation: classification.recommendation,
    executable: false,
  }
}

function normalizeThresholds(thresholds: Partial<DiscoveryThresholds> | undefined): DiscoveryThresholds {
  return {
    reviewMin: thresholds?.reviewMin ?? DEFAULT_THRESHOLDS.reviewMin,
    rejectBelow: thresholds?.rejectBelow ?? DEFAULT_THRESHOLDS.rejectBelow,
    highConfidenceMin: thresholds?.highConfidenceMin ?? DEFAULT_THRESHOLDS.highConfidenceMin,
    maxOrphanRatioBlocking: thresholds?.maxOrphanRatioBlocking ?? DEFAULT_THRESHOLDS.maxOrphanRatioBlocking,
  }
}

function normalizeWarnings(
  candidate: RelationshipCandidateInput,
  level: DiscoveryConfidenceLevel,
): string[] {
  const warnings = new Set(candidate.warnings ?? [])

  if (level === 'low') warnings.add('low-confidence')
  if (candidate.evidence.length === 0) warnings.add('missing-evidence')
  if (candidate.parent.columns.length !== candidate.child.columns.length) warnings.add('column-count-mismatch')

  return [...warnings].sort()
}

function copyEndpoint(endpoint: RelationshipDiscoveryEndpoint): RelationshipDiscoveryEndpoint {
  return {
    table: endpoint.table,
    columns: [...endpoint.columns],
  }
}

function copyEvidence(evidence: DiscoveryEvidence): DiscoveryEvidence {
  return {
    kind: evidence.kind,
    ...(evidence.score !== undefined ? { score: evidence.score } : {}),
    message: evidence.message,
    ...(evidence.source ? { source: copySourceCoordinate(evidence.source) } : {}),
    ...(evidence.metadata ? { metadata: copyMetadata(evidence.metadata) } : {}),
  }
}

function copyExclusion(exclusion: ExcludedRelationshipCandidate): ExcludedRelationshipCandidate {
  return {
    id: exclusion.id,
    reason: exclusion.reason,
    message: exclusion.message,
    ...(exclusion.source ? { source: copySourceCoordinate(exclusion.source) } : {}),
  }
}

function copySourceCoordinate(source: NonNullable<DiscoveryEvidence['source']>) {
  if (source.kind === 'file') {
    return {
      kind: 'file' as const,
      filePath: source.filePath,
      pointer: source.pointer,
      ...(source.line !== undefined ? { line: source.line } : {}),
      ...(source.column !== undefined ? { column: source.column } : {}),
    }
  }

  return {
    kind: 'db' as const,
    entity: source.entity,
    id: source.id,
    pointer: source.pointer,
  }
}

function copyMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>
}

function byEvidence(left: DiscoveryEvidence, right: DiscoveryEvidence): number {
  return `${left.kind}.${left.message}`.localeCompare(`${right.kind}.${right.message}`)
}
