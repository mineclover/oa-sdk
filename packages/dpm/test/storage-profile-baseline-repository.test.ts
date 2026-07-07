import { describe, expect, it, vi } from 'vitest'

import {
  DPM_PROFILE_BASELINE_KIND,
  createDpmProfileAnalysisReport,
  createDpmProfileBaselineRepository,
  createDpmProfileBaselineRow,
  selectDpmPreviousProfileBaseline,
  type DpmProfileBaselineListRequest,
  type DpmProfileBaselineRequest,
  type DpmProfileBaselineRow,
} from '../src/index.js'
import {
  createKafkaProfileArtifact,
  createKafkaProfileArtifactWithCustomerNoPresence,
} from './support/profile-analysis-fixtures.js'
import {
  expectStorageReportPayloadExcludesUnsafeFragments,
} from './support/storage-report-fixtures.js'

describe('DPM profile baseline repository', () => {
  it('stores profile artifacts and analysis reports as defensive baseline rows', async () => {
    const storedRows = new Map<string, DpmProfileBaselineRow>()
    const upsertProfileBaseline = vi.fn(async (row: DpmProfileBaselineRow) => {
      storedRows.set(row.baselineRef, row)
    })
    const getProfileBaseline = vi.fn((request: DpmProfileBaselineRequest) =>
      storedRows.get(request.baselineRef)
    )
    const listProfileBaselines = vi.fn((request: DpmProfileBaselineListRequest) =>
      [...storedRows.values()].filter(row =>
        row.datasetId === request.datasetId
        && row.profileId === request.profileId
      ).slice(0, request.limit)
    )
    const repository = createDpmProfileBaselineRepository({
      upsertProfileBaseline,
      getProfileBaseline,
      listProfileBaselines,
    })
    const profileArtifact = createKafkaProfileArtifact()
    const previousProfileArtifact = createKafkaProfileArtifactWithCustomerNoPresence(0.91)
    const analysisReport = createDpmProfileAnalysisReport({
      profileArtifact,
      previousProfileArtifact,
    })

    const row = await repository.saveProfileBaseline({
      profileArtifact,
      analysisReport,
      storedAt: '2026-07-07T00:00:00.000Z',
    })
    const adapterRow = storedRows.get(row.baselineRef)!

    profileArtifact.nodes[0]!.label = 'mutated after profile baseline save'
    analysisReport.driftSignals[0]!.explanation = 'Mutated after profile baseline save.'
    row.profileArtifact.nodes[0]!.label = 'mutated returned row after profile baseline save'
    row.analysisReport!.driftSignals[0]!.explanation = 'Mutated returned row after profile baseline save.'

    expect(upsertProfileBaseline).toHaveBeenCalledWith(adapterRow)
    expect(adapterRow).not.toBe(row)
    expect(row).toMatchObject({
      kind: DPM_PROFILE_BASELINE_KIND,
      datasetId: profileArtifact.datasetId,
      profileId: profileArtifact.profileId,
      profileVersion: profileArtifact.profileVersion,
      profileVersionHash: profileArtifact.freshness.versionHash,
      reportHash: analysisReport.freshness.reportHash,
      previousProfileVersionHash: previousProfileArtifact.freshness.versionHash,
      storedAt: '2026-07-07T00:00:00.000Z',
    })
    expect(row.baselineRef).toBe(
      `dpm-profile-baseline:${profileArtifact.datasetId}:${profileArtifact.profileId}:${profileArtifact.freshness.versionHash}`,
    )
    expect(row.profileArtifact.nodes[0]?.label).not.toBe('mutated after profile baseline save')
    expect(row.analysisReport?.driftSignals[0]?.explanation).not.toBe('Mutated after profile baseline save.')
    expect(adapterRow.profileArtifact.nodes[0]?.label)
      .not.toBe('mutated returned row after profile baseline save')
    expect(adapterRow.analysisReport?.driftSignals[0]?.explanation)
      .not.toBe('Mutated returned row after profile baseline save.')
    expectStorageReportPayloadExcludesUnsafeFragments(row)

    const retrieved = await repository.getProfileBaseline({ baselineRef: row.baselineRef })
    retrieved!.profileArtifact.nodes[0]!.label = 'mutated after baseline get'
    retrieved!.analysisReport!.driftSignals[0]!.explanation = 'Mutated after baseline get.'

    expect(getProfileBaseline).toHaveBeenCalledWith({ baselineRef: row.baselineRef })
    expect(storedRows.get(row.baselineRef)?.profileArtifact.nodes[0]?.label).not.toBe('mutated after baseline get')
    expect(storedRows.get(row.baselineRef)?.analysisReport?.driftSignals[0]?.explanation)
      .not.toBe('Mutated after baseline get.')

    const listed = await repository.listProfileBaselines({
      datasetId: profileArtifact.datasetId,
      profileId: profileArtifact.profileId,
      limit: 1,
    })

    expect(listProfileBaselines).toHaveBeenCalledWith({
      datasetId: profileArtifact.datasetId,
      profileId: profileArtifact.profileId,
      limit: 1,
    })
    expect(listed).toHaveLength(1)
    expect(listed[0]).toEqual(adapterRow)
    expect(listed[0]).not.toBe(adapterRow)
  })

  it('preserves adapter row metadata when analysis report bodies are omitted', async () => {
    const profileArtifact = createKafkaProfileArtifact()
    const previousProfileArtifact = createKafkaProfileArtifactWithCustomerNoPresence(0.91)
    const analysisReport = createDpmProfileAnalysisReport({
      profileArtifact,
      previousProfileArtifact,
    })
    const row = createDpmProfileBaselineRow({
      profileArtifact,
      analysisReport,
      storedAt: '2026-07-07T00:00:00.000Z',
    })
    const metadataOnlyRow: DpmProfileBaselineRow = {
      kind: row.kind,
      baselineRef: row.baselineRef,
      datasetId: row.datasetId,
      profileId: row.profileId,
      profileVersion: row.profileVersion,
      profileVersionHash: row.profileVersionHash,
      ...(row.reportHash !== undefined ? { reportHash: row.reportHash } : {}),
      ...(row.previousProfileVersionHash !== undefined
        ? { previousProfileVersionHash: row.previousProfileVersionHash }
        : {}),
      profileArtifact: row.profileArtifact,
      ...(row.storedAt !== undefined ? { storedAt: row.storedAt } : {}),
    }
    const repository = createDpmProfileBaselineRepository({
      upsertProfileBaseline: async () => undefined,
      getProfileBaseline: async () => metadataOnlyRow,
      listProfileBaselines: async () => [metadataOnlyRow],
    })

    const retrieved = await repository.getProfileBaseline({ baselineRef: row.baselineRef })
    const listed = await repository.listProfileBaselines({
      datasetId: row.datasetId,
      profileId: row.profileId,
      limit: 1,
    })

    expect(retrieved).toEqual(metadataOnlyRow)
    expect(retrieved).not.toBe(metadataOnlyRow)
    expect(retrieved?.analysisReport).toBeUndefined()
    expect(retrieved?.reportHash).toBe(row.reportHash)
    expect(retrieved?.previousProfileVersionHash).toBe(row.previousProfileVersionHash)
    expect(listed).toEqual([metadataOnlyRow])
    expect(listed[0]).not.toBe(metadataOnlyRow)
  })

  it('selects the latest previous baseline from the same profile history', async () => {
    const storedRows = new Map<string, DpmProfileBaselineRow>()
    const listProfileBaselines = vi.fn((request: DpmProfileBaselineListRequest) =>
      [...storedRows.values()].filter(row =>
        row.datasetId === request.datasetId
        && row.profileId === request.profileId
      ).slice(0, request.limit)
    )
    const repository = createDpmProfileBaselineRepository({
      upsertProfileBaseline: row => storedRows.set(row.baselineRef, row),
      getProfileBaseline: request => storedRows.get(request.baselineRef),
      listProfileBaselines,
    })
    const currentProfileArtifact = createKafkaProfileArtifact()
    const olderProfileArtifact = createKafkaProfileArtifactWithCustomerNoPresence(0.88)
    const latestPreviousProfileArtifact = createKafkaProfileArtifactWithCustomerNoPresence(0.91)
    const currentBaseline = await repository.saveProfileBaseline({
      profileArtifact: currentProfileArtifact,
      storedAt: '2026-07-08T00:00:00.000Z',
    })
    const olderBaseline = await repository.saveProfileBaseline({
      profileArtifact: olderProfileArtifact,
      storedAt: '2026-07-06T00:00:00.000Z',
    })
    const latestPreviousBaseline = await repository.saveProfileBaseline({
      profileArtifact: latestPreviousProfileArtifact,
      storedAt: '2026-07-07T00:00:00.000Z',
    })

    const selected = await repository.selectPreviousProfileBaseline({
      profileArtifact: currentProfileArtifact,
      limit: 1,
    })
    selected!.profileArtifact.nodes[0]!.label = 'mutated selected previous baseline'

    expect(listProfileBaselines).toHaveBeenLastCalledWith({
      datasetId: currentProfileArtifact.datasetId,
      profileId: currentProfileArtifact.profileId,
    })
    expect(selected?.baselineRef).toBe(latestPreviousBaseline.baselineRef)
    expect(selected?.baselineRef).not.toBe(currentBaseline.baselineRef)
    expect(selected?.baselineRef).not.toBe(olderBaseline.baselineRef)
    expect(storedRows.get(latestPreviousBaseline.baselineRef)?.profileArtifact.nodes[0]?.label)
      .not.toBe('mutated selected previous baseline')

    const directlySelected = selectDpmPreviousProfileBaseline({
      profileArtifact: currentProfileArtifact,
      baselines: [...storedRows.values()],
      limit: 1,
    })

    expect(directlySelected).toEqual(latestPreviousBaseline)
    expect(directlySelected).not.toBe(storedRows.get(latestPreviousBaseline.baselineRef))
  })

  it('rejects analysis reports that do not belong to the stored profile artifact', async () => {
    const repository = createDpmProfileBaselineRepository({
      upsertProfileBaseline: async () => undefined,
      getProfileBaseline: async () => undefined,
      listProfileBaselines: async () => [],
    })
    const profileArtifact = createKafkaProfileArtifact()
    const mismatchedProfileArtifact = createKafkaProfileArtifactWithCustomerNoPresence(0.91)
    const analysisReport = createDpmProfileAnalysisReport({ profileArtifact })

    await expect(repository.saveProfileBaseline({
      profileArtifact: mismatchedProfileArtifact,
      analysisReport,
    })).rejects.toThrow('profile baseline analysis report does not match profile artifact')
  })
})
