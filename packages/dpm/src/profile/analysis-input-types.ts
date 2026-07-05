import type {
  DpmProfileArtifact,
} from './profile-artifact-types.js'

export type DpmProfileAnalysisInput = {
  profileArtifact: DpmProfileArtifact
  previousProfileArtifact?: DpmProfileArtifact
  reportId?: string
  analyzedAt?: string
}
