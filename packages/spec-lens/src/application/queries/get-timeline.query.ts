import type { CachePort } from '../ports/cache.port.js'
import type { SpecTimelineEntry } from '../../domain/index.js'

export type GetTimelineQuery = {
  projectKey: string
  limit?: number
}

export class GetTimelineHandler {
  constructor(private readonly cache: CachePort) {}

  async handle(query: GetTimelineQuery): Promise<SpecTimelineEntry[]> {
    return this.cache.listTimeline({
      projectKey: query.projectKey,
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    })
  }
}
