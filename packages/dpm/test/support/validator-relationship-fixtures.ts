import type { DpmValidationInput } from '../../src/index.js'
import { createValidationInput } from './validator-fixtures.js'

export const expectedUnsafeRelationshipDiagnosticCodes = [
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
] as const

export const expectedAmbiguousRegistryApprovalDiagnosticCodes = [
  'REL012',
  'SAF007',
] as const

export const expectedApprovedRegistrySnapshotMismatchDiagnosticCodes = [
  'REL013',
  'SAF007',
] as const

export function createUnsafeRelationshipDiagnosticInput(): DpmValidationInput {
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

  return {
    ...input,
    manifest,
    phase: 'compile',
  }
}
