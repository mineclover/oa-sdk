import { readFileSync } from 'node:fs'

import { parse } from 'yaml'

import { createPostgresCatalogSnapshot } from '../catalog/postgres.js'
import type {
  CatalogSnapshot,
  PostgresCatalogSnapshotInput,
} from '../catalog/types.js'
import { parseRegistrySnapshotYaml } from '../registry/snapshot.js'
import type { RegistrySnapshot } from '../registry/registry-snapshot-types.js'
import type { DpmCliParsedArgs } from './types.js'

export type DpmCliInputs = {
  manifest: unknown
  catalog: CatalogSnapshot
  registry: RegistrySnapshot
  estimatedRows?: Record<string, number>
}

export function readDpmCliInputs(args: DpmCliParsedArgs): DpmCliInputs {
  const estimatedRows = args.estimatedRowsPath ? readEstimatedRows(args.estimatedRowsPath) : undefined
  return {
    manifest: readStructuredFile(args.manifestPath),
    catalog: readCatalogSnapshot(args.catalogPath),
    registry: parseRegistrySnapshotYaml(readFileSync(args.registryPath, 'utf8')),
    ...(estimatedRows ? { estimatedRows } : {}),
  }
}

function readCatalogSnapshot(path: string): CatalogSnapshot {
  const raw = readStructuredFile(path) as Record<string, unknown>
  if (raw.kind === 'dpm.catalog.snapshot.v1') {
    return raw as CatalogSnapshot
  }
  return createPostgresCatalogSnapshot(raw as PostgresCatalogSnapshotInput)
}

function readEstimatedRows(path: string): Record<string, number> {
  const raw = readStructuredFile(path)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('--estimated-rows must point to an object file')
  }
  const rows: Record<string, number> = {}
  for (const [table, count] of Object.entries(raw)) {
    if (typeof count !== 'number') {
      throw new Error(`estimated row count for ${table} must be a number`)
    }
    rows[table] = count
  }
  return rows
}

function readStructuredFile(path: string): unknown {
  return parse(readFileSync(path, 'utf8')) as unknown
}
