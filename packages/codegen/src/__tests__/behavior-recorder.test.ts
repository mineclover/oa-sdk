import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  assertBehaviorStatusTransition,
  assertValidBehaviorRecord,
  createBehaviorRecord,
  createBehaviorIdentityKey,
  createBehaviorRecorder,
  createBehaviorRecorderFromOptions,
  createMemoryBehaviorRecorder,
  isAllowedBehaviorStatusTransition,
  validateBehaviorRecord,
} from '../cli/lib/behavior-recorder.js'
import { loadSqliteDriver } from '../sqlite-workspace-index.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'oa-sdk-behavior-recorder-'))
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
})

describe('behavior recorder', () => {
  it('creates a behavior record with schema version and generated id', () => {
    const record = createBehaviorRecord({
      behaviorType: 'generic_behavior',
      status: 'succeeded',
    })

    expect(record).toEqual(expect.objectContaining({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorType: 'generic_behavior',
      status: 'succeeded',
      source: 'oa-gen.cli',
    }))
    expect(record.behaviorId).toMatch(/^bhv_[a-f0-9]{32}$/)
    expect(new Date(record.occurredAt).toString()).not.toBe('Invalid Date')
  })

  it('validates behavior record shape and reports issues for invalid payloads', () => {
    const result = validateBehaviorRecord({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorId: 'invalid',
      behaviorType: '',
      status: 'done',
      occurredAt: 'not-a-date',
      source: '',
      components: {
        actor: {
          actorType: 'system',
        },
        target: {
          targetId: 'x',
        },
        context: {},
        result: {
          recommendation: 'MAYBE',
        },
        metrics: {
          durationMs: -1,
        },
      },
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'behaviorId' }),
      expect.objectContaining({ path: 'behaviorType' }),
      expect.objectContaining({ path: 'status' }),
      expect.objectContaining({ path: 'occurredAt' }),
      expect.objectContaining({ path: 'source' }),
      expect.objectContaining({ path: 'components.actor.actorId' }),
      expect.objectContaining({ path: 'components.target.targetType' }),
      expect.objectContaining({ path: 'components.context.source' }),
      expect.objectContaining({ path: 'components.result.recommendation' }),
      expect.objectContaining({ path: 'components.metrics.durationMs' }),
    ]))
  })

  it('accepts specialized common component payloads with required fields present', () => {
    const result = validateBehaviorRecord(createBehaviorRecord({
      behaviorType: 'build_openapi_target',
      status: 'succeeded',
      components: {
        actor: {
          actorType: 'system',
          actorId: 'oa-gen',
        },
        target: {
          targetType: 'definition-target',
          targetKey: 'public-api',
          targetPath: 'targets/public-api.yaml',
        },
        context: {
          source: 'cli',
          command: 'build-spec',
        },
        result: {
          valid: true,
          fragmentCount: 1,
          selectedNodeCount: 1,
          errors: 0,
          warnings: 0,
          infos: 0,
          errorCodes: [],
        },
        metrics: {
          durationMs: 12,
        },
      },
    }))

    expect(result).toEqual({ valid: true, issues: [] })
  })

  it('preserves source provenance and trace lineage metadata on a behavior span', () => {
    const record = createBehaviorRecord({
      behaviorType: 'build_openapi_target',
      behaviorId: 'bhv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      parentBehaviorId: 'bhv_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      correlationId: 'corr_build_public_api',
      causationId: 'bhv_cccccccccccccccccccccccccccccccc',
      status: 'executing',
      components: {
        target: {
          targetType: 'definition-target',
          targetKey: 'public-api',
          targetPath: 'targets/public-api.yaml',
          canonicalId: 'path:public/books/BooksPath',
          sourcePath: 'fragments/path/public/books/BooksPath.yaml',
          sourcePointer: '#/content',
          contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        input: {
          targetPath: 'targets/public-api.yaml',
          provenancePath: 'artifacts/public-api.provenance.json',
        },
        context: {
          source: 'oa-gen.cli',
          command: 'build-spec',
          requestId: 'req_build_public_api',
          traceId: 'trace_build_public_api',
          environment: 'test',
        },
      },
    })

    expect(validateBehaviorRecord(record)).toEqual({ valid: true, issues: [] })
    expect(record).toEqual(expect.objectContaining({
      behaviorId: 'bhv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      parentBehaviorId: 'bhv_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      correlationId: 'corr_build_public_api',
      causationId: 'bhv_cccccccccccccccccccccccccccccccc',
      components: expect.objectContaining({
        context: expect.objectContaining({ traceId: 'trace_build_public_api' }),
        target: expect.objectContaining({
          canonicalId: 'path:public/books/BooksPath',
          sourcePath: 'fragments/path/public/books/BooksPath.yaml',
          sourcePointer: '#/content',
          contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        }),
        input: expect.objectContaining({
          provenancePath: 'artifacts/public-api.provenance.json',
        }),
      }),
    }))
  })

  it('accepts registered decision payloads and exception-style result payloads', () => {
    const result = validateBehaviorRecord(createBehaviorRecord({
      behaviorType: 'review_openapi_change',
      status: 'failed',
      components: {
        actor: {
          actorType: 'system',
          actorId: 'oa-gen',
        },
        target: {
          targetType: 'openapi-review',
          targetKey: 'base.yaml|head.yaml',
          basePath: 'base.yaml',
          headPath: 'head.yaml',
        },
        context: {
          source: 'cli',
          command: 'review',
        },
        decision: {
          primarySignal: 'exception',
          decisionReason: 'review command raised an exception before producing a report',
        },
        result: {
          errorMessage: 'boom',
        },
      },
    }))

    expect(result).toEqual({ valid: true, issues: [] })
  })

  it('validates registered per-behavior input schemas when input is present', () => {
    const result = validateBehaviorRecord({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorId: 'bhv_0123456789abcdef0123456789abcdef',
      behaviorType: 'build_openapi_target',
      identityKey: 'build_openapi_target:targetKey=public-api:targetType=definition-target',
      status: 'failed',
      occurredAt: new Date().toISOString(),
      source: 'oa-gen.cli',
      components: {
        input: {
          targetPath: 123,
        },
      },
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'components.input.targetPath',
      }),
    ]))
  })

  it('validates semantic consistency between decision and result for review behaviors', () => {
    const result = validateBehaviorRecord({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorId: 'bhv_0123456789abcdef0123456789abcdef',
      behaviorType: 'review_openapi_change',
      identityKey: 'review_openapi_change:targetKey=base.yaml%7Chead.yaml:targetType=openapi-review',
      status: 'failed',
      occurredAt: new Date().toISOString(),
      source: 'oa-gen.cli',
      components: {
        actor: {
          actorType: 'system',
          actorId: 'oa-gen',
        },
        target: {
          targetType: 'openapi-review',
          targetKey: 'base.yaml|head.yaml',
          basePath: 'base.yaml',
          headPath: 'head.yaml',
        },
        decision: {
          primarySignal: 'approve',
          decisionReason: 'review found no blocking issues and all required checks are satisfied',
        },
        result: {
          recommendation: 'REQUEST_CHANGES',
          reasonCount: 1,
          reasons: ['generated artifact is stale'],
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
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'components.result.recommendation',
      }),
    ]))
  })

  it('validates review reason count consistency', () => {
    const result = validateBehaviorRecord({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorId: 'bhv_12121212121212121212121212121212',
      behaviorType: 'review_openapi_change',
      identityKey: 'review_openapi_change:targetKey=base.yaml%7Chead.yaml:targetType=openapi-review',
      status: 'failed',
      occurredAt: new Date().toISOString(),
      source: 'oa-gen.cli',
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
          reasonCount: 2,
          reasons: ['generated artifact is stale'],
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
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'components.result.reasonCount' }),
    ]))
  })

  it('validates semantic consistency between decision and result for drift behaviors', () => {
    const result = validateBehaviorRecord({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorId: 'bhv_fedcba9876543210fedcba9876543210',
      behaviorType: 'sync_runtime_openapi',
      identityKey: 'sync_runtime_openapi:targetKey=managed.yaml%7Cruntime.yaml:targetType=runtime-openapi',
      status: 'failed',
      occurredAt: new Date().toISOString(),
      source: 'oa-gen.cli',
      components: {
        actor: {
          actorType: 'system',
          actorId: 'oa-gen',
        },
        target: {
          targetType: 'runtime-openapi',
          targetKey: 'managed.yaml|runtime.yaml',
          managedPath: 'managed.yaml',
          runtimePath: 'runtime.yaml',
        },
        input: {
          managedPath: 'managed.yaml',
          runtimePath: 'runtime.yaml',
        },
        decision: {
          primarySignal: 'fetch-failure',
          decisionReason: 'runtime OpenAPI could not be fetched or parsed',
        },
        result: {
          drift: true,
          status: 'ok',
        },
      },
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'components.result.status',
      }),
      expect.objectContaining({
        path: 'components.result.failureCode',
      }),
    ]))
  })

  it('validates input and target path consistency for build behaviors', () => {
    const result = validateBehaviorRecord({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorId: 'bhv_cccccccccccccccccccccccccccccccc',
      behaviorType: 'build_openapi_target',
      identityKey: 'build_openapi_target:targetKey=public-api:targetType=definition-target',
      status: 'failed',
      occurredAt: new Date().toISOString(),
      source: 'oa-gen.cli',
      components: {
        target: {
          targetType: 'definition-target',
          targetKey: 'public-api',
          targetPath: 'target-a.yaml',
          targetName: 'public-api',
        },
        input: {
          targetPath: 'target-b.yaml',
        },
        decision: {
          primarySignal: 'build-invalid',
          decisionReason: 'builder diagnostics contain one or more errors',
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
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'components.input.targetPath',
      }),
    ]))
  })

  it('validates input and target path consistency for review behaviors', () => {
    const result = validateBehaviorRecord({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorId: 'bhv_dddddddddddddddddddddddddddddddd',
      behaviorType: 'review_openapi_change',
      identityKey: 'review_openapi_change:targetKey=base.yaml%7Chead.yaml:targetType=openapi-review',
      status: 'failed',
      occurredAt: new Date().toISOString(),
      source: 'oa-gen.cli',
      components: {
        target: {
          targetType: 'openapi-review',
          targetKey: 'base.yaml|head.yaml',
          basePath: 'base.yaml',
          headPath: 'head.yaml',
          targetPath: 'target-a.yaml',
        },
        input: {
          basePath: 'other-base.yaml',
          headPath: 'head.yaml',
          targetPath: 'target-b.yaml',
        },
        decision: {
          primarySignal: 'request-changes',
          decisionReason: 'review found blocking changes that require follow-up',
        },
        result: {
          recommendation: 'REQUEST_CHANGES',
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
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'components.input.basePath',
      }),
      expect.objectContaining({
        path: 'components.input.targetPath',
      }),
    ]))
  })

  it('validates sidecar summary consistency for review behaviors', () => {
    const result = validateBehaviorRecord({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorId: 'bhv_abababababababababababababababab',
      behaviorType: 'review_openapi_change',
      identityKey: 'review_openapi_change:targetKey=base.yaml%7Chead.yaml:targetType=openapi-review',
      status: 'succeeded',
      occurredAt: new Date().toISOString(),
      source: 'oa-gen.cli',
      components: {
        target: {
          targetType: 'openapi-review',
          targetKey: 'base.yaml|head.yaml',
          basePath: 'base.yaml',
          headPath: 'head.yaml',
        },
        input: {
          basePath: 'base.yaml',
          headPath: 'head.yaml',
          artifactPath: 'artifact.yaml',
          baseProvenancePath: 'base.provenance.json',
          headProvenancePath: 'head.provenance.json',
        },
        decision: {
          primarySignal: 'approve',
          decisionReason: 'review found no blocking issues and all required checks are satisfied',
        },
        result: {
          recommendation: 'APPROVE',
          breakingChanges: 0,
          nonBreakingChanges: 0,
          validationErrors: 0,
          validationWarnings: 0,
          validationInfos: 0,
          artifactChecked: true,
          artifactFresh: null,
          provenanceChecked: true,
          provenanceChanges: null,
          metadataRegistryChecked: false,
          metadataRegistryChanges: null,
          checksIncomplete: false,
        },
      },
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'components.result.artifactFresh' }),
      expect.objectContaining({ path: 'components.result.provenanceChanges' }),
    ]))
  })

  it('validates checked-state consistency for review sidecars', () => {
    const result = validateBehaviorRecord({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorId: 'bhv_34343434343434343434343434343434',
      behaviorType: 'review_openapi_change',
      identityKey: 'review_openapi_change:targetKey=base.yaml%7Chead.yaml:targetType=openapi-review',
      status: 'succeeded',
      occurredAt: new Date().toISOString(),
      source: 'oa-gen.cli',
      components: {
        target: {
          targetType: 'openapi-review',
          targetKey: 'base.yaml|head.yaml',
          basePath: 'base.yaml',
          headPath: 'head.yaml',
        },
        input: {
          basePath: 'base.yaml',
          headPath: 'head.yaml',
          artifactPath: 'artifact.yaml',
          baseProvenancePath: 'base.provenance.json',
          headProvenancePath: 'head.provenance.json',
          baseMetadataRegistryPath: 'base.metadata.json',
        },
        decision: {
          primarySignal: 'comment',
          decisionReason: 'review found non-blocking changes or incomplete optional checks',
        },
        result: {
          recommendation: 'COMMENT',
          reasonCount: 1,
          reasons: ['provenance diff was not fully checked'],
          breakingChanges: 0,
          nonBreakingChanges: 0,
          validationErrors: 0,
          validationWarnings: 0,
          validationInfos: 0,
          artifactChecked: false,
          artifactFresh: true,
          provenanceChecked: false,
          provenanceChanges: null,
          metadataRegistryChecked: true,
          metadataRegistryChanges: null,
          checksIncomplete: true,
        },
      },
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'components.result.artifactChecked' }),
      expect.objectContaining({ path: 'components.result.provenanceChecked' }),
      expect.objectContaining({ path: 'components.result.metadataRegistryChecked' }),
    ]))
  })

  it('validates targetKey composition rules for drift behaviors', () => {
    const result = validateBehaviorRecord({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorId: 'bhv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      behaviorType: 'sync_runtime_openapi',
      identityKey: 'sync_runtime_openapi:targetKey=broken:targetType=runtime-openapi',
      status: 'failed',
      occurredAt: new Date().toISOString(),
      source: 'oa-gen.cli',
      components: {
        actor: {
          actorType: 'system',
          actorId: 'oa-gen',
        },
        target: {
          targetType: 'runtime-openapi',
          targetKey: 'broken',
          managedPath: 'managed.yaml',
          runtimeSource: 'runtime.yaml',
        },
        input: {
          managedPath: 'managed.yaml',
          runtimeUrl: 'runtime.yaml',
        },
        decision: {
          primarySignal: 'fetch-failure',
          decisionReason: 'runtime OpenAPI could not be fetched or parsed',
        },
        result: {
          drift: true,
          status: 'drift-check-failed',
          failureCode: 'drift-check-failed',
        },
      },
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'components.target.targetKey',
      }),
    ]))
  })

  it('validates runtime source consistency between input and target for drift behaviors', () => {
    const result = validateBehaviorRecord({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorId: 'bhv_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      behaviorType: 'sync_runtime_openapi',
      identityKey: 'sync_runtime_openapi:targetKey=managed.yaml%7Cruntime.yaml:targetType=runtime-openapi',
      status: 'failed',
      occurredAt: new Date().toISOString(),
      source: 'oa-gen.cli',
      components: {
        target: {
          targetType: 'runtime-openapi',
          targetKey: 'managed.yaml|runtime.yaml',
          managedPath: 'managed.yaml',
          runtimeSource: 'runtime-a.yaml',
        },
        input: {
          managedPath: 'managed.yaml',
          runtimeUrl: 'runtime-b.yaml',
        },
        decision: {
          primarySignal: 'fetch-failure',
          decisionReason: 'runtime OpenAPI could not be fetched or parsed',
        },
        result: {
          drift: true,
          status: 'drift-check-failed',
          failureCode: 'drift-check-failed',
        },
      },
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'components.input.runtimeUrl',
      }),
    ]))
  })

  it('validates target and input path consistency for review-bundle behaviors', () => {
    const result = validateBehaviorRecord({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorId: 'bhv_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      behaviorType: 'publish_review_bundle',
      identityKey: 'publish_review_bundle:targetKey=broken:targetType=review-bundle',
      status: 'failed',
      occurredAt: new Date().toISOString(),
      source: 'oa-gen.cli',
      components: {
        actor: {
          actorType: 'system',
          actorId: 'oa-gen',
        },
        target: {
          targetType: 'review-bundle',
          targetKey: 'broken',
          basePath: 'base.yaml',
          headPath: 'head.yaml',
          artifactPath: 'artifact.yaml',
        },
        input: {
          basePath: 'other-base.yaml',
          headPath: 'head.yaml',
          artifactPath: 'artifact.yaml',
          includeInventory: false,
        },
        decision: {
          primarySignal: 'exception',
          decisionReason: 'review-bundle command raised an exception before producing a bundle',
        },
        result: {
          errorMessage: 'boom',
        },
      },
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'components.target.targetKey',
      }),
      expect.objectContaining({
        path: 'components.input.basePath',
      }),
    ]))
  })

  it('validates sidecar summary consistency for review-bundle behaviors', () => {
    const result = validateBehaviorRecord({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorId: 'bhv_cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
      behaviorType: 'publish_review_bundle',
      identityKey: 'publish_review_bundle:targetKey=base.yaml%7Chead.yaml%7Cartifact.yaml:targetType=review-bundle',
      status: 'succeeded',
      occurredAt: new Date().toISOString(),
      source: 'oa-gen.cli',
      components: {
        target: {
          targetType: 'review-bundle',
          targetKey: 'base.yaml|head.yaml|artifact.yaml',
          basePath: 'base.yaml',
          headPath: 'head.yaml',
          artifactPath: 'artifact.yaml',
        },
        input: {
          basePath: 'base.yaml',
          headPath: 'head.yaml',
          artifactPath: 'artifact.yaml',
          runtimeDriftPath: 'drift.json',
          duplicateReviewPath: 'duplicate.json',
          includeInventory: false,
        },
        decision: {
          primarySignal: 'approve',
          decisionReason: 'bundle summary found no blocking review sections',
        },
        result: {
          recommendation: 'APPROVE',
          reasonCount: 0,
          reasons: [],
          breakingChanges: 0,
          nonBreakingChanges: 0,
          artifactChecked: true,
          artifactFresh: true,
          runtimeDriftIncluded: false,
          runtimeDrift: null,
          provenanceChecked: false,
          inventoryIncluded: false,
          compositionIncluded: false,
          metadataRegistryIncluded: false,
          metadataRegistryChecked: false,
          metadataRegistryValid: null,
          provenanceChanges: null,
          metadataRegistryChanges: null,
          duplicateReviewIncluded: false,
          duplicateReviewValid: null,
          checksIncomplete: false,
        },
      },
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'components.result.runtimeDriftIncluded' }),
      expect.objectContaining({ path: 'components.result.duplicateReviewIncluded' }),
    ]))
  })

  it('validates included section summary flags for review-bundle behaviors', () => {
    const result = validateBehaviorRecord({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorId: 'bhv_efefefefefefefefefefefefefefefef',
      behaviorType: 'publish_review_bundle',
      identityKey: 'publish_review_bundle:targetKey=base.yaml%7Chead.yaml%7Cartifact.yaml:targetType=review-bundle',
      status: 'succeeded',
      occurredAt: new Date().toISOString(),
      source: 'oa-gen.cli',
      components: {
        target: {
          targetType: 'review-bundle',
          targetKey: 'base.yaml|head.yaml|artifact.yaml',
          basePath: 'base.yaml',
          headPath: 'head.yaml',
          artifactPath: 'artifact.yaml',
        },
        input: {
          basePath: 'base.yaml',
          headPath: 'head.yaml',
          artifactPath: 'artifact.yaml',
          metadataRegistryPath: 'metadata.json',
          compositionPath: 'composition.json',
          includeInventory: true,
        },
        decision: {
          primarySignal: 'approve',
          decisionReason: 'bundle summary found no blocking review sections',
        },
        result: {
          recommendation: 'APPROVE',
          reasonCount: 0,
          reasons: [],
          breakingChanges: 0,
          nonBreakingChanges: 0,
          artifactChecked: true,
          artifactFresh: true,
          runtimeDriftIncluded: false,
          runtimeDrift: null,
          provenanceChecked: false,
          provenanceChanges: null,
          inventoryIncluded: false,
          compositionIncluded: false,
          metadataRegistryIncluded: false,
          metadataRegistryChecked: false,
          metadataRegistryValid: null,
          metadataRegistryChanges: null,
          duplicateReviewIncluded: false,
          duplicateReviewValid: null,
          checksIncomplete: false,
        },
      },
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'components.result.inventoryIncluded' }),
      expect.objectContaining({ path: 'components.result.compositionIncluded' }),
      expect.objectContaining({ path: 'components.result.metadataRegistryIncluded' }),
      expect.objectContaining({ path: 'components.result.metadataRegistryValid' }),
    ]))
  })

  it('validates review-bundle reason count consistency', () => {
    const result = validateBehaviorRecord({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorId: 'bhv_ffffffffffffffffffffffffffffffff',
      behaviorType: 'publish_review_bundle',
      identityKey: 'publish_review_bundle:targetKey=base.yaml%7Chead.yaml%7Cartifact.yaml:targetType=review-bundle',
      status: 'failed',
      occurredAt: new Date().toISOString(),
      source: 'oa-gen.cli',
      components: {
        target: {
          targetType: 'review-bundle',
          targetKey: 'base.yaml|head.yaml|artifact.yaml',
          basePath: 'base.yaml',
          headPath: 'head.yaml',
          artifactPath: 'artifact.yaml',
        },
        input: {
          basePath: 'base.yaml',
          headPath: 'head.yaml',
          artifactPath: 'artifact.yaml',
          includeInventory: false,
        },
        decision: {
          primarySignal: 'request-changes',
          decisionReason: 'bundle summary found blocking review sections',
        },
        result: {
          recommendation: 'REQUEST_CHANGES',
          reasonCount: 2,
          reasons: ['generated artifact is stale'],
          breakingChanges: 1,
          nonBreakingChanges: 0,
          artifactChecked: true,
          artifactFresh: false,
          runtimeDriftIncluded: false,
          runtimeDrift: null,
          provenanceChecked: false,
          provenanceChanges: null,
          inventoryIncluded: false,
          compositionIncluded: false,
          metadataRegistryIncluded: false,
          metadataRegistryChecked: false,
          metadataRegistryValid: null,
          metadataRegistryChanges: null,
          duplicateReviewIncluded: false,
          duplicateReviewValid: null,
          checksIncomplete: false,
        },
      },
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'components.result.reasonCount' }),
    ]))
  })

  it('derives identityKey from the registered behavior target definition', () => {
    const record = createBehaviorRecord({
      behaviorType: 'build_openapi_target',
      status: 'received',
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
    })

    expect(record.identityKey).toBe(
      'build_openapi_target:targetKey=public-api:targetType=definition-target',
    )
  })

  it('asserts valid behavior records before persistence', () => {
    expect(() => assertValidBehaviorRecord({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorId: 'invalid',
      behaviorType: 'generic_behavior',
      status: 'succeeded',
      occurredAt: new Date().toISOString(),
      source: 'oa-gen.cli',
      components: {},
    })).toThrow('Invalid behavior record')
  })

  it('accepts documented status transitions and rejects invalid ones', () => {
    expect(isAllowedBehaviorStatusTransition('received', 'validated')).toBe(true)
    expect(isAllowedBehaviorStatusTransition('validated', 'executing')).toBe(true)
    expect(isAllowedBehaviorStatusTransition('executing', 'succeeded')).toBe(true)
    expect(isAllowedBehaviorStatusTransition('failed', 'received')).toBe(false)
    expect(() => assertBehaviorStatusTransition('failed', 'received')).toThrow(
      'Invalid behavior status transition: failed -> received',
    )
  })

  it('validates explicit previousStatus when creating a behavior record', () => {
    expect(() => createBehaviorRecord({
      behaviorType: 'generic_behavior',
      previousStatus: 'validated',
      status: 'executing',
    })).not.toThrow()

    expect(() => createBehaviorRecord({
      behaviorType: 'generic_behavior',
      previousStatus: 'succeeded',
      status: 'executing',
    })).toThrow('Invalid behavior status transition: succeeded -> executing')
  })

  it('writes behavior records as JSONL when a file path is configured', async () => {
    const filePath = join(tmpDir, 'behavior.jsonl')
    const recorder = createBehaviorRecorder(filePath)

    await recorder.record(createBehaviorRecord({
      behaviorType: 'generic_behavior',
      status: 'succeeded',
      components: {
        result: { valid: true },
      },
    }))

    const lines = readFileSync(filePath, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? '{}')).toEqual(expect.objectContaining({
      behaviorType: 'generic_behavior',
      status: 'succeeded',
      components: {
        result: { valid: true },
      },
    }))
  })

  it('stores behavior records in memory when the memory adapter is used', async () => {
    const recorder = createMemoryBehaviorRecorder()
    const record = createBehaviorRecord({
      behaviorType: 'generic_behavior',
      status: 'failed',
      components: {
        result: { recommendation: 'REQUEST_CHANGES' },
      },
    })

    await recorder.record(record)

    expect(recorder.records).toEqual([
      expect.objectContaining({
        behaviorType: 'generic_behavior',
        status: 'failed',
        components: {
          result: { recommendation: 'REQUEST_CHANGES' },
        },
      }),
    ])
  })

  it('writes behavior records to SQLite when the sqlite adapter is configured', async () => {
    const dbPath = join(tmpDir, 'behavior.sqlite')
    const recorder = createBehaviorRecorderFromOptions({ sqlitePath: dbPath })
    const record = createBehaviorRecord({
      behaviorType: 'generic_behavior',
      status: 'succeeded',
      components: {
        result: { valid: true },
      },
    })

    await recorder.record(record)
    recorder.close?.()

    const db = loadSqliteDriver().open(dbPath)
    try {
      const row = db.prepare(`
        SELECT behavior_id, behavior_type, status, record_json
        FROM behavior_records
        WHERE behavior_id = ?
      `).get(record.behaviorId)

      expect(row).toEqual(expect.objectContaining({
        behavior_id: record.behaviorId,
        behavior_type: 'generic_behavior',
        status: 'succeeded',
      }))
      expect(JSON.parse(String(row?.record_json ?? '{}'))).toEqual(expect.objectContaining({
        behaviorType: 'generic_behavior',
        status: 'succeeded',
      }))
    } finally {
      db.close()
    }
  })

  it('enforces allowed status transitions from persisted SQLite history when targetKey is shared', async () => {
    const dbPath = join(tmpDir, 'behavior-history.sqlite')
    const recorder = createBehaviorRecorderFromOptions({ sqlitePath: dbPath })

    await recorder.record(createBehaviorRecord({
      behaviorType: 'generic_behavior',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'generic_behavior',
        parts: { targetKey: 'public-api' },
      }),
      status: 'received',
      components: {
        target: {
          targetType: 'generic-target',
          targetKey: 'public-api',
        },
      },
    }))

    expect(() => recorder.record(createBehaviorRecord({
      behaviorType: 'generic_behavior',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'generic_behavior',
        parts: { targetKey: 'public-api' },
      }),
      status: 'validated',
      components: {
        target: {
          targetType: 'generic-target',
          targetKey: 'public-api',
        },
      },
    }))).not.toThrow()

    recorder.close?.()
  })

  it('rejects invalid status transitions from persisted SQLite history when targetKey is shared', async () => {
    const dbPath = join(tmpDir, 'behavior-history-invalid.sqlite')
    const recorder = createBehaviorRecorderFromOptions({ sqlitePath: dbPath })

    await recorder.record(createBehaviorRecord({
      behaviorType: 'generic_behavior',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'generic_behavior',
        parts: { targetKey: 'public-api' },
      }),
      status: 'succeeded',
      components: {
        target: {
          targetType: 'generic-target',
          targetKey: 'public-api',
        },
      },
    }))

    await expect(() => recorder.record(createBehaviorRecord({
      behaviorType: 'generic_behavior',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'generic_behavior',
        parts: { targetKey: 'public-api' },
      }),
      status: 'executing',
      components: {
        target: {
          targetType: 'generic-target',
          targetKey: 'public-api',
        },
      },
    }))).toThrow('Invalid behavior status transition: succeeded -> executing')

    recorder.close?.()
  })

  it('persists source-backed trace span lineage across a behavior lifecycle', async () => {
    const dbPath = join(tmpDir, 'behavior-provenance-trace.sqlite')
    const recorder = createBehaviorRecorderFromOptions({ sqlitePath: dbPath })
    const identityKey = createBehaviorIdentityKey({
      behaviorType: 'build_openapi_target',
      parts: { targetKey: 'public-api', targetType: 'definition-target' },
    })
    const target = {
      targetType: 'definition-target',
      targetKey: 'public-api',
      targetPath: 'targets/public-api.yaml',
      canonicalId: 'path:public/books/BooksPath',
      sourcePath: 'fragments/path/public/books/BooksPath.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    }
    const context = {
      source: 'oa-gen.cli',
      command: 'build-spec',
      requestId: 'req_build_public_api',
      traceId: 'trace_build_public_api',
      environment: 'test',
    }
    const input = {
      targetPath: 'targets/public-api.yaml',
      provenancePath: 'artifacts/public-api.provenance.json',
    }

    const received = createBehaviorRecord({
      behaviorType: 'build_openapi_target',
      behaviorId: 'bhv_11111111111111111111111111111111',
      identityKey,
      correlationId: 'corr_build_public_api',
      occurredAt: '2026-07-14T06:00:00.000Z',
      status: 'received',
      components: { target, input, context },
    })
    const executing = createBehaviorRecord({
      behaviorType: 'build_openapi_target',
      behaviorId: 'bhv_22222222222222222222222222222222',
      identityKey,
      parentBehaviorId: received.behaviorId,
      correlationId: 'corr_build_public_api',
      causationId: received.behaviorId,
      previousStatus: received.status,
      occurredAt: '2026-07-14T06:00:01.000Z',
      status: 'executing',
      components: { target, input, context },
    })
    const succeeded = createBehaviorRecord({
      behaviorType: 'build_openapi_target',
      behaviorId: 'bhv_33333333333333333333333333333333',
      identityKey,
      parentBehaviorId: executing.behaviorId,
      correlationId: 'corr_build_public_api',
      causationId: executing.behaviorId,
      previousStatus: executing.status,
      occurredAt: '2026-07-14T06:00:02.000Z',
      status: 'succeeded',
      components: {
        target,
        input,
        context,
        result: {
          valid: true,
          fragmentCount: 1,
          selectedNodeCount: 1,
          errors: 0,
          warnings: 0,
          infos: 0,
          errorCodes: [],
          outputPath: 'artifacts/public-api.yaml',
        },
      },
    })

    await recorder.record(received)
    await recorder.record(executing)
    await recorder.record(succeeded)
    recorder.close?.()

    const db = loadSqliteDriver().open(dbPath)
    try {
      const rows = db.prepare(`
        SELECT record_json
        FROM behavior_records
        WHERE identity_key = ?
        ORDER BY occurred_at ASC, created_at ASC
      `).all(identityKey) as Array<{ record_json: string }>
      const latestProjection = db.prepare(`
        SELECT behavior_id, summary_json
        FROM behavior_projections
        WHERE projection_key = ?
      `).get(`identity:${identityKey}`)

      expect(rows).toHaveLength(3)
      expect(rows.map(row => JSON.parse(row.record_json))).toEqual([
        expect.objectContaining({
          behaviorId: received.behaviorId,
          status: 'received',
          correlationId: 'corr_build_public_api',
          components: expect.objectContaining({
            context: expect.objectContaining({ traceId: 'trace_build_public_api' }),
            target: expect.objectContaining({ sourcePointer: '#/content' }),
          }),
        }),
        expect.objectContaining({
          behaviorId: executing.behaviorId,
          status: 'executing',
          parentBehaviorId: received.behaviorId,
          causationId: received.behaviorId,
        }),
        expect.objectContaining({
          behaviorId: succeeded.behaviorId,
          status: 'succeeded',
          parentBehaviorId: executing.behaviorId,
          causationId: executing.behaviorId,
          components: expect.objectContaining({
            input: expect.objectContaining({ provenancePath: 'artifacts/public-api.provenance.json' }),
            target: expect.objectContaining({
              sourcePath: 'fragments/path/public/books/BooksPath.yaml',
              contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            }),
          }),
        }),
      ])
      expect(latestProjection).toEqual(expect.objectContaining({
        behavior_id: succeeded.behaviorId,
        summary_json: expect.stringContaining('"status":"succeeded"'),
      }))
    } finally {
      db.close()
    }
  })
})
