import { describe, expect, it } from 'vitest'

import {
  readKafkaOrdersCreatedProfileArtifact,
} from './support/profile-kafka-fixtures.js'

describe('DPM Kafka topic profile graph sections', () => {
  it('emits partition, key, header, schema, and field metrics from fixture evidence', () => {
    const profile = readKafkaOrdersCreatedProfileArtifact()

    expect(profile.nodes.map(node => node.id)).toEqual(expect.arrayContaining([
      'node:partition:orders.created.0',
      'node:key:orders.created',
      'node:header:orders.created.correlation_id',
      'node:schema-subject:orders.created-value',
    ]))
    expect(profile.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'metric:orders.created.key_coverage',
        kind: 'key_coverage_ratio',
        value: 0.998,
      }),
      expect.objectContaining({
        id: 'metric:orders.created.schema_version_count',
        kind: 'schema_version_count',
        value: 2,
      }),
      expect.objectContaining({
        id: 'metric:orders.created.message_rate_estimate',
        kind: 'message_rate_estimate',
        value: 42.5,
      }),
      expect.objectContaining({
        id: 'metric:orders.created.value.customer.customer_no.presence',
        kind: 'presence_ratio',
        value: 0.997,
      }),
      expect.objectContaining({
        id: 'metric:orders.created.value.order.promo_code.null',
        kind: 'null_ratio',
        value: 0.88,
      }),
    ]))
  })
})
