import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  GetFileEntriesOptions,
  ListRevisionsOptions,
  SpecSourcePort,
} from '../../../application/ports/spec-source.port.js'
import type { SpecFileEntry, SpecRevision } from '../../../domain/index.js'

const execFileAsync = promisify(execFile)

export type LocalGitAdapterConfig = {
  repoPath: string
  /** Default branch for listRevisions when options.branch is not specified. */
  branch?: string
}

export class LocalGitAdapter implements SpecSourcePort {
  readonly kind = 'local-git' as const

  constructor(private readonly config: LocalGitAdapterConfig) {}

  async listRevisions(options: ListRevisionsOptions): Promise<SpecRevision[]> {
    const branch = options.branch ?? this.config.branch
    const args = ['log', '--format=%H%n%aI%n%s%n%an%n%x00']
    if (branch !== undefined) args.push(branch)
    if (options.since !== undefined) args.push(`--since=${new Date(options.since).toISOString()}`)
    if (options.until !== undefined) args.push(`--until=${new Date(options.until).toISOString()}`)
    if (options.limit !== undefined) args.push(`-${Math.max(1, Math.floor(options.limit))}`)
    args.push('--', options.fragmentsDir)

    const output = await this.git(args)
    const revisions = parseGitLog(output)
    if (branch === undefined) return revisions
    return revisions.map(r => ({ ...r, sourceRef: branch }))
  }

  async getFileEntries(options: GetFileEntriesOptions): Promise<SpecFileEntry[]> {
    const { revision } = options
    const dir = normalizeDir(options.fragmentsDir)
    const prefix = dir ? dir + '/' : ''

    const listOutput = await this.git(['ls-tree', '-r', '--name-only', revision.id, '--', dir])

    const filePaths = listOutput
      .split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 0 && isDefinitionFile(p))

    if (filePaths.length === 0) {
      console.warn(`[spec-lens] No definition files found in '${dir}' at ${revision.id.slice(0, 7)} — check fragmentsDir config`)
    }

    const settled = await Promise.allSettled(
      filePaths.map(async (filePath): Promise<SpecFileEntry> => {
        const content = await this.git(['show', `${revision.id}:${filePath}`])
        const relativePath = prefix && filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
        return { relativePath, content, contentHash: sha256(content) }
      }),
    )

    const entries: SpecFileEntry[] = []
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        entries.push(result.value)
      } else {
        console.warn(`[spec-lens] Skipping file at ${revision.id.slice(0, 7)}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
      }
    }
    return entries
  }

  async git(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd: this.config.repoPath,
      maxBuffer: 50 * 1024 * 1024,
    })
    return stdout
  }
}

function parseGitLog(output: string): SpecRevision[] {
  const revisions: SpecRevision[] = []
  const chunks = output.split('\0').filter(c => c.trim().length > 0)

  for (const chunk of chunks) {
    const lines = chunk.split('\n')
    const sha = lines[0]?.trim()
    const dateStr = lines[1]?.trim()
    const message = lines[2]?.trim()
    const author = lines[3]?.trim()

    if (sha === undefined || sha.length !== 40) continue

    const resolvedAuthor = author !== undefined && author.length > 0 ? author : undefined
    revisions.push({
      id: sha,
      shortId: sha.slice(0, 7),
      timestamp: dateStr !== undefined ? new Date(dateStr).getTime() : Date.now(),
      message: message ?? '',
      source: 'local-git',
      ...(resolvedAuthor !== undefined ? { author: resolvedAuthor } : {}),
    })
  }

  return revisions
}

function normalizeDir(dir: string): string {
  return dir.replace(/^\//, '').replace(/\/$/, '')
}

function isDefinitionFile(filePath: string): boolean {
  return filePath.endsWith('.yaml') || filePath.endsWith('.yml') || filePath.endsWith('.json')
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
