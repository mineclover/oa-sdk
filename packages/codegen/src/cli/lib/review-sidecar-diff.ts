import {
  diffBuildSpecMetadataRegistries,
  loadBuildSpecMetadataRegistry,
  type BuildSpecMetadataRegistryDiffEntry,
} from './metadata-registry.js'
import {
  diffBuildSpecProvenanceMaps,
  loadBuildSpecProvenanceMap,
  type BuildSpecProvenanceDiffEntry,
} from './provenance-report.js'

export type ReviewSidecarDiff<TDiffEntry> = {
  checked: boolean
  base: string | null
  head: string | null
  changed: boolean | null
  summary: string
  differences: TDiffEntry[]
}

export type ProvenanceDiffReview = ReviewSidecarDiff<BuildSpecProvenanceDiffEntry>
export type MetadataRegistryDiffReview = ReviewSidecarDiff<BuildSpecMetadataRegistryDiffEntry>

export function createProvenanceDiffReview(
  baseProvenancePath: string | undefined,
  headProvenancePath: string | undefined,
): ProvenanceDiffReview {
  return createSidecarDiffReview({
    basePath: baseProvenancePath,
    headPath: headProvenancePath,
    load: loadBuildSpecProvenanceMap,
    diff: diffBuildSpecProvenanceMaps,
    unchangedSummary: 'provenance maps match',
    missingSummary: 'requires both base and head provenance sidecars',
    changedSummary(count) {
      return `${count} provenance entr${count === 1 ? 'y' : 'ies'} changed`
    },
  })
}

export function createMetadataRegistryDiffReview(
  baseMetadataRegistryPath: string | undefined,
  headMetadataRegistryPath: string | undefined,
): MetadataRegistryDiffReview {
  return createSidecarDiffReview({
    basePath: baseMetadataRegistryPath,
    headPath: headMetadataRegistryPath,
    load: loadBuildSpecMetadataRegistry,
    diff: diffBuildSpecMetadataRegistries,
    unchangedSummary: 'metadata registries match',
    missingSummary: 'requires both base and head metadata registry sidecars',
    changedSummary(count) {
      return `${count} metadata registry entr${count === 1 ? 'y' : 'ies'} changed`
    },
  })
}

function createSidecarDiffReview<TLoaded, TDiffEntry>(input: {
  basePath: string | undefined
  headPath: string | undefined
  load: (filePath: string) => TLoaded
  diff: (base: TLoaded, head: TLoaded) => TDiffEntry[]
  unchangedSummary: string
  missingSummary: string
  changedSummary: (count: number) => string
}): ReviewSidecarDiff<TDiffEntry> {
  if (!input.basePath && !input.headPath) {
    return {
      checked: false,
      base: null,
      head: null,
      changed: null,
      summary: 'not checked',
      differences: [],
    }
  }
  if (!input.basePath || !input.headPath) {
    return {
      checked: false,
      base: input.basePath ?? null,
      head: input.headPath ?? null,
      changed: null,
      summary: input.missingSummary,
      differences: [],
    }
  }

  const base = input.load(input.basePath)
  const head = input.load(input.headPath)
  const differences = input.diff(base, head)
  return {
    checked: true,
    base: input.basePath,
    head: input.headPath,
    changed: differences.length > 0,
    summary: differences.length === 0
      ? input.unchangedSummary
      : input.changedSummary(differences.length),
    differences,
  }
}
