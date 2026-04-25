import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  mkdirSync,
} from 'node:fs'
import {
  dirname,
  resolve,
} from 'node:path'
import { z } from 'zod'
import { loadSqliteDriver } from '../../sqlite-workspace-index.js'
import {
  readBehaviorComponentSchemas,
  readBehaviorProjectionPolicy,
  resolveBehaviorIdentityParts,
  validateBehaviorRegistryComponents,
} from './behavior-registry.js'

export const BEHAVIOR_RECORD_SCHEMA_VERSION = 'oa-gen.behavior-record.v1'

export type BehaviorStatus =
  | 'received'
  | 'validated'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'compensated'

export type BehaviorRecommendation =
  | 'APPROVE'
  | 'COMMENT'
  | 'REQUEST_CHANGES'

export type BehaviorComponentPayload = Record<string, unknown>

export type BehaviorActorComponent = BehaviorComponentPayload & {
  actorType: string
  actorId: string
  actorRole?: string
}

export type BehaviorTargetComponent = BehaviorComponentPayload & {
  targetType: string
  targetId?: string
  targetKey?: string
  targetName?: string
}

export type BehaviorContextComponent = BehaviorComponentPayload & {
  source: string
  command?: string
  requestId?: string
  traceId?: string
  environment?: string
  tenantId?: string
}

export type BehaviorDecisionComponent = BehaviorComponentPayload & {
  policyVersion?: string
  matchedRule?: string
  decisionReason?: string
  primarySignal?: string
}

export type BehaviorResultComponent = BehaviorComponentPayload & {
  resultType?: string
  outputArtifact?: string
  errorCode?: string
  recommendation?: BehaviorRecommendation
}

export type BehaviorAuditComponent = BehaviorComponentPayload & {
  ip?: string
  userAgent?: string
  sessionId?: string
  complianceTags?: string[]
  cwd?: string
  pid?: number
}

export type BehaviorMetricsComponent = BehaviorComponentPayload & {
  durationMs?: number
  latencyMs?: number
  retryCount?: number
  queueLatencyMs?: number
}

export type BehaviorRecordValidationIssue = {
  path: string
  message: string
}

export type BehaviorRecord = {
  schemaVersion: typeof BEHAVIOR_RECORD_SCHEMA_VERSION
  behaviorId: string
  behaviorType: string
  identityKey: string
  status: BehaviorStatus
  occurredAt: string
  source: string
  parentBehaviorId?: string
  correlationId?: string
  causationId?: string
  components: {
    actor?: BehaviorActorComponent
    target?: BehaviorTargetComponent
    input?: BehaviorComponentPayload
    context?: BehaviorContextComponent
    decision?: BehaviorDecisionComponent
    result?: BehaviorResultComponent
    audit?: BehaviorAuditComponent
    metrics?: BehaviorMetricsComponent
  }
}

export interface BehaviorRecorder {
  record(record: BehaviorRecord): void | Promise<void>
  close?(): void
}

export type MemoryBehaviorRecorder = BehaviorRecorder & {
  readonly records: readonly BehaviorRecord[]
}

export type BehaviorRecorderOptions = {
  jsonlPath?: string
  sqlitePath?: string
}

export type BehaviorIdentityKeyInput = {
  behaviorType: string
  parts: Record<string, string>
}

type SqliteValue = string | number | bigint | null | Uint8Array
type SqliteStatement = {
  get(...values: SqliteValue[]): Record<string, unknown> | undefined
  run(...values: SqliteValue[]): { changes: number, lastInsertRowid: number | bigint }
}
type SqliteDatabase = {
  close(): void
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
}

const behaviorComponentPayloadSchema = z.record(z.string(), z.unknown())
const behaviorRecommendationSchema = z.enum([
  'APPROVE',
  'COMMENT',
  'REQUEST_CHANGES',
])

const behaviorActorSchema = z.object({
  actorType: z.string().min(1),
  actorId: z.string().min(1),
  actorRole: z.string().min(1).optional(),
}).passthrough()

const behaviorTargetSchema = z.object({
  targetType: z.string().min(1),
  targetId: z.string().min(1).optional(),
  targetKey: z.string().min(1).optional(),
  targetName: z.string().min(1).optional(),
}).passthrough()

const behaviorContextSchema = z.object({
  source: z.string().min(1),
  command: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  environment: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
}).passthrough()

const behaviorDecisionSchema = z.object({
  policyVersion: z.string().min(1).optional(),
  matchedRule: z.string().min(1).optional(),
  decisionReason: z.string().min(1).optional(),
  primarySignal: z.string().min(1).optional(),
}).passthrough()

const behaviorResultSchema = z.object({
  resultType: z.string().min(1).optional(),
  outputArtifact: z.string().min(1).optional(),
  errorCode: z.string().min(1).optional(),
  recommendation: behaviorRecommendationSchema.optional(),
}).passthrough()

const behaviorAuditSchema = z.object({
  ip: z.string().min(1).optional(),
  userAgent: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  complianceTags: z.array(z.string().min(1)).optional(),
  cwd: z.string().min(1).optional(),
  pid: z.number().int().nonnegative().optional(),
}).passthrough()

const behaviorMetricsSchema = z.object({
  durationMs: z.number().nonnegative().optional(),
  latencyMs: z.number().nonnegative().optional(),
  retryCount: z.number().int().nonnegative().optional(),
  queueLatencyMs: z.number().nonnegative().optional(),
}).passthrough()

const behaviorStatusSchema = z.enum([
  'received',
  'validated',
  'executing',
  'succeeded',
  'failed',
  'compensated',
])

const behaviorRecordSchema = z.object({
  schemaVersion: z.literal(BEHAVIOR_RECORD_SCHEMA_VERSION),
  behaviorId: z.string().regex(/^bhv_[a-f0-9]{32}$/),
  behaviorType: z.string().min(1),
  identityKey: z.string().min(1),
  status: behaviorStatusSchema,
  occurredAt: z.string().datetime(),
  source: z.string().min(1),
  parentBehaviorId: z.string().regex(/^bhv_[a-f0-9]{32}$/).optional(),
  correlationId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  components: z.object({
    actor: behaviorActorSchema.optional(),
    target: behaviorTargetSchema.optional(),
    input: behaviorComponentPayloadSchema.optional(),
    context: behaviorContextSchema.optional(),
    decision: behaviorDecisionSchema.optional(),
    result: behaviorResultSchema.optional(),
    audit: behaviorAuditSchema.optional(),
    metrics: behaviorMetricsSchema.optional(),
  }),
})

const allowedBehaviorStatusTransitions: Record<BehaviorStatus, readonly BehaviorStatus[]> = {
  received: ['validated', 'executing', 'failed'],
  validated: ['executing', 'failed'],
  executing: ['succeeded', 'failed', 'compensated'],
  succeeded: [],
  failed: [],
  compensated: [],
}

export function createBehaviorRecord(input: {
  behaviorType: string
  identityKey?: string
  status: BehaviorStatus
  behaviorId?: string
  previousStatus?: BehaviorStatus
  source?: string
  parentBehaviorId?: string
  correlationId?: string
  causationId?: string
  occurredAt?: string
  components?: BehaviorRecord['components']
}): BehaviorRecord {
  if (input.previousStatus !== undefined) {
    assertBehaviorStatusTransition(input.previousStatus, input.status)
  }
  const behaviorId = input.behaviorId ?? `bhv_${randomUUID().replace(/-/g, '')}`

  const record: BehaviorRecord = {
    schemaVersion: BEHAVIOR_RECORD_SCHEMA_VERSION,
    behaviorId,
    behaviorType: input.behaviorType,
    identityKey: input.identityKey ?? readBehaviorIdentityKey(input.behaviorType, input.components, behaviorId),
    status: input.status,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    source: input.source ?? 'oa-gen.cli',
    ...(input.parentBehaviorId !== undefined ? { parentBehaviorId: input.parentBehaviorId } : {}),
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    ...(input.causationId !== undefined ? { causationId: input.causationId } : {}),
    components: input.components ?? {},
  }

  assertValidBehaviorRecord(record)
  return record
}

export function createBehaviorIdentityKey(
  input: BehaviorIdentityKeyInput,
): string {
  const segments = Object.entries(input.parts)
    .filter(([, value]) => value.length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
  return segments.length === 0
    ? input.behaviorType
    : [input.behaviorType, ...segments].join(':')
}

export function createBehaviorRecorder(
  filePath: string | undefined,
): BehaviorRecorder {
  return createBehaviorRecorderFromOptions(
    filePath === undefined ? {} : { jsonlPath: filePath },
  )
}

export function createBehaviorRecorderFromOptions(
  options: BehaviorRecorderOptions = {},
): BehaviorRecorder {
  if (options.jsonlPath !== undefined && options.sqlitePath !== undefined) {
    throw new Error('behavior recorder requires exactly one of jsonlPath or sqlitePath')
  }

  if (options.sqlitePath !== undefined) {
    return createSqliteBehaviorRecorder(options.sqlitePath)
  }

  if (options.jsonlPath !== undefined) {
    return createJsonlBehaviorRecorder(options.jsonlPath)
  }

  return createNoopBehaviorRecorder()
}

export function createNoopBehaviorRecorder(): BehaviorRecorder {
  return {
    record(record) {
      assertValidBehaviorRecord(record)
      return undefined
    },
  }
}

export function createMemoryBehaviorRecorder(): MemoryBehaviorRecorder {
  const records: BehaviorRecord[] = []
  return {
    get records() {
      return records
    },
    record(record) {
      assertValidBehaviorRecord(record)
      records.push(record)
    },
  }
}

export function createJsonlBehaviorRecorder(
  filePath: string,
): BehaviorRecorder {
  const resolvedPath = resolve(process.cwd(), filePath)
  return {
    record(record) {
      assertValidBehaviorRecord(record)
      mkdirSync(dirname(resolvedPath), { recursive: true })
      appendFileSync(resolvedPath, `${JSON.stringify(record)}\n`, 'utf8')
    },
  }
}

export function createSqliteBehaviorRecorder(
  dbPath: string,
): BehaviorRecorder {
  const resolvedPath = resolve(process.cwd(), dbPath)
  mkdirSync(dirname(resolvedPath), { recursive: true })

  const driver = loadSqliteDriver()
  const db = driver.open(resolvedPath) as SqliteDatabase
  db.exec(`
    CREATE TABLE IF NOT EXISTS behavior_records (
      behavior_id TEXT PRIMARY KEY,
      behavior_type TEXT NOT NULL,
      identity_key TEXT NOT NULL,
      status TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      source TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_behavior_records_type_time
      ON behavior_records (behavior_type, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_behavior_records_identity_time
      ON behavior_records (identity_key, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_behavior_records_status_time
      ON behavior_records (status, occurred_at);
    CREATE TABLE IF NOT EXISTS behavior_projections (
      projection_key TEXT PRIMARY KEY,
      projection_kind TEXT NOT NULL,
      behavior_type TEXT NOT NULL,
      identity_key TEXT NOT NULL,
      target_type TEXT,
      target_key TEXT,
      behavior_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_behavior_projections_kind_type
      ON behavior_projections (projection_kind, behavior_type);
    CREATE INDEX IF NOT EXISTS idx_behavior_projections_identity
      ON behavior_projections (identity_key);
    CREATE INDEX IF NOT EXISTS idx_behavior_projections_target
      ON behavior_projections (target_type, target_key);
  `)
  try {
    db.exec(`ALTER TABLE behavior_records ADD COLUMN identity_key TEXT`)
  } catch {}
  try {
    db.exec(`ALTER TABLE behavior_projections ADD COLUMN identity_key TEXT`)
  } catch {}

  const insert = db.prepare(`
    INSERT INTO behavior_records (
      behavior_id,
      behavior_type,
      identity_key,
      status,
      occurred_at,
      source,
      record_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const upsertProjection = db.prepare(`
    INSERT INTO behavior_projections (
      projection_key,
      projection_kind,
      behavior_type,
      identity_key,
      target_type,
      target_key,
      behavior_id,
      occurred_at,
      summary_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(projection_key) DO UPDATE SET
      behavior_type = excluded.behavior_type,
      identity_key = excluded.identity_key,
      target_type = excluded.target_type,
      target_key = excluded.target_key,
      behavior_id = excluded.behavior_id,
      occurred_at = excluded.occurred_at,
      summary_json = excluded.summary_json,
      updated_at = CURRENT_TIMESTAMP
    WHERE excluded.occurred_at >= behavior_projections.occurred_at
  `)
  const selectLatestByIdentity = db.prepare(`
    SELECT record_json
    FROM behavior_records
    WHERE identity_key = ?
    ORDER BY occurred_at DESC, created_at DESC
    LIMIT 1
  `)

  return {
    record(record) {
      assertValidBehaviorRecord(record)
      const previousRow = selectLatestByIdentity.get(record.identityKey)
      if (previousRow && typeof previousRow.record_json === 'string') {
        const previousRecord = JSON.parse(previousRow.record_json) as unknown
        assertValidBehaviorRecord(previousRecord)
        assertBehaviorStatusTransition(previousRecord.status, record.status)
      }
      insert.run(
        record.behaviorId,
        record.behaviorType,
        record.identityKey,
        record.status,
        record.occurredAt,
        record.source,
        JSON.stringify(record),
      )
      for (const projection of buildBehaviorProjectionRows(record)) {
        upsertProjection.run(
          projection.projectionKey,
          projection.projectionKind,
          projection.behaviorType,
          projection.identityKey,
          projection.targetType,
          projection.targetKey,
          projection.behaviorId,
          projection.occurredAt,
          projection.summaryJson,
        )
      }
    },
    close() {
      db.close()
    },
  }
}

export function validateBehaviorRecord(record: unknown): {
  valid: boolean
  issues: BehaviorRecordValidationIssue[]
} {
  const parsed = behaviorRecordSchema.safeParse(record)
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map(issue => ({
        path: issue.path.length === 0 ? '$' : issue.path.join('.'),
        message: issue.message,
      })),
    }
  }

  const issues: BehaviorRecordValidationIssue[] = []
  const componentSchemas = readBehaviorComponentSchemas(parsed.data.behaviorType)
  if (componentSchemas !== undefined) {
    issues.push(
      ...validateBehaviorComponent(parsed.data.components.input, componentSchemas.input, 'components.input'),
      ...validateBehaviorComponent(parsed.data.components.target, componentSchemas.target, 'components.target'),
      ...validateBehaviorComponent(parsed.data.components.decision, componentSchemas.decision, 'components.decision'),
      ...validateBehaviorComponent(parsed.data.components.result, componentSchemas.result, 'components.result'),
    )
  }
  issues.push(
    ...validateBehaviorRegistryComponents(parsed.data.behaviorType, parsed.data.components),
  )

  return {
    valid: issues.length === 0,
    issues,
  }
}

function validateBehaviorComponent<TSchema extends z.ZodTypeAny>(
  value: unknown,
  schema: TSchema | undefined,
  pathPrefix: string,
): BehaviorRecordValidationIssue[] {
  if (schema === undefined) return []
  if (value === undefined) return []
  const parsed = schema.safeParse(value)
  if (parsed.success) return []
  return parsed.error.issues.map(issue => ({
    path: issue.path.length === 0 ? pathPrefix : `${pathPrefix}.${issue.path.join('.')}`,
    message: issue.message,
  }))
}

export function assertValidBehaviorRecord(
  record: unknown,
): asserts record is BehaviorRecord {
  const validation = validateBehaviorRecord(record)
  if (validation.valid) return

  throw new Error(
    `Invalid behavior record: ${validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ')}`,
  )
}

export function isAllowedBehaviorStatusTransition(
  from: BehaviorStatus,
  to: BehaviorStatus,
): boolean {
  return allowedBehaviorStatusTransitions[from].includes(to)
}

export function assertBehaviorStatusTransition(
  from: BehaviorStatus,
  to: BehaviorStatus,
): void {
  if (isAllowedBehaviorStatusTransition(from, to)) return
  throw new Error(`Invalid behavior status transition: ${from} -> ${to}`)
}

type BehaviorProjectionRow = {
  projectionKey: string
  projectionKind: 'latest-by-type' | 'latest-by-identity' | 'latest-by-target' | 'latest-by-decision-signal' | 'latest-failure-by-type' | 'latest-by-recommendation'
  behaviorType: string
  identityKey: string
  targetType: string | null
  targetKey: string | null
  behaviorId: string
  occurredAt: string
  summaryJson: string
}

function buildBehaviorProjectionRows(
  record: BehaviorRecord,
): BehaviorProjectionRow[] {
  const projectionPolicy = readBehaviorProjectionPolicy(record.behaviorType)
  const targetType = record.components.target?.targetType
  const targetKey = record.components.target?.targetKey
    ?? record.components.target?.targetId
    ?? null
  const recommendation = record.components.result?.recommendation
  const decisionSignal = record.components.decision?.primarySignal
  const summaryJson = JSON.stringify({
    behaviorId: record.behaviorId,
    behaviorType: record.behaviorType,
    identityKey: record.identityKey,
    status: record.status,
    occurredAt: record.occurredAt,
    source: record.source,
    ...(typeof targetType === 'string' ? { targetType } : {}),
    ...(typeof targetKey === 'string' ? { targetKey } : {}),
    ...(typeof recommendation === 'string' ? { recommendation } : {}),
    ...(typeof decisionSignal === 'string' ? { decisionSignal } : {}),
  })

  const rows: BehaviorProjectionRow[] = []

  if (projectionPolicy.latestByType) {
    rows.push({
      projectionKey: `type:${record.behaviorType}`,
      projectionKind: 'latest-by-type',
      behaviorType: record.behaviorType,
      identityKey: record.identityKey,
      targetType: typeof targetType === 'string' ? targetType : null,
      targetKey: typeof targetKey === 'string' ? targetKey : null,
      behaviorId: record.behaviorId,
      occurredAt: record.occurredAt,
      summaryJson,
    })
  }

  if (projectionPolicy.latestByIdentity) {
    rows.push({
      projectionKey: `identity:${record.identityKey}`,
      projectionKind: 'latest-by-identity',
      behaviorType: record.behaviorType,
      identityKey: record.identityKey,
      targetType: typeof targetType === 'string' ? targetType : null,
      targetKey: typeof targetKey === 'string' ? targetKey : null,
      behaviorId: record.behaviorId,
      occurredAt: record.occurredAt,
      summaryJson,
    })
  }

  if (projectionPolicy.latestByTarget && typeof targetType === 'string' && typeof targetKey === 'string') {
    rows.push({
      projectionKey: `target:${targetType}:${targetKey}`,
      projectionKind: 'latest-by-target',
      behaviorType: record.behaviorType,
      identityKey: record.identityKey,
      targetType,
      targetKey,
      behaviorId: record.behaviorId,
      occurredAt: record.occurredAt,
      summaryJson,
    })
  }

  if (projectionPolicy.latestByDecisionSignal && typeof decisionSignal === 'string') {
    rows.push({
      projectionKey: `decision-signal:${decisionSignal}`,
      projectionKind: 'latest-by-decision-signal',
      behaviorType: record.behaviorType,
      identityKey: record.identityKey,
      targetType: typeof targetType === 'string' ? targetType : null,
      targetKey: typeof targetKey === 'string' ? targetKey : null,
      behaviorId: record.behaviorId,
      occurredAt: record.occurredAt,
      summaryJson,
    })
  }

  if (projectionPolicy.latestFailureByType && record.status === 'failed') {
    rows.push({
      projectionKey: `failure:${record.behaviorType}`,
      projectionKind: 'latest-failure-by-type',
      behaviorType: record.behaviorType,
      identityKey: record.identityKey,
      targetType: typeof targetType === 'string' ? targetType : null,
      targetKey: typeof targetKey === 'string' ? targetKey : null,
      behaviorId: record.behaviorId,
      occurredAt: record.occurredAt,
      summaryJson,
    })
  }

  if (projectionPolicy.latestByRecommendation && typeof recommendation === 'string') {
    rows.push({
      projectionKey: `recommendation:${recommendation}`,
      projectionKind: 'latest-by-recommendation',
      behaviorType: record.behaviorType,
      identityKey: record.identityKey,
      targetType: typeof targetType === 'string' ? targetType : null,
      targetKey: typeof targetKey === 'string' ? targetKey : null,
      behaviorId: record.behaviorId,
      occurredAt: record.occurredAt,
      summaryJson,
    })
  }

  return rows
}

function readBehaviorIdentityKey(
  behaviorType: string,
  components: BehaviorRecord['components'] | undefined,
  behaviorId: string,
): string {
  const parts = components === undefined
    ? undefined
    : resolveBehaviorIdentityParts(behaviorType, components)

  return createBehaviorIdentityKey({
    behaviorType,
    parts: parts ?? { behaviorId },
  })
}
