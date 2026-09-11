## 2026-09-11T05:55:41Z

You are Worker Remediation 1 for the @oa-sdk project.
Your identity: worker_remediation_1
Your working directory: /Users/junwoobang/workflow/oa-sdk/.agents/worker_remediation_1
Workspace root: /Users/junwoobang/workflow/oa-sdk
Parent orchestrator: orchestrator_5 (d0cddab6-f867-4aaa-b30e-0224e58b2fac)

MANDATORY FIRST STEP:
Read /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md (specifically 2026-09-11T04:41:22Z), /Users/junwoobang/workflow/oa-sdk/PROJECT.md, and the reviewer handoffs:
- /Users/junwoobang/workflow/oa-sdk/.agents/reviewer_1/handoff.md
- /Users/junwoobang/workflow/oa-sdk/.agents/reviewer_2/handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

REMEDIATION TASKS:
1. Rewire `tests/e2e/samchon-improvements/` to import directly from monorepo packages:
   - All test files in `tests/e2e/samchon-improvements/` (`tier1-*.test.ts`, `tier2-*.test.ts`, `tier3-*.test.ts`, `tier4-*.test.ts`, `runner.ts`) currently import from `tests/e2e/samchon-improvements/helpers/*` (which are shadow duplicate implementations).
   - Rewire them to import directly from the genuine packages:
     - `@oa-sdk/ast-sync`: `classifyTypeShape`, `auditTypeShapesInSource`, `detectCyclesWithChecker`, `createVirtualProgram`, `createInMemoryProgram`, `createProgramFromTsconfig`, `cleanupProgram`.
     - `@oa-sdk/core`: `JsonPrimitive`, `Resolved`, `ValueOf`, `ClassProperties`.
     - `@oa-sdk/client`: `generateClient`, `JsonPrimitive`, `Resolved`.
     - `@oa-sdk/parser`: `extractOperationsFromSource`, `extractOperationsFromFile`, `toOperationEntry`.
     - `@oa-sdk/spec-lens`: `computeTsconfigUniverse`, `computeTsconfigUniverseDigest`, `createSpecProjectIdentity`, `buildSpecProjectKey`.
     - `@oa-sdk/codegen`: `auditShapeCommand` or run live CLI `oa-gen audit:shape`.
   - Remove or replace the shadow helpers in `tests/e2e/samchon-improvements/helpers/` so that tests test the ACTUAL packages.
2. Fix `JsonPrimitive<T>` on recursive interfaces in `packages/core/src/wire-format.ts`:
   - On self-referential / recursive interfaces (e.g. `interface Category { id: string; parent?: Category }`), TypeScript produces `TS2615: Type of property circularly references itself in mapped type`.
   - Fix `JsonPrimitive<T>` in `packages/core/src/wire-format.ts` so it handles self-referential interfaces without TS2615 (e.g. follow Typia's pattern or defer mapped evaluation for recursive interfaces).
   - Also update the inline wire-format definition in `packages/client/src/generate-client-renderer.ts` to match.
   - Add a test case for `interface RecursiveCategory { id: string; parent?: RecursiveCategory; children?: RecursiveCategory[] }` in `packages/core/src/__tests__/wire-format.test.ts`.
3. Export `computeTsconfigUniverse` from `@oa-sdk/spec-lens`:
   - In `packages/spec-lens/src/index.ts`, re-export `computeTsconfigUniverse`, `computeTsconfigUniverseDigest`, `createEmptyTsconfigUniverse`, and types `ContractConfigDigest`, `ContractConfigUniverse`, `ConfigurationClosure` from `./infrastructure/cache/sqlite/cache-key.js` or `./infrastructure/cache/sqlite/tsconfig-universe.js`.
   - Update `docs/internal/api-index.md` if necessary and verify `pnpm build:scripts && pnpm check:api-index`.
4. Verification:
   - Run `pnpm vitest run tests/e2e/samchon-improvements`: ensure all tests pass importing directly from actual packages.
   - Run `pnpm --filter @oa-sdk/core test`.
   - Run `pnpm --filter @oa-sdk/client test`.
   - Run `pnpm --filter @oa-sdk/ast-sync test`.
   - Run `pnpm --filter @oa-sdk/parser test`.
   - Run `pnpm --filter @oa-sdk/spec-lens test`.
   - Run `pnpm check:api-index`, `pnpm check:cli-spec`, `pnpm check:docs`.
   - Run `pnpm test`.
5. Deliver comprehensive report in `/Users/junwoobang/workflow/oa-sdk/.agents/worker_remediation_1/handoff.md` and message parent when complete.

## 2026-09-11T06:23:16Z
**Context**: Remediation Progress Check
**Content**: Checking your status. What is your current progress on rewiring tests and running the test suite?
**Action**: Please report your status immediately or finalize your handoff.md.
