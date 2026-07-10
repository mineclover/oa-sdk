import { resolveSpecLensTypeSpecSourceReadBudget } from '@oa-sdk/codegen/spec-lens'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpecRevision } from '../domain/index.js'
import { GitlabAdapter } from '../infrastructure/source-adapters/gitlab/gitlab.adapter.js'

const budget = resolveSpecLensTypeSpecSourceReadBudget()
const revision: SpecRevision = {
  id: 'a'.repeat(40),
  shortId: 'aaaaaaa',
  timestamp: 1,
  message: 'test',
  source: 'gitlab',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GitlabAdapter TypeSpec source-read budget', () => {
  it('rejects a direct TypeSpec read without the canonical budget', async () => {
    const { adapter, tokenProvider } = makeAdapter()
    await expect(adapter.getFileEntries({
      revision,
      sourceRoot: 'typespec',
      sourceKind: 'typespec-bundle',
    } as never)).rejects.toThrow('require an explicit readBudget')
    expect(tokenProvider.getToken).not.toHaveBeenCalled()
  })

  it('rejects too many candidates before fetching raw files', async () => {
    const rawFetch = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/repository/tree?')) {
        return jsonResponse(Array.from({ length: budget.maxFiles + 1 }, (_, index) => ({
          name: `f${index}.tsp`,
          path: `typespec/f${index}.tsp`,
          type: 'blob',
        })))
      }
      rawFetch()
      return new Response('')
    }))
    const { adapter } = makeAdapter()

    await expect(readTypeSpec(adapter)).rejects.toThrow('file count 257 exceeds limit 256')
    expect(rawFetch).not.toHaveBeenCalled()
  })

  it('rejects an oversized raw Content-Length before reading its body', async () => {
    vi.stubGlobal('fetch', sourceFetch(async () => new Response('small', {
      headers: { 'content-length': String(budget.maxFileBytes + 1) },
    })))
    const { adapter } = makeAdapter()
    await expect(readTypeSpec(adapter)).rejects.toThrow('Content-Length exceeds')
  })

  it('rejects a raw stream that exceeds the per-file byte cap without Content-Length', async () => {
    vi.stubGlobal('fetch', sourceFetch(async () => streamingResponse([
      new Uint8Array(budget.maxFileBytes),
      new Uint8Array(1),
    ])))
    const { adapter } = makeAdapter()
    await expect(readTypeSpec(adapter)).rejects.toThrow(`streamed body exceeds ${budget.maxFileBytes} bytes`)
  })

  it('fails the whole revision when running aggregate bytes exceed the budget', async () => {
    const items = Array.from({ length: 9 }, (_, index) => ({
      name: `f${index}.tsp`,
      path: `typespec/f${index}.tsp`,
      type: 'blob',
    }))
    let consumedBytes = 0
    let cancelledBodies = 0
    vi.stubGlobal('fetch', sourceFetch(async () => trackedByteResponse(
      budget.maxFileBytes,
      bytes => { consumedBytes += bytes },
      () => { cancelledBodies++ },
    ), items))
    const { adapter } = makeAdapter()
    await expect(readTypeSpec(adapter)).rejects.toThrow(`aggregate bytes exceed limit ${budget.maxTotalBytes}`)
    expect(consumedBytes).toBe(budget.maxTotalBytes + 1)
    expect(cancelledBodies).toBeGreaterThanOrEqual(1)
  })

  it('allows only one overflow probe when Content-Length under-reports concurrent bodies', async () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      name: `f${index}.tsp`,
      path: `typespec/f${index}.tsp`,
      type: 'blob',
    }))
    let consumedBytes = 0
    let cancelledBodies = 0
    vi.stubGlobal('fetch', sourceFetch(async url => {
      const match = /\/f(\d+)\.tsp/.exec(decodeURIComponent(url))
      const index = Number(match?.[1] ?? -1)
      const bodyBytes = index >= 8 ? budget.maxFileBytes + 1 : budget.maxFileBytes
      return trackedByteResponse(
        bodyBytes,
        bytes => { consumedBytes += bytes },
        () => { cancelledBodies++ },
        { 'content-length': '0' },
      )
    }, items))
    const { adapter } = makeAdapter()

    await expect(readTypeSpec(adapter)).rejects.toThrow(`aggregate bytes exceed limit ${budget.maxTotalBytes}`)
    expect(consumedBytes).toBe(budget.maxTotalBytes + 1)
    expect(cancelledBodies).toBeGreaterThanOrEqual(1)
  })

  it('aborts header-pending peers and waits for workers to quiesce after a failure', async () => {
    const items = Array.from({ length: budget.maxConcurrency }, (_, index) => ({
      name: `f${index}.tsp`,
      path: `typespec/f${index}.tsp`,
      type: 'blob',
    }))
    let pendingRequests = 0
    let abortedRequests = 0
    let releaseFailingRequest!: () => void
    const peersArePending = new Promise<void>(resolveWait => {
      releaseFailingRequest = resolveWait
    })

    vi.stubGlobal('fetch', sourceFetch(async (url, init) => {
      const match = /\/f(\d+)\.tsp/.exec(decodeURIComponent(url))
      const index = Number(match?.[1] ?? -1)
      if (index === 0) {
        await peersArePending
        return new Response('small', {
          headers: { 'content-length': String(budget.maxFileBytes + 1) },
        })
      }

      pendingRequests++
      if (pendingRequests === budget.maxConcurrency - 1) releaseFailingRequest()
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          pendingRequests--
          abortedRequests++
          reject(new Error('aborted by source-read failure'))
        }
        if (init?.signal?.aborted === true) {
          abort()
        } else {
          init?.signal?.addEventListener('abort', abort, { once: true })
        }
      })
    }, items))
    const { adapter } = makeAdapter()

    await expect(readTypeSpec(adapter)).rejects.toThrow('Content-Length exceeds')
    expect(abortedRequests).toBe(budget.maxConcurrency - 1)
    expect(pendingRequests).toBe(0)
  })

  it('caps concurrent raw reads at the canonical source-read concurrency', async () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      name: `f${index}.tsp`,
      path: `typespec/f${index}.tsp`,
      type: 'blob',
    }))
    let active = 0
    let maxActive = 0
    vi.stubGlobal('fetch', sourceFetch(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(resolveWait => setTimeout(resolveWait, 10))
      active--
      return new Response('model A {}\n')
    }, items))
    const { adapter } = makeAdapter()

    await expect(readTypeSpec(adapter)).resolves.toHaveLength(8)
    expect(maxActive).toBe(budget.maxConcurrency)
  })
})

function makeAdapter() {
  const tokenProvider = { getToken: vi.fn().mockResolvedValue('token') }
  return {
    adapter: new GitlabAdapter({ projectId: 'group/project', tokenProvider }),
    tokenProvider,
  }
}

function readTypeSpec(adapter: GitlabAdapter) {
  return adapter.getFileEntries({
    revision,
    sourceRoot: 'typespec',
    sourceKind: 'typespec-bundle',
    readBudget: budget,
  })
}

function sourceFetch(
  rawResponse: (url: string, init?: TestFetchInit) => Promise<Response>,
  items = [{ name: 'main.tsp', path: 'typespec/main.tsp', type: 'blob' }],
) {
  return vi.fn(async (input: string | URL | Request, init?: TestFetchInit) => {
    const url = String(input)
    if (url.includes('/repository/tree?')) return jsonResponse(items)
    if (url.includes('/repository/files/')) return rawResponse(url, init)
    throw new Error(`unexpected GitLab request: ${url}`)
  })
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function streamingResponse(chunks: Uint8Array[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    type: 'bytes',
    start(controller: TestByteStreamController) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  } as never))
}

function trackedByteResponse(
  totalBytes: number,
  onConsume: (bytes: number) => void,
  onCancel: () => void,
  headers?: Record<string, string>,
): Response {
  let remaining = totalBytes
  return new Response(new ReadableStream<Uint8Array>({
    type: 'bytes',
    pull(controller: TestByteStreamController) {
      if (remaining === 0) {
        controller.close()
        return
      }
      const request = controller.byobRequest
      const requestedBytes = request?.view?.byteLength ?? 64 * 1024
      const bytes = Math.min(remaining, requestedBytes)
      if (request?.view !== null && request?.view !== undefined) {
        new Uint8Array(request.view.buffer, request.view.byteOffset, bytes).fill(65)
        request.respond(bytes)
      } else {
        controller.enqueue(new Uint8Array(bytes).fill(65))
      }
      remaining -= bytes
      onConsume(bytes)
      if (remaining === 0) controller.close()
    },
    cancel() {
      onCancel()
    },
  } as never), headers === undefined ? undefined : { headers })
}

type TestByteStreamController = {
  readonly byobRequest: {
    readonly view: {
      readonly buffer: ArrayBufferLike
      readonly byteOffset: number
      readonly byteLength: number
    } | null
    respond(bytesWritten: number): void
  } | null
  close(): void
  enqueue(chunk: Uint8Array): void
}

type TestFetchInit = {
  signal?: AbortSignal
}
