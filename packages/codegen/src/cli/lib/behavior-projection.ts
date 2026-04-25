import { resolve } from 'node:path'
import { loadSqliteDriver } from '../../sqlite-workspace-index.js'
import {
  assertValidBehaviorRecord,
  type BehaviorRecord,
  type BehaviorRecommendation,
} from './behavior-recorder.js'

export type BehaviorProjectionEntry = {
  behaviorId: string
  behaviorType: string
  identityKey: string
  status: BehaviorRecord['status']
  occurredAt: string
  source: string
  targetType?: string
  targetKey?: string
  decisionSignal?: string
  recommendation?: string
  record: BehaviorRecord
}

export interface BehaviorProjectionReader {
  listAll(): BehaviorProjectionEntry[]
  listRecent(limit?: number): BehaviorProjectionEntry[]
  listRecentFailures(limit?: number): BehaviorProjectionEntry[]
  getLatestByType(behaviorType: string): BehaviorProjectionEntry | undefined
  getLatestByIdentity(identityKey: string): BehaviorProjectionEntry | undefined
  getLatestByDecisionSignal(decisionSignal: string): BehaviorProjectionEntry | undefined
  getLatestFailureByType(behaviorType: string): BehaviorProjectionEntry | undefined
  getLatestByTarget(targetType: string, targetKey: string): BehaviorProjectionEntry | undefined
  getLatestByRecommendation(recommendation: string): BehaviorProjectionEntry | undefined
  close(): void
}

type SqliteValue = string | number | bigint | null | Uint8Array
type SqliteStatement = {
  all(...values: SqliteValue[]): Record<string, unknown>[]
}
type SqliteDatabase = {
  exec(sql: string): void
  close(): void
  prepare(sql: string): SqliteStatement
}

export function createSqliteBehaviorProjectionReader(
  dbPath: string,
): BehaviorProjectionReader {
  const resolvedPath = resolve(process.cwd(), dbPath)
  const db = loadSqliteDriver().open(resolvedPath) as SqliteDatabase
  db.exec(`
    CREATE TABLE IF NOT EXISTS behavior_projections (
      projection_key TEXT PRIMARY KEY,
      projection_kind TEXT NOT NULL,
      behavior_type TEXT NOT NULL,
      target_type TEXT,
      target_key TEXT,
      behavior_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  const selectRecent = db.prepare(`
    SELECT record_json
    FROM behavior_records
    ORDER BY occurred_at DESC, created_at DESC
    LIMIT ?
  `)
  const selectRecentFailures = db.prepare(`
    SELECT record_json
    FROM behavior_records
    WHERE status = 'failed'
    ORDER BY occurred_at DESC, created_at DESC
    LIMIT ?
  `)
  const selectByType = db.prepare(`
    SELECT record_json
    FROM behavior_records
    WHERE behavior_type = ?
    ORDER BY occurred_at DESC, created_at DESC
    LIMIT 1
  `)
  const selectProjectionByFailureType = db.prepare(`
    SELECT summary_json
    FROM behavior_projections
    WHERE projection_key = ?
    LIMIT 1
  `)
  const selectProjectionByIdentity = db.prepare(`
    SELECT summary_json
    FROM behavior_projections
    WHERE projection_key = ?
    LIMIT 1
  `)
  const selectProjectionByType = db.prepare(`
    SELECT summary_json
    FROM behavior_projections
    WHERE projection_key = ?
    LIMIT 1
  `)
  const selectProjectionByTarget = db.prepare(`
    SELECT summary_json
    FROM behavior_projections
    WHERE projection_key = ?
    LIMIT 1
  `)
  const selectProjectionByDecisionSignal = db.prepare(`
    SELECT summary_json
    FROM behavior_projections
    WHERE projection_key = ?
    LIMIT 1
  `)
  const selectProjectionByRecommendation = db.prepare(`
    SELECT summary_json
    FROM behavior_projections
    WHERE projection_key = ?
    LIMIT 1
  `)
  const selectAll = db.prepare(`
    SELECT record_json
    FROM behavior_records
    ORDER BY occurred_at DESC, created_at DESC
  `)

  return {
    listAll() {
      return selectAll
        .all()
        .map(row => projectionEntryFromRow(row))
    },
    listRecent(limit = 20) {
      return selectRecent
        .all(limit)
        .map(row => projectionEntryFromRow(row))
    },
    listRecentFailures(limit = 20) {
      return selectRecentFailures
        .all(limit)
        .map(row => projectionEntryFromRow(row))
    },
    getLatestByType(behaviorType: string) {
      const projectionKey = `type:${behaviorType}`
      const projectionRow = selectProjectionByType.all(projectionKey)[0]
      if (projectionRow) return projectionEntryFromProjectionRow(projectionRow)

      const row = selectByType.all(behaviorType)[0]
      return row ? projectionEntryFromRow(row) : undefined
    },
    getLatestByIdentity(identityKey: string) {
      const projectionKey = `identity:${identityKey}`
      const projectionRow = selectProjectionByIdentity.all(projectionKey)[0]
      if (projectionRow) return projectionEntryFromProjectionRow(projectionRow)

      return this.listRecent().find(entry => entry.identityKey === identityKey)
    },
    getLatestFailureByType(behaviorType: string) {
      const projectionKey = `failure:${behaviorType}`
      const projectionRow = selectProjectionByFailureType.all(projectionKey)[0]
      if (projectionRow) return projectionEntryFromProjectionRow(projectionRow)

      return this.listRecentFailures().find(entry => entry.behaviorType === behaviorType)
    },
    getLatestByTarget(targetType: string, targetKey: string) {
      const projectionKey = `target:${targetType}:${targetKey}`
      const projectionRow = selectProjectionByTarget.all(projectionKey)[0]
      if (projectionRow) return projectionEntryFromProjectionRow(projectionRow)

      for (const row of selectAll.all()) {
        const entry = projectionEntryFromRow(row)
        if (entry.targetType === targetType && entry.targetKey === targetKey) return entry
      }
      return undefined
    },
    getLatestByDecisionSignal(decisionSignal: string) {
      const projectionKey = `decision-signal:${decisionSignal}`
      const projectionRow = selectProjectionByDecisionSignal.all(projectionKey)[0]
      if (projectionRow) return projectionEntryFromProjectionRow(projectionRow)

      return this.listRecent().find(entry => entry.decisionSignal === decisionSignal)
    },
    getLatestByRecommendation(recommendation: string) {
      const projectionKey = `recommendation:${recommendation}`
      const projectionRow = selectProjectionByRecommendation.all(projectionKey)[0]
      if (projectionRow) return projectionEntryFromProjectionRow(projectionRow)

      return this.listRecent().find(entry => entry.recommendation === recommendation)
    },
    close() {
      db.close()
    },
  }
}

function projectionEntryFromRow(row: Record<string, unknown>): BehaviorProjectionEntry {
  const raw = row.record_json
  if (typeof raw !== 'string') {
    throw new Error('Invalid behavior_records row: record_json must be a string')
  }

  const record = JSON.parse(raw) as unknown
  assertValidBehaviorRecord(record)

  const target = record.components.target
  const result = record.components.result
  const decision = record.components.decision
  return {
    behaviorId: record.behaviorId,
    behaviorType: record.behaviorType,
    identityKey: record.identityKey,
    status: record.status,
    occurredAt: record.occurredAt,
    source: record.source,
    ...(typeof target?.targetType === 'string' ? { targetType: target.targetType } : {}),
    ...(
      typeof target?.targetKey === 'string'
        ? { targetKey: target.targetKey }
        : typeof target?.targetId === 'string'
          ? { targetKey: target.targetId }
          : {}
    ),
    ...(typeof decision?.primarySignal === 'string' ? { decisionSignal: decision.primarySignal } : {}),
    ...(typeof result?.recommendation === 'string' ? { recommendation: result.recommendation } : {}),
    record,
  }
}

function projectionEntryFromProjectionRow(row: Record<string, unknown>): BehaviorProjectionEntry {
  const raw = row.summary_json
  if (typeof raw !== 'string') {
    throw new Error('Invalid behavior_projections row: summary_json must be a string')
  }

  const summary = JSON.parse(raw) as Record<string, unknown>
  return {
    behaviorId: String(summary.behaviorId),
    behaviorType: String(summary.behaviorType),
    identityKey: String(summary.identityKey),
    status: summary.status as BehaviorRecord['status'],
    occurredAt: String(summary.occurredAt),
    source: String(summary.source),
    ...(typeof summary.targetType === 'string' ? { targetType: summary.targetType } : {}),
    ...(typeof summary.targetKey === 'string' ? { targetKey: summary.targetKey } : {}),
    ...(typeof summary.decisionSignal === 'string' ? { decisionSignal: summary.decisionSignal } : {}),
    ...(typeof summary.recommendation === 'string' ? { recommendation: summary.recommendation } : {}),
    record: {
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorId: String(summary.behaviorId),
      behaviorType: String(summary.behaviorType),
      identityKey: String(summary.identityKey),
      status: summary.status as BehaviorRecord['status'],
      occurredAt: String(summary.occurredAt),
      source: String(summary.source),
      components: {
        ...(typeof summary.targetType === 'string'
          ? {
              target: {
                targetType: summary.targetType,
                ...(typeof summary.targetKey === 'string' ? { targetKey: summary.targetKey } : {}),
              },
            }
          : {}),
        ...(typeof summary.recommendation === 'string'
          ? {
              result: {
                recommendation: summary.recommendation as BehaviorRecommendation,
              },
            }
          : {}),
        ...(typeof summary.decisionSignal === 'string'
          ? {
              decision: {
                primarySignal: summary.decisionSignal,
              },
            }
          : {}),
      },
    },
  }
}
