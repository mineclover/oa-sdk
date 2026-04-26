import type {
  SpecFileEntry,
  SpecPathEntry,
  SpecSnapshotStored,
  SpecTimelineDiff,
  SpecTimelineEntry,
} from '../../domain/index.js'

export type ListTimelineOptions = {
  fragmentsDir: string
  targetPath: string
  limit?: number
}

export type ListPathsOptions = {
  fragmentsDir: string
  targetPath: string
  scope?: string
  domain?: string
}

export type ClearCacheResult = {
  deletedSnapshots: number
  deletedDiffs: number
  deletedTimeline: number
  deletedPaths: number
}

export interface CachePort {
  // Write Side (snapshot 빌드 결과 저장, 단일 트랜잭션)
  saveSnapshot(snapshot: SpecSnapshotStored, entries: SpecFileEntry[]): Promise<void>
  saveDiff(diff: SpecTimelineDiff, fragmentsDir: string, targetPath: string): Promise<void>

  // Read Model 갱신 (Sync Worker 전용)
  upsertTimelineEntry(entry: SpecTimelineEntry, fragmentsDir: string, targetPath: string): Promise<void>
  upsertPathEntries(fragmentsDir: string, targetPath: string, entries: SpecPathEntry[]): Promise<void>

  // Read
  listTimeline(options: ListTimelineOptions): Promise<SpecTimelineEntry[]>
  getSnapshotByRevision(revisionId: string, fragmentsDir: string, targetPath: string, targetConfigDigest: string): Promise<SpecSnapshotStored | null>
  getDiff(baseRevisionId: string, headRevisionId: string, fragmentsDir: string, targetPath: string): Promise<SpecTimelineDiff | null>
  listPaths(options: ListPathsOptions): Promise<SpecPathEntry[]>
  getFragmentBlob(contentHash: string): Promise<string | null>

  // Maintenance
  clearCache(fragmentsDir: string, targetPath: string): Promise<ClearCacheResult>
}
