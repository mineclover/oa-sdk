import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  GetChangedFilesOptions,
  GetFileEntriesOptions,
  ListRevisionsOptions,
  SpecSourcePort,
} from '../../../application/ports/spec-source.port.js'
import type { SpecFileEntry, SpecRevision } from '../../../domain/index.js'

const execFileAsync = promisify(execFile)

export type LocalGitAdapterConfig = {
  repoPath: string
}

export class LocalGitAdapter implements SpecSourcePort {
  readonly kind = 'local-git' as const

  constructor(private readonly config: LocalGitAdapterConfig) {}

  async listRevisions(options: ListRevisionsOptions): Promise<SpecRevision[]> {
    const args = [
      'log',
      `--format=%H%n%aI%n%s%n%an%n---`,
    ]
    if (options.branch !== undefined) args.push(options.branch)
    if (options.since !== undefined) args.push(`--since=${new Date(options.since).toISOString()}`)
    if (options.until !== undefined) args.push(`--until=${new Date(options.until).toISOString()}`)
    if (options.limit !== undefined) args.push(`-${options.limit}`)
    args.push('--', options.fragmentsDir)

    const output = await this.git(args)
    return parseGitLog(output)
  }

  async getFileEntries(options: GetFileEntriesOptions): Promise<SpecFileEntry[]> {
    const { revision, fragmentsDir } = options
    const prefix = fragmentsDir.replace(/\/$/, '') + '/'

    // List all files in fragmentsDir at this commit
    const listOutput = await this.git([
      'ls-tree', '-r', '--name-only', revision.id, '--', fragmentsDir,
    ])

    const filePaths = listOutput
      .split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 0 && isDefinitionFile(p))

    const entries = await Promise.all(
      filePaths.map(async (filePath): Promise<SpecFileEntry> => {
        const content = await this.git(['show', `${revision.id}:${filePath}`])
        const relativePath = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
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
    const { baseRevision, headRevision, fragmentsDir } = options
    const prefix = fragmentsDir.replace(/\/$/, '') + '/'

    const output = await this.git([
      'diff', '--name-only', `${baseRevision.id}..${headRevision.id}`, '--', fragmentsDir,
    ])

    return output
      .split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 0 && isDefinitionFile(p))
      .map(p => p.startsWith(prefix) ? p.slice(prefix.length) : p)
  }

  private async git(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd: this.config.repoPath,
      maxBuffer: 50 * 1024 * 1024,  // 50MB
    })
    return stdout
  }
}

function parseGitLog(output: string): SpecRevision[] {
  const revisions: SpecRevision[] = []
  const chunks = output.split('---\n').filter(c => c.trim().length > 0)

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

function isDefinitionFile(filePath: string): boolean {
  return filePath.endsWith('.yaml') || filePath.endsWith('.yml') || filePath.endsWith('.json')
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
