import type { DefinitionTargetConfig } from '@oa-sdk/parser'
import type {
  DefinitionBuilderProjectIdentity,
  TypeSpecBundleProjectIdentity,
} from '../../domain/project.js'
import type {
  DefinitionBuilderSpecSnapshot,
  SpecFileEntry,
  SpecRevision,
  SpecSnapshotStored,
  SpecTimelineDiff,
  TypeSpecBundleSpecSnapshot,
} from '../../domain/index.js'
import type { SpecProjectSourceKind } from '../../domain/project.js'

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

type BuildSnapshotOptionsByKind = {
  'definition-builder': DefinitionBuilderBuildSnapshotOptions
  'typespec-bundle': TypeSpecBundleBuildSnapshotOptions
}

type SpecSnapshotByKind = {
  'definition-builder': DefinitionBuilderSpecSnapshot
  'typespec-bundle': TypeSpecBundleSpecSnapshot
}

export type BuildSnapshotOptions<
  K extends SpecProjectSourceKind = SpecProjectSourceKind,
> = BuildSnapshotOptionsByKind[K]

export interface SnapshotBuilderPort<
  K extends SpecProjectSourceKind = SpecProjectSourceKind,
> {
  build(options: BuildSnapshotOptions<K>): Promise<SpecSnapshotByKind[K]>
  // Accepts stored snapshots so entryRefs is available for affected-file computation.
  diff(base: SpecSnapshotStored, head: SpecSnapshotStored): SpecTimelineDiff
}
