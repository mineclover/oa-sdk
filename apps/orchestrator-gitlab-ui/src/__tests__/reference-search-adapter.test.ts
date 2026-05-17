import { describe, expect, it, vi } from 'vitest'
import { searchGitLabReferences } from '../gitlab/reference-search-adapter.js'

describe('GitLab reference search adapter', () => {
  it('maps issue and merge request search results to GLFM references', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      results: [
        {
          id: 'gitlab://project/1/issues/123',
          kind: 'issue',
          title: 'Release blocker',
          metadata: { iid: 123 },
        },
        {
          id: 'gitlab://project/1/merge-requests/456',
          kind: 'merge_request',
          title: 'Release fix',
          metadata: { iid: 456 },
        },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(searchGitLabReferences(
      { text: 'release', kind: 'issue', limit: 5 },
      { baseUrl: 'http://127.0.0.1:3210', authToken: 'ui-token', fetchImpl },
    )).resolves.toEqual([
      {
        id: 'gitlab://project/1/issues/123',
        kind: 'issue',
        title: 'Release blocker',
        iid: 123,
        glfmReference: '#123',
      },
      {
        id: 'gitlab://project/1/merge-requests/456',
        kind: 'merge_request',
        title: 'Release fix',
        iid: 456,
        glfmReference: '!456',
      },
    ])
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/context/search?kinds=issue&text=release&state=opened&limit=5',
      { headers: { Authorization: 'Bearer ui-token' } },
    )
  })

  it('fails when a reference search result has no iid metadata', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      results: [{ id: 'gitlab://project/1/issues/missing', kind: 'issue', title: 'Missing iid' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(searchGitLabReferences({ text: 'missing', kind: 'issue' }, { fetchImpl }))
      .rejects.toThrow('missing iid')
  })
})
