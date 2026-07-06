import { describe, expect, it } from 'vitest'

import { validateDpmManifest } from '../src/index.js'
import {
  createUnsafeRelationshipDiagnosticInput,
} from './support/validator-relationship-fixtures.js'

describe('DPM relationship validator diagnostics', () => {
  it('emits deterministic REL and SAF diagnostics for unsafe manifests', () => {
    const result = validateDpmManifest(createUnsafeRelationshipDiagnosticInput())

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
