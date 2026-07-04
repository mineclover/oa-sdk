export type DpmKafkaTopicProfileFixture = {
  profileId: string
  datasetId: string
  profileVersion: string
  createdAt: string
  connectorId?: string
  connectorVersion?: string
  clusterRef: string
  topic: DpmKafkaTopicFixture
}

export type DpmKafkaTopicFixture = {
  name: string
  partitions: number[]
  messageRateEstimate?: number
  key?: DpmKafkaKeyFixture
  headers?: DpmKafkaHeaderFixture[]
  schema?: DpmKafkaSchemaFixture
  value: {
    fields: DpmKafkaMessageFieldFixture[]
  }
  relationshipHints?: DpmKafkaRelationshipHintFixture[]
}

export type DpmKafkaKeyFixture = {
  dataType: string
  coverageRatio?: number
}

export type DpmKafkaHeaderFixture = {
  name: string
  dataType: string
  presenceRatio?: number
}

export type DpmKafkaSchemaFixture = {
  subject: string
  format: string
  versions: number[]
}

export type DpmKafkaMessageFieldFixture = {
  name: string
  dataType: string
  presenceRatio?: number
  nullRatio?: number
  fields?: DpmKafkaMessageFieldFixture[]
}

export type DpmKafkaRelationshipHintFixture = {
  id: string
  label: string
  fromPath: string
  toRef: string
  confidence: number
  evidenceRef?: string
}
