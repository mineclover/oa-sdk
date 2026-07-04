import { createHash } from 'node:crypto'

import {
  DPM_PROFILE_ARTIFACT_KIND,
  type DpmProfileArtifact,
  type DpmProfileSourceDescriptor,
} from './types.js'

export type DpmProfileFreshnessHashInput =
  | Omit<DpmProfileArtifact, 'freshness'>
  | (Omit<DpmProfileArtifact, 'kind' | 'freshness'> & {
      sourceVersionHashes?: Readonly<Record<string, string>>
    })

export function computeDpmProfileFreshnessHash(input: DpmProfileFreshnessHashInput): string {
  const structural = 'kind' in input
    ? input
    : {
        kind: DPM_PROFILE_ARTIFACT_KIND,
        profileId: input.profileId,
        datasetId: input.datasetId,
        profileVersion: input.profileVersion,
        createdAt: input.createdAt,
        sources: input.sources,
        evidenceSources: input.evidenceSources,
        nodes: input.nodes,
        edges: input.edges,
        metrics: input.metrics,
        diagnostics: input.diagnostics,
      }

  return `sha256:${createHash('sha256').update(stableStringify(structural)).digest('hex')}`
}

export function collectDpmProfileSourceVersionHashes(
  sources: readonly DpmProfileSourceDescriptor[],
  input?: Readonly<Record<string, string>>,
): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const key of Object.keys(input ?? {}).sort()) {
    const value = input?.[key]
    if (value) hashes[key] = value
  }
  for (const source of sources) {
    if (source.sourceVersionHash) hashes[source.id] = source.sourceVersionHash
  }
  return hashes
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    const next = record[key]
    if (next !== undefined) sorted[key] = sortValue(next)
  }
  return sorted
}
