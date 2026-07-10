import type { CachePort } from '../ports/cache.port.js'
import type { SnapshotBuilderPort } from '../ports/snapshot-builder.port.js'
import type { SpecTimelineDiff } from '../../domain/index.js'

export type GetDiffQuery = {
  baseRevisionId: string
  headRevisionId: string
  projectKey: string
  toolchainFingerprint: string
}

export class GetDiffHandler {
  constructor(
    private readonly cache: CachePort,
    private readonly builder: SnapshotBuilderPort,
  ) {}

  async handle(query: GetDiffQuery): Promise<SpecTimelineDiff | null> {
    const { baseRevisionId, headRevisionId, projectKey, toolchainFingerprint } = query
    const cached = await this.cache.getDiff(baseRevisionId, headRevisionId, projectKey)
    if (cached !== null) return cached

    // On-demand compute if not cached
    const [base, head] = await Promise.all([
      this.cache.getSnapshotByRevision(baseRevisionId, projectKey, toolchainFingerprint),
      this.cache.getSnapshotByRevision(headRevisionId, projectKey, toolchainFingerprint),
    ])
    if (base === null || head === null) return null

    const diff = this.builder.diff(base, head)
    await this.cache.saveDiff(diff, projectKey)
    return diff
  }
}
