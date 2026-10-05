/**
 * Persistent record of one generated artifact ("generation target"), used by
 * `oa-gen ... --incremental` to decide whether the artifact can be reused.
 *
 * Freshness is decided per target from the target's own recorded input stamps,
 * never from the shared workspace `files` table: that table is advanced by
 * whichever command ran last, so a file shared by two targets would look
 * unchanged to the second target after the first one regenerated.
 */

/** One file that was read to produce the target. `contentHash: null` = the file was absent. */
export type GenerationTargetInputRecord = {
  filePath: string
  contentHash: string | null
}

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
