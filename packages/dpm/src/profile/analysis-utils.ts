import type {
  DpmProfileArtifact,
  DpmProfileMetric,
  DpmProfileNode,
} from './types.js'

export function isIdentifierLikeNode(node: DpmProfileNode): boolean {
  if (node.kind !== 'column' && node.kind !== 'message_field' && node.kind !== 'message_key') return false
  const value = `${node.label}.${node.coordinate.path}`.toLowerCase()
  return /(^|[._-])(id|no|key)$/.test(value) ||
    /(^|[._-])(tenant_id|customer_no|order_id|user_id|account_id)([._-]|$)/.test(value)
}

export function evidenceIdsForNode(profile: DpmProfileArtifact, nodeId: string): string[] {
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

export function groupMetricsBySubject(metrics: readonly DpmProfileMetric[]): Map<string, DpmProfileMetric[]> {
  const grouped = new Map<string, DpmProfileMetric[]>()
  for (const metric of metrics) {
    const next = grouped.get(metric.subjectId) ?? []
    next.push(metric)
    grouped.set(metric.subjectId, next)
  }
  return grouped
}

export function countBy<T, K extends string>(items: readonly T[], selector: (item: T) => K): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {}
  for (const item of items) {
    const key = selector(item)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return sortRecord(counts)
}

export function readStringShape(node: DpmProfileNode | undefined, key: string): string | undefined {
  const value = node?.shape?.[key]
  return typeof value === 'string' ? value : undefined
}

export function roundRatio(value: number): number {
  return Number(value.toFixed(6))
}

export function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id)
}

function sortRecord<T extends Record<string, unknown>>(record: T): T {
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) sorted[key] = record[key]
  return sorted as T
}
