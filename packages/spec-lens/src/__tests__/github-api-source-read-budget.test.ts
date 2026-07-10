import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveSpecLensTypeSpecSourceReadBudget } from '@oa-sdk/codegen/spec-lens'
import type {
  GetFileEntriesOptions,
  SpecSourceReadBudget,
} from '../application/ports/spec-source.port.js'
import type { SpecRevision } from '../domain/index.js'
import { GithubApiAdapter } from '../infrastructure/source-adapters/github/github-api.adapter.js'

const REVISION: SpecRevision = {
  id: 'a'.repeat(40),
  shortId: 'aaaaaaa',
  timestamp: Date.UTC(2026, 0, 1),
  message: 'test revision',
  source: 'github',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GithubApiAdapter TypeSpec source read budget', () => {
  it('fails before credentials or network access when readBudget is missing', async () => {
    const getToken = vi.fn().mockResolvedValue('token')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = createAdapter(getToken)

    const invalidOptions = {
      revision: REVISION,
      sourceRoot: 'typespec',
      sourceKind: 'typespec-bundle',
    } as unknown as GetFileEntriesOptions

    await expect(adapter.getFileEntries(invalidOptions)).rejects.toThrow(
      'TypeSpec source reads require an explicit readBudget',
    )
    expect(getToken).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an over-count tree before making any blob request', async () => {
    const fixture = installGithubFetch([
      ...Array.from({ length: 257 }, (_, index) => treeItem(`${index}.tsp`, 1)),
    ])
    const adapter = createAdapter()

    await expect(readTypeSpec(adapter, budget())).rejects.toThrow(
      /file count 257 exceeds limit 256/,
    )
    expect(fixture.blobCalls()).toBe(0)
  })

  it('rejects per-file and aggregate size limits before making any blob request', async () => {
    const perFileFixture = installGithubFetch([treeItem('too-large.tsp', (2 * 1_024 * 1_024) + 1)])
    await expect(readTypeSpec(
      createAdapter(),
      budget(),
    )).rejects.toThrow(/file too-large\.tsp exceeds 2097152 bytes: 2097153/)
    expect(perFileFixture.blobCalls()).toBe(0)

    const aggregateFixture = installGithubFetch([
      ...Array.from({ length: 9 }, (_, index) => treeItem(`${index}.tsp`, 2 * 1_024 * 1_024)),
    ])
    await expect(readTypeSpec(
      createAdapter(),
      budget(),
    )).rejects.toThrow(/aggregate bytes exceed limit 16777216/)
    expect(aggregateFixture.blobCalls()).toBe(0)
  })

  it.each([
    ['missing', undefined],
    ['negative', -1],
    ['fractional', 1.5],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects %s tree size metadata before making any blob request', async (_label, size) => {
    const fixture = installGithubFetch([treeItem('invalid.tsp', size)])

    await expect(readTypeSpec(createAdapter(), budget())).rejects.toThrow(
      /missing or invalid size metadata: invalid\.tsp/,
    )
    expect(fixture.blobCalls()).toBe(0)
  })

  it('bounds commit and tree metadata responses for TypeSpec reads', async () => {
    const oversizedCommit = installGithubFetch([], {
      commitResponse: () => responseWithDeclaredLength(
        { commit: { tree: { sha: 'tree-sha' } } },
        (16 * 1_024 * 1_024) + 1,
      ),
    })
    await expect(readTypeSpec(
      createAdapter(),
      budget(),
    )).rejects.toThrow(/GitHub commit metadata.*Content-Length exceeds 16777216 bytes/)
    expect(oversizedCommit.blobCalls()).toBe(0)

    const oversizedTree = installGithubFetch([], {
      treeResponse: () => streamedTextResponse('x'.repeat((16 * 1_024 * 1_024) + 1)),
    })
    await expect(readTypeSpec(
      createAdapter(),
      budget(),
    )).rejects.toThrow(/GitHub tree metadata.*streamed body exceeds 16777216 bytes/)
    expect(oversizedTree.blobCalls()).toBe(0)
  })

  it('prechecks blob Content-Length and caps the streamed JSON response', async () => {
    const declaredFixture = installGithubFetch([treeItem('main.tsp', 1)], {
      blobResponse: () => responseWithDeclaredLength(
        { content: 'eA==', encoding: 'base64' },
        70_000,
      ),
    })
    await expect(readTypeSpec(createAdapter(), budget())).rejects.toThrow(
      /GitHub blob response.*Content-Length exceeds 65542 bytes/,
    )
    expect(declaredFixture.blobCalls()).toBe(1)

    const streamedFixture = installGithubFetch([treeItem('main.tsp', 1)], {
      blobResponse: () => streamedTextResponse(JSON.stringify({
        content: 'A'.repeat(70_000),
        encoding: 'base64',
      })),
    })
    await expect(readTypeSpec(createAdapter(), budget())).rejects.toThrow(
      /GitHub blob response.*streamed body exceeds 65542 bytes/,
    )
    expect(streamedFixture.blobCalls()).toBe(1)
  })

  it('rejects the whole revision when decoded bytes do not exactly match tree size', async () => {
    installGithubFetch([treeItem('main.tsp', 1)], {
      blobResponse: () => jsonResponse({
        content: Buffer.from('xx').toString('base64'),
        encoding: 'base64',
      }),
    })

    await expect(readTypeSpec(createAdapter(), budget())).rejects.toThrow(
      /decoded size 2 does not match tree size 1/,
    )
  })

  it('uses the read budget concurrency and never exceeds four blob reads', async () => {
    let active = 0
    let maxActive = 0
    const fixture = installGithubFetch(
      Array.from({ length: 9 }, (_, index) => treeItem(`${index}.tsp`, 1)),
      {
        blobResponse: async () => {
          active++
          maxActive = Math.max(maxActive, active)
          await new Promise(resolve => setTimeout(resolve, 5))
          active--
          return jsonResponse({ content: 'eA==', encoding: 'base64' })
        },
      },
    )

    const entries = await readTypeSpec(createAdapter(), budget())

    expect(entries).toHaveLength(9)
    expect(fixture.blobCalls()).toBe(9)
    expect(maxActive).toBe(4)
  })

  it('preserves Definition reads without requiring tree size metadata or a read budget', async () => {
    installGithubFetch([
      { path: 'typespec/definition.yaml', type: 'blob', sha: 'definition-yaml' },
    ], {
      blobResponse: () => jsonResponse({ content: 'openapi: 3.1.0', encoding: 'utf-8' }),
    })
    const adapter = createAdapter()

    const entries = await adapter.getFileEntries({
      revision: REVISION,
      sourceRoot: 'typespec',
    })

    expect(entries).toEqual([expect.objectContaining({
      relativePath: 'definition.yaml',
      content: 'openapi: 3.1.0',
    })])
  })
})

function createAdapter(
  getToken = vi.fn().mockResolvedValue('token'),
): GithubApiAdapter {
  return new GithubApiAdapter({
    owner: 'owner',
    repo: 'repo',
    tokenProvider: { getToken },
  })
}

function readTypeSpec(adapter: GithubApiAdapter, readBudget: SpecSourceReadBudget) {
  return adapter.getFileEntries({
    revision: REVISION,
    sourceRoot: 'typespec',
    sourceKind: 'typespec-bundle',
    readBudget,
  })
}

function budget(): SpecSourceReadBudget {
  return resolveSpecLensTypeSpecSourceReadBudget()
}

function treeItem(relativePath: string, size: number | undefined) {
  return {
    path: `typespec/${relativePath}`,
    type: 'blob',
    sha: `blob-${relativePath}`,
    ...(size === undefined ? {} : { size }),
  }
}

type GithubFetchFixtureOptions = {
  commitResponse?: () => Response | Promise<Response>
  treeResponse?: () => Response | Promise<Response>
  blobResponse?: (url: URL) => Response | Promise<Response>
}

function installGithubFetch(
  tree: ReturnType<typeof treeItem>[],
  options: GithubFetchFixtureOptions = {},
) {
  let blobCallCount = 0
  const fetchMock = vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input))
    if (url.pathname.endsWith(`/commits/${REVISION.id}`)) {
      return options.commitResponse?.()
        ?? jsonResponse({ commit: { tree: { sha: 'tree-sha' } } })
    }
    if (url.pathname.endsWith('/git/trees/tree-sha')) {
      return options.treeResponse?.()
        ?? jsonResponse({ tree, truncated: false })
    }
    if (url.pathname.includes('/git/blobs/')) {
      blobCallCount++
      return options.blobResponse?.(url)
        ?? jsonResponse({ content: 'eA==', encoding: 'base64' })
    }
    throw new Error(`Unexpected GitHub request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    fetchMock,
    blobCalls: () => blobCallCount,
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function responseWithDeclaredLength(value: unknown, contentLength: number): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'content-length': String(contentLength),
    },
  })
}

function streamedTextResponse(text: string): Response {
  const bytes = new TextEncoder().encode(text)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const chunkBytes = 1_024
      for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
        controller.enqueue(bytes.slice(offset, offset + chunkBytes))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
