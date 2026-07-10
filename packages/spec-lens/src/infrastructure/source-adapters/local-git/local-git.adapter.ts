import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { promisify } from 'node:util'
import type {
  GetFileEntriesOptions,
  ListRevisionsOptions,
  SpecSourcePort,
} from '../../../application/ports/spec-source.port.js'
import type { SpecFileEntry, SpecRevision } from '../../../domain/index.js'
import { isSpecProjectFile, resolveSpecSourceRoot } from '../source-file-policy.js'
import {
  assertSizedSourceCandidates,
  resolveSourceReadBudget,
  withSourceReadConcurrency,
} from '../source-read-budget.js'

const execFileAsync = promisify(execFile)
const DEFAULT_GIT_MAX_BUFFER_BYTES = 50 * 1024 * 1024
const GIT_SHOW_BUFFER_MARGIN_BYTES = 64 * 1024
const MAX_TYPESPEC_TREE_METADATA_BYTES = 4 * 1024 * 1024

export type LocalGitAdapterConfig = {
  repoPath: string
  /** Default branch for listRevisions when options.branch is not specified. */
  branch?: string
}

export class LocalGitAdapter implements SpecSourcePort {
  readonly kind = 'local-git' as const
  private trackedRefPromise: Promise<TrackedGitRef> | undefined

  constructor(private readonly config: LocalGitAdapterConfig) {}

  async resolveObservationIdentity(ref?: string) {
    const tracked = await this.resolveTrackedRef(ref)
    return {
      adapterKind: this.kind,
      repository: `file://${realpathSync(this.config.repoPath).replaceAll('\\', '/')}`,
      ref: tracked.identityRef,
    } as const
  }

  async listRevisions(options: ListRevisionsOptions): Promise<SpecRevision[]> {
    const tracked = await this.resolveTrackedRef(options.branch)
    const sourceRoot = resolveSpecSourceRoot(options)
    const args = ['log', '--format=%H%n%aI%n%s%n%an%n%x00']
    args.push(tracked.selector)
    if (options.since !== undefined) args.push(`--since=${new Date(options.since).toISOString()}`)
    if (options.until !== undefined) args.push(`--until=${new Date(options.until).toISOString()}`)
    if (options.limit !== undefined) {
      if (!Number.isSafeInteger(options.limit) || options.limit <= 0) {
        throw new Error('revision limit must be a positive safe integer')
      }
      args.push(`-${options.limit}`)
    }
    args.push('--', sourceRoot)

    const output = await this.git(args)
    const revisions = parseGitLog(output)
    return revisions.map(r => ({ ...r, sourceRef: tracked.identityRef }))
  }

  async getFileEntries(options: GetFileEntriesOptions): Promise<SpecFileEntry[]> {
    const { revision } = options
    const budget = resolveSourceReadBudget(options)
    const dir = normalizeDir(resolveSpecSourceRoot(options))
    const prefix = dir ? dir + '/' : ''

    const treeMetadataMaxBuffer = budget === undefined
      ? DEFAULT_GIT_MAX_BUFFER_BYTES
      : Math.min(budget.maxTotalBytes, MAX_TYPESPEC_TREE_METADATA_BYTES)
    const listOutput = await this.git(
      ['ls-tree', '-r', '-l', '-z', revision.id, '--', dir],
      treeMetadataMaxBuffer,
    )
    const candidates = parseSizedGitTree(listOutput, prefix, options.sourceKind)

    if (budget !== undefined) {
      assertSizedSourceCandidates(candidates, budget, 'local git TypeSpec source')
    }

    if (candidates.length === 0) {
      console.warn(`[spec-lens] No project source files found in '${dir}' at ${revision.id.slice(0, 7)} — check sourceRoot config`)
    }

    const readCandidate = async (candidate: SizedGitTreeCandidate): Promise<SpecFileEntry> => {
      const maxBuffer = budget === undefined
        ? DEFAULT_GIT_MAX_BUFFER_BYTES
        : budget.maxFileBytes + GIT_SHOW_BUFFER_MARGIN_BYTES
      const content = await this.git(
        ['show', `${revision.id}:${candidate.filePath}`],
        maxBuffer,
      )
      if (budget !== undefined) {
        const actualBytes = Buffer.byteLength(content, 'utf8')
        if (actualBytes !== candidate.size) {
          throw new Error(
            `local git TypeSpec source size changed for ${candidate.relativePath}: expected ${candidate.size}, received ${actualBytes}`,
          )
        }
      }
      return {
        relativePath: candidate.relativePath,
        content,
        contentHash: sha256(content),
      }
    }

    if (budget !== undefined) {
      return withSourceReadConcurrency(
        candidates.map(candidate => () => readCandidate(candidate)),
        budget.maxConcurrency,
      )
    }

    const settled = await Promise.allSettled(candidates.map(readCandidate))

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

  async git(args: string[], maxBuffer = DEFAULT_GIT_MAX_BUFFER_BYTES): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd: this.config.repoPath,
      maxBuffer,
    })
    return stdout
  }

  private async resolveTrackedRef(ref?: string): Promise<TrackedGitRef> {
    const requestedRef = ref ?? this.config.branch
    if (this.trackedRefPromise === undefined) {
      this.trackedRefPromise = this.createTrackedRef(requestedRef)
    }
    const tracked = await this.trackedRefPromise
    if (requestedRef !== undefined
      && requestedRef !== tracked.requestedRef
      && requestedRef !== tracked.selector
      && requestedRef !== tracked.identityRef) {
      throw new Error(`local git adapter is already pinned to ${tracked.identityRef}, cannot switch to ${requestedRef}`)
    }
    return tracked
  }

  private async createTrackedRef(requestedRef: string | undefined): Promise<TrackedGitRef> {
    if (requestedRef !== undefined) {
      await this.git(['rev-parse', '--verify', `${requestedRef}^{commit}`])
      return { requestedRef, selector: requestedRef, identityRef: requestedRef }
    }
    const attached = await this.git(['symbolic-ref', '--quiet', '--short', 'HEAD'])
      .then(value => value.trim())
      .catch(() => '')
    if (attached !== '') {
      return { selector: attached, identityRef: attached }
    }
    const commit = (await this.git(['rev-parse', '--verify', 'HEAD^{commit}'])).trim()
    if (!/^[0-9a-f]{40}$/i.test(commit)) {
      throw new Error('detached HEAD did not resolve to a commit SHA')
    }
    return { selector: commit, identityRef: `detached:${commit}` }
  }
}

type TrackedGitRef = {
  requestedRef?: string
  selector: string
  identityRef: string
}

function parseGitLog(output: string): SpecRevision[] {
  const revisions: SpecRevision[] = []
  const chunks = output.split('\0').filter(c => c.trim().length > 0)

  for (const chunk of chunks) {
    // git places a newline after each NUL-delimited record. Without removing it,
    // every record after the first starts with an empty SHA line and is dropped.
    const lines = chunk.replace(/^\n+/, '').split('\n')
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

type SizedGitTreeCandidate = {
  filePath: string
  relativePath: string
  size: number
}

function parseSizedGitTree(
  output: string,
  prefix: string,
  sourceKind: GetFileEntriesOptions['sourceKind'],
): SizedGitTreeCandidate[] {
  const candidates: SizedGitTreeCandidate[] = []
  for (const record of output.split('\0')) {
    if (record.length === 0) continue
    const separator = record.indexOf('\t')
    if (separator < 0) {
      throw new Error('local git ls-tree returned malformed size metadata')
    }
    const metadata = record.slice(0, separator)
    const filePath = record.slice(separator + 1)
    const metadataMatch = /^\d{6} (\S+) [0-9a-f]+\s+(\S+)$/i.exec(metadata)
    if (metadataMatch === null) {
      throw new Error(`local git ls-tree returned malformed size metadata for ${filePath}`)
    }
    if (metadataMatch[1] !== 'blob') continue
    if (!isSpecProjectFile(filePath, sourceKind)) continue
    const sizeText = metadataMatch[2]
    if (sizeText === undefined || !/^\d+$/.test(sizeText)) {
      throw new Error(`local git ls-tree returned missing or invalid blob size for ${filePath}`)
    }
    const size = Number(sizeText)
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`local git ls-tree returned missing or invalid blob size for ${filePath}`)
    }
    const relativePath = prefix !== '' && filePath.startsWith(prefix)
      ? filePath.slice(prefix.length)
      : filePath
    candidates.push({ filePath, relativePath, size })
  }
  return candidates
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
