import { createHash } from 'node:crypto'
import type {
  GetFileEntriesOptions,
  ListRevisionsOptions,
  SpecSourcePort,
} from '../../../application/ports/spec-source.port.js'
import type { SpecFileEntry, SpecRevision } from '../../../domain/index.js'
import type { TokenProvider } from '../github/token-provider.js'

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

  constructor(private readonly config: GitlabAdapterConfig) {
    const host = (config.host ?? 'https://gitlab.com').replace(/\/$/, '')
    this.apiBase = `${host}/api/v4`
    this.projectKey = `${host}/${config.projectId}`
  }

  async listRevisions(options: ListRevisionsOptions): Promise<SpecRevision[]> {
    const token = await this.config.tokenProvider.getToken(this.projectKey)
    const params = new URLSearchParams({
      path: options.fragmentsDir,
      per_page: String(options.limit ?? 50),
    })
    if (options.branch !== undefined) params.set('ref_name', options.branch)
    if (options.since !== undefined) params.set('since', new Date(options.since).toISOString())
    if (options.until !== undefined) params.set('until', new Date(options.until).toISOString())

    const url = `${this.apiBase}/projects/${encodeURIComponent(String(this.config.projectId))}/repository/commits?${params}`
    const commits = await this.fetchJson<GitlabCommit[]>(url, token)
    const branch = options.branch
    return commits.map(c => this.toRevision(c, branch))
  }

  async getFileEntries(options: GetFileEntriesOptions): Promise<SpecFileEntry[]> {
    const token = await this.config.tokenProvider.getToken(this.projectKey)
    const { revision, fragmentsDir } = options
    const projectPath = encodeURIComponent(String(this.config.projectId))

    // GitLab tree API returns max 100 items — paginate until exhausted
    const allItems: GitlabTreeItem[] = []
    let page = 1
    while (true) {
      const params = new URLSearchParams({
        path: fragmentsDir,
        ref: revision.id,
        recursive: 'true',
        per_page: '100',
        page: String(page),
      })
      const url = `${this.apiBase}/projects/${projectPath}/repository/tree?${params}`
      const items = await this.fetchJson<GitlabTreeItem[]>(url, token)
      allItems.push(...items)
      if (items.length < 100) break
      page++
    }

    const fileItems = allItems.filter(item => item.type === 'blob' && isDefinitionFile(item.path))

    const prefix = fragmentsDir.replace(/\/$/, '') + '/'
    const settled = await Promise.allSettled(
      fileItems.map(async item => {
        const relativePath = item.path.startsWith(prefix) ? item.path.slice(prefix.length) : item.path
        const content = await this.fetchFileContent(item.path, revision.id, token)
        return { relativePath, content, contentHash: sha256(content) }
      }),
    )
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

  private async fetchFileContent(filePath: string, ref: string, token: string): Promise<string> {
    const projectPath = encodeURIComponent(String(this.config.projectId))
    const encodedFile = encodeURIComponent(filePath)
    const url = `${this.apiBase}/projects/${projectPath}/repository/files/${encodedFile}/raw?ref=${ref}`
    const res = await this.request(url, token)
    return res.text()
  }

  private async fetchJson<T>(url: string, token: string): Promise<T> {
    const res = await this.request(url, token)
    return res.json() as Promise<T>
  }

  private async request(url: string, token: string): Promise<Response> {
    let res: Response
    try {
      res = await fetch(url, { headers: { 'PRIVATE-TOKEN': token } })
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
      const body = await res.text().catch(() => '')
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

function isDefinitionFile(filePath: string): boolean {
  return filePath.endsWith('.yaml') || filePath.endsWith('.yml') || filePath.endsWith('.json')
}
