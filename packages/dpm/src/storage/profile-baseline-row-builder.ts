import { copyDpmProfileAnalysisReport } from '../profile/analysis-report-copy.js'
import type { DpmProfileAnalysisReport } from '../profile/analysis-report-types.js'
import { copyDpmProfileArtifact } from '../profile/artifact-envelope-copy.js'
import type { DpmProfileArtifact } from '../profile/profile-artifact-types.js'
import { DPM_PROFILE_BASELINE_KIND } from './profile-baseline-kind.js'
import type { DpmProfileBaselineSaveInput } from './profile-baseline-request-types.js'
import type { DpmProfileBaselineRow } from './profile-baseline-row-types.js'

export function createDpmProfileBaselineRow(
  input: DpmProfileBaselineSaveInput,
): DpmProfileBaselineRow {
  assertAnalysisReportMatchesProfileArtifact(input.profileArtifact, input.analysisReport)
  const profileArtifact = copyDpmProfileArtifact(input.profileArtifact)
  const analysisReport = input.analysisReport
    ? copyDpmProfileAnalysisReport(input.analysisReport)
    : undefined

  return {
    kind: DPM_PROFILE_BASELINE_KIND,
    baselineRef: input.baselineRef ?? renderDefaultBaselineRef(profileArtifact),
    datasetId: profileArtifact.datasetId,
    profileId: profileArtifact.profileId,
    profileVersion: profileArtifact.profileVersion,
    profileVersionHash: profileArtifact.freshness.versionHash,
    ...(analysisReport ? { reportHash: analysisReport.freshness.reportHash } : {}),
    ...(analysisReport?.freshness.previousProfileVersionHash ? {
      previousProfileVersionHash: analysisReport.freshness.previousProfileVersionHash,
    } : {}),
    profileArtifact,
    ...(analysisReport ? { analysisReport } : {}),
    ...(input.storedAt ? { storedAt: input.storedAt } : {}),
  }
}

export function copyDpmProfileBaselineRow(row: DpmProfileBaselineRow): DpmProfileBaselineRow {
  const profileArtifact = copyDpmProfileArtifact(row.profileArtifact)
  const analysisReport = row.analysisReport
    ? copyDpmProfileAnalysisReport(row.analysisReport)
    : undefined
  assertAnalysisReportMatchesProfileArtifact(profileArtifact, analysisReport)
  assertBaselineRowMetadataMatchesProfileArtifact(row, profileArtifact, analysisReport)

  return {
    kind: DPM_PROFILE_BASELINE_KIND,
    baselineRef: row.baselineRef,
    datasetId: row.datasetId,
    profileId: row.profileId,
    profileVersion: row.profileVersion,
    profileVersionHash: row.profileVersionHash,
    ...(row.reportHash !== undefined ? { reportHash: row.reportHash } : {}),
    ...(row.previousProfileVersionHash !== undefined
      ? { previousProfileVersionHash: row.previousProfileVersionHash }
      : {}),
    profileArtifact,
    ...(analysisReport ? { analysisReport } : {}),
    ...(row.storedAt !== undefined ? { storedAt: row.storedAt } : {}),
  }
}

function assertAnalysisReportMatchesProfileArtifact(
  profileArtifact: DpmProfileArtifact,
  analysisReport?: DpmProfileAnalysisReport,
): void {
  if (!analysisReport) return

  const mismatches = [
    analysisReport.datasetId === profileArtifact.datasetId ? undefined : 'datasetId',
    analysisReport.profileId === profileArtifact.profileId ? undefined : 'profileId',
    analysisReport.profileVersion === profileArtifact.profileVersion ? undefined : 'profileVersion',
    analysisReport.profileVersionHash === profileArtifact.freshness.versionHash
      ? undefined
      : 'profileVersionHash',
    analysisReport.freshness.profileVersionHash === profileArtifact.freshness.versionHash
      ? undefined
      : 'freshness.profileVersionHash',
  ].filter(Boolean)

  if (mismatches.length > 0) {
    throw new Error(`profile baseline analysis report does not match profile artifact: ${mismatches.join(', ')}`)
  }
}

function assertBaselineRowMetadataMatchesProfileArtifact(
  row: DpmProfileBaselineRow,
  profileArtifact: DpmProfileArtifact,
  analysisReport?: DpmProfileAnalysisReport,
): void {
  const mismatches = [
    row.kind === DPM_PROFILE_BASELINE_KIND ? undefined : 'kind',
    row.datasetId === profileArtifact.datasetId ? undefined : 'datasetId',
    row.profileId === profileArtifact.profileId ? undefined : 'profileId',
    row.profileVersion === profileArtifact.profileVersion ? undefined : 'profileVersion',
    row.profileVersionHash === profileArtifact.freshness.versionHash
      ? undefined
      : 'profileVersionHash',
    ...assertAnalysisReportMetadataMatchesRow(row, analysisReport),
  ].filter(Boolean)

  if (mismatches.length > 0) {
    throw new Error(`profile baseline row metadata does not match profile artifact: ${mismatches.join(', ')}`)
  }
}

function assertAnalysisReportMetadataMatchesRow(
  row: DpmProfileBaselineRow,
  analysisReport?: DpmProfileAnalysisReport,
): Array<string | undefined> {
  if (!analysisReport) return []

  return [
    row.reportHash === analysisReport.freshness.reportHash ? undefined : 'reportHash',
    row.previousProfileVersionHash === analysisReport.freshness.previousProfileVersionHash
      ? undefined
      : 'previousProfileVersionHash',
  ]
}

function renderDefaultBaselineRef(profileArtifact: DpmProfileArtifact): string {
  return [
    'dpm-profile-baseline',
    profileArtifact.datasetId,
    profileArtifact.profileId,
    profileArtifact.freshness.versionHash,
  ].join(':')
}
