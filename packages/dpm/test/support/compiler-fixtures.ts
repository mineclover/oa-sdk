import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  createPostgresCatalogSnapshot,
  parseRegistrySnapshotYaml,
  type DpmCompileInput,
  type PostgresCatalogSnapshotInput,
} from '../../src/index.js'

const fixturesRoot = new URL('../fixtures/', import.meta.url)

export function createCompileInput(): DpmCompileInput {
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

function readJsonFixture<T>(path: string): T {
  return JSON.parse(readFileSync(join(fixturesRoot.pathname, path), 'utf8')) as T
}

function readTextFixture(path: string): string {
  return readFileSync(join(fixturesRoot.pathname, path), 'utf8')
}
