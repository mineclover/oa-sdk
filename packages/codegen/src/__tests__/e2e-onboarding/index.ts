export * from './helpers/cli-runner.js'
export * from './helpers/fixture-builder.js'
export * from './helpers/oracle.js'
export * from './helpers/test-contracts.js'

export const E2E_ONBOARDING_METADATA = {
  name: 'oa-sdk-onboarding-systematization-e2e',
  version: '1.0.0',
  tiers: {
    tier1: {
      name: 'Tier 1: Feature Coverage (Features 1–17)',
      testCount: 85,
      file: 'tier1-features.test.ts',
    },
    tier2: {
      name: 'Tier 2: Boundary Value Analysis & Corner Cases',
      testCount: 40,
      file: 'tier2-boundaries.test.ts',
    },
    tier3: {
      name: 'Tier 3: Cross-Feature Combinations (Pairwise Coverage)',
      testCount: 20,
      file: 'tier3-combinations.test.ts',
    },
    tier4: {
      name: 'Tier 4: Real-World Workload Scenarios',
      testCount: 5,
      file: 'tier4-scenarios.test.ts',
    },
  },
  totalTests: 150,
}
