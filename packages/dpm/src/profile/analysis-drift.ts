import type {
  DpmProfileDriftSignal,
} from './analysis-types.js'
import type { DpmProfileArtifact } from './profile-artifact-types.js'

export function analyzeDriftSignals(
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

function unionKeys(left: Record<string, unknown>, right: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id)
}
