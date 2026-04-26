import type { CachePort } from '../ports/cache.port.js'
import type { SpecFileEntry, SpecSnapshot, SpecSnapshotStored } from '../../domain/index.js'

export type GetSnapshotQuery = {
  revisionId: string
  fragmentsDir: string
  targetPath: string
  targetConfigDigest: string
  includeEntries?: boolean
}

export class GetSnapshotHandler {
  constructor(private readonly cache: CachePort) {}

  async handle(query: GetSnapshotQuery): Promise<SpecSnapshot | null> {
    const stored = await this.cache.getSnapshotByRevision(
      query.revisionId,
      query.fragmentsDir,
      query.targetPath,
      query.targetConfigDigest,
    )
    if (stored === null) return null

    if (!query.includeEntries) return storedToWire(stored)

    const entries = await this.resolveEntries(stored)
    return { ...storedToWire(stored), entries }
  }

  private async resolveEntries(stored: SpecSnapshotStored): Promise<SpecFileEntry[]> {
    const resolved: SpecFileEntry[] = []
    for (const ref of stored.entryRefs) {
      const content = await this.cache.getFragmentBlob(ref.contentHash)
      if (content !== null) {
        resolved.push({ relativePath: ref.relativePath, content, contentHash: ref.contentHash })
      } else {
        console.warn(`[spec-lens] Missing blob for ${ref.relativePath} (${ref.contentHash.slice(0, 8)})`)
      }
    }
    return resolved
  }
}

function storedToWire(stored: SpecSnapshotStored): SpecSnapshot {
  const { entryRefs: _, ...rest } = stored
  void _
  return rest
}
