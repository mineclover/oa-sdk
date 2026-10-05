import type {
  ClearCacheResult,
  BreakingChange,
  DiffEntry,
  RefreshResult,
  SpecGraph,
  SpecLensApiError,
  SpecLensApiResponseMap,
  SpecPathsResult,
  SpecServerConfig,
  SpecSnapshot,
  SpecTimelineDiff,
  SpecTimelineEntry,
} from '@oa-sdk/spec-lens-contract'
import { isSpecLensResponse } from '@oa-sdk/spec-lens-contract'

// Keep the UI-local import surface stable while the wire contract lives in its
// browser-safe workspace package.
export type {
  ClearCacheResult,
  BreakingChange,
  DefinitionBuilderServerConfig,
  DefinitionBuilderSpecSnapshot,
  DefinitionBuilderSpecTimelineDiff,
  DiffEntry,
  ProvenanceDiffEntry,
  ProvenanceEntry,
  RefreshResult,
  SpecCompositionReport,
  SpecFileEntry,
  SpecGraph,
  SpecLensApiError,
  SpecPathEntry,
  SpecPathsResult,
  SpecRevision,
  SpecServerConfig,
  SpecSnapshot,
  SpecSnapshotDiagnostic,
  SpecSourceKind,
  SpecTimelineDiff,
  SpecTimelineEntry,
  TypeSpecBundleServerConfig,
  TypeSpecBundleSpecSnapshot,
  TypeSpecBundleSpecTimelineDiff,
} from '@oa-sdk/spec-lens-contract'

/** Validator for one API response kind, backed by the shared wire guard. */
function responseSchema<K extends keyof SpecLensApiResponseMap>(kind: K): { parse(value: unknown): SpecLensApiResponseMap[K] } {
  return {
    parse(value) {
      if (!isSpecLensResponse(kind, value)) throw new TypeError(`invalid ${String(kind)} response shape`)
      return value
    },
  }
}

/** The `error` message of a structured API error body, when the body is one. */
const ApiErrorMessageSchema = {
  parse(value: unknown): SpecLensApiError['error'] | undefined {
    if (typeof value !== 'object' || value === null || !('error' in value)) return undefined
    return typeof value.error === 'string' ? value.error : undefined
  },
}

async function apiRequest<K extends keyof SpecLensApiResponseMap>(
  kind: K,
  path: string,
  init?: RequestInit,
): Promise<SpecLensApiResponseMap[K]> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch (err) {
    throw new Error(`API ${path} → network error: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let message = body
    try {
      message = ApiErrorMessageSchema.parse(JSON.parse(body)) ?? message
    } catch {
      // Keep the raw response body in the error when it is not a JSON API error.
    }
    throw new Error(`API ${path} → ${res.status}${message ? `: ${message.slice(0, 200)}` : ''}`)
  }
  try {
    return responseSchema(kind).parse(JSON.parse(await res.text()))
  } catch {
    throw new Error(`API ${path} → invalid JSON response or response shape`)
  }
}

export const api = {
  timeline: (limit = 100) =>
    apiRequest('timeline', `/api/timeline?limit=${limit}`),

  snapshot: (revisionId: string, includeEntries = false) =>
    apiRequest('snapshot',
      `/api/snapshot/${revisionId}${includeEntries ? '?include=entries' : ''}`,
    ),

  diff: (baseId: string, headId: string) =>
    apiRequest('diff', `/api/diff/${baseId}/${headId}`),

  paths: (scope?: string, domain?: string) => {
    const params = new URLSearchParams()
    if (scope) params.set('scope', scope)
    if (domain) params.set('domain', domain)
    const qs = params.toString()
    return apiRequest('paths', `/api/paths${qs ? `?${qs}` : ''}`)
  },

  graph: (revisionId?: string) =>
    apiRequest('graph', `/api/graph${revisionId ? `?revision=${revisionId}` : ''}`),

  config: () => apiRequest('config', '/api/config'),

  clearCache: () => apiRequest('clearCache', '/api/cache', { method: 'DELETE' }),

  refresh: () => apiRequest('refresh', '/api/refresh', { method: 'POST' }),
}
