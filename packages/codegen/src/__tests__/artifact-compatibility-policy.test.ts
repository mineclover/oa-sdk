import { describe, expect, it } from 'vitest'
import {
  OA_SDK_ARTIFACT_COMPATIBILITY_POLICY_V1,
  findArtifactCompatibility,
  supportsArtifactSchemaVersion,
} from '../cli/lib/artifact-compatibility-policy.js'

describe('artifact compatibility policy', () => {
  it('declares the current supported schema and deterministic migration path for public artifacts', () => {
    expect(OA_SDK_ARTIFACT_COMPATIBILITY_POLICY_V1.schemaVersion).toBe('oa-sdk.artifact-compatibility-policy.v1')
    expect(findArtifactCompatibility('openapi-governance-config')).toMatchObject({
      currentSchemaVersion: 'oa-gen.openapi-governance.v2',
      migration: { whenUnsupported: 'run-config-scaffold' },
    })
    expect(supportsArtifactSchemaVersion('parallel-evidence', 'oa-sdk.parallel-evidence.v1')).toBe(true)
    expect(supportsArtifactSchemaVersion('parallel-evidence', 'oa-sdk.parallel-evidence.v2')).toBe(false)
  })
})
