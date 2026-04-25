import { describe, expect, it } from 'vitest'
import { LocalGitAdapter } from '../infrastructure/source-adapters/local-git/local-git.adapter.js'
import { resolve } from 'node:path'

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

  it('returns changed files between two revisions', async () => {
    const revisions = await adapter.listRevisions({ fragmentsDir: FRAGMENTS_DIR, limit: 5 })
    if (revisions.length < 2) return  // not enough history

    const head = revisions[0]!
    const base = revisions[revisions.length - 1]!
    const changed = await adapter.getChangedFiles({
      baseRevision: base,
      headRevision: head,
      fragmentsDir: FRAGMENTS_DIR,
    })

    // relativePaths only (no prefix)
    for (const path of changed) {
      expect(path.startsWith(FRAGMENTS_DIR)).toBe(false)
      expect(path.endsWith('.yaml') || path.endsWith('.yml') || path.endsWith('.json')).toBe(true)
    }
  })
})
