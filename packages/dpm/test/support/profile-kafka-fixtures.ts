import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { DpmKafkaTopicProfileFixture } from '../../src/index.js'

const profileFixturesRoot = new URL('../fixtures/profile/', import.meta.url)

export function readKafkaOrdersCreatedFixture(): DpmKafkaTopicProfileFixture {
  return readProfileFixture<DpmKafkaTopicProfileFixture>('kafka-orders-created.json')
}

function readProfileFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(profileFixturesRoot.pathname, name), 'utf8')) as T
}
