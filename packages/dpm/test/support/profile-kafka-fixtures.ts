import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  profileKafkaTopicFixture,
  type DpmKafkaTopicProfileFixture,
  type DpmProfileArtifact,
} from '../../src/index.js'

const profileFixturesRoot = new URL('../fixtures/profile/', import.meta.url)

export function readKafkaOrdersCreatedFixture(): DpmKafkaTopicProfileFixture {
  return readProfileFixture<DpmKafkaTopicProfileFixture>('kafka-orders-created.json')
}

export function readKafkaOrdersCreatedProfileArtifact(): DpmProfileArtifact {
  const profile = profileKafkaTopicFixture(readKafkaOrdersCreatedFixture()).profileArtifact
  if (!profile) throw new Error('expected Kafka profile artifact')
  return profile
}

function readProfileFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(profileFixturesRoot.pathname, name), 'utf8')) as T
}
