import type { CachePort } from '../ports/cache.port.js'
import type { BuildSpecProvenanceMap } from '@oa-sdk/codegen/spec-lens'
import type { SpecGraph, SpecSnapshotStored } from '../../domain/index.js'

export type GetGraphQuery = {
  revisionId: string
  projectKey: string
  toolchainFingerprint: string
}

export class GetGraphHandler {
  constructor(private readonly cache: CachePort) {}

  async handle(query: GetGraphQuery): Promise<SpecGraph | null> {
    const stored = await this.cache.getSnapshotByRevision(
      query.revisionId,
      query.projectKey,
      query.toolchainFingerprint,
    )
    if (stored === null) return null

    return buildGraph(stored)
  }
}

function buildGraph(snapshot: SpecSnapshotStored): SpecGraph {
  if (snapshot.projectKind === 'typespec-bundle') {
    if (snapshot.provenance.status === 'available') {
      return buildGraphFromProvenance(snapshot.spec, snapshot.provenance.entries)
    }
    return {
      nodes: snapshot.provenance.sourceFiles.map(source => ({
        id: `source-file:${source.relativePath}`,
        kind: 'source-file',
        scope: 'typespec',
        domain: 'unavailable',
        localName: source.relativePath,
        sourcePath: source.relativePath,
        contentHash: source.contentHash,
      })),
      edges: [],
    }
  }

  return buildGraphFromProvenance(snapshot.spec, snapshot.provenance.entries)
}

function buildGraphFromProvenance(
  spec: Record<string, unknown> | null,
  provenance: BuildSpecProvenanceMap,
): SpecGraph {
  const nodes = Object.entries(provenance).flatMap(([pointer, entry]) => {
    if (!isRecord(entry) || typeof entry.canonicalId !== 'string') return []
    const parts = entry.canonicalId.split(':')
    const kindPart = parts[0] ?? ''
    const pathPart = parts[1] ?? ''
    const segments = pathPart.split('/')
    const scope = segments[0] ?? ''
    const domain = segments[1] ?? ''
    const localName = segments.slice(2).join('/') || pointer

    return [{
      id: entry.canonicalId,
      kind: kindPart,
      scope,
      domain,
      localName,
      sourcePath: entry.sourcePath,
      contentHash: entry.contentHash,
    }]
  })

  // Deduplicate nodes by canonicalId
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  const edges = buildEdgesFromSpec(spec, provenance)

  return {
    nodes: [...nodeMap.values()],
    edges,
  }
}

function buildEdgesFromSpec(
  spec: Record<string, unknown> | null,
  provenance: BuildSpecProvenanceMap,
): SpecGraph['edges'] {
  if (spec === null) return []

  // Map output JSON pointer → canonicalId (e.g. "#/components/schemas/User" → "schema:public/users/User")
  const pointerToId = new Map<string, string>()
  for (const [ptr, entry] of Object.entries(provenance)) {
    if (isRecord(entry) && typeof entry.canonicalId === 'string') {
      pointerToId.set(ptr, entry.canonicalId)
    }
  }

  const edges: SpecGraph['edges'] = []
  collectRefs(spec, '#', edges, undefined, new WeakSet(), pointerToId)
  return edges
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectRefs(
  value: unknown,
  pointer: string,
  edges: SpecGraph['edges'],
  sourceId: string | undefined,
  visited: WeakSet<object>,
  pointerToId: Map<string, string>,
): void {
  if (typeof value !== 'object' || value === null) return
  if (visited.has(value)) return
  visited.add(value)

  if (Array.isArray(value)) {
    value.forEach((item, i) =>
      collectRefs(item, `${pointer}/${i}`, edges, sourceId, visited, pointerToId),
    )
    return
  }

  const obj = value as Record<string, unknown>
  // If this pointer is a known node, it becomes the source for nested refs
  const currentId = pointerToId.get(pointer) ?? sourceId

  if (typeof obj['$ref'] === 'string') {
    const targetId = pointerToId.get(obj['$ref'])
    if (currentId !== undefined && targetId !== undefined && currentId !== targetId) {
      edges.push({ source: currentId, target: targetId, refPointer: pointer })
    }
    // Don't return — OAS 3.1 allows sibling properties alongside $ref
  }

  for (const [key, child] of Object.entries(obj)) {
    if (key === '$ref') continue
    collectRefs(child, `${pointer}/${key}`, edges, currentId, visited, pointerToId)
  }
}
