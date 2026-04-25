import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import type {
  GetChangedFilesOptions,
  GetFileEntriesOptions,
  ListRevisionsOptions,
  SpecSourcePort,
} from '../../../application/ports/spec-source.port.js'
import type { SpecFileEntry, SpecRevision } from '../../../domain/index.js'

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

  // listRevisions returns [head, base] — head is newest
  async listRevisions(_options: ListRevisionsOptions): Promise<SpecRevision[]> {
    return [this.headRevision, this.baseRevision]
  }

  async getFileEntries(options: GetFileEntriesOptions): Promise<SpecFileEntry[]> {
    const { revision } = options
    const rootPath = revision.id === this.headRevision.id
      ? this.config.headPath
      : this.config.basePath

    return scanDirectory(rootPath)
  }

  async getChangedFiles(options: GetChangedFilesOptions): Promise<string[]> {
    const baseEntries = await this.getFileEntries({ revision: options.baseRevision, fragmentsDir: '' })
    const headEntries = await this.getFileEntries({ revision: options.headRevision, fragmentsDir: '' })

    const baseMap = new Map(baseEntries.map(e => [e.relativePath, e.contentHash]))
    const headMap = new Map(headEntries.map(e => [e.relativePath, e.contentHash]))
    const changed: string[] = []

    for (const [path, hash] of headMap) {
      if (baseMap.get(path) !== hash) changed.push(path)
    }
    for (const path of baseMap.keys()) {
      if (!headMap.has(path)) changed.push(path)
    }

    return changed.sort()
  }
}

function scanDirectory(rootPath: string): SpecFileEntry[] {
  const entries: SpecFileEntry[] = []

  function visit(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      const ext = extname(entry.name)
      if (ext !== '.yaml' && ext !== '.yml' && ext !== '.json') continue

      const content = readFileSync(fullPath, 'utf8')
      entries.push({
        relativePath: relative(rootPath, fullPath),
        content,
        contentHash: sha256(content),
      })
    }
  }

  if (statSync(rootPath).isDirectory()) visit(rootPath)
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
