export type {
  SpecFileEntry,
  SpecGraph,
  SpecGraphEdge,
  SpecGraphNode,
  SpecPathEntry,
  SpecRevision,
  SpecSnapshot,
  SpecSnapshotDiagnostic,
  SpecSnapshotStored,
  SpecSourceKind,
  SpecTimelineDiff,
  SpecTimelineEntry,
} from './domain/index.js'

export {
  GetDiffHandler,
  GetGraphHandler,
  GetPathsHandler,
  GetSnapshotHandler,
  GetTimelineHandler,
  RefreshTimelineHandler,
} from './application/index.js'
export type {
  BuildSnapshotOptions,
  CachePort,
  GetDiffQuery,
  GetFileEntriesOptions,
  GetGraphQuery,
  GetPathsQuery,
  GetSnapshotQuery,
  GetTimelineQuery,
  ListPathsOptions,
  ListRevisionsOptions,
  ListTimelineOptions,
  RefreshTimelineOptions,
  RefreshTimelineResult,
  SnapshotBuilderPort,
  SpecSourcePort,
} from './application/index.js'

export {
  DefaultTokenProvider,
  FileDiffAdapter,
  GithubAdapter,
  GithubApiAdapter,
  GitlabAdapter,
  LocalGitAdapter,
  SnapshotBuilder,
  SqliteCache,
  buildTargetConfigDigest,
} from './infrastructure/index.js'
export type {
  FileDiffAdapterConfig,
  GithubAdapterConfig,
  GithubApiAdapterConfig,
  GitlabAdapterConfig,
  LocalGitAdapterConfig,
  TokenProvider,
  TokenProviderConfig,
} from './infrastructure/index.js'

export { createSpecLensServer, serveSpecLens } from './presentation/http/server.js'
export type { SpecLensServerConfig } from './presentation/http/server.js'
