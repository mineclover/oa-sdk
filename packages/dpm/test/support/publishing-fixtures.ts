import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  compileDpmPlan,
  createPostgresCatalogSnapshot,
  parseRegistrySnapshotYaml,
  type DpmCompiledPlan,
  type PostgresCatalogSnapshotInput,
} from '../../src/index.js'

const fixturesRoot = new URL('../fixtures/', import.meta.url)

export function createPublishingCompiledPlan(): DpmCompiledPlan {
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

function readJsonFixture<T>(path: string): T {
  return JSON.parse(readFileSync(join(fixturesRoot.pathname, path), 'utf8')) as T
}

function readTextFixture(path: string): string {
  return readFileSync(join(fixturesRoot.pathname, path), 'utf8')
}
