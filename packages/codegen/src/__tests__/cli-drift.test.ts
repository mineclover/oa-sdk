/**
 * `oa-gen drift` / `drift:live` path arguments and the behavior records they write.
 *
 * The command runs from a temporary project root so relative arguments resolve against it,
 * the way a user runs `oa-gen drift --managed-openapi openapi.yaml ...` from their project.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { stringify as yamlStringify } from 'yaml'
import { runOaCli, type CliRunResult } from './e2e/helpers/cli-runner.js'
import { createWorkspaceFixture, type WorkspaceFixture } from './e2e/helpers/fixture-builder.js'
import { loadSqliteDriver } from '../sqlite-workspace-index.js'

const MANAGED = 'contracts/managed.openapi.yaml'
const RUNTIME = 'runtime/runtime.openapi.yaml'
const RUNTIME_WITH_DRIFT = 'runtime/runtime-drift.openapi.yaml'

type DriftPayload = {
  drift?: boolean
  status?: string
  managed?: string
  runtime?: string
  issues?: unknown[]
  failure?: { code?: string }
}

type RecordedBehavior = {
  behaviorType?: string
  identityKey?: string
  status?: string
  components?: {
    input?: Record<string, unknown>
    target?: Record<string, unknown>
    decision?: { primarySignal?: string }
    result?: Record<string, unknown>
  }
}

function managedSpec(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'Drift API', version: '1.0.0' },
    paths: {
      '/ping': {
        get: {
          operationId: 'getPing',
          responses: { '204': { description: 'No content' } },
        },
      },
    },
  }
}

function runtimeSpecWithExtraRoute(): Record<string, unknown> {
  const spec = managedSpec()
  return {
    ...spec,
    paths: {
      ...(spec.paths as Record<string, unknown>),
      '/runtime-only': {
        get: {
          operationId: 'runtimeOnly',
          responses: { '204': { description: 'No content' } },
        },
      },
    },
  }
}

function dataUrl(document: Record<string, unknown>): string {
  return `data:application/json,${encodeURIComponent(JSON.stringify(document))}`
}

describe('oa-gen drift path arguments', () => {
  let fixture: WorkspaceFixture
  /** The project root as the CLI sees it after resolving symlinks such as macOS /var -> /private/var. */
  let root: string

  beforeEach(async () => {
    fixture = await createWorkspaceFixture({
      hasGit: true,
      files: {
        [MANAGED]: yamlStringify(managedSpec()),
        [RUNTIME]: yamlStringify(managedSpec()),
        [RUNTIME_WITH_DRIFT]: yamlStringify(runtimeSpecWithExtraRoute()),
      },
    }, 'oa-drift-cli-')
    root = realpathSync(fixture.rootDir)
  })

  afterEach(async () => {
    await fixture?.cleanup()
  })

  function runDrift(args: string[], command: 'drift' | 'drift:live' = 'drift'): CliRunResult {
    return runOaCli([command, ...args, '--format', 'json'], { cwd: fixture.rootDir })
  }

  function parsePayload(result: CliRunResult): DriftPayload {
    expect(result.stderr).not.toContain('Invalid behavior record')
    return JSON.parse(result.stdout) as DriftPayload
  }

  function readBehaviorLog(relativePath: string): RecordedBehavior[] {
    return readFileSync(join(root, relativePath), 'utf8')
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as RecordedBehavior)
  }

  describe.each([
    { form: 'relative', absolute: false },
    { form: 'absolute', absolute: true },
  ])('$form file inputs', ({ absolute }) => {
    /** The argument as the user passes it. */
    const arg = (path: string): string => (absolute ? join(fixture.rootDir, path) : path)
    /** The path the command reports: an absolute argument as given, a relative one resolved from the project root. */
    const reported = (path: string): string => join(absolute ? fixture.rootDir : root, path)

    it('reports no drift with exit code 0', () => {
      const result = runDrift([
        '--managed-openapi', arg(MANAGED),
        '--runtime-openapi', arg(RUNTIME),
      ])
      const payload = parsePayload(result)

      expect(result.status).toBe(0)
      expect(payload).toEqual(expect.objectContaining({
        drift: false,
        status: 'ok',
        managed: reported(MANAGED),
        runtime: reported(RUNTIME),
        issues: [],
      }))
    })

    it('reports drift with exit code 1', () => {
      const result = runDrift([
        '--managed-openapi', arg(MANAGED),
        '--runtime-openapi', arg(RUNTIME_WITH_DRIFT),
      ])
      const payload = parsePayload(result)

      expect(result.status).toBe(1)
      expect(payload.drift).toBe(true)
      expect(payload.status).toBe('ok')
      expect(payload.issues?.length).toBeGreaterThan(0)
    })
  })

  describe('runtime URL input', () => {
    it.each(['drift', 'drift:live'] as const)('%s accepts a relative --managed-openapi and reports no drift', (command) => {
      const result = runDrift([
        '--managed-openapi', MANAGED,
        '--runtime-openapi-url', dataUrl(managedSpec()),
      ], command)
      const payload = parsePayload(result)

      expect(result.status).toBe(0)
      expect(payload.drift).toBe(false)
      expect(payload.managed).toBe(join(root, MANAGED))
    })

    it('reports drift from a runtime URL with exit code 1', () => {
      const result = runDrift([
        '--managed-openapi', MANAGED,
        '--runtime-openapi-url', dataUrl(runtimeSpecWithExtraRoute()),
      ], 'drift:live')
      const payload = parsePayload(result)

      expect(result.status).toBe(1)
      expect(payload.drift).toBe(true)
      expect(payload.issues?.length).toBeGreaterThan(0)
    })

    it('reports an unparsable runtime URL response as drift-check-failed', () => {
      const result = runDrift([
        '--managed-openapi', MANAGED,
        '--runtime-openapi-url', 'data:application/json,%7Bbad',
      ], 'drift:live')
      const payload = parsePayload(result)

      expect(result.status).toBe(1)
      expect(payload.status).toBe('drift-check-failed')
      expect(payload.failure?.code).toBe('drift-check-failed')
      expect(payload.managed).toBe(join(root, MANAGED))
    })
  })

  describe('behavior records', () => {
    it('records the resolved managed and runtime paths in both input and target (--behavior-log)', () => {
      const result = runDrift([
        '--managed-openapi', MANAGED,
        '--runtime-openapi', RUNTIME,
        '--behavior-log', 'logs/drift.behavior.jsonl',
      ])
      expect(result.status).toBe(0)

      const managedPath = join(root, MANAGED)
      const runtimePath = join(root, RUNTIME)
      const records = readBehaviorLog('logs/drift.behavior.jsonl')
      expect(records).toHaveLength(1)
      expect(records[0]).toEqual(expect.objectContaining({
        behaviorType: 'sync_runtime_openapi',
        status: 'succeeded',
        components: expect.objectContaining({
          input: { managedPath, runtimePath },
          target: {
            targetType: 'runtime-openapi',
            targetKey: `${managedPath}|${runtimePath}`,
            managedPath,
            runtimePath,
          },
          decision: expect.objectContaining({ primarySignal: 'no-drift' }),
        }),
      }))
    })

    it('records a drift-detected run with relative paths as a failed behavior', () => {
      const result = runDrift([
        '--managed-openapi', MANAGED,
        '--runtime-openapi', RUNTIME_WITH_DRIFT,
        '--behavior-log', 'logs/drift.behavior.jsonl',
      ])
      expect(result.status).toBe(1)
      expect(result.stderr).not.toContain('Invalid behavior record')

      const records = readBehaviorLog('logs/drift.behavior.jsonl')
      expect(records).toHaveLength(1)
      expect(records[0]?.status).toBe('failed')
      expect(records[0]?.components?.decision?.primarySignal).toBe('drift-detected')
      expect(records[0]?.components?.input?.managedPath).toBe(join(root, MANAGED))
      expect(records[0]?.components?.input?.runtimePath).toBe(join(root, RUNTIME_WITH_DRIFT))
    })

    it('gives relative and absolute invocations of the same files the same target identity', () => {
      const logPath = 'logs/drift.behavior.jsonl'
      const relative = runDrift([
        '--managed-openapi', MANAGED,
        '--runtime-openapi', RUNTIME,
        '--behavior-log', logPath,
      ])
      const absolute = runDrift([
        '--managed-openapi', join(root, MANAGED),
        '--runtime-openapi', join(root, RUNTIME),
        '--behavior-log', join(root, logPath),
      ])
      expect(relative.status).toBe(0)
      expect(absolute.status).toBe(0)

      const [fromRelative, fromAbsolute] = readBehaviorLog(logPath)
      expect(fromRelative?.identityKey).toBe(fromAbsolute?.identityKey)
      expect(fromRelative?.components?.input).toEqual(fromAbsolute?.components?.input)
      expect(fromRelative?.components?.target).toEqual(fromAbsolute?.components?.target)
    })

    it('persists a relative-path run to SQLite (--behavior-db)', () => {
      const result = runDrift([
        '--managed-openapi', MANAGED,
        '--runtime-openapi', RUNTIME,
        '--behavior-db', 'out/behavior.sqlite',
      ])
      expect(result.status).toBe(0)
      expect(result.stderr).not.toContain('Invalid behavior record')

      const managedPath = join(root, MANAGED)
      const runtimePath = join(root, RUNTIME)
      const sqlite = loadSqliteDriver().open(join(root, 'out/behavior.sqlite'))
      try {
        const rows = sqlite.prepare(`
          SELECT behavior_type, status, record_json
          FROM behavior_records
        `).all() as Array<{ behavior_type: string; status: string; record_json: string }>
        expect(rows).toHaveLength(1)
        expect(rows[0]).toEqual(expect.objectContaining({
          behavior_type: 'sync_runtime_openapi',
          status: 'succeeded',
        }))
        const record = JSON.parse(rows[0]!.record_json) as RecordedBehavior
        expect(record.components?.input).toEqual({ managedPath, runtimePath })
        expect(record.components?.target).toEqual(expect.objectContaining({
          targetKey: `${managedPath}|${runtimePath}`,
          managedPath,
          runtimePath,
        }))

        const projections = sqlite.prepare(`
          SELECT target_key
          FROM behavior_projections
          WHERE projection_kind = 'latest-by-target'
        `).all() as Array<{ target_key: string }>
        expect(projections).toEqual([{ target_key: `${managedPath}|${runtimePath}` }])
      } finally {
        sqlite.close()
      }
    })

    it('records URL-mode runs with the resolved managed path', () => {
      const runtimeUrl = dataUrl(managedSpec())
      const result = runDrift([
        '--managed-openapi', MANAGED,
        '--runtime-openapi-url', runtimeUrl,
        '--runtime-header', 'Authorization: Bearer test-token',
        '--behavior-log', 'logs/drift.behavior.jsonl',
      ], 'drift:live')
      expect(result.status).toBe(0)

      const managedPath = join(root, MANAGED)
      const [record] = readBehaviorLog('logs/drift.behavior.jsonl')
      expect(record?.components?.input).toEqual({
        managedPath,
        runtimeUrl,
        runtimeHeaders: ['Authorization'],
      })
      expect(record?.components?.target).toEqual({
        targetType: 'runtime-openapi',
        targetKey: `${managedPath}|${runtimeUrl}`,
        managedPath,
        runtimePath: runtimeUrl,
      })
    })

    it('records a runtime URL fetch failure with the resolved managed path', () => {
      const runtimeUrl = 'data:application/json,%7Bbad'
      const result = runDrift([
        '--managed-openapi', MANAGED,
        '--runtime-openapi-url', runtimeUrl,
        '--behavior-log', 'logs/drift.behavior.jsonl',
      ], 'drift:live')
      expect(result.status).toBe(1)
      expect(result.stderr).not.toContain('Invalid behavior record')

      const managedPath = join(root, MANAGED)
      const [record] = readBehaviorLog('logs/drift.behavior.jsonl')
      expect(record?.status).toBe('failed')
      expect(record?.components?.decision?.primarySignal).toBe('fetch-failure')
      expect(record?.components?.input).toEqual({ managedPath, runtimeUrl })
      expect(record?.components?.target).toEqual({
        targetType: 'runtime-openapi',
        targetKey: `${managedPath}|${runtimeUrl}`,
        managedPath,
        runtimeSource: runtimeUrl,
      })
    })

    it('reports an unreadable relative runtime file with its own error and records the resolved paths', () => {
      const missing = 'runtime/missing.openapi.yaml'
      const result = runOaCli([
        'drift',
        '--managed-openapi', MANAGED,
        '--runtime-openapi', missing,
        '--behavior-log', 'logs/drift.behavior.jsonl',
      ], { cwd: fixture.rootDir })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(join(root, missing))
      expect(result.stderr).not.toContain('Invalid behavior record')

      const managedPath = join(root, MANAGED)
      const runtimePath = join(root, missing)
      const [record] = readBehaviorLog('logs/drift.behavior.jsonl')
      expect(record?.components?.decision?.primarySignal).toBe('runtime-error')
      expect(record?.components?.input).toEqual({ managedPath, runtimePath })
      expect(record?.components?.target).toEqual({
        targetType: 'runtime-openapi',
        targetKey: `${managedPath}|${runtimePath}`,
        managedPath,
        runtimePath,
      })
    })
  })
})
