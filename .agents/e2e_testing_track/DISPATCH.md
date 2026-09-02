## 2026-09-02T14:53:23Z
You are the E2E Test Writer for the 4 Upstream Architectural Proposals in @oa-sdk.
Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/e2e_testing_track
Read ORIGINAL_REQUEST.md at /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md.
Read PROJECT.md at /Users/junwoobang/workflow/oa-sdk/PROJECT.md.
Read TEST_INFRA.md at /Users/junwoobang/workflow/oa-sdk/TEST_INFRA.md.
Read the specification at /Users/junwoobang/workflow/browser-studio/docs/specs/oa-sdk-integration-proposals.md.

Task:
Design and implement the comprehensive opaque-box E2E test suites (Tiers 1-4) across the 4 Upstream Architectural Proposals:
1. Discriminated Union Projection: `packages/openapi-projection-contract/test/e2e/discriminated-union.e2e.test.ts`
2. Surface Range Extensions & Linting: `packages/parser/test/e2e/surface-lint.e2e.test.ts` and `packages/openapi-projection-contract/test/e2e/surface-extensions.e2e.test.ts`
3. Standalone Type Guard Generator: `packages/codegen/test/e2e/standalone-guards.e2e.test.ts`
4. AST Bidirectional Synchronization: `packages/codegen/test/e2e/ast-bidirectional-sync.e2e.test.ts`
5. End-to-End Proposal Integration (Tier 4 scenarios): `packages/codegen/test/e2e/proposal-integration.e2e.test.ts`

Ensure you cover:
- Tier 1: Feature Coverage (>=5 test cases per feature)
- Tier 2: Boundary & Corner Cases (>=5 test cases per feature, invalid offsets, fingerprint drift, zero-variants, recursive schemas, invalid quotes, overlapping text edits)
- Tier 3: Cross-Feature Interactions (pairwise combinations)
- Tier 4: Real-World Scenarios (Chrome Native Messaging RPC stream, MCP Stdio protocol, 60fps parameter slider live patching, Zod <-> TS Interface AST sync, JSDoc/Typia comment retention).

Once test files are authored and validated, create TEST_READY.md at /Users/junwoobang/workflow/oa-sdk/TEST_READY.md summarizing test runner commands, tier coverage counts, and feature matrix.
Write your handoff report to /Users/junwoobang/workflow/oa-sdk/.agents/e2e_testing_track/handoff.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Send a message to parent upon completion.
