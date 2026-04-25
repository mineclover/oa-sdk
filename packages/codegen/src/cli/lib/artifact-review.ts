import {
  createArtifactFreshnessReport,
  createSkippedArtifactFreshnessReport,
  type ArtifactFreshnessSection,
} from './artifact-freshness.js'
import { loadSpecWithPath } from './load-spec.js'

export function createArtifactReview(input: {
  headDocument: Record<string, unknown>
  artifactPath?: string
  artifactDocument?: Record<string, unknown>
  skippedSummary?: string
}): ArtifactFreshnessSection {
  if (!input.artifactPath) {
    return createSkippedArtifactFreshnessReport(input.skippedSummary)
  }

  const artifact = input.artifactDocument === undefined
    ? loadSpecWithPath(input.artifactPath)
    : {
        document: input.artifactDocument,
        path: input.artifactPath,
      }

  return createArtifactFreshnessReport({
    headDocument: input.headDocument,
    artifactDocument: artifact.document,
    artifactPath: artifact.path,
  })
}
