import { describe, expect, it } from 'vitest'
import { LocalGitAdapter } from '../infrastructure/source-adapters/local-git/local-git.adapter.js'
import { resolve } from 'node:path'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

// Uses the actual oa-sdk repo as a test fixture
const REPO_PATH = resolve(import.meta.dirname, '../../../../')
const FRAGMENTS_DIR = 'packages/schemas/src/fragments'

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
      })
      expect(entries.map(entry => entry.relativePath).sort()).toEqual([
        'main.tsp',
        'oa-sdk.typespec-bundle.json',
      ])
    } finally {
      rmSync(repoPath, { recursive: true, force: true })
    }
  })
})

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}
