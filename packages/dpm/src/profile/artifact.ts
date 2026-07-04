import { createHash } from 'node:crypto'

import {
  DPM_PROFILE_ARTIFACT_KIND,
  type DpmProfileArtifact,
  type DpmProfileCoordinate,
  type DpmProfileDiagnostic,
  type DpmProfileEdge,
  type DpmProfileEvidenceSource,
  type DpmProfileMetric,
  type DpmProfileNode,
  type DpmProfileSourceDescriptor,
} from './types.js'

export type DpmProfileArtifactInput = Omit<DpmProfileArtifact, 'kind' | 'freshness'> & {
  sourceVersionHashes?: Readonly<Record<string, string>>
}

export function normalizeDpmProfileArtifact(input: DpmProfileArtifactInput): DpmProfileArtifact {
  const structural: Omit<DpmProfileArtifact, 'freshness'> = {
    kind: DPM_PROFILE_ARTIFACT_KIND,
    profileId: input.profileId,
    datasetId: input.datasetId,
    profileVersion: input.profileVersion,
    createdAt: input.createdAt,
    sources: input.sources.map(copySourceDescriptor).sort(byId),
    evidenceSources: sortEvidenceSources(input.evidenceSources),
    nodes: input.nodes.map(copyNode).sort(byId),
    edges: input.edges.map(copyEdge).sort(byId),
    metrics: input.metrics.map(copyMetric).sort(byId),
    diagnostics: input.diagnostics.map(copyDiagnostic).sort(byDiagnostic),
  }

  const sourceVersionHashes = collectSourceVersionHashes(structural.sources, input.sourceVersionHashes)

  return {
    ...structural,
    freshness: {
      versionHash: computeDpmProfileFreshnessHash(structural),
      ...(Object.keys(sourceVersionHashes).length > 0 ? { sourceVersionHashes } : {}),
    },
  }
}

export function computeDpmProfileFreshnessHash(
  input: Omit<DpmProfileArtifact, 'freshness'> | DpmProfileArtifactInput,
): string {
  const structural = 'kind' in input
    ? input
    : {
        kind: DPM_PROFILE_ARTIFACT_KIND,
        profileId: input.profileId,
        datasetId: input.datasetId,
        profileVersion: input.profileVersion,
        createdAt: input.createdAt,
        sources: input.sources,
        evidenceSources: input.evidenceSources,
        nodes: input.nodes,
        edges: input.edges,
        metrics: input.metrics,
        diagnostics: input.diagnostics,
      }

  return `sha256:${createHash('sha256').update(stableStringify(structural)).digest('hex')}`
}

function copySourceDescriptor(source: DpmProfileSourceDescriptor): DpmProfileSourceDescriptor {
  return {
    id: source.id,
    kind: source.kind,
    connectorId: source.connectorId,
    connectorVersion: source.connectorVersion,
    refs: [...source.refs].sort(),
    captureMode: source.captureMode,
    ...(source.capturedAt ? { capturedAt: source.capturedAt } : {}),
    ...(source.sourceVersionHash ? { sourceVersionHash: source.sourceVersionHash } : {}),
  }
}

function copyCoordinate(coordinate: DpmProfileCoordinate): DpmProfileCoordinate {
  return {
    kind: coordinate.kind,
    path: coordinate.path,
    ...(coordinate.sourceId ? { sourceId: coordinate.sourceId } : {}),
    ...(coordinate.pointer ? { pointer: coordinate.pointer } : {}),
    ...(coordinate.externalId ? { externalId: coordinate.externalId } : {}),
  }
}

function copyEvidenceSource(source: DpmProfileEvidenceSource): DpmProfileEvidenceSource {
  return {
    coordinate: copyCoordinate(source.coordinate),
    ...(source.connectorId ? { connectorId: source.connectorId } : {}),
    ...(source.capturedAt ? { capturedAt: source.capturedAt } : {}),
    ...(source.description ? { description: source.description } : {}),
  }
}

function copyNode(node: DpmProfileNode): DpmProfileNode {
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    coordinate: copyCoordinate(node.coordinate),
    ...(node.dataType ? { dataType: node.dataType } : {}),
    ...(node.shape ? { shape: sortShape(node.shape) } : {}),
  }
}

function copyEdge(edge: DpmProfileEdge): DpmProfileEdge {
  return {
    id: edge.id,
    kind: edge.kind,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    evidenceIds: [...edge.evidenceIds].sort(),
    ...(edge.confidence !== undefined ? { confidence: edge.confidence } : {}),
  }
}

function copyMetric(metric: DpmProfileMetric): DpmProfileMetric {
  return {
    id: metric.id,
    kind: metric.kind,
    subjectId: metric.subjectId,
    value: metric.value,
    ...(metric.unit ? { unit: metric.unit } : {}),
    evidenceIds: [...metric.evidenceIds].sort(),
  }
}

function copyDiagnostic(diagnostic: DpmProfileDiagnostic): DpmProfileDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.connectorId ? { connectorId: diagnostic.connectorId } : {}),
    ...(diagnostic.coordinate ? { coordinate: copyCoordinate(diagnostic.coordinate) } : {}),
    ...(diagnostic.evidenceIds ? { evidenceIds: [...diagnostic.evidenceIds].sort() } : {}),
  }
}

function sortEvidenceSources(
  sources: Readonly<Record<string, DpmProfileEvidenceSource>>,
): Record<string, DpmProfileEvidenceSource> {
  const sorted: Record<string, DpmProfileEvidenceSource> = {}
  for (const key of Object.keys(sources).sort()) {
    const source = sources[key]
    if (source) sorted[key] = copyEvidenceSource(source)
  }
  return sorted
}

function sortShape(shape: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
  const sorted: Record<string, string | number | boolean | null> = {}
  for (const key of Object.keys(shape).sort()) {
    const value = shape[key]
    if (value !== undefined) sorted[key] = value
  }
  return sorted
}

function collectSourceVersionHashes(
  sources: readonly DpmProfileSourceDescriptor[],
  input?: Readonly<Record<string, string>>,
): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const key of Object.keys(input ?? {}).sort()) {
    const value = input?.[key]
    if (value) hashes[key] = value
  }
  for (const source of sources) {
    if (source.sourceVersionHash) hashes[source.id] = source.sourceVersionHash
  }
  return hashes
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id)
}

function byDiagnostic(left: DpmProfileDiagnostic, right: DpmProfileDiagnostic): number {
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
