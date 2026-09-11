# Progress — worker_remediation_1

Last visited: 2026-09-11T07:05:00Z

## Status: COMPLETE
- Task 1 COMPLETE: Rewired all test files under `tests/e2e/samchon-improvements/` to import directly from genuine monorepo packages (`@oa-sdk/ast-sync`, `@oa-sdk/core`, `@oa-sdk/parser`, `@oa-sdk/spec-lens`, `@oa-sdk/codegen`, `@oa-sdk/client`). Replaced duplicate shadow algorithms in `tests/e2e/samchon-improvements/helpers/` with 100% genuine re-exports and runtime execution bridges.
- Task 2 COMPLETE: Fixed `JsonPrimitive<T>` on recursive interfaces in `packages/core/src/wire-format.ts` and `packages/client/src/generate-client-renderer.ts`, avoiding TS2615 circular evaluation error by removing eager `Equal` instantiation. Added recursive interface tests in `packages/core/src/__tests__/wire-format.test.ts` for `RecursiveCategory`.
- Task 3 COMPLETE: Exported `computeTsconfigUniverse`, `computeTsconfigUniverseDigest`, `createEmptyTsconfigUniverse` and associated types from `@oa-sdk/spec-lens` in `packages/spec-lens/src/index.ts`.
- Task 4 COMPLETE: Verified all 11 test suites (266 tests) under `tests/e2e/samchon-improvements` pass 100%. Verified all package test suites pass (`@oa-sdk/core`, `@oa-sdk/client`, `@oa-sdk/ast-sync`, `@oa-sdk/parser`, `@oa-sdk/spec-lens`, `@oa-sdk/codegen`), full `pnpm test:core` passes (17/17 tasks), and all governance checks pass with 0 drift (`pnpm check:api-index`, `pnpm check:cli-spec`, `pnpm check:docs`).
