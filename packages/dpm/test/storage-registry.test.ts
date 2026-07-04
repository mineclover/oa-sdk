import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  DPM_REGISTRY_STORAGE_SCHEMA_SQL,
  createDpmRegistryRepository,
  registryRowsToSnapshot,
  type DpmRegistryRelationshipRow,
} from '../src/index.js'

const storageFixturesRoot = new URL('./fixtures/storage/', import.meta.url)

describe('DPM registry storage canonical model', () => {
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

  it('exports storage rows to the existing registry snapshot contract', () => {
    const snapshot = registryRowsToSnapshot({
      datasetId: 'commerce_ai',
      registryVersion: 'reg-2026-07-01',
      exportedAt: '2026-07-01T00:00:00.000Z',
      rows: storageRows,
    })

    expect(snapshot.identity).toBe('commerce_ai@reg-2026-07-01')
    expect(snapshot.relationships.map(relationship => relationship.identity)).toEqual([
      'commerce_ai/rel_orders_customer@1',
      'commerce_ai/rel_orders_status@1',
    ])
    expect(snapshot.approvedRelationships.map(relationship => relationship.name)).toEqual(['rel_orders_customer'])
    expect(snapshot.nonExecutableRelationships.map(relationship => relationship.status)).toEqual(['rejected'])
    expect(snapshot.relationships[0]).toMatchObject({
      name: 'rel_orders_customer',
      status: 'approved',
      executable: true,
      namespace: 'customer',
      parent: {
        table: 'public.customers',
        columns: ['customer_no'],
      },
      child: {
        table: 'public.orders',
        columns: ['customer_no'],
      },
      condition: {
        contextColumns: ['tenant_id'],
      },
      approval: {
        owner: 'privacy-team',
        approvedBy: 'dpo@example.com',
      },
    })
  })

  it('creates a repository that requests rows by dataset and registry version', async () => {
    const listRelationshipRows = vi.fn(async () => storageRows)
    const repository = createDpmRegistryRepository({ listRelationshipRows })

    const snapshot = await repository.exportSnapshot({
      datasetId: 'commerce_ai',
      registryVersion: 'reg-2026-07-01',
      exportedAt: '2026-07-01T00:00:00.000Z',
    })

    expect(listRelationshipRows).toHaveBeenCalledWith({
      datasetId: 'commerce_ai',
      registryVersion: 'reg-2026-07-01',
    })
    expect(snapshot.summary).toMatchObject({
      total: 2,
      approved: 1,
      nonExecutable: 1,
    })
  })

  it('refuses storage rows outside the requested dataset or registry version', () => {
    expect(() =>
      registryRowsToSnapshot({
        datasetId: 'commerce_ai',
        registryVersion: 'reg-2026-07-01',
        rows: [
          {
            ...storageRows[0],
            datasetId: 'other_dataset',
          },
        ],
      }),
    ).toThrow('Registry row other_dataset/reg-2026-07-01/rel_orders_customer@1 does not match requested snapshot commerce_ai@reg-2026-07-01')
  })
})

const storageRows: DpmRegistryRelationshipRow[] = [
  {
    datasetId: 'commerce_ai',
    registryVersion: 'reg-2026-07-01',
    relationshipName: 'rel_orders_customer',
    relationshipVersion: '1',
    status: 'approved',
    relationshipType: 'many_to_one',
    parentTable: 'public.customers',
    parentColumns: ['customer_no'],
    childTable: 'public.orders',
    childColumns: ['customer_no'],
    namespace: 'customer',
    transformStrategy: 'relationship_token',
    orphanPolicy: 'block',
    contextColumns: ['tenant_id'],
    confidenceScore: 0.99,
    evidence: [
      {
        kind: 'catalog_fk',
        message: 'orders.customer_no references customers.customer_no',
        score: 0.99,
      },
    ],
    approval: {
      owner: 'privacy-team',
      approvedBy: 'dpo@example.com',
      approvedAt: '2026-07-01T00:00:00.000Z',
    },
    sourceFreshnessHash: 'sha256:storage-catalog-v1',
  },
  {
    datasetId: 'commerce_ai',
    registryVersion: 'reg-2026-07-01',
    relationshipName: 'rel_orders_status',
    relationshipVersion: '1',
    status: 'rejected',
    relationshipType: 'code_lookup',
    parentTable: 'public.order_statuses',
    parentColumns: ['status_code'],
    childTable: 'public.orders',
    childColumns: ['status'],
    namespace: 'order_status',
    transformStrategy: 'keep_code',
    orphanPolicy: 'warn',
    contextColumns: [],
    evidence: [],
    approval: {
      owner: 'privacy-team',
      reviewedBy: 'dpo@example.com',
      reviewedAt: '2026-07-01T00:00:00.000Z',
      reason: 'Ambiguous operational status candidate.',
    },
    sourceFreshnessHash: 'sha256:storage-catalog-v1',
  },
]

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}
