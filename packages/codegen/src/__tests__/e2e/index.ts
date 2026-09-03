export * from './helpers/cli-runner.js'
export * from './helpers/fixture-builder.js'

export const E2E_SUITE_METADATA = {
  name: 'oa-sdk-root-config-drift-e2e',
  version: '1.0.0',
  tiers: {
    tier1: {
      name: 'Tier 1: Feature Coverage',
      testCount: 80,
      file: 'tier1-feature-coverage.test.ts',
    },
    tier2: {
      name: 'Tier 2: Boundary & Corner Cases',
      testCount: 80,
      file: 'tier2-boundary-cases.test.ts',
    },
    tier3: {
      name: 'Tier 3: Cross-Feature Interactions',
      testCount: 16,
      file: 'tier3-interactions.test.ts',
    },
    tier4: {
      name: 'Tier 4: Real-World Scenarios',
      testCount: 8,
      file: 'tier4-real-world.test.ts',
    },
    subdirectory: {
      name: 'Subdirectory Execution Conformance',
      testCount: 18,
      file: 'subdirectory-conformance.test.ts',
    },
  },
  totalTierTests: 184,
  totalTests: 202,
}
