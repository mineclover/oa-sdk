import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  createPostgresCatalogSnapshot,
  parseRegistrySnapshotYaml,
  profileKafkaTopicFixture,
  type DpmKafkaTopicProfileFixture,
} from '../../src/index.js'

const fixturesRoot = new URL('../fixtures/', import.meta.url)

export const manifestPath = join(fixturesRoot.pathname, 'valid/customer-orders.json')
export const catalogPath = join(fixturesRoot.pathname, 'catalog/postgres-commerce.json')
export const registryPath = join(fixturesRoot.pathname, 'registry/commerce-registry.yaml')
const kafkaProfilePath = join(fixturesRoot.pathname, 'profile/kafka-orders-created.json')

export function parseStdout(stdout: string): Record<string, any> {
  return JSON.parse(stdout) as Record<string, any>
}

export function createRuntimeInput() {
  return {
    manifest: readJsonFixture(manifestPath),
    catalog: createPostgresCatalogSnapshot(readJsonFixture(catalogPath)),
    registry: parseRegistrySnapshotYaml(readFileSync(registryPath, 'utf8')),
  }
}

export function createKafkaProfileArtifact() {
  const result = profileKafkaTopicFixture(readJsonFixture<DpmKafkaTopicProfileFixture>(kafkaProfilePath))
  if (!result.profileArtifact) throw new Error('expected Kafka profile artifact')
  return result.profileArtifact
}

function readJsonFixture<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}
