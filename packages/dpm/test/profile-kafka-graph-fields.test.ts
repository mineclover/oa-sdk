import { describe, expect, it } from 'vitest'

import {
  readKafkaOrdersCreatedProfileArtifact,
} from './support/profile-kafka-fixtures.js'

describe('DPM Kafka topic profile graph fields', () => {
  it('flattens nested message fields into stable profile nodes and edges', () => {
    const profile = readKafkaOrdersCreatedProfileArtifact()
    const nodesById = new Map(profile.nodes.map(node => [node.id, node]))
    const edgePairs = profile.edges.map(edge => `${edge.fromNodeId}->${edge.toNodeId}`)

    expect(nodesById.get('node:field:orders.created.value.customer')?.kind).toBe('message_field')
    expect(nodesById.get('node:field:orders.created.value.customer.customer_no')).toMatchObject({
      kind: 'message_field',
      label: 'value.customer.customer_no',
      dataType: 'string',
      coordinate: {
        kind: 'kafka_topic_bundle',
        path: 'orders.created.value.customer.customer_no',
        pointer: '/value/customer/customer_no',
      },
    })
    expect(edgePairs).toContain('node:topic:orders.created->node:field:orders.created.value.customer')
    expect(edgePairs).toContain('node:field:orders.created.value.customer->node:field:orders.created.value.customer.customer_no')
  })
})
