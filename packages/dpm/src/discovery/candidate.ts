import { classifyRelationshipCandidate } from './classification.js'
import {
  compareDiscoveryEvidence,
  copyDiscoveryEndpoint,
  copyDiscoveryEvidence,
} from './copy.js'
import type {
  DiscoveryThresholds,
  RelationshipCandidate,
  RelationshipCandidateInput,
} from './discovery-candidate-types.js'
import type {
  DiscoveryConfidenceLevel,
} from './discovery-taxonomy.js'

export function normalizeRelationshipCandidate(
  candidate: RelationshipCandidateInput,
  thresholds: DiscoveryThresholds,
): RelationshipCandidate {
  const classification = classifyRelationshipCandidate(candidate.confidenceScore, thresholds)
  const warnings = normalizeRelationshipCandidateWarnings(candidate, classification.level)

  return {
    id: candidate.id,
    relationshipName: candidate.relationshipName,
    type: candidate.type,
    parent: copyDiscoveryEndpoint(candidate.parent),
    child: copyDiscoveryEndpoint(candidate.child),
    confidence: {
      score: candidate.confidenceScore,
      level: classification.level,
    },
    evidence: candidate.evidence.map(copyDiscoveryEvidence).sort(compareDiscoveryEvidence),
    warnings,
    recommendation: classification.recommendation,
    executable: false,
  }
}

function normalizeRelationshipCandidateWarnings(
  candidate: RelationshipCandidateInput,
  level: DiscoveryConfidenceLevel,
): string[] {
  const warnings = new Set(candidate.warnings ?? [])

  if (level === 'low') warnings.add('low-confidence')
  if (candidate.evidence.length === 0) warnings.add('missing-evidence')
  if (candidate.parent.columns.length !== candidate.child.columns.length) warnings.add('column-count-mismatch')

  return [...warnings].sort()
}
