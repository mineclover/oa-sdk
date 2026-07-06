import { describe, expect, it } from 'vitest'

import { validateDpmManifest } from '../src/index.js'
import { createValidationInput } from './support/validator-fixtures.js'

describe('DPM relationship validator diagnostics', () => {
  it('emits deterministic REL and SAF diagnostics for unsafe manifests', () => {
    const input = createValidationInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.relationship_registry.registry_version = 'reg-stale'
    manifest.vault.mode = 'runtime'
    manifest.quality_gates = []
    manifest.entities[0].namespace = 'account'
    manifest.relationships = [
      {
        ...manifest.relationships[0],
        name: 'rel_orders_status',
        parent: {
          table: 'public.order_statuses',
          columns: ['status'],
        },
        child: {
          table: 'public.orders',
          columns: ['amount'],
        },
        namespace: 'order_status',
        transform_strategy: 'keep_code',
      },
      {
        ...manifest.relationships[0],
        name: 'rel_missing_customer',
        parent: {
          table: 'public.customers',
          columns: ['customer_no'],
        },
        child: {
          table: 'public.orders',
          columns: ['customer_no', 'order_id'],
        },
      },
    ]
    manifest.columns = [
      {
        table: 'public.customers',
        column: 'customer_no',
        role: 'direct_identifier',
        pii: true,
        transform: { type: 'keep' },
      },
      {
        table: 'public.orders',
        column: 'customer_no',
        role: 'foreign_identifier',
        pii: true,
        transform: { type: 'relationship_token' },
      },
      {
        table: 'public.orders',
        column: 'amount',
        role: 'business_identifier',
        pii: true,
        transform: { type: 'keep' },
      },
      {
        table: 'public.orders',
        column: 'customer_no',
        role: 'foreign_identifier',
        pii: true,
        entity: 'customer',
        relationship: 'rel_orders_status',
        transform: {
          type: 'relationship_token',
          relationship: 'rel_orders_status',
        },
      },
    ]

    const result = validateDpmManifest({
      ...input,
      manifest,
      phase: 'compile',
    })

    expect(result.valid).toBe(false)
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'REL001',
      'REL003',
      'REL006',
      'REL010',
      'REL011',
      'SAF001',
      'SAF002',
      'SAF007',
      'SAF009',
      'SAF010',
      'SAF011',
      'SYN001',
      'SYN001',
      'SYN001',
      'SYN001',
      'SYN001',
      'SYN001',
    ])
    expect(result.diagnostics.find(diagnostic => diagnostic.code === 'REL006')).toMatchObject({
      registryCoordinate: {
        datasetId: 'commerce_ai',
        relationshipName: 'rel_orders_status',
        registryVersion: 'reg-2026-07-01',
      },
    })
    expect(result.diagnostics.find(diagnostic => diagnostic.code === 'REL001')).toMatchObject({
      catalogCoordinate: {
        table: 'public.order_statuses',
      },
      sourcePointer: '/relationships/0/parent/table',
    })
  })
})
