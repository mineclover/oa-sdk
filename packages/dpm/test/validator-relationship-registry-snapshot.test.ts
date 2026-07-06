import { describe, expect, it } from 'vitest'

import { validateDpmManifest } from '../src/index.js'
import { createValidationInput } from './support/validator-fixtures.js'

describe('DPM relationship validator registry snapshot gates', () => {
  it('rejects manifests that spoof an approved registry relationship by changing its approved namespace', () => {
    const input = createValidationInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.relationships[0].namespace = 'account'

    const result = validateDpmManifest({
      ...input,
      manifest,
    })

    expect(result.valid).toBe(false)
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['REL013', 'SAF007'])
    expect(result.diagnostics.find(diagnostic => diagnostic.code === 'REL013')).toMatchObject({
      sourcePointer: '/relationships/0/namespace',
      registryCoordinate: {
        datasetId: 'commerce_ai',
        registryVersion: 'reg-2026-07-01',
        relationshipName: 'rel_orders_customer',
        relationshipVersion: '1',
        status: 'approved',
      },
    })
  })
})
