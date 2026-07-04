import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  createPostgresCatalogSnapshot,
  parseRegistrySnapshotYaml,
  type DpmValidationInput,
  type PostgresCatalogSnapshotInput,
} from '../../src/index.js'

const fixturesRoot = new URL('../fixtures/', import.meta.url)

export function createValidationInput(): DpmValidationInput {
  return {
    manifest: readJsonFixture('valid/customer-orders.json'),
    catalog: createPostgresCatalogSnapshot(
      readJsonFixture<PostgresCatalogSnapshotInput>('catalog/postgres-commerce.json'),
    ),
    registry: parseRegistrySnapshotYaml(readTextFixture('registry/commerce-registry.yaml')),
    phase: 'validate',
  }
}

function readJsonFixture<T>(path: string): T {
  return JSON.parse(readFileSync(join(fixturesRoot.pathname, path), 'utf8')) as T
}

function readTextFixture(path: string): string {
  return readFileSync(join(fixturesRoot.pathname, path), 'utf8')
}
