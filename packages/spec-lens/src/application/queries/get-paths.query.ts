import type { CachePort } from '../ports/cache.port.js'
import type { SpecPathEntry } from '../../domain/index.js'

export type GetPathsQuery = {
  fragmentsDir: string
  targetPath: string
  scope?: string
  domain?: string
}

export class GetPathsHandler {
  constructor(private readonly cache: CachePort) {}

  async handle(query: GetPathsQuery): Promise<SpecPathEntry[]> {
    return this.cache.listPaths({
      fragmentsDir: query.fragmentsDir,
      targetPath: query.targetPath,
      ...(query.scope !== undefined ? { scope: query.scope } : {}),
      ...(query.domain !== undefined ? { domain: query.domain } : {}),
    })
  }
}
