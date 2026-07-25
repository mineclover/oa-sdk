import { createHash } from 'node:crypto'
import type {
  GetFileEntriesOptions,
  GetObservationInputEvidenceOptions,
  ListRevisionsOptions,
  SpecSourcePort,
} from '../../../application/ports/spec-source.port.js'
import type { SpecFileEntry, SpecLensObservedInputEvidence, SpecRevision } from '../../../domain/index.js'
import {
  assertTypeSpecObservationInputLimits,
  MAX_TYPESPEC_EVIDENCE_CONCURRENCY,
  MAX_TYPESPEC_EVIDENCE_INPUT_BYTES,
} from '../../../domain/project.js'
import type { TokenProvider } from './token-provider.js'
import { isSpecProjectFile, resolveSpecObservationPaths, resolveSpecSourceRoot } from '../source-file-policy.js'
import { normalizeCredentialFreeRemote } from '../observation-identity.js'
import {
  assertSizedSourceCandidates,
  createSourceReadTracker,
  readResponseTextBounded,
  resolveSourceReadBudget,
  withSourceReadConcurrency,
} from '../source-read-budget.js'

export type GithubApiAdapterConfig = {
  owner: string
  repo: string
  tokenProvider: TokenProvider
  baseUrl?: string  // GitHub Enterprise: 'https://ghe.example.com/api/v3'
}

type GithubCommit = {
  sha: string
  commit: {
    message: string
    author: { name: string; date: string } | null
  }
}

type GithubTreeItem = {
  path: string
  type: string
  sha: string
  size?: number
}

type GithubCompareFile = {
  filename: string
  status: string
}

export class GithubApiAdapter implements SpecSourcePort {
  readonly kind = 'github' as const

  private readonly apiBase: string
  private readonly repoKey: string
  private readonly observationRepository: string

  constructor(private readonly config: GithubApiAdapterConfig) {
    this.apiBase = config.baseUrl ?? 'https://api.github.com'
    this.repoKey = `github.com/${config.owner}/${config.repo}`
    this.observationRepository = `${normalizeCredentialFreeRemote(this.apiBase)}/${config.owner.toLowerCase()}/${config.repo.toLowerCase()}`
  }

  async resolveObservationIdentity(ref?: string) {
    return {
      adapterKind: this.kind,
      repository: this.observationRepository,
      ref: ref ?? 'default',
    } as const
  }

  async listRevisions(options: ListRevisionsOptions): Promise<SpecRevision[]> {
    const token = await this.config.tokenProvider.getToken(this.repoKey)
    const observationPaths = resolveSpecObservationPaths(options)
    const limit = normalizeRevisionLimit(options.limit)
    const perPage = Math.min(100, limit ?? 100)
    const revisions = new Map<string, SpecRevision>()
    for (const path of observationPaths) {
      let page = 1
      let seen = 0
      while (true) {
        const params = new URLSearchParams({ path, per_page: String(perPage), page: String(page) })
        if (options.branch !== undefined) params.set('sha', options.branch)
        if (options.since !== undefined) params.set('since', new Date(options.since).toISOString())
        if (options.until !== undefined) params.set('until', new Date(options.until).toISOString())
        const url = `${this.apiBase}/repos/${this.config.owner}/${this.config.repo}/commits?${params}`
        const batch = await this.fetchJson<GithubCommit[]>(url, token)
        for (const commit of batch) {
          const revision = this.toRevision(commit, options.branch)
          revisions.set(revision.id, revision)
        }
        seen += batch.length
        if (batch.length < perPage || (limit !== undefined && seen >= limit)) break
        page++
      }
    }
    return [...revisions.values()]
      .sort((left, right) => right.timestamp - left.timestamp || right.id.localeCompare(left.id))
      .slice(0, limit)
  }

  async getFileEntries(options: GetFileEntriesOptions): Promise<SpecFileEntry[]> {
    const readBudget = resolveSourceReadBudget(options)
    const token = await this.config.tokenProvider.getToken(this.repoKey)
    const { revision } = options
    const sourceRoot = resolveSpecSourceRoot(options)

    const commitUrl = `${this.apiBase}/repos/${this.config.owner}/${this.config.repo}/commits/${revision.id}`
    const commit = await this.fetchJson<{ commit: { tree: { sha: string } } }>(
      commitUrl,
      token,
      readBudget?.maxTotalBytes,
      `GitHub commit metadata at ${revision.id}`,
    )
    const treeSha = commit.commit.tree.sha

    const treeUrl = `${this.apiBase}/repos/${this.config.owner}/${this.config.repo}/git/trees/${treeSha}?recursive=1`
    const tree = await this.fetchJson<{ tree: GithubTreeItem[]; truncated: boolean }>(
      treeUrl,
      token,
      readBudget?.maxTotalBytes,
      `GitHub tree metadata at ${revision.id}`,
    )
    if (tree.truncated) {
      throw new Error(
        `Git tree truncated at commit ${revision.id}. The repo is too large for recursive tree fetch. ` +
        `Use a more specific sourceRoot or contact repo maintainers.`,
      )
    }

    const normalized = sourceRoot.replace(/^\//, '').replace(/\/$/, '')
    const prefix = normalized === '' ? '' : normalized + '/'
    const fileItems = tree.tree.filter(
      item => item.type === 'blob' && item.path.startsWith(prefix) && isSpecProjectFile(item.path, options.sourceKind),
    )

    const candidates = fileItems.map(item => ({
      item,
      relativePath: prefix === '' ? item.path : item.path.slice(prefix.length),
    }))

    if (readBudget !== undefined) {
      const label = `GitHub TypeSpec source read at ${revision.id}`
      assertSizedSourceCandidates(
        candidates.map(({ item, relativePath }) => ({
          relativePath,
          // The GitHub tree contract makes size optional, so the shared
          // validator is deliberately responsible for rejecting undefined.
          size: item.size as number,
        })),
        readBudget,
        label,
      )
      const tracker = createSourceReadTracker(readBudget, label)
      return withSourceReadConcurrency(
        candidates.map(({ item, relativePath }) => async () => {
          const content = await this.fetchBlob(item.sha, token, {
            expectedBytes: item.size as number,
            maxDecodedBytes: readBudget.maxFileBytes,
          })
          tracker.record(relativePath, content.bytes)
          return {
            relativePath,
            content: content.text,
            contentHash: sha256(content.text),
          }
        }),
        readBudget.maxConcurrency,
      )
    }

    return withConcurrency(
      candidates.map(({ item, relativePath }) => async () => {
        const content = await this.fetchBlob(item.sha, token)
        return {
          relativePath,
          content: content.text,
          contentHash: sha256(content.text),
        }
      }),
      10,
    )
  }

  async getObservationInputEvidence(options: GetObservationInputEvidenceOptions): Promise<SpecLensObservedInputEvidence[]> {
    assertTypeSpecObservationInputLimits(options.inputs)
    const token = await this.config.tokenProvider.getToken(this.repoKey)
    const entries = await withSourceReadConcurrency(options.inputs.map(input => async () => {
      const encodedPath = input.path.split('/').map(segment => encodeURIComponent(segment)).join('/')
      const url = `${this.apiBase}/repos/${this.config.owner}/${this.config.repo}/contents/${encodedPath}?ref=${encodeURIComponent(options.revision.id)}`
      try {
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        })
        if (response.status === 404) {
          return { path: input.path, class: 'evidence-only' as const, availability: 'missing' as const }
        }
        if (!response.ok) {
          return {
            path: input.path,
            class: 'evidence-only' as const,
            availability: 'unreadable' as const,
            reason: `GitHub evidence read failed (${response.status})`,
          }
        }
        const { text } = await readResponseTextBounded(
          response,
          githubBlobJsonByteCap(MAX_TYPESPEC_EVIDENCE_INPUT_BYTES),
          `GitHub evidence input ${input.path}`,
        )
        const payload = JSON.parse(text) as { content?: string; encoding?: string; type?: string }
        if (payload.type !== 'file' || typeof payload.content !== 'string' || payload.encoding !== 'base64') {
          return {
            path: input.path,
            class: 'evidence-only' as const,
            availability: 'unreadable' as const,
            reason: 'GitHub evidence input is not a base64 file',
          }
        }
        const bytes = Buffer.from(payload.content.replace(/\n/g, ''), 'base64')
        if (bytes.byteLength > MAX_TYPESPEC_EVIDENCE_INPUT_BYTES) {
          return {
            path: input.path,
            class: 'evidence-only' as const,
            availability: 'unreadable' as const,
            reason: `GitHub evidence input exceeds ${MAX_TYPESPEC_EVIDENCE_INPUT_BYTES} bytes`,
          }
        }
        const content = bytes.toString('utf8')
        return {
          path: input.path,
          class: 'evidence-only' as const,
          availability: 'available' as const,
          contentHash: sha256(content),
        }
      } catch (error) {
        return {
          path: input.path,
          class: 'evidence-only' as const,
          availability: 'unreadable' as const,
          reason: error instanceof Error ? error.message : String(error),
        }
      }
    }), MAX_TYPESPEC_EVIDENCE_CONCURRENCY)
    return entries.sort((left, right) => left.path.localeCompare(right.path))
  }

  private toRevision(commit: GithubCommit, branch?: string): SpecRevision {
    const date = commit.commit.author?.date ?? new Date().toISOString()
    const authorName = commit.commit.author?.name
    return {
      id: commit.sha,
      shortId: commit.sha.slice(0, 7),
      timestamp: new Date(date).getTime(),
      message: commit.commit.message.split('\n')[0] ?? '',
      source: 'github',
      ...(authorName !== undefined ? { author: authorName } : {}),
      ...(branch !== undefined ? { sourceRef: branch } : {}),
    }
  }

  private async fetchBlob(
    blobSha: string,
    token: string,
    limits?: GithubBlobReadLimits,
  ): Promise<{ text: string; bytes: number }> {
    const url = `${this.apiBase}/repos/${this.config.owner}/${this.config.repo}/git/blobs/${blobSha}`
    const blob = await this.fetchJson<{ content: string; encoding: string }>(
      url,
      token,
      limits === undefined ? undefined : githubBlobJsonByteCap(limits.expectedBytes),
      `GitHub blob response for ${blobSha}`,
    )
    let bytes: Buffer
    if (blob.encoding === 'base64') {
      bytes = Buffer.from(blob.content.replace(/\n/g, ''), 'base64')
    } else if (blob.encoding === 'utf-8') {
      bytes = Buffer.from(blob.content, 'utf8')
    } else {
      throw new Error(`Unsupported GitHub blob encoding: ${blob.encoding} (sha: ${blobSha})`)
    }
    if (limits !== undefined) {
      if (bytes.byteLength > limits.maxDecodedBytes) {
        throw new Error(
          `GitHub blob ${blobSha} decoded bytes exceed ${limits.maxDecodedBytes}: ${bytes.byteLength}`,
        )
      }
      if (bytes.byteLength !== limits.expectedBytes) {
        throw new Error(
          `GitHub blob ${blobSha} decoded size ${bytes.byteLength} does not match tree size ${limits.expectedBytes}`,
        )
      }
    }
    return { text: bytes.toString('utf8'), bytes: bytes.byteLength }
  }

  private async fetchJson<T>(
    url: string,
    token: string,
    maxBytes?: number,
    label = 'GitHub JSON response',
  ): Promise<T> {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (res.status === 429 || (res.status === 403 && res.headers.get('X-RateLimit-Remaining') === '0')) {
      const reset = res.headers.get('X-RateLimit-Reset')
      const resetMsg = reset !== null
        ? ` Rate limit resets at ${new Date(Number(reset) * 1000).toISOString()}.`
        : ''
      throw new Error(`GitHub API rate limited (${res.status}).${resetMsg} Reduce refresh frequency or use a token with higher quota.`)
    }
    if (!res.ok) {
      const body = maxBytes === undefined
        ? await res.text().catch(() => '')
        : await readResponseTextBounded(res, maxBytes, label).then(result => result.text).catch(() => '')
      throw new Error(`GitHub API error ${res.status}: ${url}\n${body}`)
    }
    if (maxBytes === undefined) return res.json() as Promise<T>
    const { text } = await readResponseTextBounded(res, maxBytes, label)
    try {
      return JSON.parse(text) as T
    } catch (error) {
      throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

type GithubBlobReadLimits = {
  expectedBytes: number
  maxDecodedBytes: number
}

const GITHUB_BLOB_JSON_FIXED_OVERHEAD_BYTES = 64 * 1024

function githubBlobJsonByteCap(expectedBytes: number): number {
  // GitHub normally returns base64, while some compatible Enterprise APIs use
  // utf-8. Six JSON bytes per source byte covers the worst-case escaping of an
  // utf-8 payload; the fixed allowance covers the remaining response fields.
  const contentBytes = expectedBytes * 6
  const cap = contentBytes + GITHUB_BLOB_JSON_FIXED_OVERHEAD_BYTES
  if (!Number.isSafeInteger(cap) || cap <= 0) {
    throw new Error(`GitHub blob response cap is invalid for tree size ${expectedBytes}`)
  }
  return cap
}

function normalizeRevisionLimit(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('revision limit must be a positive safe integer')
  return value
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function withConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0
  async function worker() {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]!()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}
