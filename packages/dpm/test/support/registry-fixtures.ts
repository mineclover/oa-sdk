import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  parseRegistrySnapshotYaml,
  type RegistrySnapshot,
} from '../../src/index.js'

const registryFixturesRoot = new URL('../fixtures/registry/', import.meta.url)

export function readRegistryFixture(name: string): string {
  return readFileSync(join(registryFixturesRoot.pathname, name), 'utf8')
}

export function readCommerceRegistrySnapshot(): RegistrySnapshot {
  return parseRegistrySnapshotYaml(readRegistryFixture('commerce-registry.yaml'))
}
