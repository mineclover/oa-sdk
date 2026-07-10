import { describe, expect, it, vi } from 'vitest'
import { resolveSpecLensTypeSpecSourceReadBudget } from '@oa-sdk/codegen/spec-lens'
import { LocalGitAdapter } from '../infrastructure/source-adapters/local-git/local-git.adapter.js'
import type { GetFileEntriesOptions } from '../application/ports/spec-source.port.js'
import { resolve } from 'node:path'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

// Uses the actual oa-sdk repo as a test fixture
const REPO_PATH = resolve(import.meta.dirname, '../../../../')
const FRAGMENTS_DIR = 'packages/schemas/src/fragments'
const TYPESPEC_READ_BUDGET = resolveSpecLensTypeSpecSourceReadBudget()

describe('LocalGitAdapter', () => {
  const adapter = new LocalGitAdapter({ repoPath: REPO_PATH })

  it('lists revisions that touched the fragments dir', async () => {
    const revisions = await adapter.listRevisions({ fragmentsDir: FRAGMENTS_DIR, limit: 5 })
    expect(revisions.length).toBeGreaterThan(0)
    expect(revisions.length).toBeLessThanOrEqual(5)
    for (const rev of revisions) {
      expect(rev.id).toMatch(/^[0-9a-f]{40}$/)
      expect(rev.shortId).toHaveLength(7)
      expect(typeof rev.timestamp).toBe('number')
      expect(rev.source).toBe('local-git')
    }
  })

  it('revisions are returned newest first', async () => {
    const revisions = await adapter.listRevisions({ fragmentsDir: FRAGMENTS_DIR, limit: 5 })
    for (let i = 0; i < revisions.length - 1; i++) {
      expect(revisions[i]!.timestamp).toBeGreaterThanOrEqual(revisions[i + 1]!.timestamp)
    }
  })

  it('fetches file entries at a revision', async () => {
    const revisions = await adapter.listRevisions({ fragmentsDir: FRAGMENTS_DIR, limit: 1 })
    const rev = revisions[0]!
    const entries = await adapter.getFileEntries({ revision: rev, fragmentsDir: FRAGMENTS_DIR })

    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry.relativePath).not.toContain(FRAGMENTS_DIR)  // relative, not absolute
      expect(entry.content.length).toBeGreaterThan(0)
      expect(entry.contentHash).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('contentHash is sha256 of content', async () => {
    const { createHash } = await import('node:crypto')
    const revisions = await adapter.listRevisions({ fragmentsDir: FRAGMENTS_DIR, limit: 1 })
    const entries = await adapter.getFileEntries({ revision: revisions[0]!, fragmentsDir: FRAGMENTS_DIR })

    for (const entry of entries.slice(0, 3)) {
      const expected = createHash('sha256').update(entry.content).digest('hex')
      expect(entry.contentHash).toBe(expected)
    }
  })

  it('returns relative paths without fragmentsDir prefix', async () => {
    const revisions = await adapter.listRevisions({ fragmentsDir: FRAGMENTS_DIR, limit: 2 })
    if (revisions.length === 0) return

    const entries = await adapter.getFileEntries({ revision: revisions[0]!, fragmentsDir: FRAGMENTS_DIR })
    for (const entry of entries) {
      expect(entry.relativePath.startsWith(FRAGMENTS_DIR)).toBe(false)
    }
  })

  it('observes TypeSpec bundle-only revisions and includes .tsp sources', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'spec-lens-typespec-source-'))
    try {
      git(repoPath, ['init', '-b', 'main'])
      git(repoPath, ['config', 'user.email', 'spec-lens@example.test'])
      git(repoPath, ['config', 'user.name', 'Spec Lens Test'])
      const bundleDir = join(repoPath, 'packages/schemas/typespec')
      mkdirSync(bundleDir, { recursive: true })
      writeFileSync(join(bundleDir, 'main.tsp'), '@service(#{ title: "v1" }) namespace Test;\n')
      writeFileSync(join(bundleDir, 'oa-sdk.typespec-bundle.json'), '{"schemaVersion":"oa-sdk.typespec-bundle.v1","entrypoint":"main.tsp"}\n')
      writeFileSync(join(bundleDir, 'notes.md'), 'not a bundle input\n')
      git(repoPath, ['add', '.'])
      git(repoPath, ['commit', '-m', 'add TypeSpec bundle'])

      writeFileSync(join(bundleDir, 'main.tsp'), '@service(#{ title: "v2" }) namespace Test;\n')
      git(repoPath, ['add', 'packages/schemas/typespec/main.tsp'])
      git(repoPath, ['commit', '-m', 'change TypeSpec only'])

      const typespec = new LocalGitAdapter({ repoPath })
      expect(await typespec.resolveObservationIdentity()).toEqual({
        adapterKind: 'local-git',
        repository: `file://${realpathSync(repoPath)}`,
        ref: 'main',
      })
      const revisions = await typespec.listRevisions({
        sourceRoot: 'packages/schemas/typespec',
        sourceKind: 'typespec-bundle',
      })
      expect(revisions.map(revision => revision.message)).toEqual([
        'change TypeSpec only',
        'add TypeSpec bundle',
      ])

      const entries = await typespec.getFileEntries({
        revision: revisions[0]!,
        sourceRoot: 'packages/schemas/typespec',
        sourceKind: 'typespec-bundle',
        readBudget: TYPESPEC_READ_BUDGET,
      })
      expect(entries.map(entry => entry.relativePath).sort()).toEqual([
        'main.tsp',
        'oa-sdk.typespec-bundle.json',
      ])
    } finally {
      rmSync(repoPath, { recursive: true, force: true })
    }
  })

  it('pins detached HEAD to an explicit commit identity across later checkout movement', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'spec-lens-detached-source-'))
    try {
      git(repoPath, ['init', '-b', 'main'])
      git(repoPath, ['config', 'user.email', 'spec-lens@example.test'])
      git(repoPath, ['config', 'user.name', 'Spec Lens Test'])
      mkdirSync(join(repoPath, 'fragments'), { recursive: true })
      writeFileSync(join(repoPath, 'fragments', 'api.yaml'), 'version: 1\n')
      git(repoPath, ['add', '.'])
      git(repoPath, ['commit', '-m', 'first'])
      const first = gitOutput(repoPath, ['rev-parse', 'HEAD'])
      writeFileSync(join(repoPath, 'fragments', 'api.yaml'), 'version: 2\n')
      git(repoPath, ['add', '.'])
      git(repoPath, ['commit', '-m', 'second'])

      git(repoPath, ['checkout', '--detach', first])
      const detached = new LocalGitAdapter({ repoPath })
      expect(await detached.resolveObservationIdentity()).toMatchObject({
        adapterKind: 'local-git',
        ref: `detached:${first}`,
      })

      git(repoPath, ['checkout', 'main'])
      const revisions = await detached.listRevisions({ sourceRoot: 'fragments' })
      expect(revisions.map(revision => revision.id)).toEqual([first])
      expect(revisions[0]?.sourceRef).toBe(`detached:${first}`)
    } finally {
      rmSync(repoPath, { recursive: true, force: true })
    }
  })

  it('requires the canonical TypeSpec read budget before accessing git', async () => {
    const typespec = new LocalGitAdapter({ repoPath: REPO_PATH })
    const gitSpy = vi.spyOn(typespec, 'git')

    await expect(typespec.getFileEntries({
      revision: fakeRevision(),
      sourceRoot: 'bundle',
      sourceKind: 'typespec-bundle',
    } as unknown as GetFileEntriesOptions)).rejects.toThrow(
      'TypeSpec source reads require an explicit readBudget',
    )
    expect(gitSpy).not.toHaveBeenCalled()
  })

  it.each([
    {
      constraint: 'file count',
      sizes: Array.from({ length: TYPESPEC_READ_BUDGET.maxFiles + 1 }, () => 0),
      expectedError: 'file count',
    },
    {
      constraint: 'per-file bytes',
      sizes: [TYPESPEC_READ_BUDGET.maxFileBytes + 1],
      expectedError: `exceeds ${TYPESPEC_READ_BUDGET.maxFileBytes} bytes`,
    },
    {
      constraint: 'aggregate bytes',
      sizes: Array.from(
        { length: Math.floor(TYPESPEC_READ_BUDGET.maxTotalBytes / TYPESPEC_READ_BUDGET.maxFileBytes) + 1 },
        () => TYPESPEC_READ_BUDGET.maxFileBytes,
      ),
      expectedError: 'aggregate bytes exceed limit',
    },
  ])('prevalidates TypeSpec $constraint metadata before any git show', async ({ sizes, expectedError }) => {
    const typespec = new LocalGitAdapter({ repoPath: REPO_PATH })
    const gitSpy = vi.spyOn(typespec, 'git').mockImplementation(async args => {
      if (args[0] === 'ls-tree') return sizedTreeOutput(sizes)
      throw new Error('git show must not run before source budget validation')
    })

    await expect(typespec.getFileEntries({
      revision: fakeRevision(),
      sourceRoot: 'bundle',
      sourceKind: 'typespec-bundle',
      readBudget: TYPESPEC_READ_BUDGET,
    })).rejects.toThrow(expectedError)
    expect(gitSpy.mock.calls.filter(([args]) => args[0] === 'show')).toHaveLength(0)
    expect(gitSpy.mock.calls[0]?.[1]).toBe(
      Math.min(TYPESPEC_READ_BUDGET.maxTotalBytes, 4 * 1024 * 1024),
    )
  })

  it('fails closed when a TypeSpec blob is missing numeric ls-tree size metadata', async () => {
    const typespec = new LocalGitAdapter({ repoPath: REPO_PATH })
    const objectId = 'b'.repeat(40)
    const gitSpy = vi.spyOn(typespec, 'git').mockImplementation(async args => {
      if (args[0] === 'ls-tree') {
        return `100644 blob ${objectId} -\tbundle/main.tsp\0`
      }
      throw new Error('git show must not run for invalid metadata')
    })

    await expect(typespec.getFileEntries({
      revision: fakeRevision(),
      sourceRoot: 'bundle',
      sourceKind: 'typespec-bundle',
      readBudget: TYPESPEC_READ_BUDGET,
    })).rejects.toThrow('missing or invalid blob size')
    expect(gitSpy.mock.calls.filter(([args]) => args[0] === 'show')).toHaveLength(0)
  })

  it('bounds concurrent TypeSpec git show reads and their output buffers', async () => {
    const typespec = new LocalGitAdapter({ repoPath: REPO_PATH })
    const fileCount = TYPESPEC_READ_BUDGET.maxConcurrency + 3
    let activeReads = 0
    let maxActiveReads = 0
    const gitSpy = vi.spyOn(typespec, 'git').mockImplementation(async args => {
      if (args[0] === 'ls-tree') {
        return sizedTreeOutput(Array.from({ length: fileCount }, () => 1))
      }
      if (args[0] !== 'show') throw new Error(`unexpected git operation: ${String(args[0])}`)
      activeReads += 1
      maxActiveReads = Math.max(maxActiveReads, activeReads)
      await new Promise(resolveDelay => setTimeout(resolveDelay, 10))
      activeReads -= 1
      return 'x'
    })

    const entries = await typespec.getFileEntries({
      revision: fakeRevision(),
      sourceRoot: 'bundle',
      sourceKind: 'typespec-bundle',
      readBudget: TYPESPEC_READ_BUDGET,
    })

    expect(entries).toHaveLength(fileCount)
    expect(maxActiveReads).toBe(TYPESPEC_READ_BUDGET.maxConcurrency)
    const showCalls = gitSpy.mock.calls.filter(([args]) => args[0] === 'show')
    expect(showCalls).toHaveLength(fileCount)
    for (const [, maxBuffer] of showCalls) {
      expect(maxBuffer).toBeGreaterThan(TYPESPEC_READ_BUDGET.maxFileBytes)
      expect(maxBuffer).toBeLessThanOrEqual(TYPESPEC_READ_BUDGET.maxFileBytes + 64 * 1024)
    }
  })

  it('rejects the whole TypeSpec revision when any git show fails', async () => {
    const typespec = new LocalGitAdapter({ repoPath: REPO_PATH })
    vi.spyOn(typespec, 'git').mockImplementation(async args => {
      if (args[0] === 'ls-tree') return sizedTreeOutput([1, 1])
      if (args[1]?.endsWith('file-1.tsp')) throw new Error('simulated blob read failure')
      return 'x'
    })

    await expect(typespec.getFileEntries({
      revision: fakeRevision(),
      sourceRoot: 'bundle',
      sourceKind: 'typespec-bundle',
      readBudget: TYPESPEC_READ_BUDGET,
    })).rejects.toThrow('simulated blob read failure')
  })
})

function fakeRevision() {
  return {
    id: 'a'.repeat(40),
    shortId: 'aaaaaaa',
    timestamp: 0,
    message: 'fixture revision',
    source: 'local-git' as const,
  }
}

function sizedTreeOutput(sizes: readonly number[]): string {
  const objectId = 'b'.repeat(40)
  return sizes
    .map((size, index) => `100644 blob ${objectId} ${size}\tbundle/file-${index}.tsp\0`)
    .join('')
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function gitOutput(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}
