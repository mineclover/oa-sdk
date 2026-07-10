import type { CachePort } from '../ports/cache.port.js'
import type { SpecPathEntry } from '../../domain/index.js'

export type GetPathsQuery = {
  projectKey: string
  scope?: string
  domain?: string
}

export class GetPathsHandler {
  constructor(private readonly cache: CachePort) {}

  async handle(query: GetPathsQuery): Promise<SpecPathEntry[]> {
    return this.cache.listPaths({
      projectKey: query.projectKey,
      ...(query.scope !== undefined ? { scope: query.scope } : {}),
      ...(query.domain !== undefined ? { domain: query.domain } : {}),
    })
  }
}
