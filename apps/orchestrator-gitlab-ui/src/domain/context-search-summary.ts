import { warningSeverityFromCode, type WarningSeverity } from './warning-severity.js'

export type ContextSearchKind =
  | 'issue'
  | 'issue_note'
  | 'merge_request'
  | 'discussion'
  | 'repo_file'
  | 'wiki_page'
  | 'snippet'
  | 'pipeline'
  | 'release'
  | 'label'
  | 'milestone'
  | 'board'

export type ContextSearchMetadataValue = string | number | boolean

export interface ContextSearchResult {
  readonly id: string
  readonly kind: ContextSearchKind
  readonly title: string
  readonly url?: string
  readonly preview?: string
  readonly score?: number
  readonly updatedAt?: string
  readonly ref?: string
  readonly metadata: Readonly<Record<string, ContextSearchMetadataValue>>
}

export interface ContextSearchWarning {
  readonly kind: ContextSearchKind
  readonly code: 'unsupported_kind' | 'request_failed' | string
  readonly message: string
  readonly status?: number
}

export interface ContextSearchResponse {
  readonly results: ReadonlyArray<ContextSearchResult>
  readonly warnings: ReadonlyArray<ContextSearchWarning>
  readonly cursor?: string
}

export interface ContextSearchRow {
  readonly id: string
  readonly kind: ContextSearchKind
  readonly kindLabel: string
  readonly title: string
  readonly preview: string
  readonly score: number
  readonly updatedAtEpochMs: number | undefined
}

export interface ContextSearchWarningRow {
  readonly id: string
  readonly kind: ContextSearchKind
  readonly message: string
  readonly code: string
  readonly severity: WarningSeverity
  readonly status: number | undefined
}

export interface ContextSearchSummary {
  readonly items: ReadonlyArray<ContextSearchRow>
  readonly warnings: ReadonlyArray<ContextSearchWarningRow>
  readonly warningCounts: { readonly info: number; readonly warning: number; readonly error: number }
  readonly cursor: string | undefined
  readonly hasNextPage: boolean
}

const KIND_LABELS: Record<ContextSearchKind, string> = {
  issue: 'Issue',
  issue_note: 'Issue Note',
  merge_request: 'Merge Request',
  discussion: 'Discussion',
  repo_file: 'Repository File',
  wiki_page: 'Wiki Page',
  snippet: 'Snippet',
  pipeline: 'Pipeline',
  release: 'Release',
  label: 'Label',
  milestone: 'Milestone',
  board: 'Board',
}

export function normalizeContextSearchResponse(
  response: ContextSearchResponse,
): ContextSearchSummary {
  const items = dedupeById(response.results)
    .map(normalizeContextSearchRow)
    .sort(sortContextSearchRows)
  const warnings = response.warnings.map(normalizeContextSearchWarning)
  const warningCounts = warnings.reduce(
    (acc, warning) => ({ ...acc, [warning.severity]: acc[warning.severity] + 1 }),
    { info: 0, warning: 0, error: 0 },
  )

  return {
    items,
    warnings,
    warningCounts,
    cursor: response.cursor,
    hasNextPage: response.cursor !== undefined && response.cursor.length > 0,
  }
}

export function normalizeContextSearchRow(result: ContextSearchResult): ContextSearchRow {
  return {
    id: result.id,
    kind: result.kind,
    kindLabel: KIND_LABELS[result.kind],
    title: result.title,
    preview: result.preview ?? '',
    score: result.score ?? 0,
    updatedAtEpochMs: parseDateToEpochMs(result.updatedAt),
  }
}

export function normalizeContextSearchWarning(
  warning: ContextSearchWarning,
): ContextSearchWarningRow {
  return {
    id: `${warning.kind}:${warning.code}:${warning.status ?? 'na'}`,
    kind: warning.kind,
    message: warning.code === 'request_failed'
      ? `${warning.kind} search request failed${warning.status === undefined ? '' : ` (HTTP ${warning.status})`}`
      : warning.message,
    code: warning.code,
    status: warning.status,
    severity: warningSeverityFromCode(warning.code),
  }
}

export function parseDateToEpochMs(date: string | undefined): number | undefined {
  if (date === undefined) return undefined
  const ms = Date.parse(date)
  return Number.isNaN(ms) ? undefined : ms
}

function sortContextSearchRows(left: ContextSearchRow, right: ContextSearchRow): number {
  if (left.score !== right.score) return right.score - left.score
  if (left.updatedAtEpochMs !== undefined && right.updatedAtEpochMs !== undefined) {
    return right.updatedAtEpochMs - left.updatedAtEpochMs
  }
  return left.title.localeCompare(right.title, 'en', { sensitivity: 'base' })
}

function dedupeById(results: ReadonlyArray<ContextSearchResult>): ContextSearchResult[] {
  const byId = new Map<string, ContextSearchResult>()
  for (const result of results) {
    if (!byId.has(result.id)) byId.set(result.id, result)
  }
  return [...byId.values()]
}
