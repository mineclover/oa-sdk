import type {
  DpmProfileBaselineListRequest,
  DpmProfileBaselineRequest,
  DpmProfileBaselineSelectionRequest,
  DpmProfileBaselineSaveInput,
} from './profile-baseline-request-types.js'
import type { DpmProfileBaselineRow } from './profile-baseline-row-types.js'

export type DpmProfileBaselineStorage = {
  upsertProfileBaseline(row: DpmProfileBaselineRow): Promise<void> | void
  getProfileBaseline(
    request: DpmProfileBaselineRequest,
  ): Promise<DpmProfileBaselineRow | undefined> | DpmProfileBaselineRow | undefined
  listProfileBaselines(
    request: DpmProfileBaselineListRequest,
  ): Promise<readonly DpmProfileBaselineRow[]> | readonly DpmProfileBaselineRow[]
}

export type DpmProfileBaselineRepository = {
  saveProfileBaseline(input: DpmProfileBaselineSaveInput): Promise<DpmProfileBaselineRow>
  getProfileBaseline(request: DpmProfileBaselineRequest): Promise<DpmProfileBaselineRow | undefined>
  listProfileBaselines(request: DpmProfileBaselineListRequest): Promise<DpmProfileBaselineRow[]>
  selectPreviousProfileBaseline(
    request: DpmProfileBaselineSelectionRequest,
  ): Promise<DpmProfileBaselineRow | undefined>
}
