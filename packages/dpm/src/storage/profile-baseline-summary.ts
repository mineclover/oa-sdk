import type { DpmProfileAnalysisSummary } from '../profile/analysis-summary-types.js'
import { copyDpmProfileBaselineRow } from './profile-baseline-row-builder.js'
import type { DpmProfileBaselineRow } from './profile-baseline-row-types.js'
import type {
  DpmProfileBaselineArtifactSummary,
  DpmProfileBaselineSummary,
} from './profile-baseline-summary-types.js'

export function summarizeDpmProfileBaselineRow(
  row: DpmProfileBaselineRow,
): DpmProfileBaselineSummary {
  const copied = copyDpmProfileBaselineRow(row)

  return {
    kind: copied.kind,
    baselineRef: copied.baselineRef,
    datasetId: copied.datasetId,
    profileId: copied.profileId,
    profileVersion: copied.profileVersion,
    profileVersionHash: copied.profileVersionHash,
    ...(copied.measurementId !== undefined ? { measurementId: copied.measurementId } : {}),
    ...(copied.measuredAt !== undefined ? { measuredAt: copied.measuredAt } : {}),
    ...(copied.measurementRunHash !== undefined ? { measurementRunHash: copied.measurementRunHash } : {}),
    ...(copied.reportHash !== undefined ? { reportHash: copied.reportHash } : {}),
    ...(copied.previousProfileVersionHash !== undefined
      ? { previousProfileVersionHash: copied.previousProfileVersionHash }
      : {}),
    ...(copied.storedAt !== undefined ? { storedAt: copied.storedAt } : {}),
    profileSummary: summarizeProfileArtifact(copied),
    ...(copied.analysisReport ? { analysisSummary: copyAnalysisSummary(copied.analysisReport.summary) } : {}),
    hasAnalysisReport: copied.analysisReport !== undefined,
  }
}

export function summarizeDpmProfileBaselineRows(
  rows: readonly DpmProfileBaselineRow[],
): DpmProfileBaselineSummary[] {
  return rows.map(summarizeDpmProfileBaselineRow)
}

function summarizeProfileArtifact(row: DpmProfileBaselineRow): DpmProfileBaselineArtifactSummary {
  return {
    nodeCount: row.profileArtifact.nodes.length,
    edgeCount: row.profileArtifact.edges.length,
    metricCount: row.profileArtifact.metrics.length,
    diagnosticCount: row.profileArtifact.diagnostics.length,
  }
}

function copyAnalysisSummary(summary: DpmProfileAnalysisSummary): DpmProfileAnalysisSummary {
  return {
    nodeCount: summary.nodeCount,
    edgeCount: summary.edgeCount,
    metricCount: summary.metricCount,
    diagnosticCount: summary.diagnosticCount,
    relationshipHintCount: summary.relationshipHintCount,
    keyCandidateCount: summary.keyCandidateCount,
    riskIndicatorCount: summary.riskIndicatorCount,
    driftSignalCount: summary.driftSignalCount,
  }
}
