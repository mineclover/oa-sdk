import type { CachePort } from '../ports/cache.port.js'
import type { BuildSpecProvenanceEntry } from '@oa-sdk/codegen/spec-lens'
import type { SpecGraph, SpecSnapshotStored } from '../../domain/index.js'

export type GetGraphQuery = {
  revisionId: string
  fragmentsDir: string
  targetPath: string
  targetConfigDigest: string
}

export class GetGraphHandler {
  constructor(private readonly cache: CachePort) {}

  async handle(query: GetGraphQuery): Promise<SpecGraph | null> {
    const stored = await this.cache.getSnapshotByRevision(
      query.revisionId,
      query.fragmentsDir,
      query.targetPath,
      query.targetConfigDigest,
    )
    if (stored === null) return null

    return buildGraph(stored)
  }
}

function buildGraph(snapshot: SpecSnapshotStored): SpecGraph {
  const nodes = Object.entries(snapshot.provenance).map(([pointer, rawEntry]) => {
    const entry = rawEntry as BuildSpecProvenanceEntry
    const parts = entry.canonicalId.split(':')
    const kindPart = parts[0] ?? ''
    const pathPart = parts[1] ?? ''
    const segments = pathPart.split('/')
    const scope = segments[0] ?? ''
    const domain = segments[1] ?? ''
    const localName = segments.slice(2).join('/') || pointer

    return {
      id: entry.canonicalId,
      kind: kindPart,
      scope,
      domain,
      localName,
      sourcePath: entry.sourcePath,
      contentHash: entry.contentHash,
    }
  })

  // Deduplicate nodes by canonicalId
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  // Build $ref edges from provenance diff pointers — use provenanceDiff from snapshot
  // For graph edges we use the component relationships embedded in the spec
  const edges = buildEdgesFromSpec(snapshot.spec)

  return {
    nodes: [...nodeMap.values()],
    edges,
  }
}

function buildEdgesFromSpec(spec: Record<string, unknown> | null): SpecGraph['edges'] {
  if (spec === null) return []
  const edges: SpecGraph['edges'] = []
  collectRefs(spec, '#', edges, undefined, new WeakSet())
  return edges
}

function collectRefs(
  value: unknown,
  pointer: string,
  edges: SpecGraph['edges'],
  sourceId: string | undefined,
  visited: WeakSet<object>,
): void {
  if (typeof value !== 'object' || value === null) return
  if (visited.has(value)) return
  visited.add(value)

  if (Array.isArray(value)) {
    value.forEach((item, i) => collectRefs(item, `${pointer}/${i}`, edges, sourceId, visited))
    return
  }
  const obj = value as Record<string, unknown>
  if (typeof obj['$ref'] === 'string') {
    const ref = obj['$ref'] as string
    if (sourceId !== undefined) {
      edges.push({ source: sourceId, target: ref, refPointer: pointer })
    }
    // Don't return — OAS 3.1 allows sibling properties alongside $ref
  }
  for (const [key, child] of Object.entries(obj)) {
    if (key === '$ref') continue
    collectRefs(child, `${pointer}/${key}`, edges, sourceId ?? pointer, visited)
  }
}
