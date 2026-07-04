import { createHash } from 'node:crypto'

import {
  DPM_PROFILE_ANALYSIS_REPORT_KIND,
  type DpmProfileAnalysisInput,
  type DpmProfileAnalysisReport,
} from './analysis-types.js'
import {
  analyzeCoverage,
  analyzeKeyCandidates,
  analyzeRelationshipHints,
  analyzeRiskIndicators,
} from './analysis-compute.js'
import { analyzeDriftSignals } from './analysis-drift.js'
import type { DpmProfileArtifact } from './types.js'

export function createDpmProfileAnalysisReport(input: DpmProfileAnalysisInput): DpmProfileAnalysisReport {
  const coverage = analyzeCoverage(input.profileArtifact)
  const relationshipHints = analyzeRelationshipHints(input.profileArtifact)
  const keyCandidates = analyzeKeyCandidates(input.profileArtifact)
  const riskIndicators = analyzeRiskIndicators(input.profileArtifact)
  const driftSignals = analyzeDriftSignals(input.profileArtifact, input.previousProfileArtifact)
  const diagnostics = [...input.profileArtifact.diagnostics].sort(byDiagnostic)
  const structural = {
    kind: DPM_PROFILE_ANALYSIS_REPORT_KIND,
    reportId: input.reportId ?? `profile-analysis:${input.profileArtifact.profileId}:${input.profileArtifact.freshness.versionHash}`,
    profileId: input.profileArtifact.profileId,
    datasetId: input.profileArtifact.datasetId,
    profileVersion: input.profileArtifact.profileVersion,
    analyzedAt: input.analyzedAt ?? input.profileArtifact.createdAt,
    profileVersionHash: input.profileArtifact.freshness.versionHash,
    coverage,
    relationshipHints,
    keyCandidates,
    driftSignals,
    riskIndicators,
    diagnostics,
    summary: {
      nodeCount: input.profileArtifact.nodes.length,
      edgeCount: input.profileArtifact.edges.length,
      metricCount: input.profileArtifact.metrics.length,
      diagnosticCount: diagnostics.length,
      relationshipHintCount: relationshipHints.length,
      keyCandidateCount: keyCandidates.length,
      riskIndicatorCount: riskIndicators.length,
      driftSignalCount: driftSignals.length,
    },
  }

  return {
    ...structural,
    freshness: {
      reportHash: computeDpmProfileAnalysisReportHash(structural),
      profileVersionHash: input.profileArtifact.freshness.versionHash,
      ...(input.previousProfileArtifact ? { previousProfileVersionHash: input.previousProfileArtifact.freshness.versionHash } : {}),
    },
  }
}

export function computeDpmProfileAnalysisReportHash(
  input: Omit<DpmProfileAnalysisReport, 'freshness'>,
): string {
  return `sha256:${createHash('sha256').update(stableStringify(input)).digest('hex')}`
}

function byDiagnostic(left: DpmProfileArtifact['diagnostics'][number], right: DpmProfileArtifact['diagnostics'][number]): number {
  return `${left.severity}.${left.code}.${left.message}`.localeCompare(`${right.severity}.${right.code}.${right.message}`)
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
