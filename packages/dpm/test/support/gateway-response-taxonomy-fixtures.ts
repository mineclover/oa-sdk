import type {
  GatewayWorkflowResponseSchemaName,
} from './gateway-workflow-response-schema-fixtures.js'
import {
  readCommerceDiscoveryReport,
} from './discovery-fixtures.js'

type GatewayInvalidResponseTaxonomyCase =
  readonly [GatewayWorkflowResponseSchemaName, Record<string, unknown>, string]

const discoveryReport = readCommerceDiscoveryReport()

export const gatewayInvalidResponseTaxonomyCases = [
  ['DpmRelationshipDiscoveryReport', {
    ...discoveryReport,
    candidates: [{
      ...discoveryReport.candidates[0]!,
      recommendation: 'auto_approve',
    }],
  }, 'unknown recommendation'],
  ['DpmRegistrySnapshotResponse', {
    datasetId: 'commerce_ai',
    registryVersion: 'reg-2026-07-01',
    relationships: [{ name: 'rel_orders_customer', status: 'unknown_status' }],
  }, 'unknown relationship status'],
] as const satisfies readonly GatewayInvalidResponseTaxonomyCase[]
