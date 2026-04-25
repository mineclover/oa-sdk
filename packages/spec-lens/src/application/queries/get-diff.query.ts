import type { CachePort } from '../ports/cache.port.js'
import type { SnapshotBuilderPort } from '../ports/snapshot-builder.port.js'
import type { SpecTimelineDiff } from '../../domain/index.js'

export type GetDiffQuery = {
  baseRevisionId: string
  headRevisionId: string
  fragmentsDir: string
  targetPath: string
  targetConfigDigest: string
}

export class GetDiffHandler {
  constructor(
    private readonly cache: CachePort,
    private readonly builder: SnapshotBuilderPort,
  ) {}

  async handle(query: GetDiffQuery): Promise<SpecTimelineDiff | null> {
    const { baseRevisionId, headRevisionId, fragmentsDir, targetPath, targetConfigDigest } = query
    const cached = await this.cache.getDiff(baseRevisionId, headRevisionId, fragmentsDir, targetPath)
    if (cached !== null) return cached

    // On-demand compute if not cached
    const [base, head] = await Promise.all([
      this.cache.getSnapshotByRevision(baseRevisionId, fragmentsDir, targetPath, targetConfigDigest),
      this.cache.getSnapshotByRevision(headRevisionId, fragmentsDir, targetPath, targetConfigDigest),
    ])
    if (base === null || head === null) return null

    const diff = this.builder.diff(base, head)
    await this.cache.saveDiff(diff, fragmentsDir, targetPath)
    return diff
  }
}
