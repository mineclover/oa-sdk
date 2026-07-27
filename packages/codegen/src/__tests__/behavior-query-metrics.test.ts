import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  createBehaviorIdentityKey,
  createBehaviorRecord,
  createBehaviorRecorderFromOptions,
} from '../cli/lib/behavior-recorder.js'
import { queryBehavior } from '../cli/lib/behavior-query.js'

const tmpBase = resolve(__dirname, '../../.tmp-behavior-query-metrics-test')
const createdPaths: string[] = []

afterEach(() => {
  for (const filePath of createdPaths.splice(0)) {
    if (existsSync(filePath)) rmSync(filePath, { force: true })
  }
})

describe('behavior metric summaries', () => {
  it('returns deterministic min/max/average/latest summaries for one behavior type', () => {
    const dbPath = join(tmpBase, `metrics-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
    createdPaths.push(dbPath)
    const recorder = createBehaviorRecorderFromOptions({ sqlitePath: dbPath })
    for (const [index, sample] of [
      { durationMs: 10, matchedPointers: 2, occurredAt: '2026-01-01T00:00:00Z' },
      { durationMs: 30, matchedPointers: 6, occurredAt: '2026-01-01T00:00:01Z' },
    ].entries()) {
      const targetKey = `public-api-${index}`
      const identityKey = createBehaviorIdentityKey({
        behaviorType: 'build_openapi_target',
        parts: { targetType: 'definition-target', targetKey },
      })
      recorder.record(createBehaviorRecord({
        behaviorType: 'build_openapi_target',
        identityKey,
        status: 'succeeded',
        occurredAt: sample.occurredAt,
        components: {
          actor: { actorType: 'system', actorId: 'oa-gen' },
          target: { targetType: 'definition-target', targetKey, targetPath: 'targets/public-api.yaml' },
          context: { source: 'cli', command: 'build-spec' },
          result: { valid: true, fragmentCount: 1, selectedNodeCount: 1, errors: 0, warnings: 0, infos: 0, errorCodes: [] },
          metrics: { durationMs: sample.durationMs, parallelEvidenceMatchedPointers: sample.matchedPointers },
        },
      }))
    }
    recorder.close?.()

    const report = queryBehavior({
      dbPath,
      mode: 'metrics-summary',
      behaviorType: 'build_openapi_target',
    })

    expect(report.count).toBe(2)
    expect(report.entries).toEqual([])
    expect(report.metricSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'durationMs', count: 2, min: 10, max: 30, average: 20, latest: 30 }),
      expect.objectContaining({ name: 'parallelEvidenceMatchedPointers', count: 2, min: 2, max: 6, average: 4, latest: 6 }),
    ]))
  })
})
