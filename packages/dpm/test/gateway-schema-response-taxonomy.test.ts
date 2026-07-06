import { describe, expect, it } from 'vitest'

import { compileGatewayComponentSchema } from './support/gateway-schema.js'

describe('DPM gateway response taxonomy schemas', () => {
  it('rejects workflow response taxonomy values outside DPM review and registry contracts', () => {
    const discoverySchema = compileGatewayComponentSchema('DpmRelationshipDiscoveryReport')
    const registrySchema = compileGatewayComponentSchema('DpmRegistrySnapshotResponse')

    expect(discoverySchema({
      reportRef: 'report://discovery',
      candidates: [{ name: 'rel_orders_customer', recommendation: 'auto_approve' }],
    }), 'DpmRelationshipDiscoveryReport unexpectedly accepted an unknown recommendation').toBe(false)
    expect(registrySchema({
      datasetId: 'commerce_ai',
      registryVersion: 'reg-2026-07-01',
      relationships: [{ name: 'rel_orders_customer', status: 'unknown_status' }],
    }), 'DpmRegistrySnapshotResponse unexpectedly accepted an unknown relationship status').toBe(false)
  })
})
