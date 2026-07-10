import type {
  SpecFileEntry,
  SpecPathEntry,
  SpecSnapshotStored,
  SpecTimelineDiff,
  SpecTimelineEntry,
} from '../../domain/index.js'

export type ListTimelineOptions = {
  projectKey: string
  limit?: number
}

export type ListPathsOptions = {
  projectKey: string
  scope?: string
  domain?: string
}

export type ClearCacheResult = {
  deletedSnapshots: number
  deletedDiffs: number
  deletedTimeline: number
  deletedPaths: number
  deletedEntries: number
  deletedBlobs: number
}

export interface CachePort {
  // Write Side (snapshot 빌드 결과 저장, 단일 트랜잭션)
  saveSnapshot(snapshot: SpecSnapshotStored, entries: SpecFileEntry[]): Promise<void>
  saveDiff(diff: SpecTimelineDiff, projectKey: string): Promise<void>

  // Read Model 갱신 (Sync Worker 전용)
  upsertTimelineEntry(entry: SpecTimelineEntry, projectKey: string): Promise<void>
  upsertPathEntries(projectKey: string, entries: SpecPathEntry[]): Promise<void>

  // Read
  listTimeline(options: ListTimelineOptions): Promise<SpecTimelineEntry[]>
  getSnapshotByRevision(revisionId: string, projectKey: string): Promise<SpecSnapshotStored | null>
  getDiff(baseRevisionId: string, headRevisionId: string, projectKey: string): Promise<SpecTimelineDiff | null>
  listPaths(options: ListPathsOptions): Promise<SpecPathEntry[]>
  getFragmentBlob(contentHash: string): Promise<string | null>

  // Maintenance
  clearCache(projectKey: string): Promise<ClearCacheResult>
}
