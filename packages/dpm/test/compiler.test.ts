import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  compileDpmPlan,
  createPostgresCatalogSnapshot,
  parseRegistrySnapshotYaml,
  type DpmCompileInput,
  type PostgresCatalogSnapshotInput,
} from '../src/index.js'

const fixturesRoot = new URL('./fixtures/', import.meta.url)

function readJsonFixture<T>(path: string): T {
  return JSON.parse(readFileSync(join(fixturesRoot.pathname, path), 'utf8')) as T
}

function readTextFixture(path: string): string {
  return readFileSync(join(fixturesRoot.pathname, path), 'utf8')
}

function createCompileInput(): DpmCompileInput {
  const catalog = createPostgresCatalogSnapshot(
    readJsonFixture<PostgresCatalogSnapshotInput>('catalog/postgres-commerce.json'),
  )
  const manifest = readJsonFixture<Record<string, any>>('valid/customer-orders.json')

  return {
    manifest,
    catalog,
    registry: parseRegistrySnapshotYaml(readTextFixture('registry/commerce-registry.yaml')),
  }
}

describe('DPM compiler', () => {
  it('compiles a validated manifest into approved relationship-first plan steps', () => {
    const result = compileDpmPlan(createCompileInput())

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected compile success')
    expect(result.plan.kind).toBe('dpm.compiled-plan.v1')
    expect(result.plan.stale).toBe(false)
    expect(result.plan.relationshipSteps.map(step => step.name)).toEqual(['rel_orders_customer'])
    expect(result.plan.relationshipSteps.every(step => step.registryStatus === 'approved')).toBe(true)
    expect(result.plan.namespaceBindings).toEqual([
      expect.objectContaining({
        namespace: 'customer',
        entity: 'customer',
        relationships: ['rel_orders_customer'],
        columns: ['public.customers.customer_no', 'public.orders.customer_no'],
      }),
    ])
    expect(result.plan.freshness).toMatchObject({
      catalogVersionHash: result.plan.manifestCatalogVersionHash,
      registryVersion: 'reg-2026-07-01',
    })
  })

  it('refuses to compile invalid validator output', () => {
    const input = createCompileInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.columns[0].transform = { type: 'keep' }

    const result = compileDpmPlan({
      ...input,
      manifest,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected compile failure')
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('SAF001')
    expect('plan' in result).toBe(false)
  })

  it('refuses manifests that reuse an approved registry name with different relationship semantics', () => {
    const input = createCompileInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.relationships[0].namespace = 'account'

    const result = compileDpmPlan({
      ...input,
      manifest,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected compile failure')
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('REL013')
  })

  it('refuses columns that reference a relationship absent from the manifest relationship set', () => {
    const input = createCompileInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.columns[1].relationship = 'rel_missing_customer'
    manifest.columns[1].transform.relationship = 'rel_missing_customer'

    const result = compileDpmPlan({
      ...input,
      manifest,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected compile failure')
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('SAF012')
  })

  it('marks compiled plans stale when manifest freshness differs from snapshots', () => {
    const input = createCompileInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.catalog.version_hash = 'sha256:stale-catalog'

    const result = compileDpmPlan({
      ...input,
      manifest,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected stale compile success')
    expect(result.plan.stale).toBe(true)
    expect(result.plan.staleReasons).toEqual(['catalog_version_hash_changed'])
  })
})
