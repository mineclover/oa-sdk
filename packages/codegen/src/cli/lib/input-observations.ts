/**
 * File-system observations a generation depends on, reported by the readers
 * that made them (spec loader, TypeSpec compiler host, module loader) and
 * re-checked by `--incremental` before an output is reused.
 */
import { realpathSync, statSync } from 'node:fs'
import type { GenerationTargetInputKind } from '../../generation-target-store.js'

/** What a path named when it was probed, following symlinks. */
export type FileEntryKind = 'file' | 'directory' | 'other' | 'absent' | 'unreadable'

/** Evidence of the content a reader consumed. */
export type ConsumedContent =
  /** Decoded text the reader parsed (UTF-8, a byte order mark may have been dropped). */
  | { text: string }
  /** sha256 hex digest of the exact bytes the reader consumed. */
  | { sha256: string }
  /** The reader found no file at the path. */
  | { absent: true }

/**
 * One observation, as the reader reported it:
 *   - `content` of a file: the record step stamps the file and uses
 *     `consumed` (when given) to check that the stamp is what was read;
 *   - `entry` / `realpath` of a path: the value the reader observed;
 *   - `unverified`: the reader could not report what it observed (the reason).
 */
export type InputObservation =
  | { kind: 'content'; path: string; consumed?: ConsumedContent }
  | { kind: 'entry'; path: string; value: FileEntryKind }
  | { kind: 'realpath'; path: string; value: string | null }
  | { kind: GenerationTargetInputKind; path: string; unverified: string }

/** What `path` names now, the way a module lookup probes it (`stat`, following symlinks). */
export function observeEntry(path: string): FileEntryKind {
  try {
    const stats = statSync(path)
    return stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : 'other'
  } catch (error) {
    return isMissingPathError(error) ? 'absent' : 'unreadable'
  }
}

/**
 * `path` with every symlink resolved; null when nothing exists at the path,
 * undefined when it cannot be resolved for another reason (permissions, a
 * symlink loop). Uses the JavaScript `realpath` that the TypeSpec compiler
 * host and Node's module resolver use, so values compare equal to theirs.
 */
export function observeRealpath(path: string): string | null | undefined {
  try {
    return realpathSync(path)
  } catch (error) {
    return isMissingPathError(error) ? null : undefined
  }
}

/** ENOENT / ENOTDIR: nothing exists at the path. */
export function isMissingPathError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}
