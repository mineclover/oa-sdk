import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DPM_REGISTRY_STORAGE_SCHEMA_SQL,
} from '../src/index.js'

const storageFixturesRoot = new URL('./fixtures/storage/', import.meta.url)

describe('DPM registry storage schema', () => {
  it('defines a Postgres schema for durable relationship lifecycle records', () => {
    const sql = normalizeSql(DPM_REGISTRY_STORAGE_SCHEMA_SQL)
    const fixtureSql = normalizeSql(readFileSync(join(storageFixturesRoot.pathname, 'registry-schema.sql'), 'utf8'))

    expect(sql).toBe(fixtureSql)
    expect(sql).toContain('create schema if not exists dpm')
    expect(sql).toContain('create table if not exists dpm.relationship_registry')
    expect(sql).toContain('id bigint generated always as identity primary key')
    expect(sql).toContain('dataset_id text not null')
    expect(sql).toContain('registry_version text not null')
    expect(sql).toContain('relationship_name text not null')
    expect(sql).toContain('relationship_version text not null')
    expect(sql).toContain('status text not null')
    expect(sql).toContain('approval jsonb not null')
    expect(sql).toContain('created_at timestamptz not null default now()')
    expect(sql).toContain('updated_at timestamptz not null default now()')
    expect(sql).toContain('constraint dpm_relationship_registry_status_check check')
    expect(sql).toContain('constraint dpm_relationship_registry_orphan_policy_check check')
    expect(sql).toContain('create unique index if not exists dpm_relationship_registry_identity_idx')
    expect(sql).toContain('on dpm.relationship_registry (dataset_id, registry_version, relationship_name, relationship_version)')
    expect(sql).toContain('create index if not exists dpm_relationship_registry_approved_idx')
    expect(sql).toContain("where status = 'approved'")
  })
})

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}
