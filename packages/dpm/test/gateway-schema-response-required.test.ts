import { describe, expect, it } from 'vitest'

import { compileGatewayComponentSchema } from './support/gateway-schema.js'

describe('DPM gateway required response schemas', () => {
  it('rejects incomplete response payloads for gateway workflow schemas', () => {
    for (const schemaName of [
      'DpmCatalogProfileResponse',
      'DpmProfileInspectionResponse',
      'DpmProfileAnalysisResponse',
      'DpmProfileProposalReviewResponse',
      'DpmRelationshipDiscoveryReport',
      'DpmCandidateImportResponse',
      'DpmRelationshipApprovalResponse',
      'DpmRegistrySnapshotResponse',
      'DpmExecuteJobResponse',
      'DpmJobReport',
    ]) {
      const schema = compileGatewayComponentSchema(schemaName)
      expect(schema({}), `${schemaName} unexpectedly accepted an empty object`).toBe(false)
    }
  })
})
