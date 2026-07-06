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
