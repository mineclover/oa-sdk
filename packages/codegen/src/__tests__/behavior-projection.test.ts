import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createBehaviorRecord,
  createBehaviorIdentityKey,
  createBehaviorRecorderFromOptions,
} from '../cli/lib/behavior-recorder.js'
import { createSqliteBehaviorProjectionReader } from '../cli/lib/behavior-projection.js'
import { loadSqliteDriver } from '../sqlite-workspace-index.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'oa-sdk-behavior-projection-'))
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
})

describe('behavior projection reader', () => {
  it('lists recent entries, recent failures, and latest behavior by type/target from SQLite records', async () => {
    const dbPath = join(tmpDir, 'behavior.sqlite')
    const recorder = createBehaviorRecorderFromOptions({ sqlitePath: dbPath })

    await recorder.record(createBehaviorRecord({
      behaviorType: 'build_openapi_target',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'build_openapi_target',
        parts: {
          targetType: 'definition-target',
          targetKey: 'public-api',
        },
      }),
      status: 'received',
      occurredAt: '2026-04-24T00:00:00.000Z',
      components: {
        target: {
          targetType: 'definition-target',
          targetKey: 'public-api',
          targetPath: 'targets/public-api.yaml',
        },
        result: {
          valid: false,
          fragmentCount: 0,
          selectedNodeCount: 0,
          errors: 0,
          warnings: 0,
          infos: 0,
          errorCodes: [],
        },
      },
    }))
    await recorder.record(createBehaviorRecord({
      behaviorType: 'review_openapi_change',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'review_openapi_change',
        parts: {
          targetType: 'openapi-review',
          targetKey: 'base.yaml|head.yaml',
        },
      }),
      status: 'failed',
      occurredAt: '2026-04-24T00:01:00.000Z',
      components: {
        target: {
          targetType: 'openapi-review',
          targetKey: 'base.yaml|head.yaml',
          basePath: 'base.yaml',
          headPath: 'head.yaml',
        },
        decision: {
          primarySignal: 'request-changes',
          decisionReason: 'review found blocking changes that require follow-up',
        },
        result: {
          recommendation: 'REQUEST_CHANGES',
          reasonCount: 1,
          reasons: ['review found blocking changes that require follow-up'],
          breakingChanges: 1,
          nonBreakingChanges: 0,
          validationErrors: 0,
          validationWarnings: 0,
          validationInfos: 0,
          artifactChecked: false,
          provenanceChecked: false,
          metadataRegistryChecked: false,
          artifactFresh: false,
          provenanceChanges: null,
          metadataRegistryChanges: null,
          checksIncomplete: false,
        },
      },
    }))
    await recorder.record(createBehaviorRecord({
      behaviorType: 'build_openapi_target',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'build_openapi_target',
        parts: {
          targetType: 'definition-target',
          targetKey: 'public-api',
        },
      }),
      status: 'validated',
      occurredAt: '2026-04-24T00:02:00.000Z',
      components: {
        target: {
          targetType: 'definition-target',
          targetKey: 'public-api',
          targetPath: 'targets/public-api.yaml',
        },
        result: {
          valid: false,
          fragmentCount: 0,
          selectedNodeCount: 0,
          errors: 0,
          warnings: 0,
          infos: 0,
          errorCodes: [],
        },
      },
    }))
    await recorder.record(createBehaviorRecord({
      behaviorType: 'build_openapi_target',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'build_openapi_target',
        parts: {
          targetType: 'definition-target',
          targetKey: 'public-api',
        },
      }),
      status: 'failed',
      occurredAt: '2026-04-24T00:03:00.000Z',
      components: {
        target: {
          targetType: 'definition-target',
          targetKey: 'public-api',
          targetPath: 'targets/public-api.yaml',
        },
        result: {
          valid: false,
          fragmentCount: 1,
          selectedNodeCount: 1,
          errors: 1,
          warnings: 0,
          infos: 0,
          errorCodes: ['definition-registry/missing-ref'],
        },
      },
    }))
    recorder.close?.()

    const db = loadSqliteDriver().open(dbPath)
    try {
      const projectionRows = db.prepare(`
        SELECT projection_key, projection_kind, behavior_type
        FROM behavior_projections
        ORDER BY projection_key
      `).all()
      expect(projectionRows).toEqual(expect.arrayContaining([
        expect.objectContaining({ projection_key: 'target:definition-target:public-api', projection_kind: 'latest-by-target', behavior_type: 'build_openapi_target' }),
        expect.objectContaining({ projection_key: 'target:openapi-review:base.yaml|head.yaml', projection_kind: 'latest-by-target', behavior_type: 'review_openapi_change' }),
        expect.objectContaining({ projection_key: 'decision-signal:request-changes', projection_kind: 'latest-by-decision-signal', behavior_type: 'review_openapi_change' }),
        expect.objectContaining({ projection_key: 'identity:build_openapi_target:targetKey=public-api:targetType=definition-target', projection_kind: 'latest-by-identity', behavior_type: 'build_openapi_target' }),
        expect.objectContaining({ projection_key: 'identity:review_openapi_change:targetKey=base.yaml%7Chead.yaml:targetType=openapi-review', projection_kind: 'latest-by-identity', behavior_type: 'review_openapi_change' }),
        expect.objectContaining({ projection_key: 'failure:build_openapi_target', projection_kind: 'latest-failure-by-type', behavior_type: 'build_openapi_target' }),
        expect.objectContaining({ projection_key: 'failure:review_openapi_change', projection_kind: 'latest-failure-by-type', behavior_type: 'review_openapi_change' }),
        expect.objectContaining({ projection_key: 'recommendation:REQUEST_CHANGES', projection_kind: 'latest-by-recommendation', behavior_type: 'review_openapi_change' }),
        expect.objectContaining({ projection_key: 'type:build_openapi_target', projection_kind: 'latest-by-type', behavior_type: 'build_openapi_target' }),
        expect.objectContaining({ projection_key: 'type:review_openapi_change', projection_kind: 'latest-by-type', behavior_type: 'review_openapi_change' }),
      ]))
    } finally {
      db.close()
    }

    const reader = createSqliteBehaviorProjectionReader(dbPath)
    try {
      const recent = reader.listRecent(2)
      expect(recent).toHaveLength(2)
      expect(recent.map(entry => entry.behaviorType)).toEqual([
        'build_openapi_target',
        'build_openapi_target',
      ])

      const failures = reader.listRecentFailures(5)
      expect(failures).toHaveLength(2)
      expect(failures.every(entry => entry.status === 'failed')).toBe(true)

      const latestBuild = reader.getLatestByType('build_openapi_target')
      expect(latestBuild).toEqual(expect.objectContaining({
        behaviorType: 'build_openapi_target',
        status: 'failed',
        identityKey: 'build_openapi_target:targetKey=public-api:targetType=definition-target',
        targetType: 'definition-target',
        targetKey: 'public-api',
      }))

      const latestBuildIdentity = reader.getLatestByIdentity(
        'build_openapi_target:targetKey=public-api:targetType=definition-target',
      )
      expect(latestBuildIdentity).toEqual(expect.objectContaining({
        behaviorType: 'build_openapi_target',
        status: 'failed',
      }))

      const latestReviewTarget = reader.getLatestByTarget('openapi-review', 'base.yaml|head.yaml')
      expect(latestReviewTarget).toEqual(expect.objectContaining({
        behaviorType: 'review_openapi_change',
        status: 'failed',
        identityKey: 'review_openapi_change:targetKey=base.yaml%7Chead.yaml:targetType=openapi-review',
        decisionSignal: 'request-changes',
        recommendation: 'REQUEST_CHANGES',
      }))

      const latestRequestChangesDecision = reader.getLatestByDecisionSignal('request-changes')
      expect(latestRequestChangesDecision).toEqual(expect.objectContaining({
        behaviorType: 'review_openapi_change',
        decisionSignal: 'request-changes',
      }))

      const latestBuildFailure = reader.getLatestFailureByType('build_openapi_target')
      expect(latestBuildFailure).toEqual(expect.objectContaining({
        behaviorType: 'build_openapi_target',
        status: 'failed',
      }))

      const latestRequestChanges = reader.getLatestByRecommendation('REQUEST_CHANGES')
      expect(latestRequestChanges).toEqual(expect.objectContaining({
        behaviorType: 'review_openapi_change',
        recommendation: 'REQUEST_CHANGES',
      }))
    } finally {
      reader.close()
    }
  })
})
