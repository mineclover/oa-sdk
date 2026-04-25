import { resolve } from 'node:path'
import {
  createSqliteBehaviorProjectionReader,
  type BehaviorProjectionEntry,
} from './behavior-projection.js'

export type BehaviorQueryMode =
  | 'recent'
  | 'recent-failures'
  | 'latest-failure-by-type'
  | 'latest-by-type'
  | 'latest-by-identity'
  | 'latest-by-target'
  | 'latest-by-decision-signal'
  | 'latest-by-recommendation'
  | 'summary-by-type'
  | 'summary-by-status'
  | 'summary-by-target-type'
  | 'summary-by-behavior-status'
  | 'summary-by-behavior-decision-signal'
  | 'summary-by-decision-signal'
  | 'summary-by-recommendation'

export type BehaviorQueryFilters = {
  behaviorType?: string
  identityKey?: string
  targetType?: string
  targetKey?: string
  decisionSignal?: string
  recommendation?: string
  status?: string
}

export type BehaviorQueryReport = {
  schemaVersion: 'oa-gen.behavior-query.v1'
  dbPath: string
  mode: BehaviorQueryMode
  filters: BehaviorQueryFilters
  count: number
  entries: BehaviorProjectionEntry[]
  aggregations: BehaviorQueryAggregationBucket[]
}

export type BehaviorQueryAggregationBucket = {
  key: string
  count: number
  dimensions?: Record<string, string>
}

export function queryBehavior(options: {
  dbPath: string
  mode: BehaviorQueryMode
  behaviorType?: string
  identityKey?: string
  targetType?: string
  targetKey?: string
  decisionSignal?: string
  recommendation?: string
  status?: string
  limit?: number
}): BehaviorQueryReport {
  const resolvedDbPath = resolve(process.cwd(), options.dbPath)
  const reader = createSqliteBehaviorProjectionReader(resolvedDbPath)
  try {
    const result = queryEntries(reader, options)
    return {
      schemaVersion: 'oa-gen.behavior-query.v1',
      dbPath: resolvedDbPath,
      mode: options.mode,
      filters: readQueryFilters(options),
      count: result.count,
      entries: result.entries,
      aggregations: result.aggregations,
    }
  } finally {
    reader.close()
  }
}

function queryEntries(
  reader: ReturnType<typeof createSqliteBehaviorProjectionReader>,
  options: {
    mode: BehaviorQueryMode
    behaviorType?: string
    identityKey?: string
    targetType?: string
    targetKey?: string
    decisionSignal?: string
    recommendation?: string
    status?: string
    limit?: number
  },
): {
  count: number
  entries: BehaviorProjectionEntry[]
  aggregations: BehaviorQueryAggregationBucket[]
} {
  const entries = (() => {
    switch (options.mode) {
      case 'recent':
        return reader.listRecent(Number.MAX_SAFE_INTEGER)
      case 'recent-failures':
        return reader.listRecentFailures(Number.MAX_SAFE_INTEGER)
      case 'latest-failure-by-type': {
        if (!options.behaviorType) throw new Error('--behavior-type is required for latest-failure-by-type')
        const entry = reader.getLatestFailureByType(options.behaviorType)
        return entry ? [entry] : []
      }
      case 'latest-by-type': {
        if (!options.behaviorType) throw new Error('--behavior-type is required for latest-by-type')
        const entry = reader.getLatestByType(options.behaviorType)
        return entry ? [entry] : []
      }
      case 'latest-by-identity': {
        if (!options.identityKey) throw new Error('--identity-key is required for latest-by-identity')
        const entry = reader.getLatestByIdentity(options.identityKey)
        return entry ? [entry] : []
      }
      case 'latest-by-target': {
        if (!options.targetType) throw new Error('--target-type is required for latest-by-target')
        if (!options.targetKey) throw new Error('--target-key is required for latest-by-target')
        const entry = reader.getLatestByTarget(options.targetType, options.targetKey)
        return entry ? [entry] : []
      }
      case 'latest-by-decision-signal': {
        if (!options.decisionSignal) throw new Error('--decision-signal is required for latest-by-decision-signal')
        const entry = reader.getLatestByDecisionSignal(options.decisionSignal)
        return entry ? [entry] : []
      }
      case 'latest-by-recommendation': {
        if (!options.recommendation) throw new Error('--recommendation is required for latest-by-recommendation')
        const entry = reader.getLatestByRecommendation(options.recommendation)
        return entry ? [entry] : []
      }
      case 'summary-by-type':
      case 'summary-by-status':
      case 'summary-by-target-type':
      case 'summary-by-behavior-status':
      case 'summary-by-behavior-decision-signal':
      case 'summary-by-decision-signal':
      case 'summary-by-recommendation':
        return reader.listAll()
    }
  })()

  const filtered = applyQueryFilters(entries, options)
  if (
    options.mode === 'summary-by-type'
    || options.mode === 'summary-by-status'
    || options.mode === 'summary-by-target-type'
    || options.mode === 'summary-by-behavior-status'
    || options.mode === 'summary-by-behavior-decision-signal'
    || options.mode === 'summary-by-decision-signal'
    || options.mode === 'summary-by-recommendation'
  ) {
    const aggregations = buildAggregations(filtered, options.mode)
    return {
      count: filtered.length,
      entries: [],
      aggregations,
    }
  }
  if (options.mode === 'recent' || options.mode === 'recent-failures') {
    return {
      count: Math.min(filtered.length, options.limit ?? 20),
      entries: filtered.slice(0, options.limit ?? 20),
      aggregations: [],
    }
  }
  return {
    count: filtered.length,
    entries: filtered,
    aggregations: [],
  }
}

function buildAggregations(
  entries: BehaviorProjectionEntry[],
  mode: Extract<BehaviorQueryMode, 'summary-by-type' | 'summary-by-status' | 'summary-by-target-type' | 'summary-by-behavior-status' | 'summary-by-behavior-decision-signal' | 'summary-by-decision-signal' | 'summary-by-recommendation'>,
): BehaviorQueryAggregationBucket[] {
  const counts = new Map<string, BehaviorQueryAggregationBucket>()
  for (const entry of entries) {
    const bucket = readAggregationBucket(entry, mode)
    const previous = counts.get(bucket.key)
    counts.set(
      bucket.key,
      previous === undefined
        ? bucket
        : {
            ...bucket,
            count: previous.count + 1,
          },
    )
  }
  return [...counts.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
}

function readAggregationBucket(
  entry: BehaviorProjectionEntry,
  mode: Extract<BehaviorQueryMode, 'summary-by-type' | 'summary-by-status' | 'summary-by-target-type' | 'summary-by-behavior-status' | 'summary-by-behavior-decision-signal' | 'summary-by-decision-signal' | 'summary-by-recommendation'>,
): BehaviorQueryAggregationBucket {
  switch (mode) {
    case 'summary-by-type':
      return {
        key: entry.behaviorType,
        count: 1,
        dimensions: { behaviorType: entry.behaviorType },
      }
    case 'summary-by-status':
      return {
        key: entry.status,
        count: 1,
        dimensions: { status: entry.status },
      }
    case 'summary-by-target-type': {
      const targetType = entry.targetType ?? 'none'
      return {
        key: targetType,
        count: 1,
        dimensions: { targetType },
      }
    }
    case 'summary-by-behavior-status':
      return {
        key: `${entry.behaviorType}|${entry.status}`,
        count: 1,
        dimensions: {
          behaviorType: entry.behaviorType,
          status: entry.status,
        },
      }
    case 'summary-by-behavior-decision-signal': {
      const decisionSignal = entry.decisionSignal ?? 'none'
      return {
        key: `${entry.behaviorType}|${decisionSignal}`,
        count: 1,
        dimensions: {
          behaviorType: entry.behaviorType,
          decisionSignal,
        },
      }
    }
    case 'summary-by-decision-signal':
      return {
        key: entry.decisionSignal ?? 'none',
        count: 1,
        dimensions: { decisionSignal: entry.decisionSignal ?? 'none' },
      }
    case 'summary-by-recommendation':
      return {
        key: entry.recommendation ?? 'none',
        count: 1,
        dimensions: { recommendation: entry.recommendation ?? 'none' },
      }
  }
}

function applyQueryFilters(
  entries: BehaviorProjectionEntry[],
  filters: BehaviorQueryFilters,
): BehaviorProjectionEntry[] {
  return entries.filter(entry => {
    if (filters.behaviorType !== undefined && entry.behaviorType !== filters.behaviorType) return false
    if (filters.identityKey !== undefined && entry.identityKey !== filters.identityKey) return false
    if (filters.targetType !== undefined && entry.targetType !== filters.targetType) return false
    if (filters.targetKey !== undefined && entry.targetKey !== filters.targetKey) return false
    if (filters.decisionSignal !== undefined && entry.decisionSignal !== filters.decisionSignal) return false
    if (filters.recommendation !== undefined && entry.recommendation !== filters.recommendation) return false
    if (filters.status !== undefined && entry.status !== filters.status) return false
    return true
  })
}

function readQueryFilters(options: {
  behaviorType?: string
  identityKey?: string
  targetType?: string
  targetKey?: string
  decisionSignal?: string
  recommendation?: string
  status?: string
}): BehaviorQueryFilters {
  return {
    ...(options.behaviorType !== undefined ? { behaviorType: options.behaviorType } : {}),
    ...(options.identityKey !== undefined ? { identityKey: options.identityKey } : {}),
    ...(options.targetType !== undefined ? { targetType: options.targetType } : {}),
    ...(options.targetKey !== undefined ? { targetKey: options.targetKey } : {}),
    ...(options.decisionSignal !== undefined ? { decisionSignal: options.decisionSignal } : {}),
    ...(options.recommendation !== undefined ? { recommendation: options.recommendation } : {}),
    ...(options.status !== undefined ? { status: options.status } : {}),
  }
}

export function formatBehaviorQueryMarkdown(report: BehaviorQueryReport): string {
  const lines = [
    '# Behavior Query',
    '',
    `- DB: \`${report.dbPath}\``,
    `- Mode: \`${report.mode}\``,
    `- Count: ${report.count}`,
  ]
  const filterEntries = Object.entries(report.filters)
  if (filterEntries.length > 0) {
    lines.push(...filterEntries.map(([key, value]) => `- Filter ${key}: \`${value}\``))
  }
  if (report.aggregations.length > 0) {
    const hasDimensions = report.aggregations.some(bucket => bucket.dimensions !== undefined)
    lines.push(
      '',
      hasDimensions
        ? '| Group | Count | Dimensions |'
        : '| Group | Count |',
      hasDimensions
        ? '| --- | --- | --- |'
        : '| --- | --- |',
      ...report.aggregations.map(bucket => {
        if (!hasDimensions) {
          return `| \`${bucket.key}\` | ${bucket.count} |`
        }
        const dimensions = bucket.dimensions === undefined
          ? '—'
          : Object.entries(bucket.dimensions)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, value]) => `${key}=${value}`)
            .join(', ')
        return `| \`${bucket.key}\` | ${bucket.count} | ${dimensions === '—' ? '—' : `\`${dimensions}\``} |`
      }),
    )
    return lines.join('\n')
  }
  if (report.entries.length === 0) {
    lines.push('', 'No entries.')
    return lines.join('\n')
  }

  lines.push(
    '',
    '| Behavior Type | Identity | Status | Decision | Target | Recommendation | Occurred At |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.entries.map(entry => (
      `| \`${entry.behaviorType}\` | \`${entry.identityKey}\` | \`${entry.status}\` | ${entry.decisionSignal ? `\`${entry.decisionSignal}\`` : '—'} | ${entry.targetType && entry.targetKey ? `\`${entry.targetType}:${entry.targetKey}\`` : '—'} | ${entry.recommendation ? `\`${entry.recommendation}\`` : '—'} | \`${entry.occurredAt}\` |`
    )),
  )
  return lines.join('\n')
}
