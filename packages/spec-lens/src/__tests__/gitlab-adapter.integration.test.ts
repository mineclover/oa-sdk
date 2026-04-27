import { describe, expect, it } from 'vitest'
import { GitlabAdapter } from '../infrastructure/source-adapters/gitlab/gitlab.adapter.js'
import type { TokenProvider } from '../infrastructure/source-adapters/github/token-provider.js'

const host = process.env['GITLAB_INTEGRATION_HOST']
const projectId = process.env['GITLAB_INTEGRATION_PROJECT_ID']
const token = process.env['GITLAB_INTEGRATION_TOKEN']
const fragmentsDir = process.env['GITLAB_INTEGRATION_FRAGMENTS_DIR'] ?? 'fragments'

const enabled = host !== undefined && projectId !== undefined && token !== undefined

const describeIntegration = enabled ? describe : describe.skip

class StaticToken implements TokenProvider {
  constructor(private readonly value: string) {}
  async getToken(): Promise<string> {
    return this.value
  }
}

describeIntegration('GitlabAdapter — integration', () => {
  const adapter = new GitlabAdapter({
    host: host!,
    projectId: projectId!,
    tokenProvider: new StaticToken(token!),
  })

  it('lists revisions touching the fragments directory', async () => {
    const revisions = await adapter.listRevisions({ fragmentsDir, branch: 'main', limit: 10 })

    expect(revisions.length).toBeGreaterThan(0)
    for (const rev of revisions) {
      expect(rev.source).toBe('gitlab')
      expect(typeof rev.id).toBe('string')
      expect(rev.id.length).toBeGreaterThan(0)
      expect(typeof rev.shortId).toBe('string')
      expect(typeof rev.message).toBe('string')
      expect(typeof rev.timestamp).toBe('number')
      expect(rev.sourceRef).toBe('main')
    }
  })

  it('fetches all fragment file entries at a revision with content + sha256', async () => {
    const revisions = await adapter.listRevisions({ fragmentsDir, branch: 'main', limit: 1 })
    expect(revisions.length).toBe(1)
    const head = revisions[0]!

    const entries = await adapter.getFileEntries({ revision: head, fragmentsDir })

    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry.relativePath).not.toContain(`${fragmentsDir}/`)
      expect(entry.content.length).toBeGreaterThan(0)
      expect(entry.contentHash).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('reflects content drift across consecutive revisions', async () => {
    const revisions = await adapter.listRevisions({ fragmentsDir, branch: 'main', limit: 5 })
    expect(revisions.length).toBeGreaterThanOrEqual(2)
    const head = revisions[0]!
    const earlier = revisions[revisions.length - 1]!

    const headEntries = await adapter.getFileEntries({ revision: head, fragmentsDir })
    const earlierEntries = await adapter.getFileEntries({ revision: earlier, fragmentsDir })

    const headByPath = new Map(headEntries.map(e => [e.relativePath, e.contentHash]))
    const earlierByPath = new Map(earlierEntries.map(e => [e.relativePath, e.contentHash]))

    let differs = false
    for (const [path, hash] of headByPath) {
      if (earlierByPath.get(path) !== hash) {
        differs = true
        break
      }
    }
    if (!differs && earlierByPath.size !== headByPath.size) differs = true

    expect(differs).toBe(true)
  })

  it('rejects an invalid token with a friendly auth-error message', async () => {
    const badAdapter = new GitlabAdapter({
      host: host!,
      projectId: projectId!,
      tokenProvider: new StaticToken('glpat-invalid-token-deadbeef'),
    })

    await expect(
      badAdapter.listRevisions({ fragmentsDir, branch: 'main', limit: 1 }),
    ).rejects.toThrow(/GitLab auth error \(401|403\)/)
  })
})
