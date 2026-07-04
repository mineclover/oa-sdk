import type {
  DpmProfileAnalysisCoverage,
  DpmProfileKeyCandidate,
  DpmProfileRelationshipHintProposal,
  DpmProfileRiskIndicator,
} from './analysis-types.js'
import type {
  DpmProfileArtifact,
  DpmProfileMetric,
  DpmProfileNode,
} from './types.js'

export function analyzeCoverage(profile: DpmProfileArtifact): DpmProfileAnalysisCoverage {
  const measuredNodeIds = new Set(profile.metrics.map(metric => metric.subjectId))

  return {
    sourceKindCounts: countBy(profile.sources, source => source.kind),
    nodeKindCounts: countBy(profile.nodes, node => node.kind),
    metricKindCounts: countBy(profile.metrics, metric => metric.kind),
    measuredNodeCount: measuredNodeIds.size,
    measuredNodeRatio: profile.nodes.length > 0 ? roundRatio(measuredNodeIds.size / profile.nodes.length) : 0,
  }
}

export function analyzeRelationshipHints(profile: DpmProfileArtifact): DpmProfileRelationshipHintProposal[] {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]))

  return profile.edges
    .filter(edge => edge.kind === 'candidate_relationship')
    .map(edge => {
      const hintNode = nodes.get(edge.toNodeId)
      const targetRef = readStringShape(hintNode, 'toRef') ?? hintNode?.coordinate.externalId
      return {
        id: `proposal:${edge.id}`,
        status: 'review' as const,
        fromNodeId: edge.fromNodeId,
        hintNodeId: edge.toNodeId,
        ...(targetRef ? { targetRef } : {}),
        confidence: edge.confidence ?? 0,
        evidenceIds: [...edge.evidenceIds].sort(),
        explanation: hintNode?.label ?? `Review candidate relationship ${edge.id}.`,
      }
    })
    .sort(byId)
}

export function analyzeKeyCandidates(profile: DpmProfileArtifact): DpmProfileKeyCandidate[] {
  const candidates = new Map<string, DpmProfileKeyCandidate>()
  const nodes = new Map(profile.nodes.map(node => [node.id, node]))
  const metricsBySubject = groupMetricsBySubject(profile.metrics)

  for (const metric of profile.metrics) {
    if (metric.kind !== 'key_coverage_ratio' || typeof metric.value !== 'number') continue
    candidates.set(`key-candidate:${metric.subjectId}:message_key`, {
      id: `key-candidate:${metric.subjectId}:message_key`,
      kind: 'message_key',
      nodeId: metric.subjectId,
      confidence: roundRatio(metric.value),
      reason: 'Message key coverage metric suggests a stable key candidate.',
      evidenceIds: [...metric.evidenceIds].sort(),
    })
  }

  for (const node of profile.nodes) {
    if (!isIdentifierLikeNode(node)) continue
    const metrics = metricsBySubject.get(node.id) ?? []
    const presence = metrics.find(metric => metric.kind === 'presence_ratio' && typeof metric.value === 'number')
    const confidence = typeof presence?.value === 'number' ? roundRatio(presence.value) : 0.6
    candidates.set(`key-candidate:${node.id}:identifier_like_field`, {
      id: `key-candidate:${node.id}:identifier_like_field`,
      kind: 'identifier_like_field',
      nodeId: node.id,
      confidence,
      reason: 'Field name and type resemble an identifier or join key.',
      evidenceIds: [...(presence?.evidenceIds ?? evidenceIdsForNode(profile, node.id))].sort(),
    })
  }

  return [...candidates.values()].filter(candidate => nodes.has(candidate.nodeId)).sort(byId)
}

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

function isIdentifierLikeNode(node: DpmProfileNode): boolean {
  if (node.kind !== 'column' && node.kind !== 'message_field' && node.kind !== 'message_key') return false
  const value = `${node.label}.${node.coordinate.path}`.toLowerCase()
  return /(^|[._-])(id|no|key)$/.test(value) ||
    /(^|[._-])(tenant_id|customer_no|order_id|user_id|account_id)([._-]|$)/.test(value)
}

function evidenceIdsForNode(profile: DpmProfileArtifact, nodeId: string): string[] {
  const evidenceIds = new Set<string>()
  for (const edge of profile.edges) {
    if (edge.fromNodeId === nodeId || edge.toNodeId === nodeId) {
      for (const evidenceId of edge.evidenceIds) evidenceIds.add(evidenceId)
    }
  }
  for (const metric of profile.metrics) {
    if (metric.subjectId === nodeId) {
      for (const evidenceId of metric.evidenceIds) evidenceIds.add(evidenceId)
    }
  }
  return [...evidenceIds].sort()
}

function groupMetricsBySubject(metrics: readonly DpmProfileMetric[]): Map<string, DpmProfileMetric[]> {
  const grouped = new Map<string, DpmProfileMetric[]>()
  for (const metric of metrics) {
    const next = grouped.get(metric.subjectId) ?? []
    next.push(metric)
    grouped.set(metric.subjectId, next)
  }
  return grouped
}

function countBy<T, K extends string>(items: readonly T[], selector: (item: T) => K): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {}
  for (const item of items) {
    const key = selector(item)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return sortRecord(counts)
}

function sortRecord<T extends Record<string, unknown>>(record: T): T {
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) sorted[key] = record[key]
  return sorted as T
}

function readStringShape(node: DpmProfileNode | undefined, key: string): string | undefined {
  const value = node?.shape?.[key]
  return typeof value === 'string' ? value : undefined
}

function roundRatio(value: number): number {
  return Number(value.toFixed(6))
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id)
}
