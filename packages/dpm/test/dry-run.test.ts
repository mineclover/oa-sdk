import { describe, expect, it } from 'vitest'

import {
  compileDpmPlan,
  createDpmDryRunReport,
  createPostgresCatalogSnapshot,
  parseRegistrySnapshotYaml,
  type PostgresCatalogSnapshotInput,
} from '../src/index.js'
import {
  readDpmJsonFixture,
  readDpmTextFixture,
} from './support/fixture-io.js'

describe('DPM dry-run report', () => {
  it('reports impact counts and categories without preserving raw sensitive values', () => {
    const catalog = createPostgresCatalogSnapshot(
      readDpmJsonFixture<PostgresCatalogSnapshotInput>('catalog/postgres-commerce.json'),
    )
    const manifest = readDpmJsonFixture<Record<string, any>>('valid/customer-orders.json')
    manifest.catalog.version_hash = catalog.freshness.versionHash
    const compiled = compileDpmPlan({
      manifest,
      catalog,
      registry: parseRegistrySnapshotYaml(readDpmTextFixture('registry/commerce-registry.yaml')),
    })
    if (!compiled.ok) throw new Error('expected compile success')

    const report = createDpmDryRunReport({
      plan: compiled.plan,
      estimatedRows: {
        'public.customers': 2,
        'public.orders': 3,
      },
      sampleValues: {
        customer_no: 'C-001',
      },
    })

    expect(report.kind).toBe('dpm.dry-run-report.v1')
    expect(report.impact).toEqual({
      namespaces: 1,
      relationships: 1,
      columns: 2,
      piiColumns: 2,
      estimatedRows: 5,
    })
    expect(report.categories.map(category => category.name)).toEqual([
      'namespace_bindings',
      'relationship_steps',
      'column_steps',
      'pii_columns',
      'estimated_rows',
    ])
    expect(JSON.stringify(report)).not.toContain('C-001')
  })
})
