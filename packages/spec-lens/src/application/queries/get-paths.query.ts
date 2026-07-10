import type { CachePort } from '../ports/cache.port.js'
import type { SpecPathsResult } from '../../domain/index.js'
import type { SpecProjectSourceKind } from '../../domain/project.js'

export type GetPathsQuery = {
  projectKey: string
  projectKind: SpecProjectSourceKind
  scope?: string
  domain?: string
}

export class GetPathsHandler {
  constructor(private readonly cache: CachePort) {}

  async handle(query: GetPathsQuery): Promise<SpecPathsResult> {
    if (query.projectKind === 'typespec-bundle') {
      return {
        status: 'unavailable',
        projectKind: 'typespec-bundle',
        reason: 'output-pointer-mapping-unavailable',
      }
    }
    const entries = await this.cache.listPaths({
      projectKey: query.projectKey,
      ...(query.scope !== undefined ? { scope: query.scope } : {}),
      ...(query.domain !== undefined ? { domain: query.domain } : {}),
    })
    return { status: 'available', projectKind: 'definition-builder', entries }
  }
}
