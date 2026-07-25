import { afterEach, describe, expect, it, vi } from 'vitest'
import { GithubApiAdapter } from '../infrastructure/source-adapters/github/github-api.adapter.js'
import { GitlabAdapter } from '../infrastructure/source-adapters/gitlab/gitlab.adapter.js'
import {
  MAX_TYPESPEC_EVIDENCE_CONCURRENCY,
  MAX_TYPESPEC_EVIDENCE_INPUTS,
  MAX_TYPESPEC_OBSERVATION_INPUTS,
} from '../domain/project.js'

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

  it('merges GitHub revisions from sourceRoot and explicit watch paths', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).searchParams.get('path')
      return jsonResponse(path === 'pnpm-lock.yaml'
        ? [githubCommit('b'.repeat(40), '2026-01-02T00:00:00.000Z')]
        : [githubCommit('a'.repeat(40), '2026-01-01T00:00:00.000Z')])
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new GithubApiAdapter({
      owner: 'owner', repo: 'repo', tokenProvider: { getToken: vi.fn().mockResolvedValue('token') },
    })

    const revisions = await adapter.listRevisions({ sourceRoot: 'typespec', watchPaths: ['pnpm-lock.yaml'] })

    expect(revisions.map(revision => revision.id)).toEqual(['b'.repeat(40), 'a'.repeat(40)])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('merges GitLab revisions from sourceRoot and explicit watch paths', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).searchParams.get('path')
      return jsonResponse(path === 'pnpm-lock.yaml'
        ? [gitlabCommit('b'.repeat(40), '2026-01-02T00:00:00.000Z')]
        : [gitlabCommit('a'.repeat(40), '2026-01-01T00:00:00.000Z')])
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new GitlabAdapter({
      projectId: 'group/project', tokenProvider: { getToken: vi.fn().mockResolvedValue('token') },
    })

    const revisions = await adapter.listRevisions({ sourceRoot: 'typespec', watchPaths: ['pnpm-lock.yaml'] })

    expect(revisions.map(revision => revision.id)).toEqual(['b'.repeat(40), 'a'.repeat(40)])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('records GitHub evidence-only input hashes without making them compiler entries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      type: 'file', encoding: 'base64', content: Buffer.from('lockfileVersion: 9\n').toString('base64'),
    })))
    const adapter = new GithubApiAdapter({
      owner: 'owner', repo: 'repo', tokenProvider: { getToken: vi.fn().mockResolvedValue('token') },
    })
    const evidence = await adapter.getObservationInputEvidence({
      revision: { id: 'a'.repeat(40), shortId: 'aaaaaaa', timestamp: 1, message: 'test', source: 'github' },
      inputs: [{ path: 'pnpm-lock.yaml', class: 'evidence-only' }],
    })
    expect(evidence).toEqual([{
      path: 'pnpm-lock.yaml', class: 'evidence-only', availability: 'available',
      contentHash: '2a812209f3e69edfb5c65c5f1bb5cee92d2be3b8e5c5facc27f5e1c0338f2df0',
    }])
  })

  it('rejects unbounded direct GitHub evidence reads', async () => {
    const adapter = new GithubApiAdapter({
      owner: 'owner', repo: 'repo', tokenProvider: { getToken: vi.fn().mockResolvedValue('token') },
    })
    await expect(adapter.getObservationInputEvidence({
      revision: { id: 'a'.repeat(40), shortId: 'aaaaaaa', timestamp: 1, message: 'test', source: 'github' },
      inputs: Array.from({ length: MAX_TYPESPEC_EVIDENCE_INPUTS + 1 }, (_, index) => ({
        path: `evidence-${index}.json`, class: 'evidence-only' as const,
      })),
    })).rejects.toThrow(`must not exceed ${MAX_TYPESPEC_EVIDENCE_INPUTS} entries`)
  })

  it('limits concurrent GitHub evidence reads', async () => {
    let active = 0
    let maximumActive = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      active++
      maximumActive = Math.max(maximumActive, active)
      await new Promise(resolveWait => setTimeout(resolveWait, 5))
      active--
      return jsonResponse({
        type: 'file', encoding: 'base64', content: Buffer.from('evidence').toString('base64'),
      })
    }))
    const adapter = new GithubApiAdapter({
      owner: 'owner', repo: 'repo', tokenProvider: { getToken: vi.fn().mockResolvedValue('token') },
    })
    await adapter.getObservationInputEvidence({
      revision: { id: 'a'.repeat(40), shortId: 'aaaaaaa', timestamp: 1, message: 'test', source: 'github' },
      inputs: Array.from({ length: MAX_TYPESPEC_EVIDENCE_INPUTS }, (_, index) => ({
        path: `evidence-${index}.json`, class: 'evidence-only' as const,
      })),
    })
    expect(maximumActive).toBe(MAX_TYPESPEC_EVIDENCE_CONCURRENCY)
  })

  it('rejects unbounded direct revision-observation paths', async () => {
    const adapter = new GithubApiAdapter({
      owner: 'owner', repo: 'repo', tokenProvider: { getToken: vi.fn().mockResolvedValue('token') },
    })
    await expect(adapter.listRevisions({
      sourceRoot: 'typespec',
      watchPaths: Array.from({ length: MAX_TYPESPEC_OBSERVATION_INPUTS + 1 }, (_, index) => `watched-${index}`),
    })).rejects.toThrow(`must not exceed ${MAX_TYPESPEC_OBSERVATION_INPUTS} entries`)
  })

  it('rejects simultaneous legacy and typed direct observation inputs', async () => {
    const adapter = new GithubApiAdapter({
      owner: 'owner', repo: 'repo', tokenProvider: { getToken: vi.fn().mockResolvedValue('token') },
    })
    await expect(adapter.listRevisions({
      sourceRoot: 'typespec',
      watchPaths: ['legacy.tsp'],
      observationInputs: [{ path: 'typed.tsp', class: 'candidate-only' }],
    })).rejects.toThrow('watchPaths and observationInputs cannot be used together')
  })

  it('marks a GitHub evidence-only directory unreadable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([{ type: 'dir', path: 'toolchain' }])))
    const adapter = new GithubApiAdapter({
      owner: 'owner', repo: 'repo', tokenProvider: { getToken: vi.fn().mockResolvedValue('token') },
    })
    await expect(adapter.getObservationInputEvidence({
      revision: { id: 'a'.repeat(40), shortId: 'aaaaaaa', timestamp: 1, message: 'test', source: 'github' },
      inputs: [{ path: 'toolchain', class: 'evidence-only' }],
    })).resolves.toEqual([{
      path: 'toolchain', class: 'evidence-only', availability: 'unreadable',
      reason: 'GitHub evidence input is not a base64 file',
    }])
  })

  it('records missing GitLab evidence-only inputs without failing the revision', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))
    const adapter = new GitlabAdapter({
      projectId: 'group/project', tokenProvider: { getToken: vi.fn().mockResolvedValue('token') },
    })
    await expect(adapter.getObservationInputEvidence({
      revision: { id: 'b'.repeat(40), shortId: 'bbbbbbb', timestamp: 1, message: 'test', source: 'gitlab' },
      inputs: [{ path: 'pnpm-lock.yaml', class: 'evidence-only' }],
    })).resolves.toEqual([{
      path: 'pnpm-lock.yaml', class: 'evidence-only', availability: 'missing',
    }])
  })

  it('marks a GitLab evidence-only directory unreadable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      return url.pathname.includes('/repository/tree')
        ? jsonResponse([{ type: 'tree', path: 'toolchain' }])
        : new Response('not found', { status: 404 })
    }))
    const adapter = new GitlabAdapter({
      projectId: 'group/project', tokenProvider: { getToken: vi.fn().mockResolvedValue('token') },
    })
    await expect(adapter.getObservationInputEvidence({
      revision: { id: 'b'.repeat(40), shortId: 'bbbbbbb', timestamp: 1, message: 'test', source: 'gitlab' },
      inputs: [{ path: 'toolchain', class: 'evidence-only' }],
    })).resolves.toEqual([{
      path: 'toolchain', class: 'evidence-only', availability: 'unreadable',
      reason: 'GitLab evidence input is a directory, but evidence-only requires a file',
    }])
  })
})

function githubCommit(sha: string, date = '2026-01-01T00:00:00.000Z') {
  return {
    sha,
    commit: {
      message: sha,
      author: { name: 'Test', date },
    },
  }
}

function gitlabCommit(id: string, date = '2026-01-01T00:00:00.000Z') {
  return {
    id,
    short_id: id.slice(0, 7),
    title: id,
    authored_date: date,
    author_name: 'Test',
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
