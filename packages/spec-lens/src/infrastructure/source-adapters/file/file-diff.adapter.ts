import { createHash } from 'node:crypto'
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  GetFileEntriesOptions,
  ListRevisionsOptions,
  SpecSourceReadBudget,
  SpecSourcePort,
} from '../../../application/ports/spec-source.port.js'
import type { SpecFileEntry, SpecRevision } from '../../../domain/index.js'
import { isSpecProjectFile } from '../source-file-policy.js'
import { resolveSourceReadBudget } from '../source-read-budget.js'

export type FileDiffAdapterConfig = {
  basePath: string
  headPath: string
  labels?: { base?: string; head?: string }
}

export class FileDiffAdapter implements SpecSourcePort {
  readonly kind = 'file' as const

  private readonly baseRevision: SpecRevision
  private readonly headRevision: SpecRevision

  constructor(private readonly config: FileDiffAdapterConfig) {
    const now = Date.now()
    this.baseRevision = {
      id: `file:base:${config.basePath}`,
      shortId: config.labels?.base ?? 'base',
      timestamp: now - 1,
      message: config.labels?.base ?? config.basePath,
      source: 'file',
    }
    this.headRevision = {
      id: `file:head:${config.headPath}`,
      shortId: config.labels?.head ?? 'head',
      timestamp: now,
      message: config.labels?.head ?? config.headPath,
      source: 'file',
    }
  }

  async resolveObservationIdentity(ref?: string) {
    return {
      adapterKind: this.kind,
      repository: `file-diff://${resolve(this.config.basePath).replaceAll('\\', '/')}::${resolve(this.config.headPath).replaceAll('\\', '/')}`,
      ref: ref ?? 'comparison',
    } as const
  }

  // listRevisions returns [head, base] — head is newest
  async listRevisions(_options: ListRevisionsOptions): Promise<SpecRevision[]> {
    return [this.headRevision, this.baseRevision]
  }

  async getFileEntries(options: GetFileEntriesOptions): Promise<SpecFileEntry[]> {
    const { revision } = options
    const budget = resolveSourceReadBudget(options)
    const rootPath = revision.id === this.headRevision.id
      ? this.config.headPath
      : this.config.basePath

    return scanDirectory(rootPath, options.sourceKind, budget)
  }

}

function scanDirectory(
  rootPath: string,
  sourceKind: GetFileEntriesOptions['sourceKind'],
  budget: SpecSourceReadBudget | undefined,
): SpecFileEntry[] {
  try {
    const resolvedRoot = realpathSync(resolve(rootPath))
    if (!statSync(resolvedRoot).isDirectory()) return []
    const candidates = collectFileCandidates(resolvedRoot, sourceKind, budget)
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))

    return candidates.map(candidate => {
      const bytes = budget === undefined
        ? readFileSync(candidate.realPath)
        : readBoundedCandidate(candidate)
      if (budget !== undefined && bytes.byteLength !== candidate.size) {
        throw new Error(
          `file diff TypeSpec source size changed for ${candidate.relativePath}: expected ${candidate.size}, received ${bytes.byteLength}`,
        )
      }
      const content = bytes.toString('utf8')
      return {
        relativePath: candidate.relativePath,
        content,
        contentHash: sha256(content),
      }
    })
  } catch (err) {
    throw new Error(`Failed to scan directory '${rootPath}': ${err instanceof Error ? err.message : String(err)}`)
  }
}

function readBoundedCandidate(candidate: FileCandidate): Buffer {
  const descriptor = openSync(candidate.realPath, 'r')
  try {
    const openedSize = fstatSync(descriptor).size
    if (openedSize !== candidate.size) {
      throw new Error(
        `file diff TypeSpec source size changed for ${candidate.relativePath}: expected ${candidate.size}, received ${openedSize}`,
      )
    }
    const bytes = Buffer.alloc(candidate.size + 1)
    let offset = 0
    while (offset < bytes.byteLength) {
      const count = readSync(descriptor, bytes, offset, bytes.byteLength - offset, null)
      if (count === 0) break
      offset += count
    }
    if (offset !== candidate.size) {
      throw new Error(
        `file diff TypeSpec source size changed for ${candidate.relativePath}: expected ${candidate.size}, received ${offset}`,
      )
    }
    return bytes.subarray(0, offset)
  } finally {
    closeSync(descriptor)
  }
}

type FileCandidate = {
  realPath: string
  relativePath: string
  size: number
}

function collectFileCandidates(
  rootRealPath: string,
  sourceKind: GetFileEntriesOptions['sourceKind'],
  budget: SpecSourceReadBudget | undefined,
): FileCandidate[] {
  const candidates: FileCandidate[] = []
  const visitedDirectories = new Set<string>()
  const failClosed = sourceKind === 'typespec-bundle'
  let totalBytes = 0

  function addCandidate(candidate: FileCandidate): void {
    if (budget !== undefined) {
      const nextCount = candidates.length + 1
      if (nextCount > budget.maxFiles) {
        throw new Error(
          `file diff TypeSpec source file count ${nextCount} exceeds limit ${budget.maxFiles}`,
        )
      }
      if (!Number.isSafeInteger(candidate.size) || candidate.size < 0) {
        throw new Error(
          `file diff TypeSpec source has missing or invalid size metadata: ${candidate.relativePath}`,
        )
      }
      if (candidate.size > budget.maxFileBytes) {
        throw new Error(
          `file diff TypeSpec source file ${candidate.relativePath} exceeds ${budget.maxFileBytes} bytes: ${candidate.size}`,
        )
      }
      totalBytes += candidate.size
      if (!Number.isSafeInteger(totalBytes) || totalBytes > budget.maxTotalBytes) {
        throw new Error(
          `file diff TypeSpec source aggregate bytes exceed limit ${budget.maxTotalBytes}`,
        )
      }
    }
    candidates.push(candidate)
  }

  function visit(directoryRealPath: string, logicalDirectory: string): void {
    const canonicalDirectory = realpathSync(directoryRealPath)
    assertContainedPath(rootRealPath, canonicalDirectory, failClosed)
    if (visitedDirectories.has(canonicalDirectory)) return
    visitedDirectories.add(canonicalDirectory)

    for (const entry of readdirSync(canonicalDirectory, { withFileTypes: true })) {
      const discoveredPath = join(canonicalDirectory, entry.name)
      const logicalPath = logicalDirectory === ''
        ? entry.name
        : join(logicalDirectory, entry.name)
      const discoveredStat = lstatSync(discoveredPath)

      if (discoveredStat.isSymbolicLink()) {
        // Definition-builder scans historically ignored symlinks. TypeSpec scans
        // may follow in-root links, but resolve and contain them before any read.
        if (!failClosed) continue
        const targetRealPath = realpathSync(discoveredPath)
        assertContainedPath(rootRealPath, targetRealPath, true)
        const targetStat = statSync(targetRealPath)
        if (targetStat.isDirectory()) {
          visit(targetRealPath, logicalPath)
        } else if (targetStat.isFile() && isSpecProjectFile(logicalPath, sourceKind)) {
          addCandidate({
            realPath: targetRealPath,
            relativePath: logicalPath,
            size: targetStat.size,
          })
        }
        continue
      }

      if (discoveredStat.isDirectory()) {
        visit(discoveredPath, logicalPath)
        continue
      }
      if (!discoveredStat.isFile() || !isSpecProjectFile(logicalPath, sourceKind)) continue
      const fileRealPath = realpathSync(discoveredPath)
      assertContainedPath(rootRealPath, fileRealPath, failClosed)
      addCandidate({
        realPath: fileRealPath,
        relativePath: logicalPath,
        size: discoveredStat.size,
      })
    }
  }

  visit(rootRealPath, '')
  return candidates
}

function assertContainedPath(rootRealPath: string, targetRealPath: string, failClosed: boolean): void {
  if (!failClosed) return
  const pathFromRoot = relative(rootRealPath, targetRealPath)
  if (
    pathFromRoot === '..'
    || pathFromRoot.startsWith(`..${sep}`)
    || isAbsolute(pathFromRoot)
  ) {
    throw new Error(`TypeSpec source path escapes configured root: ${targetRealPath}`)
  }
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
