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

export const relationshipHint = {
  id: 'proposal:edge:relationship-hint:orders-created-customer',
  status: 'review',
  fromNodeId: 'node:field:orders.created.value.customer.customer_no',
  hintNodeId: 'node:relationship-hint:orders-created-customer',
  targetRef: 'catalog://commerce/public.customers.customer_no',
  confidence: 0.93,
  evidenceIds: ['evidence:kafka:orders.created.customer_no'],
  explanation: 'Review orders.created customer_no as a relationship hint.',
}

export const profileAnalysisReport = {
  kind: 'dpm.profile.analysis-report.v1',
  reportId: 'profile-analysis:orders.created',
  profileId: 'profile:kafka:orders.created',
  datasetId: 'commerce_ai',
  profileVersion: '2026-07-04',
  analyzedAt: '2026-07-04T00:00:00.000Z',
  profileVersionHash: 'sha256:profile',
  coverage: {
    sourceKindCounts: { kafka_topic_bundle: 1 },
    nodeKindCounts: { message_field: 1 },
    metricKindCounts: {},
    measuredNodeCount: 0,
    measuredNodeRatio: 0,
  },
  relationshipHints: [relationshipHint],
  keyCandidates: [],
  driftSignals: [],
  riskIndicators: [],
  diagnostics: [],
  summary: {
    nodeCount: 1,
    edgeCount: 0,
    metricCount: 0,
    diagnosticCount: 0,
    relationshipHintCount: 1,
    keyCandidateCount: 0,
    riskIndicatorCount: 0,
    driftSignalCount: 0,
  },
  freshness: {
    reportHash: 'sha256:analysis',
    profileVersionHash: 'sha256:profile',
  },
}
