import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createPostgresCatalogSnapshot,
  createRegistrySnapshot,
  parseRegistrySnapshotYaml,
  validateDpmManifest,
  type DpmValidationInput,
  type PostgresCatalogSnapshotInput,
} from '../src/index.js'

const fixturesRoot = new URL('./fixtures/', import.meta.url)

function readJsonFixture<T>(path: string): T {
  return JSON.parse(readFileSync(join(fixturesRoot.pathname, path), 'utf8')) as T
}

function readTextFixture(path: string): string {
  return readFileSync(join(fixturesRoot.pathname, path), 'utf8')
}

function createValidationInput(): DpmValidationInput {
  return {
    manifest: readJsonFixture('valid/customer-orders.json'),
    catalog: createPostgresCatalogSnapshot(
      readJsonFixture<PostgresCatalogSnapshotInput>('catalog/postgres-commerce.json'),
    ),
    registry: parseRegistrySnapshotYaml(readTextFixture('registry/commerce-registry.yaml')),
    phase: 'validate',
  }
}

describe('DPM semantic validator', () => {
  it('validates manifest, catalog snapshot, and registry snapshot without source DB access', () => {
    const result = validateDpmManifest(createValidationInput())

    expect(result.valid).toBe(true)
    expect(result.summary).toEqual({ errors: 0, warnings: 1, infos: 0 })
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'SAF007',
        sourcePointer: '/quality_gates',
      }),
    ])
  })

  it('emits deterministic REL and SAF diagnostics for unsafe manifests', () => {
    const input = createValidationInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.relationship_registry.registry_version = 'reg-stale'
    manifest.vault.mode = 'runtime'
    manifest.quality_gates = []
    manifest.entities[0].namespace = 'account'
    manifest.relationships = [
      {
        ...manifest.relationships[0],
        name: 'rel_orders_status',
        parent: {
          table: 'public.order_statuses',
          columns: ['status'],
        },
        child: {
          table: 'public.orders',
          columns: ['amount'],
        },
        namespace: 'order_status',
        transform_strategy: 'keep_code',
      },
      {
        ...manifest.relationships[0],
        name: 'rel_missing_customer',
        parent: {
          table: 'public.customers',
          columns: ['customer_no'],
        },
        child: {
          table: 'public.orders',
          columns: ['customer_no', 'order_id'],
        },
      },
    ]
    manifest.columns = [
      {
        table: 'public.customers',
        column: 'customer_no',
        role: 'direct_identifier',
        pii: true,
        transform: { type: 'keep' },
      },
      {
        table: 'public.orders',
        column: 'customer_no',
        role: 'foreign_identifier',
        pii: true,
        transform: { type: 'relationship_token' },
      },
      {
        table: 'public.orders',
        column: 'amount',
        role: 'business_identifier',
        pii: true,
        transform: { type: 'keep' },
      },
      {
        table: 'public.orders',
        column: 'customer_no',
        role: 'foreign_identifier',
        pii: true,
        entity: 'customer',
        relationship: 'rel_orders_status',
        transform: {
          type: 'relationship_token',
          relationship: 'rel_orders_status',
        },
      },
    ]

    const result = validateDpmManifest({
      ...input,
      manifest,
      phase: 'compile',
    })

    expect(result.valid).toBe(false)
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'REL001',
      'REL003',
      'REL006',
      'REL010',
      'REL011',
      'SAF001',
      'SAF002',
      'SAF007',
      'SAF009',
      'SAF010',
      'SAF011',
      'SYN001',
      'SYN001',
      'SYN001',
      'SYN001',
      'SYN001',
      'SYN001',
    ])
    expect(result.diagnostics.find(diagnostic => diagnostic.code === 'REL006')).toMatchObject({
      registryCoordinate: {
        datasetId: 'commerce_ai',
        relationshipName: 'rel_orders_status',
        registryVersion: 'reg-2026-07-01',
      },
    })
    expect(result.diagnostics.find(diagnostic => diagnostic.code === 'REL001')).toMatchObject({
      catalogCoordinate: {
        table: 'public.order_statuses',
      },
      sourcePointer: '/relationships/0/parent/table',
    })
  })

  it('flags ambiguous approved registry matches deterministically', () => {
    const input = createValidationInput()
    const approved = input.registry.approvedRelationships[0]
    if (!approved) throw new Error('fixture must contain an approved relationship')
    const registry = createRegistrySnapshot({
      datasetId: input.registry.datasetId,
      registryVersion: input.registry.registryVersion,
      exportedAt: input.registry.exportedAt,
      relationships: [
        ...input.registry.relationships,
        {
          ...approved,
          version: '2',
          approval: {
            ...approved.approval,
            reason: 'Second approved version used to verify ambiguity diagnostics.',
          },
        },
      ],
    })

    const result = validateDpmManifest({
      ...input,
      registry,
    })

    expect(result.valid).toBe(false)
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['REL012', 'SAF007'])
  })

  it('rejects manifests that spoof an approved registry relationship by changing its approved namespace', () => {
    const input = createValidationInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.relationships[0].namespace = 'account'

    const result = validateDpmManifest({
      ...input,
      manifest,
    })

    expect(result.valid).toBe(false)
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['REL013', 'SAF007'])
    expect(result.diagnostics.find(diagnostic => diagnostic.code === 'REL013')).toMatchObject({
      sourcePointer: '/relationships/0/namespace',
      registryCoordinate: {
        datasetId: 'commerce_ai',
        registryVersion: 'reg-2026-07-01',
        relationshipName: 'rel_orders_customer',
        relationshipVersion: '1',
        status: 'approved',
      },
    })
  })

  it('rejects columns that reference a relationship absent from the manifest relationship set', () => {
    const input = createValidationInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.columns[1].relationship = 'rel_missing_customer'
    manifest.columns[1].transform.relationship = 'rel_missing_customer'

    const result = validateDpmManifest({
      ...input,
      manifest,
    })

    expect(result.valid).toBe(false)
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['SAF007', 'SAF012'])
    expect(result.diagnostics.find(diagnostic => diagnostic.code === 'SAF012')).toMatchObject({
      sourcePointer: '/columns/1/relationship',
      registryCoordinate: {
        datasetId: 'commerce_ai',
        registryVersion: 'reg-2026-07-01',
        relationshipName: 'rel_missing_customer',
      },
    })
  })
})
