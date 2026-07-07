import type { DpmProfileArtifact } from '../profile/profile-artifact-types.js'
import { copyDpmProfileBaselineRow } from './profile-baseline-row-builder.js'
import type { DpmProfileBaselineRow } from './profile-baseline-row-types.js'

export type DpmPreviousProfileBaselineSelectionInput = {
  profileArtifact: DpmProfileArtifact
  baselines: readonly DpmProfileBaselineRow[]
  limit?: number
  includeCurrentProfileVersionHash?: boolean
}

export function selectDpmPreviousProfileBaseline(
  input: DpmPreviousProfileBaselineSelectionInput,
): DpmProfileBaselineRow | undefined {
  const candidates = input.baselines
    .filter(row => isSameProfileHistory(row, input.profileArtifact))
    .filter(row => input.includeCurrentProfileVersionHash
      || row.profileVersionHash !== input.profileArtifact.freshness.versionHash)
    .sort(compareProfileBaselineRowsForLatestPrevious)
  const selected = input.limit === undefined
    ? candidates[0]
    : candidates.slice(0, input.limit)[0]

  return selected ? copyDpmProfileBaselineRow(selected) : undefined
}

function isSameProfileHistory(
  row: DpmProfileBaselineRow,
  profileArtifact: DpmProfileArtifact,
): boolean {
  return row.datasetId === profileArtifact.datasetId
    && row.profileId === profileArtifact.profileId
}

function compareProfileBaselineRowsForLatestPrevious(
  left: DpmProfileBaselineRow,
  right: DpmProfileBaselineRow,
): number {
  return compareDescending(left.storedAt ?? '', right.storedAt ?? '')
    || compareDescending(left.profileVersion, right.profileVersion)
    || compareDescending(left.profileVersionHash, right.profileVersionHash)
    || left.baselineRef.localeCompare(right.baselineRef)
}

function compareDescending(left: string, right: string): number {
  return right.localeCompare(left)
}
