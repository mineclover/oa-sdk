import { afterEach, describe, expect, it, vi } from 'vitest'
import { GithubApiAdapter } from '../infrastructure/source-adapters/github/github-api.adapter.js'
import { GitlabAdapter } from '../infrastructure/source-adapters/gitlab/gitlab.adapter.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('authoritative revision pagination', () => {
  it('paginates GitHub to exhaustion when limit is omitted', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const page = Number(url.searchParams.get('page'))
      return jsonResponse(page === 1
        ? Array.from({ length: 100 }, (_, index) => githubCommit(`a${String(index).padStart(39, '0')}`))
        : [githubCommit(`b${'0'.repeat(39)}`)])
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new GithubApiAdapter({
      owner: 'owner',
      repo: 'repo',
      tokenProvider: { getToken: vi.fn().mockResolvedValue('token') },
    })

    const revisions = await adapter.listRevisions({ sourceRoot: 'typespec' })

    expect(revisions).toHaveLength(101)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('page=2')
  })

  it('paginates GitLab to exhaustion but keeps explicit limits bounded', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const page = Number(url.searchParams.get('page'))
      const perPage = Number(url.searchParams.get('per_page'))
      const count = perPage === 7 ? 7 : page === 1 ? 100 : 1
      return jsonResponse(Array.from({ length: count }, (_, index) => (
        gitlabCommit(`${page}${String(index).padStart(39, '0')}`)
      )))
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new GitlabAdapter({
      projectId: 'group/project',
      tokenProvider: { getToken: vi.fn().mockResolvedValue('token') },
    })

    expect(await adapter.listRevisions({ sourceRoot: 'typespec' })).toHaveLength(101)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    fetchMock.mockClear()
    expect(await adapter.listRevisions({ sourceRoot: 'typespec', limit: 7 })).toHaveLength(7)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

function githubCommit(sha: string) {
  return {
    sha,
    commit: {
      message: sha,
      author: { name: 'Test', date: '2026-01-01T00:00:00.000Z' },
    },
  }
}

function gitlabCommit(id: string) {
  return {
    id,
    short_id: id.slice(0, 7),
    title: id,
    authored_date: '2026-01-01T00:00:00.000Z',
    author_name: 'Test',
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
