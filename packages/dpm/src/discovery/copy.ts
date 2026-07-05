import type {
  DiscoveryEvidence,
  ExcludedRelationshipCandidate,
  RelationshipDiscoveryEndpoint,
} from './types.js'

export function copyDiscoveryEndpoint(endpoint: RelationshipDiscoveryEndpoint): RelationshipDiscoveryEndpoint {
  return {
    table: endpoint.table,
    columns: [...endpoint.columns],
  }
}

export function copyDiscoveryEvidence(evidence: DiscoveryEvidence): DiscoveryEvidence {
  return {
    kind: evidence.kind,
    ...(evidence.score !== undefined ? { score: evidence.score } : {}),
    message: evidence.message,
    ...(evidence.source ? { source: copyDiscoverySourceCoordinate(evidence.source) } : {}),
    ...(evidence.metadata ? { metadata: copyDiscoveryMetadata(evidence.metadata) } : {}),
  }
}

export function copyExcludedRelationshipCandidate(
  exclusion: ExcludedRelationshipCandidate,
): ExcludedRelationshipCandidate {
  return {
    id: exclusion.id,
    reason: exclusion.reason,
    message: exclusion.message,
    ...(exclusion.source ? { source: copyDiscoverySourceCoordinate(exclusion.source) } : {}),
  }
}

export function compareDiscoveryEvidence(left: DiscoveryEvidence, right: DiscoveryEvidence): number {
  return `${left.kind}.${left.message}`.localeCompare(`${right.kind}.${right.message}`)
}

function copyDiscoverySourceCoordinate(source: NonNullable<DiscoveryEvidence['source']>) {
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

function copyDiscoveryMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>
}
