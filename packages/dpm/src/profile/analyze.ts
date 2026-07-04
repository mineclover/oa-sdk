import { createHash } from 'node:crypto'

import {
  DPM_PROFILE_ANALYSIS_REPORT_KIND,
  type DpmProfileAnalysisCoverage,
  type DpmProfileAnalysisInput,
  type DpmProfileAnalysisReport,
  type DpmProfileDriftSignal,
  type DpmProfileKeyCandidate,
  type DpmProfileRelationshipHintProposal,
  type DpmProfileRiskIndicator,
} from './analysis-types.js'
import type {
  DpmProfileArtifact,
  DpmProfileMetric,
  DpmProfileNode,
} from './types.js'

export function createDpmProfileAnalysisReport(input: DpmProfileAnalysisInput): DpmProfileAnalysisReport {
  const coverage = analyzeCoverage(input.profileArtifact)
  const relationshipHints = analyzeRelationshipHints(input.profileArtifact)
  const keyCandidates = analyzeKeyCandidates(input.profileArtifact)
  const riskIndicators = analyzeRiskIndicators(input.profileArtifact)
  const driftSignals = analyzeDriftSignals(input.profileArtifact, input.previousProfileArtifact)
  const diagnostics = [...input.profileArtifact.diagnostics].sort(byDiagnostic)
  const structural = {
    kind: DPM_PROFILE_ANALYSIS_REPORT_KIND,
    reportId: input.reportId ?? `profile-analysis:${input.profileArtifact.profileId}:${input.profileArtifact.freshness.versionHash}`,
    profileId: input.profileArtifact.profileId,
    datasetId: input.profileArtifact.datasetId,
    profileVersion: input.profileArtifact.profileVersion,
    analyzedAt: input.analyzedAt ?? input.profileArtifact.createdAt,
    profileVersionHash: input.profileArtifact.freshness.versionHash,
    coverage,
    relationshipHints,
    keyCandidates,
    driftSignals,
    riskIndicators,
    diagnostics,
    summary: {
      nodeCount: input.profileArtifact.nodes.length,
      edgeCount: input.profileArtifact.edges.length,
      metricCount: input.profileArtifact.metrics.length,
      diagnosticCount: diagnostics.length,
      relationshipHintCount: relationshipHints.length,
      keyCandidateCount: keyCandidates.length,
      riskIndicatorCount: riskIndicators.length,
      driftSignalCount: driftSignals.length,
    },
  }

  return {
    ...structural,
    freshness: {
      reportHash: computeDpmProfileAnalysisReportHash(structural),
      profileVersionHash: input.profileArtifact.freshness.versionHash,
      ...(input.previousProfileArtifact ? { previousProfileVersionHash: input.previousProfileArtifact.freshness.versionHash } : {}),
    },
  }
}

export function computeDpmProfileAnalysisReportHash(
  input: Omit<DpmProfileAnalysisReport, 'freshness'>,
): string {
  return `sha256:${createHash('sha256').update(stableStringify(input)).digest('hex')}`
}

function analyzeCoverage(profile: DpmProfileArtifact): DpmProfileAnalysisCoverage {
  const measuredNodeIds = new Set(profile.metrics.map(metric => metric.subjectId))

  return {
    sourceKindCounts: countBy(profile.sources, source => source.kind),
    nodeKindCounts: countBy(profile.nodes, node => node.kind),
    metricKindCounts: countBy(profile.metrics, metric => metric.kind),
    measuredNodeCount: measuredNodeIds.size,
    measuredNodeRatio: profile.nodes.length > 0 ? roundRatio(measuredNodeIds.size / profile.nodes.length) : 0,
  }
}

function analyzeRelationshipHints(profile: DpmProfileArtifact): DpmProfileRelationshipHintProposal[] {
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

function analyzeKeyCandidates(profile: DpmProfileArtifact): DpmProfileKeyCandidate[] {
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

function analyzeRiskIndicators(profile: DpmProfileArtifact): DpmProfileRiskIndicator[] {
  const risks = new Map<string, DpmProfileRiskIndicator>()
  const metricsBySubject = groupMetricsBySubject(profile.metrics)

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

  for (const [subjectId, metrics] of metricsBySubject.entries()) {
    if (risks.has(`risk:${subjectId}:identifier_like_field`)) continue
    void metrics
  }

  return [...risks.values()].sort(byId)
}

function analyzeDriftSignals(
  current: DpmProfileArtifact,
  previous?: DpmProfileArtifact,
): DpmProfileDriftSignal[] {
  if (!previous) return []

  const signals = new Map<string, DpmProfileDriftSignal>()
  if (current.freshness.versionHash !== previous.freshness.versionHash) {
    signals.set('drift:profile_hash_changed', {
      id: 'drift:profile_hash_changed',
      kind: 'profile_hash_changed',
      severity: 'warning',
      previousValue: previous.freshness.versionHash,
      currentValue: current.freshness.versionHash,
      explanation: 'Profile artifact freshness changed.',
    })
  }

  for (const sourceId of unionKeys(previous.freshness.sourceVersionHashes ?? {}, current.freshness.sourceVersionHashes ?? {})) {
    const previousValue = previous.freshness.sourceVersionHashes?.[sourceId]
    const currentValue = current.freshness.sourceVersionHashes?.[sourceId]
    if (previousValue !== currentValue) {
      signals.set(`drift:source:${sourceId}`, {
        id: `drift:source:${sourceId}`,
        kind: 'source_version_hash_changed',
        severity: 'warning',
        sourceId,
        ...(previousValue ? { previousValue } : {}),
        ...(currentValue ? { currentValue } : {}),
        explanation: `Source freshness changed for ${sourceId}.`,
      })
    }
  }

  const previousNodes = new Set(previous.nodes.map(node => node.id))
  const currentNodes = new Set(current.nodes.map(node => node.id))
  for (const nodeId of [...currentNodes].filter(nodeId => !previousNodes.has(nodeId)).sort()) {
    signals.set(`drift:node-added:${nodeId}`, {
      id: `drift:node-added:${nodeId}`,
      kind: 'node_added',
      severity: 'info',
      nodeId,
      explanation: `Profile node ${nodeId} was added.`,
    })
  }
  for (const nodeId of [...previousNodes].filter(nodeId => !currentNodes.has(nodeId)).sort()) {
    signals.set(`drift:node-removed:${nodeId}`, {
      id: `drift:node-removed:${nodeId}`,
      kind: 'node_removed',
      severity: 'warning',
      nodeId,
      explanation: `Profile node ${nodeId} was removed.`,
    })
  }

  const previousMetrics = new Map(previous.metrics.map(metric => [metric.id, metric]))
  for (const currentMetric of current.metrics) {
    const previousMetric = previousMetrics.get(currentMetric.id)
    if (!previousMetric || previousMetric.value === currentMetric.value) continue
    signals.set(`drift:metric:${currentMetric.id}`, {
      id: `drift:metric:${currentMetric.id}`,
      kind: 'metric_value_changed',
      severity: 'warning',
      metricId: currentMetric.id,
      previousValue: previousMetric.value,
      currentValue: currentMetric.value,
      explanation: `Profile metric ${currentMetric.id} changed.`,
    })
  }

  return [...signals.values()].sort(byId)
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

function unionKeys(left: Record<string, unknown>, right: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
}

function roundRatio(value: number): number {
  return Number(value.toFixed(6))
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id)
}

function byDiagnostic(left: DpmProfileArtifact['diagnostics'][number], right: DpmProfileArtifact['diagnostics'][number]): number {
  return `${left.severity}.${left.code}.${left.message}`.localeCompare(`${right.severity}.${right.code}.${right.message}`)
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    const next = record[key]
    if (next !== undefined) sorted[key] = sortValue(next)
  }
  return sorted
}
