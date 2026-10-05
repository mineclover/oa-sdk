/**
 * Persistent record of one generated artifact ("generation target"), used by
 * `oa-gen ... --incremental` to decide whether the artifact can be reused.
 *
 * Freshness is decided per target from the target's own recorded input stamps,
 * never from the shared workspace `files` table: that table is advanced by
 * whichever command ran last, so a file shared by two targets would look
 * unchanged to the second target after the first one regenerated.
 */

/**
 * One file that was read to produce the target, as generation consumed it:
 *   - `contentHash`: sha256 of the content; `null` = the file was absent;
 *   - `unverified`: the run could not establish which content generation
 *     consumed (the file was first examined after generation and may have
 *     changed in between). It never matches, so the next run regenerates and,
 *     having examined the file before generating, records it verified.
 */
export type GenerationTargetInputRecord =
  | { filePath: string; contentHash: string | null }
  | { filePath: string; unverified: true }

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

export function isGenerationTargetStore(value: unknown): value is GenerationTargetStore {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Record<keyof GenerationTargetStore, unknown>>
  return typeof candidate.getGenerationTarget === 'function'
    && typeof candidate.replaceGenerationTarget === 'function'
    && typeof candidate.deleteGenerationTarget === 'function'
}
