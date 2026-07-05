import {
  DPM_PROFILE_ARTIFACT_KIND,
  type DpmProfileArtifact,
} from './profile-artifact-types.js'
import {
  copyDiagnostic,
  copyEdge,
  copyMetric,
  copyNode,
  copySourceDescriptor,
  sortEvidenceSources,
} from './artifact-copy.js'
import {
  computeDpmProfileFreshnessHash,
} from './artifact-freshness.js'
import {
  byDiagnostic,
  byId,
} from './artifact-ordering.js'
import { collectDpmProfileSourceVersionHashes } from './artifact-source-version-hashes.js'

export { computeDpmProfileFreshnessHash } from './artifact-freshness.js'

export type DpmProfileArtifactInput = Omit<DpmProfileArtifact, 'kind' | 'freshness'> & {
  sourceVersionHashes?: Readonly<Record<string, string>>
}

export function normalizeDpmProfileArtifact(input: DpmProfileArtifactInput): DpmProfileArtifact {
  const structural: Omit<DpmProfileArtifact, 'freshness'> = {
    kind: DPM_PROFILE_ARTIFACT_KIND,
    profileId: input.profileId,
    datasetId: input.datasetId,
    profileVersion: input.profileVersion,
    createdAt: input.createdAt,
    sources: input.sources.map(copySourceDescriptor).sort(byId),
    evidenceSources: sortEvidenceSources(input.evidenceSources),
    nodes: input.nodes.map(copyNode).sort(byId),
    edges: input.edges.map(copyEdge).sort(byId),
    metrics: input.metrics.map(copyMetric).sort(byId),
    diagnostics: input.diagnostics.map(copyDiagnostic).sort(byDiagnostic),
  }

  const sourceVersionHashes = collectDpmProfileSourceVersionHashes(
    structural.sources,
    input.sourceVersionHashes,
  )

  return {
    ...structural,
    freshness: {
      versionHash: computeDpmProfileFreshnessHash(structural),
      ...(Object.keys(sourceVersionHashes).length > 0 ? { sourceVersionHashes } : {}),
    },
  }
}
