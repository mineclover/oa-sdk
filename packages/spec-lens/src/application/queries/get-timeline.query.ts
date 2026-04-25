import type { CachePort } from '../ports/cache.port.js'
import type { SpecTimelineEntry } from '../../domain/index.js'

export type GetTimelineQuery = {
  fragmentsDir: string
  targetPath: string
  limit?: number
}

export class GetTimelineHandler {
  constructor(private readonly cache: CachePort) {}

  async handle(query: GetTimelineQuery): Promise<SpecTimelineEntry[]> {
    return this.cache.listTimeline({
      fragmentsDir: query.fragmentsDir,
      targetPath: query.targetPath,
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    })
  }
}
