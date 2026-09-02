## 2026-09-03T07:05:58+09:00

You are the E2E Test Writer for the OA-SDK and Browser-Studio CLI feature expansions and conventions project.
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/test_writer_e2e
Project root: /Users/junwoobang/workflow/oa-sdk
Authoritative user request: /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md
Project plan: /Users/junwoobang/workflow/oa-sdk/PROJECT.md

Task:
1. Read /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md and /Users/junwoobang/workflow/oa-sdk/PROJECT.md.
2. Create /Users/junwoobang/workflow/oa-sdk/TEST_INFRA.md following the 4-tier test architecture:
   - Tier 1: Feature Coverage (>=5 per feature across R1, R2, R3, R4)
   - Tier 2: Boundary & Corner Cases (>=5 per feature)
   - Tier 3: Cross-Feature Combinations (pairwise interactions)
   - Tier 4: Real-World Application Scenarios
3. Author the comprehensive E2E test suite in packages/codegen/test/e2e/cli-expansions.e2e.test.ts (or corresponding test files in packages/codegen/test/):
   - R1 tests: --split producing separate .js and .d.ts files in guards/ and root index.js barrel; --schemas filtering by type name or guard function name (e.g. isSurfaceBlock, isSurfaceParam); dynamic execution verifying 0 eval, 0 new Function, 0 runtime imports.
   - R2 tests: oa-codegen lint --categories surface executing only surface rules; oa-codegen validate --profile operation-contract failing when paths has no operations and passing when valid; oa-codegen validate --profile component-bundle.
   - R3 tests: oa-codegen audit:csp --bundle <dir> passing on clean standalone guard bundles and failing with exit code 1 on bundles containing eval, new Function, setTimeout("string"), setInterval("string"), and imports of ajv, zod, @oa-sdk.
   - R4 tests: verify presence, completeness, and validity of documentation in browser-studio/docs/guides/schema-architecture-and-conventions.md for RFC 9457, numeric bounds, z.lazy, x-surface-*, and V3 JSDoc tags.
4. Run the test suite once created to confirm setup (or document runner command).
5. Create /Users/junwoobang/workflow/oa-sdk/TEST_READY.md at project root with test runner command and coverage summary.
6. Write your handoff report to /Users/junwoobang/workflow/oa-sdk/.agents/test_writer_e2e/handoff.md and notify parent via send_message.
