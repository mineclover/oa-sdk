import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  compileDpmPlan,
  createDpmPublishingContext,
  createPostgresCatalogSnapshot,
  parseRegistrySnapshotYaml,
  type DpmCompiledPlan,
  type PostgresCatalogSnapshotInput,
} from '../src/index.js'

const fixturesRoot = new URL('./fixtures/', import.meta.url)

function readJsonFixture<T>(path: string): T {
  return JSON.parse(readFileSync(join(fixturesRoot.pathname, path), 'utf8')) as T
}

function readTextFixture(path: string): string {
  return readFileSync(join(fixturesRoot.pathname, path), 'utf8')
}

function createCompiledPlan(): DpmCompiledPlan {
  const catalog = createPostgresCatalogSnapshot(
    readJsonFixture<PostgresCatalogSnapshotInput>('catalog/postgres-commerce.json'),
  )
  const manifest = readJsonFixture<Record<string, any>>('valid/customer-orders.json')
  manifest.catalog.version_hash = catalog.freshness.versionHash
  const compiled = compileDpmPlan({
    manifest,
    catalog,
    registry: parseRegistrySnapshotYaml(readTextFixture('registry/commerce-registry.yaml')),
  })

  if (!compiled.ok) throw new Error('expected compile success')
  return compiled.plan
}

describe('DPM publishing context', () => {
  it('publishes AI relationship context only from validated relationship steps', () => {
    const plan = createCompiledPlan()
    const context = createDpmPublishingContext({
      plan,
      includeExamples: true,
    })

    expect(context.kind).toBe('dpm.publishing-context.v1')
    expect(context.relationshipMetadata.map(relationship => relationship.name)).toEqual(
      plan.relationshipSteps.map(step => step.name),
    )
    expect(context.relationshipMetadata).toEqual([
      expect.objectContaining({
        name: 'rel_orders_customer',
        namespace: 'customer',
        cardinality: 'one_to_many',
        joinPredicate: 'public.orders.customer_no = public.customers.customer_no',
        readonly: true,
      }),
    ])
    expect(context.aiSchemaContext.relationships[0]).toMatchObject({
      name: 'rel_orders_customer',
      namespace: 'customer',
      cardinality: 'one_to_many',
      description: 'Join public.orders to public.customers through the customer namespace.',
      examples: [
        {
          child: 'public.orders.customer_no',
          parent: 'public.customers.customer_no',
        },
      ],
    })
    expect(context.aiSchemaContext.readonlyGrantHints).toEqual([
      'Use read-only access to the pseudonymized target dataset.',
      'Do not request source database, secret store, or token lookup access.',
    ])
  })

  it('marks physical foreign key output as recommendations instead of mutations', () => {
    const context = createDpmPublishingContext({
      plan: createCompiledPlan(),
      includePhysicalForeignKeyRecommendations: true,
    })

    expect(context.physicalForeignKeyRecommendations).toEqual([
      {
        kind: 'physical_fk_recommendation',
        relationship: 'rel_orders_customer',
        childTable: 'public.orders',
        childColumns: ['customer_no'],
        parentTable: 'public.customers',
        parentColumns: ['customer_no'],
        applyMode: 'recommendation_only',
        mutation: 'none',
      },
    ])
  })

  it('excludes vault and reverse token lookup details from publishing context', () => {
    const context = createDpmPublishingContext({
      plan: createCompiledPlan(),
      includeExamples: true,
      includePhysicalForeignKeyRecommendations: true,
    })
    const serialized = JSON.stringify(context).toLowerCase()

    expect(serialized).not.toContain('vault')
    expect(serialized).not.toContain('reverse')
    expect(serialized).not.toContain('resolve')
  })
})
