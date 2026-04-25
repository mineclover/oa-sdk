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

export type SpecSnapshot = {
  schemaVersion: string
  revision: SpecRevision
  fragmentsDir: string
  targetPath: string
  targetConfigDigest: string
  spec: Record<string, unknown> | null
  provenance: Record<string, ProvenanceEntry>
  diagnostics: Array<{ code: string; severity: string; message: string; pointer?: string; sourcePath?: string }>
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

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`)
  return res.json() as Promise<T>
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

  refresh: () =>
    fetch('/api/refresh', { method: 'POST' }).then(r => r.json()),
}
