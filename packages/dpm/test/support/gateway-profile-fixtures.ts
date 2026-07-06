export const profileCoordinate = {
  kind: 'kafka_topic_bundle',
  path: 'orders.created.value.customer.customer_no',
  sourceId: 'source:kafka:orders.created',
  pointer: '/value/customer/customer_no',
  externalId: 'kafka://commerce/orders.created',
}

export const profileArtifact = {
  kind: 'dpm.profile.artifact.v1',
  profileId: 'profile:kafka:orders.created',
  datasetId: 'commerce_ai',
  profileVersion: '2026-07-04',
  createdAt: '2026-07-04T00:00:00.000Z',
  sources: [{
    id: 'source:kafka:orders.created',
    kind: 'kafka_topic_bundle',
    connectorId: 'dpm.kafka.fixture',
    connectorVersion: '1.0.0',
    refs: ['kafka://commerce/orders.created'],
    captureMode: 'fixture',
  }],
  evidenceSources: {
    'evidence:kafka:orders.created.customer_no': {
      coordinate: profileCoordinate,
      connectorId: 'dpm.kafka.fixture',
    },
  },
  nodes: [{
    id: 'node:field:orders.created.value.customer.customer_no',
    kind: 'message_field',
    label: 'value.customer.customer_no',
    coordinate: profileCoordinate,
    dataType: 'string',
  }],
  edges: [],
  metrics: [],
  diagnostics: [],
  freshness: {
    versionHash: 'sha256:profile',
  },
}
