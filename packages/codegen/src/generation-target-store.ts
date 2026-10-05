/**
 * Persistent record of one generated artifact ("generation target"), used by
 * `oa-gen ... --incremental` to decide whether the artifact can be reused.
 *
 * Freshness is decided per target from the target's own recorded inputs,
 * never from the shared workspace `files` table: that table is advanced by
 * whichever command ran last, so a file shared by two targets would look
 * unchanged to the second target after the first one regenerated.
 */

/**
 * What an input record observed about its path:
 *   - `content`: the file's bytes, as a sha256 hex digest; `null` = no regular
 *     file at the path;
 *   - `entry`: what the path names, following symlinks (`file`, `directory`,
 *     `other`, `absent`, `unreadable`), as a module lookup probes it;
 *   - `realpath`: the path with every symlink resolved; `null` = unresolvable.
 */
export type GenerationTargetInputKind = 'content' | 'entry' | 'realpath'

/**
 * One observation of the file system that generation depended on, as
 * generation made it:
 *   - `value`: the observed value for the record's kind;
 *   - `unverified`: why the run could not establish what generation observed
 *     (for example, the file may have changed while generation read it). It
 *     never matches, so the next run regenerates and records it again.
 */
export type GenerationTargetInputRecord =
  | { kind: GenerationTargetInputKind; path: string; value: string | null }
  | { kind: GenerationTargetInputKind; path: string; unverified: string }

export type GenerationTargetOutputRecord =
  | { kind: 'file'; filePath: string; contentHash: string }
  /** stdout output is replayed from `content` when the target is reused. */
  | { kind: 'stdout'; contentHash: string; content: string }

export type GenerationTargetRecord = {
  /** Identity: command + entry + output destination. */
  targetKey: string
  command: string
  /** Hash of the normalized generation options. */
  optionsHash: string
  /** Hash of the generator identity (package versions, record format). */
  generatorHash: string
  inputs: GenerationTargetInputRecord[]
  output: GenerationTargetOutputRecord
  /** Non-fatal messages (warnings) emitted while generating; replayed on reuse. */
  messages: string[]
  lastRun?: string
}

export interface GenerationTargetStore {
  getGenerationTarget(targetKey: string): GenerationTargetRecord | undefined
  replaceGenerationTarget(record: GenerationTargetRecord): void
  deleteGenerationTarget(targetKey: string): void
}

export const GENERATION_TARGET_INPUT_KINDS: readonly GenerationTargetInputKind[] = ['content', 'entry', 'realpath']

export function isGenerationTargetStore(value: unknown): value is GenerationTargetStore {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Record<keyof GenerationTargetStore, unknown>>
  return typeof candidate.getGenerationTarget === 'function'
    && typeof candidate.replaceGenerationTarget === 'function'
    && typeof candidate.deleteGenerationTarget === 'function'
}
