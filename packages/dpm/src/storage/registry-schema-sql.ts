import {
  DPM_REGISTRY_STORAGE_AUDIT_TABLE_SQL,
} from './registry-schema-audit-table.js'
import {
  DPM_REGISTRY_STORAGE_INDEX_SQL,
} from './registry-schema-indexes.js'
import {
  DPM_REGISTRY_STORAGE_TABLE_SQL,
} from './registry-schema-table.js'

export const DPM_REGISTRY_STORAGE_SCHEMA_VERSION = 'dpm.registry-storage.v1' as const

export const DPM_REGISTRY_STORAGE_SCHEMA_SQL = [
  DPM_REGISTRY_STORAGE_TABLE_SQL,
  DPM_REGISTRY_STORAGE_AUDIT_TABLE_SQL,
  DPM_REGISTRY_STORAGE_INDEX_SQL,
].join('\n\n')
