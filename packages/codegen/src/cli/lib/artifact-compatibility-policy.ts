/**
 * Compatibility declaration for machine-readable artifacts that cross package
 * or repository boundaries. This is intentionally separate from API-contract
 * SemVer: a contract version describes the API; this policy describes tooling
 * artifacts used to review and operate that API.
 */
export const ARTIFACT_COMPATIBILITY_POLICY_SCHEMA_VERSION = 'oa-sdk.artifact-compatibility-policy.v1' as const

export type ArtifactCompatibilityEntry = {
  artifact: string
  currentSchemaVersion: string
  supportedSchemaVersions: readonly string[]
  stability: 'stable' | 'experimental' | 'external'
  migration: {
    whenUnsupported: 'regenerate-from-source' | 'run-config-scaffold'
    guide: string
  }
}

export type ArtifactCompatibilityPolicyV1 = {
  schemaVersion: typeof ARTIFACT_COMPATIBILITY_POLICY_SCHEMA_VERSION
  supportWindow: {
    policy: 'current-major-schema-only'
    deprecatedSchemaHandling: 'reject-with-migration-guide'
  }
  artifacts: readonly ArtifactCompatibilityEntry[]
}

/**
 * The public support boundary for OA SDK artifacts. Add a new entry before a
 * producer emits a new incompatible schema, retain old entries only while a
 * reader intentionally supports them, and point migrations at an executable
 * or deterministic regeneration path.
 */
export const OA_SDK_ARTIFACT_COMPATIBILITY_POLICY_V1: ArtifactCompatibilityPolicyV1 = {
  schemaVersion: ARTIFACT_COMPATIBILITY_POLICY_SCHEMA_VERSION,
  supportWindow: {
    policy: 'current-major-schema-only',
    deprecatedSchemaHandling: 'reject-with-migration-guide',
  },
  artifacts: [
    {
      artifact: 'typespec-ref-provenance',
      currentSchemaVersion: 'oa-sdk.typespec-ref-provenance.v1',
      supportedSchemaVersions: ['oa-sdk.typespec-ref-provenance.v1'],
      stability: 'stable',
      migration: { whenUnsupported: 'regenerate-from-source', guide: 'docs/internal/typespec-roundtrip/parallel-evidence-contract.md' },
    },
    {
      artifact: 'parallel-evidence',
      currentSchemaVersion: 'oa-sdk.parallel-evidence.v1',
      supportedSchemaVersions: ['oa-sdk.parallel-evidence.v1'],
      stability: 'stable',
      migration: { whenUnsupported: 'regenerate-from-source', guide: 'docs/internal/typespec-roundtrip/parallel-evidence-contract.md' },
    },
    {
      artifact: 'parallel-evidence-report',
      currentSchemaVersion: 'oa-sdk.parallel-evidence-report.v1',
      supportedSchemaVersions: ['oa-sdk.parallel-evidence-report.v1'],
      stability: 'stable',
      migration: { whenUnsupported: 'regenerate-from-source', guide: 'docs/internal/typespec-roundtrip/parallel-evidence-contract.md' },
    },
    {
      artifact: 'openapi-governance-config',
      currentSchemaVersion: 'oa-gen.openapi-governance.v2',
      supportedSchemaVersions: ['oa-gen.openapi-governance.v2'],
      stability: 'stable',
      migration: { whenUnsupported: 'run-config-scaffold', guide: 'docs/guides/openapi-governance-service-template.md' },
    },
    {
      artifact: 'ttsc-contract-provenance',
      currentSchemaVersion: 'ttsc-contract-provenance.v2',
      supportedSchemaVersions: ['ttsc-contract-provenance.v2'],
      stability: 'external',
      migration: { whenUnsupported: 'regenerate-from-source', guide: 'docs/internal/typespec-roundtrip/parallel-evidence-contract.md' },
    },
    {
      artifact: 'ref-projection',
      currentSchemaVersion: 'oa-sdk.ref-projection.v1',
      supportedSchemaVersions: ['oa-sdk.ref-projection.v1'],
      stability: 'experimental',
      migration: { whenUnsupported: 'regenerate-from-source', guide: 'docs/guides/cli-command-reference.md' },
    },
  ],
}

export function findArtifactCompatibility(
  artifact: string,
  policy: ArtifactCompatibilityPolicyV1 = OA_SDK_ARTIFACT_COMPATIBILITY_POLICY_V1,
): ArtifactCompatibilityEntry | undefined {
  return policy.artifacts.find(entry => entry.artifact === artifact)
}

export function supportsArtifactSchemaVersion(
  artifact: string,
  schemaVersion: string,
  policy: ArtifactCompatibilityPolicyV1 = OA_SDK_ARTIFACT_COMPATIBILITY_POLICY_V1,
): boolean {
  return findArtifactCompatibility(artifact, policy)?.supportedSchemaVersions.includes(schemaVersion) ?? false
}
