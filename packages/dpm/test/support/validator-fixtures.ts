import {
  createPostgresCatalogSnapshot,
  parseRegistrySnapshotYaml,
  type DpmValidationInput,
  type PostgresCatalogSnapshotInput,
} from '../../src/index.js'
import {
  readDpmJsonFixture,
  readDpmTextFixture,
} from './fixture-io.js'

export function createValidationInput(): DpmValidationInput {
  return {
    manifest: readDpmJsonFixture('valid/customer-orders.json'),
    catalog: createPostgresCatalogSnapshot(
      readDpmJsonFixture<PostgresCatalogSnapshotInput>('catalog/postgres-commerce.json'),
    ),
    registry: parseRegistrySnapshotYaml(readDpmTextFixture('registry/commerce-registry.yaml')),
    phase: 'validate',
  }
}
