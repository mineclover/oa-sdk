import { computeCatalogFreshnessHash } from './freshness.js'
import {
  copyDiagnostic,
} from './snapshot-diagnostic-copy.js'
import {
  copyForeignKey,
  copyIndex,
  copyPrimaryKey,
  copyUniqueCandidate,
} from './snapshot-integrity-copy.js'
import { copyProjectionEvidence } from './snapshot-projection-copy.js'
import {
  copySnapshotSource,
  sortSourceMap,
} from './snapshot-source-copy.js'
import {
  copyColumn,
  copySchema,
  copyTable,
} from './snapshot-structure-copy.js'
import {
  byColumn,
  byDiagnostic,
  bySchema,
  byTable,
  byTableName,
} from './snapshot-ordering.js'
import type {
  CatalogSnapshot,
  CatalogSnapshotInput,
} from './snapshot-types.js'

export function normalizeCatalogSnapshot(input: CatalogSnapshotInput): CatalogSnapshot {
  const structural = {
    kind: 'dpm.catalog.snapshot.v1' as const,
    source: copySnapshotSource(input.source),
    schemas: [...(input.schemas ?? [])].map(copySchema).sort(bySchema),
    tables: [...(input.tables ?? [])].map(copyTable).sort(byTable),
    columns: [...(input.columns ?? [])].map(copyColumn).sort(byColumn),
    primaryKeys: [...(input.primaryKeys ?? [])].map(copyPrimaryKey).sort(byTableName),
    foreignKeys: [...(input.foreignKeys ?? [])].map(copyForeignKey).sort(byTableName),
    indexes: [...(input.indexes ?? [])].map(copyIndex).sort(byTableName),
    uniqueCandidates: [...(input.uniqueCandidates ?? [])].map(copyUniqueCandidate).sort(byTableName),
    sources: sortSourceMap(input.sources ?? {}),
    diagnostics: [...(input.diagnostics ?? [])].map(copyDiagnostic).sort(byDiagnostic),
    ...(input.projection ? { projection: copyProjectionEvidence(input.projection) } : {}),
  }

  return {
    ...structural,
    freshness: {
      versionHash: computeCatalogFreshnessHash(structural),
      ...(input.sourceVersionHash ? { sourceVersionHash: input.sourceVersionHash } : {}),
    },
  }
}
