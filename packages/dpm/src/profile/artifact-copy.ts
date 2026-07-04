import type {
  DpmProfileCoordinate,
  DpmProfileDiagnostic,
  DpmProfileEdge,
  DpmProfileEvidenceSource,
  DpmProfileMetric,
  DpmProfileNode,
  DpmProfileSourceDescriptor,
} from './types.js'

export function copySourceDescriptor(source: DpmProfileSourceDescriptor): DpmProfileSourceDescriptor {
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

export function copyCoordinate(coordinate: DpmProfileCoordinate): DpmProfileCoordinate {
  return {
    kind: coordinate.kind,
    path: coordinate.path,
    ...(coordinate.sourceId ? { sourceId: coordinate.sourceId } : {}),
    ...(coordinate.pointer ? { pointer: coordinate.pointer } : {}),
    ...(coordinate.externalId ? { externalId: coordinate.externalId } : {}),
  }
}

export function copyEvidenceSource(source: DpmProfileEvidenceSource): DpmProfileEvidenceSource {
  return {
    coordinate: copyCoordinate(source.coordinate),
    ...(source.connectorId ? { connectorId: source.connectorId } : {}),
    ...(source.capturedAt ? { capturedAt: source.capturedAt } : {}),
    ...(source.description ? { description: source.description } : {}),
  }
}

export function copyNode(node: DpmProfileNode): DpmProfileNode {
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    coordinate: copyCoordinate(node.coordinate),
    ...(node.dataType ? { dataType: node.dataType } : {}),
    ...(node.shape ? { shape: sortShape(node.shape) } : {}),
  }
}

export function copyEdge(edge: DpmProfileEdge): DpmProfileEdge {
  return {
    id: edge.id,
    kind: edge.kind,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    evidenceIds: [...edge.evidenceIds].sort(),
    ...(edge.confidence !== undefined ? { confidence: edge.confidence } : {}),
  }
}

export function copyMetric(metric: DpmProfileMetric): DpmProfileMetric {
  return {
    id: metric.id,
    kind: metric.kind,
    subjectId: metric.subjectId,
    value: metric.value,
    ...(metric.unit ? { unit: metric.unit } : {}),
    evidenceIds: [...metric.evidenceIds].sort(),
  }
}

export function copyDiagnostic(diagnostic: DpmProfileDiagnostic): DpmProfileDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.connectorId ? { connectorId: diagnostic.connectorId } : {}),
    ...(diagnostic.coordinate ? { coordinate: copyCoordinate(diagnostic.coordinate) } : {}),
    ...(diagnostic.evidenceIds ? { evidenceIds: [...diagnostic.evidenceIds].sort() } : {}),
  }
}

export function sortEvidenceSources(
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
