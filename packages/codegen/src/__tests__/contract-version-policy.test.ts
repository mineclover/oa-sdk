import { describe, expect, it } from 'vitest'
import {
  evaluateContractVersionPolicy,
  parseSemanticVersion,
} from '../cli/lib/contract-version-policy.js'
import type { DiffResult } from '../cli/lib/openapi-breaking-diff.js'

const noChanges: DiffResult = { added: [], removed: [], modified: [] }
const endpointRemoved: DiffResult = {
  added: [],
  modified: [],
  removed: [{
    path: '/users',
    method: 'get',
    parameters: [],
    parameterDetails: [],
    responses: ['200'],
    requestBodyRequired: false,
    requestBodyRequiredFields: [],
    responseSchemaFingerprints: {},
  }],
}

describe('contract version policy', () => {
  it('parses stable SemVer values only', () => {
    expect(parseSemanticVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(parseSemanticVersion('01.2.3')).toBeUndefined()
    expect(parseSemanticVersion('1.2.3-beta.1')).toBeUndefined()
  })

  it('permits unchanged versions when no breaking change exists', () => {
    expect(evaluateContractVersionPolicy({
      baseVersion: '0.1.0',
      headVersion: '0.1.0',
      diff: noChanges,
    })).toMatchObject({ pass: true, breakingChangeCount: 0 })
  })

  it('requires a minor bump for a pre-1.0 breaking change', () => {
    expect(evaluateContractVersionPolicy({
      baseVersion: '0.1.4',
      headVersion: '0.2.0',
      diff: endpointRemoved,
    })).toMatchObject({ pass: true, breakingChangeCount: 1 })
    expect(evaluateContractVersionPolicy({
      baseVersion: '0.1.4',
      headVersion: '0.1.5',
      diff: endpointRemoved,
    })).toMatchObject({ pass: false })
  })

  it('requires a major bump for a stable breaking change', () => {
    expect(evaluateContractVersionPolicy({
      baseVersion: '1.4.2',
      headVersion: '2.0.0',
      diff: endpointRemoved,
    })).toMatchObject({ pass: true, breakingChangeCount: 1 })
    expect(evaluateContractVersionPolicy({
      baseVersion: '1.4.2',
      headVersion: '1.5.0',
      diff: endpointRemoved,
    })).toMatchObject({ pass: false })
  })

  it('rejects contract version regressions', () => {
    expect(evaluateContractVersionPolicy({
      baseVersion: '1.4.2',
      headVersion: '1.4.1',
      diff: noChanges,
    })).toMatchObject({ pass: false })
  })
})
