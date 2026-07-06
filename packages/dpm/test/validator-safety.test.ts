import { describe, expect, it } from 'vitest'

import { validateDpmManifest } from '../src/index.js'
import {
  createValidationInput,
  expectedMissingRelationshipSafetyDiagnosticCodes,
} from './support/validator-fixtures.js'

describe('DPM validator safety gates', () => {
  it('rejects columns that reference a relationship absent from the manifest relationship set', () => {
    const input = createValidationInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.columns[1].relationship = 'rel_missing_customer'
    manifest.columns[1].transform.relationship = 'rel_missing_customer'

    const result = validateDpmManifest({
      ...input,
      manifest,
    })

    expect(result.valid).toBe(false)
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      ...expectedMissingRelationshipSafetyDiagnosticCodes,
    ])
    expect(result.diagnostics.find(diagnostic => diagnostic.code === 'SAF012')).toMatchObject({
      sourcePointer: '/columns/1/relationship',
      registryCoordinate: {
        datasetId: 'commerce_ai',
        registryVersion: 'reg-2026-07-01',
        relationshipName: 'rel_missing_customer',
      },
    })
  })
})
