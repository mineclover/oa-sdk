// Types mirrored from @oa-sdk/spec-lens domain types
export type SpecSourceKind = 'github' | 'gitlab' | 'local-git' | 'file'

export type SpecRevision = {
  id: string
  shortId: string
  timestamp: number
  message: string
  author?: string
  source: SpecSourceKind
  sourceRef?: string
  metadata?: Record<string, unknown>
}

export type SpecFileEntry = {
  relativePath: string
  content: string
  contentHash: string
}

export type SpecTimelineEntry = {
  revision: SpecRevision
  affectedFiles: string[]
  snapshotCached: boolean
  diffStats: {
    pathsAdded: number
    pathsRemoved: number
    pathsChanged: number
    breakingChanges: number
  }
}

export type ProvenanceEntry = {
  canonicalId: string
  kind: string
  sourcePath: string
  sourcePointer: string
  contentHash: string
}

export type ProvenanceDiffEntry = {
  kind: 'added' | 'removed' | 'changed'
  pointer: string
  message: string
  base?: ProvenanceEntry
  head?: ProvenanceEntry
}

export type SpecCompositionReport = {
  schemaVersion: string
  target: {
    name: string
    targetPath: string
    fragmentsDir: string
    scopes: string[]
    domains: string[]
    includePaths: string[]
    includeDefinitions: string[]
  }
  summary: {
    registryNodeCount: number
    selectedNodeCount: number
    directPathCount: number
    directDefinitionCount: number
    transitiveComponentCount: number
    omittedNodeCount: number
    sourceRefCount: number
    outputAliasCount: number
    renamedOutputAliasCount: number
    collisionReportCount: number
  }
}

export type RefreshResult = {
  newRevisions: number
  builtSnapshots: number
  errors: Array<{ revisionId: string; message: string }>
}

export type ClearCacheResult = {
  deletedSnapshots: number
  deletedDiffs: number
  deletedTimeline: number
  deletedPaths: number
  deletedEntries: number
  deletedBlobs: number
}

export type SpecSnapshot = {
  schemaVersion: 'spec-lens.snapshot.v1'
  revision: SpecRevision
  fragmentsDir: string
  targetPath: string
  targetConfigDigest: string
  spec: Record<string, unknown> | null
  provenance: Record<string, ProvenanceEntry>
  composition: SpecCompositionReport
  diagnostics: Array<{ code: string; severity: 'error' | 'warning' | 'info'; message: string; pointer?: string; sourcePath?: string }>
  builtAt: number
  entries?: SpecFileEntry[]
}

export type DiffEntry = {
  category: string
  kind: 'added' | 'removed' | 'changed'
  pointer: string
  message: string
}

export type BreakingChange = {
  code: string
  endpoint: string
  detail: string
  severity: 'breaking' | 'non-breaking'
}

export type SpecTimelineDiff = {
  schemaVersion: string
  baseRevision: SpecRevision
  headRevision: SpecRevision
  normalizedDiff: DiffEntry[]
  breakingDiff: BreakingChange[]
  provenanceDiff: ProvenanceDiffEntry[]
  affectedFragments: string[]
  stats: {
    pathsAdded: number
    pathsRemoved: number
    pathsChanged: number
    schemasAdded: number
    schemasRemoved: number
    schemasChanged: number
    breakingChanges: number
  }
}

export type SpecPathEntry = {
  path: string
  methods: string[]
  canonicalId: string
  scope: string
  domain: string
  sourceFile: string
  contentHash: string
  lastChangedRevisionId: string
  lastChangedTimestamp: number
}

export type SpecGraph = {
  nodes: Array<{
    id: string
    kind: string
    scope: string
    domain: string
    localName: string
    sourcePath: string
    contentHash: string
  }>
  edges: Array<{
    source: string
    target: string
    refPointer: string
  }>
}

export type SpecServerConfig = {
  targetName: string
  targetPath: string
  fragmentsDir: string
  sourceKind: SpecSourceKind
  branch?: string
}

async function apiFetch<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(path)
  } catch (err) {
    throw new Error(`API ${path} → network error: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`API ${path} → ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
  }
  try {
    return await res.json() as T
  } catch {
    throw new Error(`API ${path} → invalid JSON response`)
  }
}

export const api = {
  timeline: (limit = 100) =>
    apiFetch<SpecTimelineEntry[]>(`/api/timeline?limit=${limit}`),

  snapshot: (revisionId: string, includeEntries = false) =>
    apiFetch<SpecSnapshot>(
      `/api/snapshot/${revisionId}${includeEntries ? '?include=entries' : ''}`,
    ),

  diff: (baseId: string, headId: string) =>
    apiFetch<SpecTimelineDiff>(`/api/diff/${baseId}/${headId}`),

  paths: (scope?: string, domain?: string) => {
    const params = new URLSearchParams()
    if (scope) params.set('scope', scope)
    if (domain) params.set('domain', domain)
    const qs = params.toString()
    return apiFetch<SpecPathEntry[]>(`/api/paths${qs ? `?${qs}` : ''}`)
  },

  graph: (revisionId?: string) =>
    apiFetch<SpecGraph>(`/api/graph${revisionId ? `?revision=${revisionId}` : ''}`),

  config: () => apiFetch<SpecServerConfig>('/api/config'),

  clearCache: async () => {
    const res = await fetch('/api/cache', { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`API /api/cache → ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
    }
    return res.json() as Promise<ClearCacheResult>
  },

  refresh: async () => {
    const res = await fetch('/api/refresh', { method: 'POST' })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`API /api/refresh → ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
    }
    return res.json() as Promise<RefreshResult>
  },
}
