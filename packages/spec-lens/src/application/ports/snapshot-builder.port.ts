import type { DefinitionTargetConfig } from '@oa-sdk/parser'
import type { SpecFileEntry, SpecRevision, SpecSnapshot, SpecSnapshotStored, SpecTimelineDiff } from '../../domain/index.js'

export type BuildSnapshotOptions = {
  revision: SpecRevision
  entries: SpecFileEntry[]
  fragmentsDir: string
  targetPath: string
  targetConfig: DefinitionTargetConfig
  targetConfigDigest: string
}

export interface SnapshotBuilderPort {
  build(options: BuildSnapshotOptions): Promise<SpecSnapshot>
  // Accepts stored snapshots so entryRefs is available for affectedFragments computation
  diff(base: SpecSnapshotStored, head: SpecSnapshotStored): SpecTimelineDiff
}
