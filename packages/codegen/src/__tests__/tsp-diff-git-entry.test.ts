/**
 * `oa-gen tsp diff` with git references: which entry point each side compiles.
 *
 * Regression: a path-less git ref on `--head` (`--base base --head HEAD`) used to re-read the entry point
 * extracted for `--base` (its absolute temp path was mapped back through the repository root and clamped at
 * `/`), so the diff compared base with itself and `--fail-on-breaking` always passed.
 *
 * Each test builds its own git repository directly under `os.tmpdir()`, the layout where that mapping landed
 * on the base extraction directory.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import { execFileSync } from 'node:child_process'
import { diffTypeSpecPrograms } from '../cli/lib/typespec-ast-diff.js'
import {
  resolveTypeSpecDiffSources,
  resolveTypeSpecProgramRef,
  type ResolvedTypeSpecDiffSources,
} from '../cli/lib/typespec-ref-resolver.js'
import { runOaCli } from './e2e/helpers/cli-runner.js'
import { SUBPROCESS_TEST_BUDGET_MS } from './helpers/subprocess-budget.js'

const BASE_SPEC = 'model User { id: string; }\n'
/** Adds a required property: `required-property-added`, a breaking change. */
const BREAKING_SPEC = 'model User { id: string; email: string; }\n'
/** Adds an optional property: `property-added`, non-breaking. */
const COMPATIBLE_SPEC = 'model User { id: string; nickname?: string; }\n'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: SUBPROCESS_TEST_BUDGET_MS }).trim()
}

describe('tsp diff: entry points of git references', () => {
  let repo: string
  const opened: ResolvedTypeSpecDiffSources[] = []

  async function writeFiles(files: Record<string, string>): Promise<void> {
    for (const [relPath, content] of Object.entries(files)) {
      const filePath = path.join(repo, relPath)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, content, 'utf8')
    }
  }

  /** Writes `files`, commits everything and returns the commit SHA. */
  async function commit(files: Record<string, string>, message: string): Promise<string> {
    await writeFiles(files)
    git(repo, ['add', '-A'])
    git(repo, ['commit', '--quiet', '--no-verify', '--no-gpg-sign', '-m', message])
    return git(repo, ['rev-parse', 'HEAD'])
  }

  async function resolvePair(baseRef: string, headRef: string) {
    const sources = await resolveTypeSpecDiffSources(baseRef, headRef, { projectRoot: repo, cwd: repo })
    opened.push(sources)
    const result = diffTypeSpecPrograms(sources.base.program, sources.head.program, { baseRef, headRef })
    return { sources, result }
  }

  function breakingCodes(result: ReturnType<typeof diffTypeSpecPrograms>): string[] {
    return result.breakingChanges.map(change => `${change.code} ${change.target}`)
  }

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'tsp-diff-git-'))
    git(repo, ['init', '--quiet', '-b', 'main'])
    git(repo, ['config', 'user.email', 'tsp-diff@example.test'])
    git(repo, ['config', 'user.name', 'tsp diff test'])
  })

  afterEach(async () => {
    for (const sources of opened.splice(0)) await sources.cleanup()
    await fs.rm(repo, { recursive: true, force: true })
  })

  describe('CLI exit codes', () => {
    it('reports a breaking change between two commits when --head is a git ref without a path', async () => {
      await commit({ 'main.tsp': BASE_SPEC }, 'base')
      git(repo, ['tag', 'base'])
      await commit({ 'main.tsp': BREAKING_SPEC }, 'require email')

      const result = runOaCli(['tsp', 'diff', '--base', 'base', '--head', 'HEAD', '--fail-on-breaking'], { cwd: repo })

      expect(result.stderr).not.toContain('compares that commit with itself')
      expect(result.stdout).not.toContain('No semantic changes detected')
      expect(result.stdout).toContain('`required-property-added` `User.email`')
      expect(result.status).toBe(1)
    })

    it('reads a relative --head path from the invocation directory and uses it as the entry of a path-less --base ref', async () => {
      await commit({ 'api/main.tsp': BASE_SPEC, 'examples/main.tsp': 'model Sample { id: string; }\n' }, 'base')
      git(repo, ['tag', 'base'])
      await writeFiles({ 'api/main.tsp': BREAKING_SPEC })

      const result = runOaCli(
        ['tsp', 'diff', '--base', 'base', '--head', './main.tsp', '--format', 'json', '--fail-on-breaking'],
        { cwd: path.join(repo, 'api') },
      )

      expect(result.status).toBe(1)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.summary).toEqual({ totalChanges: 1, breakingCount: 1, nonBreakingCount: 0 })
      expect(parsed.breakingChanges[0].code).toBe('required-property-added')
    })

    it('says so on stderr when --base and --head are the same commit, and keeps JSON stdout parseable', async () => {
      await commit({ 'main.tsp': BASE_SPEC }, 'base')
      await writeFiles({ 'main.tsp': BREAKING_SPEC })

      const sameCommit = runOaCli(
        ['tsp', 'diff', '--base', 'HEAD', '--head', 'HEAD', '--format', 'json', '--fail-on-breaking'],
        { cwd: repo },
      )
      expect(sameCommit.status).toBe(0)
      expect(JSON.parse(sameCommit.stdout).summary.totalChanges).toBe(0)
      expect(sameCommit.stderr).toContain('--base and --head both resolve to commit')
      expect(sameCommit.stderr).toContain('compares that commit with itself')
      expect(sameCommit.stderr).toContain('--head main.tsp')

      const workingTree = runOaCli(
        ['tsp', 'diff', '--base', 'HEAD', '--head', 'main.tsp', '--fail-on-breaking'],
        { cwd: repo },
      )
      expect(workingTree.status).toBe(1)
      expect(workingTree.stdout).toContain('`required-property-added` `User.email`')
      expect(workingTree.stderr).not.toContain('compares that commit with itself')
    })

    it('fails with a request for <ref>:<path> when a path-less ref has several main.tsp files', async () => {
      await commit({ 'a/main.tsp': BASE_SPEC, 'b/main.tsp': BASE_SPEC }, 'base')
      git(repo, ['tag', 'base'])
      await commit({ 'a/main.tsp': BREAKING_SPEC }, 'require email')

      const result = runOaCli(['tsp', 'diff', '--base', 'base', '--head', 'HEAD', '--fail-on-breaking'], { cwd: repo })

      expect(result.status).toBe(1)
      expect(result.stdout).not.toContain('No semantic changes detected')
      expect(result.stderr).toContain('found 2 main.tsp files (a/main.tsp, b/main.tsp)')
      expect(result.stderr).toContain('Pass the entry point explicitly as base:<path>')
    })
  })

  describe('resolveTypeSpecDiffSources', () => {
    it('compiles a path-less --head ref from its own commit at the base entry path', async () => {
      await commit({ 'spec/main.tsp': BASE_SPEC }, 'base')
      git(repo, ['tag', 'base'])
      const headCommit = await commit({ 'spec/main.tsp': BREAKING_SPEC }, 'require email')

      const { sources, result } = await resolvePair('base', 'HEAD')

      expect(sources.base.repoRelativeEntry).toBe('spec/main.tsp')
      expect(sources.head.repoRelativeEntry).toBe('spec/main.tsp')
      expect(sources.head.source).toEqual({ kind: 'git', rev: 'HEAD', commit: headCommit, entry: 'spec/main.tsp' })
      expect(path.dirname(path.dirname(sources.head.entrypoint)))
        .not.toBe(path.dirname(path.dirname(sources.base.entrypoint)))
      expect(sources.sameSourceNotice).toBeUndefined()
      expect(breakingCodes(result)).toEqual(['required-property-added User.email'])
    })

    it.each([
      ['<ref>:<path> on both sides', 'base:spec/main.tsp', 'HEAD:spec/main.tsp'],
      ['<ref>:<path> base and a path-less head', 'base:spec/main.tsp', 'HEAD'],
      ['a path-less base and <ref>:<path> head', 'base', 'HEAD:spec/main.tsp'],
    ])('detects the breaking change with %s', async (_label, baseRef, headRef) => {
      await commit({ 'spec/main.tsp': BASE_SPEC, 'spec/other/main.tsp': 'model Other { id: string; }\n' }, 'base')
      git(repo, ['tag', 'base'])
      await commit({ 'spec/main.tsp': BREAKING_SPEC }, 'require email')

      const { sources, result } = await resolvePair(baseRef, headRef)

      expect(sources.base.repoRelativeEntry).toBe('spec/main.tsp')
      expect(sources.head.repoRelativeEntry).toBe('spec/main.tsp')
      expect(breakingCodes(result)).toEqual(['required-property-added User.email'])
    })

    it('compares a commit against an uncommitted working-tree file', async () => {
      await commit({ 'main.tsp': BASE_SPEC }, 'base')
      await writeFiles({ 'main.tsp': COMPATIBLE_SPEC })

      const { sources, result } = await resolvePair('HEAD', path.join(repo, 'main.tsp'))

      expect(sources.base.source.kind).toBe('git')
      expect(sources.head.source.kind).toBe('path')
      expect(sources.sameSourceNotice).toBeUndefined()
      expect(result.breakingChanges).toEqual([])
      expect(result.nonBreakingChanges.map(change => `${change.code} ${change.target}`))
        .toEqual(['property-added User.nickname'])
    })

    it('uses a working-tree directory on --base as the entry path of a path-less --head ref', async () => {
      await commit({ 'spec/main.tsp': BREAKING_SPEC }, 'require email')
      await writeFiles({ 'spec/main.tsp': BASE_SPEC })

      const { sources, result } = await resolvePair(path.join(repo, 'spec'), 'HEAD')

      expect(sources.base.entrypoint).toBe(path.join(repo, 'spec', 'main.tsp'))
      expect(sources.head.repoRelativeEntry).toBe('spec/main.tsp')
      expect(breakingCodes(result)).toEqual(['required-property-added User.email'])
    })

    it('rejects a path-less ref whose commit lacks the other side\'s entry path instead of guessing', async () => {
      await commit({ 'old/main.tsp': BASE_SPEC }, 'base')
      git(repo, ['tag', 'base'])
      await fs.rm(path.join(repo, 'old'), { recursive: true })
      await commit({ 'new/main.tsp': BREAKING_SPEC }, 'move spec')

      await expect(resolvePair('base', 'HEAD')).rejects.toThrow(
        /"old\/main\.tsp" \(the --base entry point\) does not exist in commit [0-9a-f]{12}\. Pass the entry point explicitly as HEAD:<path>\./,
      )
      // The same holds in the other direction: the head path is not looked for elsewhere in the base commit.
      await expect(resolvePair('base', 'HEAD:new/main.tsp')).rejects.toThrow(
        /"new\/main\.tsp" \(the --head entry point\) does not exist in commit [0-9a-f]{12}\. Pass the entry point explicitly as base:<path>\./,
      )

      const { result } = await resolvePair('base:old/main.tsp', 'HEAD:new/main.tsp')
      expect(breakingCodes(result)).toEqual(['required-property-added User.email'])
    })

    it('resolves an ambiguous path-less ref once the other side names the entry point', async () => {
      await commit({ 'a/main.tsp': BASE_SPEC, 'b/main.tsp': BASE_SPEC }, 'base')
      git(repo, ['tag', 'base'])
      await commit({ 'b/main.tsp': BREAKING_SPEC }, 'require email')

      await expect(resolvePair('base', 'HEAD')).rejects.toThrow(
        /found 2 main\.tsp files \(a\/main\.tsp, b\/main\.tsp\)\. Pass the entry point explicitly as base:<path>\./,
      )

      const { sources, result } = await resolvePair('base:b/main.tsp', 'HEAD')
      expect(sources.head.repoRelativeEntry).toBe('b/main.tsp')
      expect(breakingCodes(result)).toEqual(['required-property-added User.email'])
    })

    it('flags base and head that resolve to the same commit and entry point', async () => {
      await commit({ 'main.tsp': BASE_SPEC }, 'base')
      git(repo, ['tag', 'base'])

      const sameCommit = await resolvePair('base', 'HEAD')
      expect(sameCommit.sources.sameSourceNotice).toMatch(/both resolve to commit [0-9a-f]{12} \(main\.tsp\)/)

      const sameFile = await resolvePair(path.join(repo, 'main.tsp'), repo)
      expect(sameFile.sources.sameSourceNotice).toContain('compares it with itself')

      const otherCommit = await commit({ 'main.tsp': COMPATIBLE_SPEC }, 'add nickname')
      const different = await resolvePair('base', otherCommit)
      expect(different.sources.sameSourceNotice).toBeUndefined()
    })

    it('rejects a <ref>:<path> that leaves the repository', async () => {
      await commit({ 'main.tsp': BASE_SPEC }, 'base')

      await expect(resolvePair('HEAD:../main.tsp', 'HEAD')).rejects.toThrow(
        /Invalid TypeSpec reference "HEAD:\.\.\/main\.tsp": "\.\.\/main\.tsp" must be a path inside the repository/,
      )
    })

    it('reports a <ref>:<path> that does not exist in the commit', async () => {
      await commit({ 'main.tsp': BASE_SPEC }, 'base')

      await expect(resolveTypeSpecProgramRef('HEAD:missing.tsp', repo)).rejects.toThrow(
        /TypeSpec entry point "missing\.tsp" does not exist in git reference "HEAD"/,
      )
    })
  })
})
