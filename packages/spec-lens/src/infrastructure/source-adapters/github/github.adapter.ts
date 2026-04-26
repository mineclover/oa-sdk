import { createHash } from 'node:crypto'
import type {
  GetChangedFilesOptions,
  GetFileEntriesOptions,
  ListRevisionsOptions,
  SpecSourcePort,
} from '../../../application/ports/spec-source.port.js'
import type { SpecFileEntry, SpecRevision } from '../../../domain/index.js'
import type { TokenProvider } from './token-provider.js'

export type GithubAdapterConfig = {
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

export class GithubAdapter implements SpecSourcePort {
  readonly kind = 'github' as const

  private readonly apiBase: string
  private readonly repoKey: string

  constructor(private readonly config: GithubAdapterConfig) {
    this.apiBase = config.baseUrl ?? 'https://api.github.com'
    this.repoKey = `github.com/${config.owner}/${config.repo}`
  }

  async listRevisions(options: ListRevisionsOptions): Promise<SpecRevision[]> {
    const token = await this.config.tokenProvider.getToken(this.repoKey)
    const params = new URLSearchParams({
      path: options.fragmentsDir,
      per_page: String(options.limit ?? 50),
    })
    if (options.branch !== undefined) params.set('sha', options.branch)
    if (options.since !== undefined) params.set('since', new Date(options.since).toISOString())
    if (options.until !== undefined) params.set('until', new Date(options.until).toISOString())

    const url = `${this.apiBase}/repos/${this.config.owner}/${this.config.repo}/commits?${params}`
    const commits = await this.fetchJson<GithubCommit[]>(url, token)

    return commits.map(c => this.toRevision(c))
  }

  async getFileEntries(options: GetFileEntriesOptions): Promise<SpecFileEntry[]> {
    const token = await this.config.tokenProvider.getToken(this.repoKey)
    const { revision, fragmentsDir } = options

    // Get the tree for this commit
    const commitUrl = `${this.apiBase}/repos/${this.config.owner}/${this.config.repo}/commits/${revision.id}`
    const commit = await this.fetchJson<{ commit: { tree: { sha: string } } }>(commitUrl, token)
    const treeSha = commit.commit.tree.sha

    const treeUrl = `${this.apiBase}/repos/${this.config.owner}/${this.config.repo}/git/trees/${treeSha}?recursive=1`
    const tree = await this.fetchJson<{ tree: GithubTreeItem[]; truncated: boolean }>(treeUrl, token)
    if (tree.truncated) {
      throw new Error(
        `Git tree truncated at commit ${revision.id}. The repo is too large for recursive tree fetch. ` +
        `Use a more specific fragmentsDir or contact repo maintainers.`,
      )
    }

    const normalized = fragmentsDir.replace(/^\//, '').replace(/\/$/, '')
    const prefix = normalized === '' ? '' : normalized + '/'
    const fileItems = tree.tree.filter(
      item => item.type === 'blob' && item.path.startsWith(prefix) && isDefinitionFile(item.path),
    )

    const entries = await Promise.all(
      fileItems.map(async item => {
        const relativePath = prefix === '' ? item.path : item.path.slice(prefix.length)
        const content = await this.fetchBlob(item.sha, token)
        return {
          relativePath,
          content,
          contentHash: sha256(content),
        }
      }),
    )

    return entries
  }

  async getChangedFiles(options: GetChangedFilesOptions): Promise<string[]> {
    const token = await this.config.tokenProvider.getToken(this.repoKey)
    const { baseRevision, headRevision, fragmentsDir } = options

    const url = `${this.apiBase}/repos/${this.config.owner}/${this.config.repo}/compare/${baseRevision.id}...${headRevision.id}`
    const compare = await this.fetchJson<{ files?: GithubCompareFile[] }>(url, token)

    const normalized = fragmentsDir.replace(/^\//, '').replace(/\/$/, '')
    const prefix = normalized === '' ? '' : normalized + '/'
    return (compare.files ?? [])
      .filter(f => f.filename.startsWith(prefix) && isDefinitionFile(f.filename))
      .map(f => prefix === '' ? f.filename : f.filename.slice(prefix.length))
  }

  private toRevision(commit: GithubCommit): SpecRevision {
    const date = commit.commit.author?.date ?? new Date().toISOString()
    const authorName = commit.commit.author?.name
    return {
      id: commit.sha,
      shortId: commit.sha.slice(0, 7),
      timestamp: new Date(date).getTime(),
      message: commit.commit.message.split('\n')[0] ?? '',
      source: 'github',
      ...(authorName !== undefined ? { author: authorName } : {}),
    }
  }

  private async fetchBlob(blobSha: string, token: string): Promise<string> {
    const url = `${this.apiBase}/repos/${this.config.owner}/${this.config.repo}/git/blobs/${blobSha}`
    const blob = await this.fetchJson<{ content: string; encoding: string }>(url, token)
    if (blob.encoding === 'base64') {
      return Buffer.from(blob.content.replace(/\n/g, ''), 'base64').toString('utf8')
    }
    if (blob.encoding === 'utf-8') {
      return blob.content
    }
    throw new Error(`Unsupported GitHub blob encoding: ${blob.encoding} (sha: ${blobSha})`)
  }

  private async fetchJson<T>(url: string, token: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (res.status === 429 || res.status === 403) {
      const reset = res.headers.get('X-RateLimit-Reset')
      const resetMsg = reset !== null
        ? ` Rate limit resets at ${new Date(Number(reset) * 1000).toISOString()}.`
        : ''
      throw new Error(`GitHub API rate limited (${res.status}).${resetMsg} Reduce refresh frequency or use a token with higher quota.`)
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GitHub API error ${res.status}: ${url}\n${body}`)
    }
    return res.json() as Promise<T>
  }
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function isDefinitionFile(filePath: string): boolean {
  return filePath.endsWith('.yaml') || filePath.endsWith('.yml') || filePath.endsWith('.json')
}
