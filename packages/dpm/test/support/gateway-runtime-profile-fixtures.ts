import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  profileKafkaTopicFixture,
  type DpmKafkaTopicProfileFixture,
} from '../../src/index.js'

const fixturesRoot = new URL('../fixtures/', import.meta.url)
const kafkaProfilePath = join(fixturesRoot.pathname, 'profile/kafka-orders-created.json')

export function createKafkaProfileArtifact() {
  const result = profileKafkaTopicFixture(readJsonFixture<DpmKafkaTopicProfileFixture>(kafkaProfilePath))
  if (!result.profileArtifact) throw new Error('expected Kafka profile artifact')
  return result.profileArtifact
}

function readJsonFixture<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}
