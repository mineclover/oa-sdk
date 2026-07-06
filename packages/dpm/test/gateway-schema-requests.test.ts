import { describe, expect, it } from 'vitest'

import { profileArtifact, profileCoordinate, relationshipHint } from './support/gateway-fixtures.js'
import { compileGatewayComponentSchema } from './support/gateway-schema.js'

const snapshotRef = { ref: 'catalog://commerce/v1', versionHash: 'sha256:test' }
const manifest = { dpm_version: '1.0' }

describe('DPM gateway request schemas', () => {
  it('rejects incomplete request payloads for gateway write operations', () => {
    for (const schemaName of [
      'DpmCatalogProfileRequest',
      'DpmProfileInspectionRequest',
      'DpmProfileAnalysisRequest',
      'DpmProfileProposalReviewRequest',
      'DpmRelationshipDiscoveryRequest',
      'DpmCandidateImportRequest',
      'DpmRelationshipApprovalRequest',
      'DpmManifestValidationRequest',
      'DpmManifestCompileRequest',
      'DpmManifestDryRunRequest',
      'DpmExecuteJobRequest',
    ]) {
      const schema = compileGatewayComponentSchema(schemaName)
      expect(schema({}), `${schemaName} unexpectedly accepted an empty object`).toBe(false)
    }
  })

  it('accepts minimal request payloads for gateway write operations', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['DpmCatalogProfileRequest', { datasetId: 'commerce_ai', catalogSourceRef: 'source://catalog', manifest }],
      ['DpmProfileInspectionRequest', { profileArtifact }],
      ['DpmProfileAnalysisRequest', { profileArtifact }],
      ['DpmProfileProposalReviewRequest', {
        status: 'accepted',
        reviewedBy: 'privacy-reviewer',
        reason: 'reviewed against catalog evidence',
        coordinate: profileCoordinate,
        relationshipHint,
      }],
      ['DpmRelationshipDiscoveryRequest', { manifest, catalogSnapshot: snapshotRef }],
      ['DpmCandidateImportRequest', { datasetId: 'commerce_ai', candidates: [{ name: 'rel_orders_customer', evidenceRef: 'evidence://rel' }] }],
      ['DpmRelationshipApprovalRequest', { owner: 'privacy', approvedBy: 'reviewer', reason: 'reviewed' }],
      ['DpmManifestValidationRequest', { manifest, catalogSnapshot: snapshotRef, registrySnapshot: snapshotRef }],
      ['DpmManifestCompileRequest', { manifest, catalogSnapshot: snapshotRef, registrySnapshot: snapshotRef }],
      ['DpmManifestDryRunRequest', { manifest, catalogSnapshot: snapshotRef, registrySnapshot: snapshotRef }],
      ['DpmExecuteJobRequest', { planRef: 'compiled-plan://commerce', targetDatasetRef: 'target://ai' }],
    ]

    for (const [schemaName, payload] of cases) {
      const schema = compileGatewayComponentSchema(schemaName)
      expect(schema(payload), JSON.stringify(schema.errors, null, 2)).toBe(true)
    }
  })
})
