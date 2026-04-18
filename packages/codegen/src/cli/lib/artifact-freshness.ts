import {
  diffOpenApiDocuments,
  type OpenApiNormalizedDiffEntry,
} from './openapi-normalized-diff.js'

export const ARTIFACT_FRESHNESS_SCHEMA_VERSION = 'oa-gen.artifact-freshness.v1'

export type ArtifactFreshnessReport = {
  schemaVersion: typeof ARTIFACT_FRESHNESS_SCHEMA_VERSION
  checked: true
  artifact: string
  fresh: boolean
  summary: string
  differences: OpenApiNormalizedDiffEntry[]
}

export type ArtifactFreshnessSkippedReport = {
  schemaVersion: typeof ARTIFACT_FRESHNESS_SCHEMA_VERSION
  checked: false
  artifact: null
  fresh: null
  summary: string
  differences: []
}

export type ArtifactFreshnessSection =
  | ArtifactFreshnessReport
  | ArtifactFreshnessSkippedReport

export function createArtifactFreshnessReport(options: {
  headDocument: Record<string, unknown>
  artifactDocument: Record<string, unknown>
  artifactPath: string
}): ArtifactFreshnessReport {
  const differences = diffOpenApiDocuments(options.headDocument, options.artifactDocument)
  const fresh = differences.length === 0
  return {
    schemaVersion: ARTIFACT_FRESHNESS_SCHEMA_VERSION,
    checked: true,
    artifact: options.artifactPath,
    fresh,
    summary: fresh
      ? 'matches head OpenAPI'
      : `${differences.length} OpenAPI difference${differences.length === 1 ? '' : 's'} detected`,
    differences,
  }
}

export function createSkippedArtifactFreshnessReport(
  summary = 'not checked',
): ArtifactFreshnessSkippedReport {
  return {
    schemaVersion: ARTIFACT_FRESHNESS_SCHEMA_VERSION,
    checked: false,
    artifact: null,
    fresh: null,
    summary,
    differences: [],
  }
}
