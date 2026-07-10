import type { DefinitionTargetConfig } from '@oa-sdk/parser'
import type {
  DefinitionBuilderProjectIdentity,
  TypeSpecBundleProjectIdentity,
} from '../../domain/project.js'
import type {
  SpecFileEntry,
  SpecRevision,
  SpecSnapshot,
  SpecSnapshotStored,
  SpecTimelineDiff,
} from '../../domain/index.js'

type BuildSnapshotCommon = {
  revision: SpecRevision
  entries: SpecFileEntry[]
}

export type DefinitionBuilderBuildSnapshotOptions = BuildSnapshotCommon & {
  kind: 'definition-builder'
  project: DefinitionBuilderProjectIdentity
  fragmentsDir: string
  targetPath: string
  targetConfig: DefinitionTargetConfig
  targetConfigDigest: string
}

export type TypeSpecBundleBuildSnapshotOptions = BuildSnapshotCommon & {
  kind: 'typespec-bundle'
  project: TypeSpecBundleProjectIdentity
  sourceRoot: string
  manifestPath: string
}

export type BuildSnapshotOptions =
  | DefinitionBuilderBuildSnapshotOptions
  | TypeSpecBundleBuildSnapshotOptions

export interface SnapshotBuilderPort {
  build(options: BuildSnapshotOptions): Promise<SpecSnapshot>
  // Accepts stored snapshots so entryRefs is available for affected-file computation.
  diff(base: SpecSnapshotStored, head: SpecSnapshotStored): SpecTimelineDiff
}
