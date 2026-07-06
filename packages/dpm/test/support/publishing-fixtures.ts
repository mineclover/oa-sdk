import {
  compileDpmPlan,
  createPostgresCatalogSnapshot,
  parseRegistrySnapshotYaml,
  type DpmCompiledPlan,
  type PostgresCatalogSnapshotInput,
} from '../../src/index.js'
import {
  readDpmJsonFixture,
  readDpmTextFixture,
} from './fixture-io.js'

export const expectedPublishingRelationshipMetadata = [
  {
    name: 'rel_orders_customer',
    namespace: 'customer',
    cardinality: 'one_to_many',
    joinPredicate: 'public.orders.customer_no = public.customers.customer_no',
    readonly: true,
  },
] as const

export const expectedPublishingAiRelationshipContext = {
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
} as const

export const expectedPublishingReadonlyGrantHints = [
  'Use read-only access to the pseudonymized target dataset.',
  'Do not request source database, secret store, or token lookup access.',
] as const

export const expectedPublishingPhysicalForeignKeyRecommendations = [
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
] as const

export function createPublishingCompiledPlan(): DpmCompiledPlan {
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
  return compiled.plan
}
