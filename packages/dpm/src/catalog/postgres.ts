import type { PostgresCatalogSnapshotInput } from './types.js'
import { normalizeCatalogSnapshot } from './snapshot.js'

export function createPostgresCatalogSnapshot(input: PostgresCatalogSnapshotInput) {
  return normalizeCatalogSnapshot({
    ...input,
    source: {
      kind: 'postgresql',
      database: input.database,
      ...(input.capturedAt ? { capturedAt: input.capturedAt } : {}),
    },
  })
}
