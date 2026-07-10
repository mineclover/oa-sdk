import { createHash } from 'node:crypto'
import type {
  GetFileEntriesOptions,
  ListRevisionsOptions,
  SpecSourcePort,
} from '../../../application/ports/spec-source.port.js'
import type { SpecFileEntry, SpecRevision } from '../../../domain/index.js'
import type { TokenProvider } from '../github/token-provider.js'
import { isSpecProjectFile, resolveSpecSourceRoot } from '../source-file-policy.js'
import { normalizeCredentialFreeRemote } from '../observation-identity.js'
import {
  createStreamingSourceReadTracker,
  readResponseTextBounded,
  resolveSourceReadBudget,
  type StreamingSourceReadTracker,
  withSourceReadConcurrency,
} from '../source-read-budget.js'

export type GitlabAdapterConfig = {
  /** GitLab instance base URL. Default: 'https://gitlab.com' */
  host?: string
  /** Numeric project ID or 'namespace/project' slug */
  projectId: string | number
  tokenProvider: TokenProvider
}

type GitlabCommit = {
  id: string
  short_id: string
  title: string
  authored_date: string
  author_name: string
}

type GitlabTreeItem = {
  name: string
  path: string
  type: 'blob' | 'tree'
}

export class GitlabAdapter implements SpecSourcePort {
  readonly kind = 'gitlab' as const

  private readonly apiBase: string
  private readonly projectKey: string
  private readonly observationRepository: string

  constructor(private readonly config: GitlabAdapterConfig) {
    const host = (config.host ?? 'https://gitlab.com').replace(/\/$/, '')
    this.apiBase = `${host}/api/v4`
    this.projectKey = `${host}/${config.projectId}`
    this.observationRepository = `${normalizeCredentialFreeRemote(host)}/${String(config.projectId)}`
  }

  async resolveObservationIdentity(ref?: string) {
    return {
      adapterKind: this.kind,
      repository: this.observationRepository,
      ref: ref ?? 'default',
    } as const
  }

  async listRevisions(options: ListRevisionsOptions): Promise<SpecRevision[]> {
    const token = await this.config.tokenProvider.getToken(this.projectKey)
    const sourceRoot = resolveSpecSourceRoot(options)
    const limit = normalizeRevisionLimit(options.limit)
    const perPage = Math.min(100, limit ?? 100)
    const commits: GitlabCommit[] = []
    let page = 1
    while (true) {
      const params = new URLSearchParams({
        path: sourceRoot,
        per_page: String(perPage),
        page: String(page),
      })
      if (options.branch !== undefined) params.set('ref_name', options.branch)
      if (options.since !== undefined) params.set('since', new Date(options.since).toISOString())
      if (options.until !== undefined) params.set('until', new Date(options.until).toISOString())

      const url = `${this.apiBase}/projects/${encodeURIComponent(String(this.config.projectId))}/repository/commits?${params}`
      const batch = await this.fetchJson<GitlabCommit[]>(url, token)
      commits.push(...batch)
      if (batch.length < perPage || (limit !== undefined && commits.length >= limit)) break
      page++
    }
    const branch = options.branch
    return (limit === undefined ? commits : commits.slice(0, limit))
      .map(c => this.toRevision(c, branch))
  }

  async getFileEntries(options: GetFileEntriesOptions): Promise<SpecFileEntry[]> {
    const readBudget = resolveSourceReadBudget(options)
    const token = await this.config.tokenProvider.getToken(this.projectKey)
    const { revision } = options
    const sourceRoot = resolveSpecSourceRoot(options)
    const projectPath = encodeURIComponent(String(this.config.projectId))

    // GitLab tree API returns max 100 items — paginate until exhausted
    const fileItems: GitlabTreeItem[] = []
    let page = 1
    while (true) {
      const params = new URLSearchParams({
        path: sourceRoot,
        ref: revision.id,
        recursive: 'true',
        per_page: '100',
        page: String(page),
      })
      const url = `${this.apiBase}/projects/${projectPath}/repository/tree?${params}`
      const items = await this.fetchJson<GitlabTreeItem[]>(
        url,
        token,
        readBudget?.maxTotalBytes,
        `GitLab tree page ${page}`,
      )
      fileItems.push(...items.filter(item => (
        item.type === 'blob' && isSpecProjectFile(item.path, options.sourceKind)
      )))
      if (readBudget && fileItems.length > readBudget.maxFiles) {
        throw new Error(`GitLab TypeSpec source file count ${fileItems.length} exceeds limit ${readBudget.maxFiles}`)
      }
      if (items.length < 100) break
      page++
    }

    const prefix = sourceRoot.replace(/\/$/, '') + '/'
    const tracker = readBudget
      ? createStreamingSourceReadTracker(readBudget, 'GitLab TypeSpec source read')
      : undefined
    const abortController = tracker === undefined ? undefined : new AbortController()
    const unregisterAbort = tracker?.registerCancel(() => abortController?.abort())
    const tasks = fileItems.map(item => async () => {
      const relativePath = item.path.startsWith(prefix) ? item.path.slice(prefix.length) : item.path
      try {
        const content = await this.fetchFileContent(
          item.path,
          revision.id,
          token,
          readBudget?.maxFileBytes,
          tracker,
          relativePath,
          abortController?.signal,
        )
        return { relativePath, content: content.text, contentHash: sha256(content.text) }
      } catch (error) {
        tracker?.fail(error)
        throw error
      }
    })
    if (readBudget) {
      try {
        return await withSourceReadConcurrency(tasks, readBudget.maxConcurrency)
      } catch (error) {
        throw tracker?.failure ?? error
      } finally {
        unregisterAbort?.()
      }
    }
    const settled = await Promise.allSettled(tasks.map(task => task()))
    const entries: SpecFileEntry[] = []
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        entries.push(result.value)
      } else {
        console.warn(`[spec-lens] Skipping GitLab file at ${revision.id.slice(0, 7)}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
      }
    }
    return entries
  }

  private async fetchFileContent(
    filePath: string,
    ref: string,
    token: string,
    maxBytes?: number,
    tracker?: StreamingSourceReadTracker,
    relativePath = filePath,
    signal?: AbortSignal,
  ): Promise<{ text: string; bytes: number }> {
    const projectPath = encodeURIComponent(String(this.config.projectId))
    const encodedFile = encodeURIComponent(filePath)
    const url = `${this.apiBase}/projects/${projectPath}/repository/files/${encodedFile}/raw?ref=${ref}`
    const res = await this.request(url, token, maxBytes, signal)
    if (maxBytes !== undefined) {
      return readResponseTextBounded(
        res,
        maxBytes,
        `GitLab source file ${filePath}`,
        tracker === undefined ? undefined : { tracker, relativePath },
      )
    }
    const text = await res.text()
    return { text, bytes: Buffer.byteLength(text) }
  }

  private async fetchJson<T>(
    url: string,
    token: string,
    maxBytes?: number,
    label = 'GitLab JSON response',
  ): Promise<T> {
    const res = await this.request(url, token, maxBytes)
    if (maxBytes === undefined) return res.json() as Promise<T>
    const { text } = await readResponseTextBounded(res, maxBytes, label)
    try {
      return JSON.parse(text) as T
    } catch (error) {
      throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async request(
    url: string,
    token: string,
    maxErrorBytes?: number,
    signal?: AbortSignal,
  ): Promise<Response> {
    let res: Response
    try {
      const headers = { 'PRIVATE-TOKEN': token }
      res = await fetch(url, signal === undefined ? { headers } : { headers, signal })
    } catch (err) {
      throw new Error(`GitLab request failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`GitLab auth error (${res.status}). Check your token has api or read_api scope.`)
    }
    if (res.status === 429) {
      const retry = res.headers.get('Retry-After')
      throw new Error(`GitLab rate limited.${retry ? ` Retry after ${retry}s.` : ''}`)
    }
    if (!res.ok) {
      const body = maxErrorBytes === undefined
        ? await res.text().catch(() => '')
        : await readResponseTextBounded(res, maxErrorBytes, 'GitLab error response')
          .then(result => result.text)
          .catch(() => '')
      const safePath = new URL(url).pathname
      throw new Error(`GitLab API error ${res.status}: ${safePath}\n${body}`)
    }
    return res
  }

  private toRevision(commit: GitlabCommit, branch?: string): SpecRevision {
    const authorName = commit.author_name.length > 0 ? commit.author_name : undefined
    return {
      id: commit.id,
      shortId: commit.short_id,
      timestamp: new Date(commit.authored_date).getTime(),
      message: commit.title,
      source: 'gitlab',
      ...(authorName !== undefined ? { author: authorName } : {}),
      ...(branch !== undefined ? { sourceRef: branch } : {}),
    }
  }
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function normalizeRevisionLimit(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('revision limit must be a positive safe integer')
  return value
}
