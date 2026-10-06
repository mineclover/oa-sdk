/**
 * `oa-gen review` path arguments and the behavior records they write.
 *
 * The command runs from a temporary project root so relative arguments resolve against it,
 * the way a user runs `oa-gen review --base contracts/v1.openapi.yaml ...` from their project.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { stringify as yamlStringify } from 'yaml'
import { runOaCli, type CliRunResult } from './e2e/helpers/cli-runner.js'
import { createWorkspaceFixture, type WorkspaceFixture } from './e2e/helpers/fixture-builder.js'

const BASE = 'contracts/base.openapi.yaml'
const HEAD = 'contracts/head.openapi.yaml'
const HEAD_BREAKING = 'contracts/head-breaking.openapi.yaml'

type ReviewReport = {
  recommendation?: string
  base?: string
  head?: string
}

type RecordedBehavior = {
  behaviorType?: string
  identityKey?: string
  status?: string
  components?: {
    input?: Record<string, unknown>
    target?: Record<string, unknown>
    decision?: { primarySignal?: string }
  }
}

function reviewSpec(): Record<string, unknown> {
  return {
    openapi: '3.2.0',
    info: { title: 'Review API', version: '1.0.0' },
    paths: {
      '/ping': {
        get: {
          operationId: 'getPing',
          summary: 'Get ping status',
          responses: { '204': { description: 'No content' } },
        },
      },
    },
  }
}

describe('oa-gen review path arguments', () => {
  let fixture: WorkspaceFixture
  /** The project root as the CLI sees it after resolving symlinks such as macOS /var -> /private/var. */
  let root: string

  beforeEach(async () => {
    fixture = await createWorkspaceFixture({
      hasGit: true,
      files: {
        [BASE]: yamlStringify(reviewSpec()),
        [HEAD]: yamlStringify(reviewSpec()),
        [HEAD_BREAKING]: yamlStringify({ ...reviewSpec(), paths: {} }),
      },
    }, 'oa-review-cli-')
    root = realpathSync(fixture.rootDir)
  })

  afterEach(async () => {
    await fixture?.cleanup()
  })

  function runReview(args: string[]): CliRunResult {
    return runOaCli(['review', ...args, '--format', 'json'], { cwd: fixture.rootDir })
  }

  function parseReport(result: CliRunResult): ReviewReport {
    expect(result.stderr).not.toContain('Invalid behavior record')
    return JSON.parse(result.stdout) as ReviewReport
  }

  function readBehaviorLog(relativePath: string): RecordedBehavior[] {
    return readFileSync(join(root, relativePath), 'utf8')
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as RecordedBehavior)
  }

  it('reviews relative --base and --head paths', () => {
    const result = runReview(['--base', BASE, '--head', HEAD, '--artifact', HEAD])
    const report = parseReport(result)

    expect(result.status).toBe(0)
    expect(report.recommendation).toBe('APPROVE')
  })

  it('requests changes for a breaking relative --head with exit code 1', () => {
    const result = runReview(['--base', BASE, '--head', HEAD_BREAKING])
    const report = parseReport(result)

    expect(result.status).toBe(1)
    expect(report.recommendation).toBe('REQUEST_CHANGES')
  })

  it('records the resolved base and head paths in both input and target (--behavior-log)', () => {
    const result = runReview([
      '--base', BASE,
      '--head', HEAD,
      '--behavior-log', 'logs/review.behavior.jsonl',
    ])
    expect(result.status).toBe(0)

    const basePath = join(root, BASE)
    const headPath = join(root, HEAD)
    const records = readBehaviorLog('logs/review.behavior.jsonl')
    expect(records).toHaveLength(1)
    expect(records[0]).toEqual(expect.objectContaining({
      behaviorType: 'review_openapi_change',
      status: 'succeeded',
      components: expect.objectContaining({
        input: { basePath, headPath },
        target: {
          targetType: 'openapi-review',
          targetKey: `${basePath}|${headPath}`,
          basePath,
          headPath,
        },
      }),
    }))
  })

  it('gives relative and absolute invocations of the same files the same target identity', () => {
    const logPath = 'logs/review.behavior.jsonl'
    const relative = runReview(['--base', BASE, '--head', HEAD, '--behavior-log', logPath])
    const absolute = runReview([
      '--base', join(root, BASE),
      '--head', join(root, HEAD),
      '--behavior-log', join(root, logPath),
    ])
    expect(relative.status).toBe(0)
    expect(absolute.status).toBe(0)

    const [fromRelative, fromAbsolute] = readBehaviorLog(logPath)
    expect(fromRelative?.identityKey).toBe(fromAbsolute?.identityKey)
    expect(fromRelative?.components?.input).toEqual(fromAbsolute?.components?.input)
    expect(fromRelative?.components?.target).toEqual(fromAbsolute?.components?.target)
  })

  it('reports an unreadable relative --head with its own error and records the resolved paths', () => {
    const missing = 'contracts/missing.openapi.yaml'
    const result = runReview([
      '--base', BASE,
      '--head', missing,
      '--behavior-log', 'logs/review.behavior.jsonl',
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(join(root, missing))
    expect(result.stderr).not.toContain('Invalid behavior record')

    const basePath = join(root, BASE)
    const headPath = join(root, missing)
    const [record] = readBehaviorLog('logs/review.behavior.jsonl')
    expect(record?.components?.decision?.primarySignal).toBe('exception')
    expect(record?.components?.input).toEqual({ basePath, headPath })
    expect(record?.components?.target).toEqual({
      targetType: 'openapi-review',
      targetKey: `${basePath}|${headPath}`,
      basePath,
      headPath,
    })
  })
})
