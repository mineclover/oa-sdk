import type { DpmProfileDiagnosticFamily } from './profile-taxonomy.js'
import type {
  DpmProfileCoordinate,
  DpmProfileEvidenceSource,
  DpmProfileSourceDescriptor,
} from './profile-source-types.js'
import type {
  DpmProfileEdge,
  DpmProfileMetric,
  DpmProfileNode,
} from './profile-graph-types.js'

export const DPM_PROFILE_ARTIFACT_KIND = 'dpm.profile.artifact.v1' as const

export type DpmProfileDiagnostic = {
  severity: 'error' | 'warning' | 'info'
  code: `${DpmProfileDiagnosticFamily}${string}`
  message: string
  connectorId?: string
  coordinate?: DpmProfileCoordinate
  evidenceIds?: string[]
}

export type DpmProfileFreshness = {
  versionHash: string
  sourceVersionHashes?: Record<string, string>
}

export type DpmProfileArtifact = {
  kind: typeof DPM_PROFILE_ARTIFACT_KIND
  profileId: string
  datasetId: string
  profileVersion: string
  createdAt: string
  sources: DpmProfileSourceDescriptor[]
  evidenceSources: Record<string, DpmProfileEvidenceSource>
  nodes: DpmProfileNode[]
  edges: DpmProfileEdge[]
  metrics: DpmProfileMetric[]
  diagnostics: DpmProfileDiagnostic[]
  freshness: DpmProfileFreshness
}
