/**
 * Byte-exact snapshots of a directory tree, for checks that run commands which
 * write into a directory the check itself must leave as it found it.
 */

import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

type SnapshotEntry =
  | { kind: 'directory' }
  | { kind: 'file'; content: Buffer; mode: number }
  | { kind: 'symlink'; target: string }

/** Every entry below a directory, keyed by its `/`-separated path relative to that directory. */
export type DirectorySnapshot = ReadonlyMap<string, SnapshotEntry>

/** Reads every directory, file (content and mode) and symbolic link below `directory`. */
export function snapshotDirectory(directory: string): DirectorySnapshot {
  const entries = new Map<string, SnapshotEntry>()
  const visit = (relativePath: string): void => {
    for (const name of readdirSync(join(directory, relativePath)).sort()) {
      const entryPath = relativePath === '' ? name : `${relativePath}/${name}`
      const absolutePath = join(directory, entryPath)
      const stats = lstatSync(absolutePath)
      if (stats.isSymbolicLink()) {
        entries.set(entryPath, { kind: 'symlink', target: readlinkSync(absolutePath) })
      } else if (stats.isDirectory()) {
        entries.set(entryPath, { kind: 'directory' })
        visit(entryPath)
      } else if (stats.isFile()) {
        entries.set(entryPath, { kind: 'file', content: readFileSync(absolutePath), mode: stats.mode & 0o7777 })
      }
    }
  }
  visit('')
  return entries
}

/**
 * Paths below `directory` whose current entry differs from `snapshot`: added,
 * removed, or changed in kind, content, mode or link target. Empty when the
 * tree is byte-identical to the snapshot.
 */
export function directorySnapshotDifferences(directory: string, snapshot: DirectorySnapshot): string[] {
  const current = snapshotDirectory(directory)
  const paths = new Set([...snapshot.keys(), ...current.keys()])
  return [...paths].filter(path => !sameEntry(snapshot.get(path), current.get(path))).sort()
}

/**
 * Puts the tree below `directory` back to `snapshot`: removes what was added,
 * recreates what was removed, and rewrites what changed. Entries that did not
 * change are not touched.
 */
export function restoreDirectorySnapshot(directory: string, snapshot: DirectorySnapshot): void {
  const current = snapshotDirectory(directory)
  // Remove added or changed-kind entries, deepest first, so a directory is empty when it goes.
  for (const [path, entry] of [...current].sort(([left], [right]) => right.localeCompare(left))) {
    const expected = snapshot.get(path)
    if (expected === undefined || expected.kind !== entry.kind || (entry.kind === 'symlink' && !sameEntry(expected, entry))) {
      rmSync(join(directory, path), { recursive: true, force: true })
    }
  }
  for (const [path, entry] of [...snapshot].sort(([left], [right]) => left.localeCompare(right))) {
    const absolutePath = join(directory, path)
    if (entry.kind === 'directory') {
      mkdirSync(absolutePath, { recursive: true })
      continue
    }
    if (sameEntry(entry, readEntry(absolutePath))) continue
    mkdirSync(dirname(absolutePath), { recursive: true })
    if (entry.kind === 'symlink') {
      symlinkSync(entry.target, absolutePath)
    } else {
      writeFileSync(absolutePath, entry.content)
      chmodSync(absolutePath, entry.mode)
    }
  }
}

/**
 * Runs `action`, then restores the tree below `directory` to what it was
 * before, whether `action` succeeded or not, and fails unless the tree is
 * byte-identical again.
 */
export async function preservingDirectory<T>(directory: string, action: () => Promise<T>): Promise<T> {
  const snapshot = snapshotDirectory(directory)
  let outcome: { ok: true; value: T } | { ok: false; error: unknown }
  try {
    outcome = { ok: true, value: await action() }
  } catch (error) {
    outcome = { ok: false, error }
  }
  restoreDirectorySnapshot(directory, snapshot)
  const differences = directorySnapshotDifferences(directory, snapshot)
  if (differences.length > 0) {
    const error = new Error(`could not restore ${directory}; these paths still differ: ${differences.join(', ')}`)
    throw outcome.ok ? error : new AggregateError([outcome.error, error], error.message)
  }
  if (!outcome.ok) throw outcome.error
  return outcome.value
}

function readEntry(path: string): SnapshotEntry | undefined {
  let stats
  try {
    stats = lstatSync(path)
  } catch {
    return undefined
  }
  if (stats.isSymbolicLink()) return { kind: 'symlink', target: readlinkSync(path) }
  if (stats.isDirectory()) return { kind: 'directory' }
  return { kind: 'file', content: readFileSync(path), mode: stats.mode & 0o7777 }
}

function sameEntry(left: SnapshotEntry | undefined, right: SnapshotEntry | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  if (left.kind === 'directory' || right.kind === 'directory') return left.kind === right.kind
  if (left.kind === 'symlink' || right.kind === 'symlink') {
    return left.kind === 'symlink' && right.kind === 'symlink' && left.target === right.target
  }
  return left.mode === right.mode && left.content.equals(right.content)
}
