import { describe, expect, it } from 'vitest'

import { validateDpmManifest } from '../src/index.js'
import { createValidationInput } from './support/validator-fixtures.js'

describe('DPM semantic validator', () => {
  it('validates manifest, catalog snapshot, and registry snapshot without source DB access', () => {
    const result = validateDpmManifest(createValidationInput())

    expect(result.valid).toBe(true)
    expect(result.summary).toEqual({ errors: 0, warnings: 1, infos: 0 })
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'SAF007',
        sourcePointer: '/quality_gates',
      }),
    ])
  })
})
