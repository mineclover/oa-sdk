import {
  createPostgresCatalogSnapshot,
  parseRegistrySnapshotYaml,
  type DpmCompileInput,
  type PostgresCatalogSnapshotInput,
} from '../../src/index.js'
import {
  readDpmJsonFixture,
  readDpmTextFixture,
} from './fixture-io.js'

export const expectedCompiledRelationshipStepNames = [
  'rel_orders_customer',
] as const

export const expectedCompiledCustomerNamespaceBinding = {
  namespace: 'customer',
  entity: 'customer',
  relationships: ['rel_orders_customer'],
  columns: ['public.customers.customer_no', 'public.orders.customer_no'],
} as const

export const expectedCatalogStaleReasons = [
  'catalog_version_hash_changed',
] as const

export function createCompileInput(): DpmCompileInput {
  const catalog = createPostgresCatalogSnapshot(
    readDpmJsonFixture<PostgresCatalogSnapshotInput>('catalog/postgres-commerce.json'),
  )
  const manifest = readDpmJsonFixture<Record<string, any>>('valid/customer-orders.json')

  return {
    manifest,
    catalog,
    registry: parseRegistrySnapshotYaml(readDpmTextFixture('registry/commerce-registry.yaml')),
  }
}

export {
  compilerValidationBlockingCases,
} from './compiler-validation-fixtures.js'
