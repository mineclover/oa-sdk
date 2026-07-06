import {
  profileKafkaTopicFixture,
  type DpmKafkaTopicProfileFixture,
} from '../../src/index.js'
import { readDpmJsonFixture } from './fixture-io.js'

export function createKafkaProfileArtifact() {
  const result = profileKafkaTopicFixture(
    readDpmJsonFixture<DpmKafkaTopicProfileFixture>('profile/kafka-orders-created.json'),
  )
  if (!result.profileArtifact) throw new Error('expected Kafka profile artifact')
  return result.profileArtifact
}
