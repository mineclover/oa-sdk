import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { LocalGitAdapter } from '../local-git/local-git.adapter.js'
import type {
  GetChangedFilesOptions,
  GetFileEntriesOptions,
  ListRevisionsOptions,
  SpecSourcePort,
} from '../../../application/ports/spec-source.port.js'
import type { SpecFileEntry, SpecRevision } from '../../../domain/index.js'
import type { TokenProvider } from './token-provider.js'

const execFileAsync = promisify(execFile)

export type GithubAdapterConfig = {
  owner: string
  repo: string
  tokenProvider: TokenProvider
  /** Branch to track. If omitted, all remote branches are fetched. */
  branch?: string
  /** Local directory where repos are cloned. Default: '.spec-lens-repos' */
  repoCache?: string
  /** GitHub Enterprise host, e.g. 'https://ghe.example.com' */
  host?: string
}

export class GithubAdapter implements SpecSourcePort {
  readonly kind = 'github' as const

  private readonly repoPath: string
  private readonly cloneBase: string
  private readonly repoKey: string
  private readonly local: LocalGitAdapter

  constructor(private readonly config: GithubAdapterConfig) {
    const host = (config.host ?? 'https://github.com').replace(/\/$/, '')
    const cacheDir = resolve(config.repoCache ?? '.spec-lens-repos')
    this.repoPath = join(cacheDir, config.owner, config.repo)
    this.cloneBase = `${host}/${config.owner}/${config.repo}.git`
    this.repoKey = `${host.replace('https://', '')}/${config.owner}/${config.repo}`
    this.local = new LocalGitAdapter({ repoPath: this.repoPath })
  }

  async listRevisions(options: ListRevisionsOptions): Promise<SpecRevision[]> {
    await this.syncRepo(options.branch ?? this.config.branch)
    return this.local.listRevisions(options)
  }

  async getFileEntries(options: GetFileEntriesOptions): Promise<SpecFileEntry[]> {
    return this.local.getFileEntries(options)
  }

  async getChangedFiles(options: GetChangedFilesOptions): Promise<string[]> {
    return this.local.getChangedFiles(options)
  }

  /** Exposed for explicit pre-fetch (e.g. health checks). */
  async syncRepo(branch?: string): Promise<void> {
    const token = await this.config.tokenProvider.getToken(this.repoKey)
    // Embed token in HTTPS URL — not stored in git config
    const authUrl = this.cloneBase.replace('https://', `https://oauth2:${token}@`)

    if (!existsSync(join(this.repoPath, 'HEAD'))) {
      mkdirSync(this.repoPath, { recursive: true })
      console.log(`[spec-lens] Cloning ${this.config.owner}/${this.config.repo}…`)
      // Bare clone with partial blob filter: only metadata, blobs fetched on demand
      await git(['clone', '--bare', '--filter=blob:none', '--no-tags', authUrl, this.repoPath])
      console.log(`[spec-lens] Clone complete → ${this.repoPath}`)
    } else {
      const refspec = branch
        ? `+refs/heads/${branch}:refs/heads/${branch}`
        : '+refs/heads/*:refs/heads/*'
      await git(['fetch', authUrl, refspec], this.repoPath)
    }
  }
}

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 50 * 1024 * 1024,
  }).catch(err => {
    // Strip auth URL from error messages to avoid token leak in logs
    const msg = (err instanceof Error ? err.message : String(err)).replace(
      /https:\/\/[^@]+@/g,
      'https://***@',
    )
    throw new Error(msg)
  })
  return stdout
}
