/**
 * Verifies that the artifact-only source repository is ready to hand off for
 * external npm promotion. This command never publishes packages.
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname, '..')

export type ReleasePreflightOptions = {
  allowDirty: boolean
}

export type ReleasePreflightGate = {
  label: string
  command: string
  args: string[]
}

/** Full release verification runs only from a clean, committed worktree. */
export const releasePreflightGates: readonly ReleasePreflightGate[] = [
  // Documentation and policy gates load workspace package source through tsx.
  // A fresh checkout has no declaration/runtime outputs yet, so materialize
  // the Core dependency closure before any such gate.
  rootScriptGate('build:core'),
  rootScriptGate('check:docs'),
  rootScriptGate('check:package-versions'),
  rootScriptGate('check:spec-governance'),
  rootScriptGate('check:release-policy'),
  rootScriptGate('schema:validate'),
  rootScriptGate('schema:downstream-check'),
  rootScriptGate('typecheck:core'),
  rootScriptGate('test:core:ci'),
  {
    label: 'codegen smoke:pack',
    command: 'corepack',
    args: ['pnpm', '--filter', '@oa-sdk/codegen', 'run', 'smoke:pack'],
  },
]

/**
 * Draft verification deliberately excludes builds, schema materialization, and
 * tests. Those commands can rewrite generated artifacts, so they are unsafe
 * to run over a maintainer's uncommitted work.
 */
export const draftReleasePreflightGates: readonly ReleasePreflightGate[] = [
  rootScriptGate('check:docs'),
  rootScriptGate('check:package-versions'),
  rootScriptGate('check:spec-governance'),
  rootScriptGate('check:release-policy'),
]

export function main(): void {
  let options: ReleasePreflightOptions
  try {
    options = parseReleasePreflightArgs(process.argv.slice(2))
  } catch (error) {
    fail(error)
    return
  }

  console.log('Release preflight verifies the local artifact-release gate set only; it does not publish packages.')
  console.log('It does not replace required CI checks or the external npm promotion review.')

  try {
    if (options.allowDirty) {
      const before = readWorktreeStatus('before draft release gates')
      console.warn('[release-preflight] Draft mode runs read-only policy and documentation gates only; it does not build, bundle, or test generated artifacts.')
      runGates(draftReleasePreflightGates)
      assertWorktreeUnchanged(before, 'after draft release gates')
      console.log('Draft release preflight passed. Run pnpm release:preflight from a clean, committed worktree for the full release gate set.')
      return
    }

    assertCleanWorktree('before running release gates')
    runGates(releasePreflightGates)
    assertCleanWorktree('after running release gates')
    console.log('Release preflight passed. This command does not publish packages and does not replace required CI; actual npm promotion remains external.')
  } catch (error) {
    fail(error)
  }
}

export function parseReleasePreflightArgs(argv: readonly string[]): ReleasePreflightOptions {
  let allowDirty = false

  const values = argv[0] === '--' ? argv.slice(1) : argv
  for (const arg of values) {
    if (arg === '--allow-dirty') {
      if (allowDirty) throw new Error('duplicate option: --allow-dirty')
      allowDirty = true
      continue
    }

    throw new Error(`unknown option: ${arg}\nUsage: pnpm release:preflight [--allow-dirty]`)
  }

  return { allowDirty }
}

function readWorktreeStatus(phase: string): string {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assertProcessStarted(result.error, 'git status')
  if (result.status !== 0) {
    throw new Error(`could not inspect the worktree while ${phase}: ${result.stderr.trim() || 'git status failed'}`)
  }

  return result.stdout
}

function assertCleanWorktree(phase: string): void {
  const changes = readWorktreeStatus(phase).trim()

  if (!changes) {
    console.log(`[release-preflight] Worktree is clean (${phase}).`)
    return
  }

  throw new Error(
    `release preflight requires a clean worktree ${phase}. ` +
      'Use --allow-dirty only for draft verification, never for a release.\n' +
      changes,
  )
}

function assertWorktreeUnchanged(before: string, phase: string): void {
  const after = readWorktreeStatus(phase)
  if (after === before) {
    console.log(`[release-preflight] Worktree state is unchanged (${phase}).`)
    return
  }

  throw new Error(
    `draft release preflight changed the worktree ${phase}; refusing to treat it as a safe draft verification.\n` +
      after.trim(),
  )
}

function runGates(gates: readonly ReleasePreflightGate[]): void {
  for (const [index, gate] of gates.entries()) {
    console.log(`\n[release-preflight] [${index + 1}/${gates.length}] ${gate.label}`)
    const result = spawnSync(gate.command, gate.args, {
      cwd: root,
      stdio: 'inherit',
    })
    assertProcessStarted(result.error, gate.label)
    if (result.status !== 0) {
      const detail = result.signal ? ` (signal: ${result.signal})` : ''
      throw new Error(`release gate failed: ${gate.label}${detail}`)
    }
  }
}

function rootScriptGate(script: string): ReleasePreflightGate {
  return {
    label: script,
    command: 'corepack',
    args: ['pnpm', 'run', script],
  }
}

function assertProcessStarted(error: Error | undefined, command: string): void {
  if (error) throw new Error(`could not start ${command}: ${error.message}`)
}

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Release preflight failed: ${message}`)
  process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
