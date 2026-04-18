import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { stringify as stringifyYaml } from 'yaml'
import type {
  DefinitionDuplicateReviewFinding,
  DefinitionDuplicateReviewResult,
} from '../cli/lib/duplicate-review.js'

const pkgDir = resolve(__dirname, '../..')
const cliPath = resolve(pkgDir, 'dist/cli/index.js')
const tmpBase = resolve(pkgDir, '.tmp-cli-duplicate-review-test')

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpBase, `run-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

describe('oa-gen duplicate-review', () => {
  it('emits stable JSON and exits zero for informational candidates', () => {
    writeSameContentCandidates()

    const result = runCli([
      'duplicate-review',
      '--fragments',
      join(tmpDir, 'fragments'),
      '--format',
      'json',
    ])

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')

    const report = JSON.parse(result.stdout) as DefinitionDuplicateReviewResult
    expect(report.schemaVersion).toBe('oa-gen.duplicate-review.v1')
    expect(report.valid).toBe(true)
    expect(report.summary).toEqual(expect.objectContaining({
      errors: 0,
      infos: 1,
      findingCount: 1,
    }))
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]).toEqual(expect.objectContaining({
      code: 'definition-duplicate-review/same-content-hash',
      severity: 'info',
      canonicalIds: [
        'schema:public/archive/BookSnapshot',
        'schema:public/book/Book',
      ],
    }))
    expect(report.findings[0]?.sources).toEqual([
      expect.objectContaining({
        canonicalId: 'schema:public/archive/BookSnapshot',
        sourcePath: join(tmpDir, 'fragments/schema/public/archive/BookSnapshot.yaml'),
      }),
      expect.objectContaining({
        canonicalId: 'schema:public/book/Book',
        sourcePath: join(tmpDir, 'fragments/schema/public/book/Book.yaml'),
      }),
    ])
  })

  it('defaults to compact markdown for PR comments', () => {
    writeSameContentCandidates()

    const result = runCli([
      'duplicate-review',
      '--fragments',
      join(tmpDir, 'fragments'),
    ])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('## Definition Duplicate Review')
    expect(result.stdout).toContain('Summary: 1 findings, 0 diagnostics, 0 errors, 0 warnings, 1 infos.')
    expect(result.stdout).toContain('`same-content-hash`')
    expect(result.stdout).toContain('schema:public/book/Book')
    expect(result.stdout).toContain(join(tmpDir, 'fragments/schema/public/book/Book.yaml'))
    expect(result.stdout).not.toContain('### Diagnostics')
  })

  it('exits non-zero for duplicate canonical id errors', () => {
    writeFragment('schema/public/book/Book.yaml', {
      id: 'schema:public/book/Book',
      content: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
    })
    writeFragment('schema/public/book/BookDuplicate.yaml', {
      id: 'schema:public/book/Book',
      content: {
        type: 'object',
        properties: {
          duplicateId: { type: 'string' },
        },
      },
    })

    const result = runCli([
      'duplicate-review',
      '--fragments',
      join(tmpDir, 'fragments'),
      '--format',
      'json',
    ])

    expect(result.status).toBe(1)
    const report = JSON.parse(result.stdout) as DefinitionDuplicateReviewResult
    expect(report.valid).toBe(false)
    expect(report.summary.errors).toBeGreaterThan(0)
    const duplicateId = report.findings.find(isDuplicateIdFinding)
    expect(duplicateId?.sources.map(source => source.sourcePath)).toEqual([
      join(tmpDir, 'fragments/schema/public/book/Book.yaml'),
      join(tmpDir, 'fragments/schema/public/book/BookDuplicate.yaml'),
    ])
  })
})

function writeSameContentCandidates(): void {
  const content = {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string' },
    },
  }
  writeFragment('schema/public/book/Book.yaml', {
    id: 'schema:public/book/Book',
    content,
  })
  writeFragment('schema/public/archive/BookSnapshot.yaml', {
    id: 'schema:public/archive/BookSnapshot',
    content,
  })
}

function writeFragment(relativePath: string, value: unknown): void {
  writeYaml(join(tmpDir, 'fragments', relativePath), value)
}

function writeYaml(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, stringifyYaml(value), 'utf8')
}

function runCli(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: pkgDir,
    encoding: 'utf8',
    timeout: 15_000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  }
}

function isDuplicateIdFinding(
  finding: DefinitionDuplicateReviewFinding,
): boolean {
  return finding.code === 'definition-duplicate-review/duplicate-canonical-id'
}
