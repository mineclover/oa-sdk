import type { DefinitionTargetConfig } from '@oa-sdk/parser'
import type { CachePort } from '../ports/cache.port.js'
import type { SnapshotBuilderPort } from '../ports/snapshot-builder.port.js'
import type { SpecSourcePort } from '../ports/spec-source.port.js'
import type { SpecRevision, SpecSnapshotStored } from '../../domain/index.js'

export type RefreshTimelineOptions = {
  fragmentsDir: string
  targetPath: string
  targetConfig: DefinitionTargetConfig
  targetConfigDigest: string
  branch?: string
  limit?: number
}

export type RefreshTimelineResult = {
  newRevisions: number
  builtSnapshots: number
  errors: Array<{ revisionId: string; message: string }>
}

// stored=null means build failed — revision still appears in timeline with snapshotCached=false
type SnapshotEntry = { revision: SpecRevision; stored: SpecSnapshotStored | null }

export class RefreshTimelineHandler {
  constructor(
    private readonly source: SpecSourcePort,
    private readonly builder: SnapshotBuilderPort,
    private readonly cache: CachePort,
  ) {}

  async handle(options: RefreshTimelineOptions): Promise<RefreshTimelineResult> {
    const { fragmentsDir, targetPath, targetConfig, targetConfigDigest, branch, limit } = options

    const revisions = await this.source.listRevisions({
      fragmentsDir,
      ...(branch !== undefined ? { branch } : {}),
      ...(limit !== undefined ? { limit } : {}),
    })
    const errors: RefreshTimelineResult['errors'] = []
    let builtSnapshots = 0
    let newRevisions = 0
    const snapshots: SnapshotEntry[] = []

    for (const revision of revisions) {
      const cached = await this.cache.getSnapshotByRevision(revision.id, fragmentsDir, targetPath, targetConfigDigest)
      if (cached !== null) {
        snapshots.push({ revision, stored: cached })
        continue
      }
      newRevisions++

      try {
        const entries = await this.source.getFileEntries({ revision, fragmentsDir })
        const snapshot = await this.builder.build({ revision, entries, fragmentsDir, targetPath, targetConfig, targetConfigDigest })
        const entryRefs = entries.map(e => ({ relativePath: e.relativePath, contentHash: e.contentHash }))
        const stored: SpecSnapshotStored = { ...snapshot, entryRefs }
        await this.cache.saveSnapshot(stored, entries)
        snapshots.push({ revision, stored })
        builtSnapshots++
      } catch (error) {
        errors.push({
          revisionId: revision.id,
          message: error instanceof Error ? error.message : String(error),
        })
        // Still track the revision in the timeline (snapshotCached=false)
        snapshots.push({ revision, stored: null })
      }
    }

    await this.computeDiffsAndUpdateReadModel(snapshots, fragmentsDir, targetPath, errors)
    await this.populatePathEntries(snapshots, fragmentsDir, targetPath)

    return { newRevisions, builtSnapshots, errors }
  }

  private async computeDiffsAndUpdateReadModel(
    snapshots: SnapshotEntry[],
    fragmentsDir: string,
    targetPath: string,
    errors: RefreshTimelineResult['errors'],
  ): Promise<void> {
    for (let i = 0; i < snapshots.length; i++) {
      const head = snapshots[i]
      const base = snapshots[i + 1]
      if (head === undefined) continue

      // Revision with build failure — record in timeline but skip diff
      if (head.stored === null) {
        await this.cache.upsertTimelineEntry({
          revision: head.revision,
          affectedFiles: [],
          snapshotCached: false,
          diffStats: { pathsAdded: 0, pathsRemoved: 0, pathsChanged: 0, breakingChanges: 0 },
        }, fragmentsDir, targetPath)
        continue
      }

      if (base !== undefined && base.stored !== null) {
        try {
          const existing = await this.cache.getDiff(base.revision.id, head.revision.id, fragmentsDir, targetPath)
          const diff = existing ?? this.builder.diff(base.stored, head.stored)
          if (existing === null) {
            await this.cache.saveDiff(diff, fragmentsDir, targetPath)
          }
          // Always write Read Model regardless of cache hit
          await this.cache.upsertTimelineEntry({
            revision: head.revision,
            affectedFiles: diff.affectedFragments,
            snapshotCached: true,
            diffStats: {
              pathsAdded: diff.stats.pathsAdded,
              pathsRemoved: diff.stats.pathsRemoved,
              pathsChanged: diff.stats.pathsChanged,
              breakingChanges: diff.stats.breakingChanges,
            },
          }, fragmentsDir, targetPath)
        } catch (error) {
          errors.push({
            revisionId: head.revision.id,
            message: `diff error: ${error instanceof Error ? error.message : String(error)}`,
          })
        }
      } else {
        // Oldest revision or base had build failure — no diff possible
        await this.cache.upsertTimelineEntry({
          revision: head.revision,
          affectedFiles: [],
          snapshotCached: true,
          diffStats: { pathsAdded: 0, pathsRemoved: 0, pathsChanged: 0, breakingChanges: 0 },
        }, fragmentsDir, targetPath)
      }
    }
  }

  private async populatePathEntries(
    snapshots: SnapshotEntry[],
    fragmentsDir: string,
    targetPath: string,
  ): Promise<void> {
    // Use the latest snapshot that was successfully built
    const latestEntry = snapshots.find(s => s.stored !== null && s.stored.spec !== null)
    if (latestEntry === undefined || latestEntry.stored === null) return
    const latestSpec = latestEntry.stored.spec
    if (latestSpec === null) return

    const latest = latestEntry.stored
    const specPaths = latestSpec['paths'] as Record<string, unknown> | undefined
    if (specPaths === undefined) return

    // Walk diffs newest→oldest; first occurrence of each path = most recent change
    const lastChanged = new Map<string, { revisionId: string; timestamp: number }>()

    for (let i = 0; i < snapshots.length - 1; i++) {
      const head = snapshots[i]
      const base = snapshots[i + 1]
      if (head === undefined || base === undefined || head.stored === null || base.stored === null) continue

      const diff = await this.cache.getDiff(base.revision.id, head.revision.id, fragmentsDir, targetPath)
      if (diff === null) continue

      for (const entry of diff.normalizedDiff) {
        if (entry.category !== 'path') continue
        // pointer: #/paths/~1books~1{bookId}~1notes  → /books/{bookId}/notes
        const apiPath = decodeJsonPointerPath(entry.pointer)
        // Keep only first hit (newest-first traversal) — subsequent hits are older changes
        if (apiPath !== null && !lastChanged.has(apiPath)) {
          lastChanged.set(apiPath, { revisionId: head.revision.id, timestamp: head.revision.timestamp })
        }
      }
    }

    // Paths absent from all diffs were never changed — assign the latest revision
    for (const apiPath of Object.keys(specPaths)) {
      if (!lastChanged.has(apiPath)) {
        lastChanged.set(apiPath, { revisionId: latestEntry.revision.id, timestamp: latestEntry.revision.timestamp })
      }
    }

    // Extract SpecPathEntry[] from provenance + spec
    const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']
    const pathEntries: import('../../domain/index.js').SpecPathEntry[] = []

    for (const [apiPath, pathItem] of Object.entries(specPaths)) {
      if (typeof pathItem !== 'object' || pathItem === null) continue
      const pointer = `#/paths/${encodeJsonPointerSegment(apiPath)}`
      const provenanceEntry = latest.provenance[pointer]
      if (provenanceEntry === undefined) continue

      const canonicalId = provenanceEntry.canonicalId
      const idParts = canonicalId.split(':')
      const pathPart = idParts[1] ?? ''
      const segments = pathPart.split('/')
      const scope = segments[0] ?? ''
      const domain = segments[1] ?? ''
      const pathItemObj = pathItem as Record<string, unknown>
      const methods = HTTP_METHODS.filter(m => pathItemObj[m] !== undefined)
      const lc = lastChanged.get(apiPath) ?? { revisionId: latestEntry.revision.id, timestamp: latestEntry.revision.timestamp }

      pathEntries.push({
        path: apiPath,
        methods,
        canonicalId,
        scope,
        domain,
        sourceFile: provenanceEntry.sourcePath,
        contentHash: provenanceEntry.contentHash,
        lastChangedRevisionId: lc.revisionId,
        lastChangedTimestamp: lc.timestamp,
      })
    }

    if (pathEntries.length > 0) {
      await this.cache.upsertPathEntries(fragmentsDir, targetPath, pathEntries)
    }
  }
}

// #/paths/~1books~1{bookId}~1notes → /books/{bookId}/notes
function decodeJsonPointerPath(pointer: string): string | null {
  const prefix = '#/paths/'
  if (!pointer.startsWith(prefix)) return null
  const encoded = pointer.slice(prefix.length)
  // Ignore operation pointers like #/paths/~1users/get
  if (/\/(get|post|put|patch|delete|head|options|trace)$/.test(pointer)) return null
  return '/' + encoded.replaceAll('~1', '/').replaceAll('~0', '~')
}

function encodeJsonPointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}
