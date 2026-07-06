import { describe, expect, it } from 'vitest'

import {
  createRegistrySnapshot,
  validateDpmManifest,
} from '../src/index.js'
import { createValidationInput } from './support/validator-fixtures.js'
import {
  expectedAmbiguousRegistryApprovalDiagnosticCodes,
} from './support/validator-relationship-fixtures.js'

describe('DPM relationship validator registry approval gates', () => {
  it('flags ambiguous approved registry matches deterministically', () => {
    const input = createValidationInput()
    const approved = input.registry.approvedRelationships[0]
    if (!approved) throw new Error('fixture must contain an approved relationship')
    const registry = createRegistrySnapshot({
      datasetId: input.registry.datasetId,
      registryVersion: input.registry.registryVersion,
      exportedAt: input.registry.exportedAt,
      relationships: [
        ...input.registry.relationships,
        {
          ...approved,
          version: '2',
          approval: {
            ...approved.approval,
            reason: 'Second approved version used to verify ambiguity diagnostics.',
          },
        },
      ],
    })

    const result = validateDpmManifest({
      ...input,
      registry,
    })

    expect(result.valid).toBe(false)
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      ...expectedAmbiguousRegistryApprovalDiagnosticCodes,
    ])
  })
})
