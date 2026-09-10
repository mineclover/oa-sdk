# Execution Plan: OpenAPI 3.2 to Zod 4 Generator (`generateZodFromSpec` & `oa-gen generate:zod`)

## Phase 0: Survey & Scope Mapping
- Spawn 3 parallel Explorers (Survey):
  - Explorer 1 (Spec & Algebra): Map `@oa-sdk/parser`'s `foldSchema` architecture, AST definitions, and algebra contracts needed for `createZod4Algebra`.
  - Explorer 2 (Vocabulary & Circular): Investigate OAS 3.2 / Draft 2020-12 vocabulary (`exclusiveMinimum/Maximum` numeric, `prefixItems`, `discriminator`, `strict()`, `z.lazy()` cycle detection).
  - Explorer 3 (CLI & Monorepo Integration): Investigate `oa-gen` CLI command dispatching in `@oa-sdk/codegen`, dependencies (Zod 4 installation/compatibility, `z.fromJSONSchema`), and test suites.
- Consolidate feature inventory into `/Users/junwoobang/workflow/oa-sdk/.agents/PROJECT.md`.

## Phase 1: Dual Track Initiation
- Track A (E2E Testing Track):
  - Spawn `teamwork_preview_test_writer` / testing agent to establish `TEST_INFRA.md` and create 4-tier E2E test suite (`test/e2e/zod4-generator.e2e.test.ts`), publishing `TEST_READY.md`.
- Track B (Implementation Track):
  - Milestone 1: Zod 4 Algebra & Engine Core (`generateZodFromSpec`, `createZod4Algebra` with `foldSchema`).
  - Milestone 2: Full OAS 3.2 / Draft 2020-12 Vocabulary Support & Cycle Resolution (`exclusiveMinimum`, `prefixItems`, `discriminator` + `defaultMapping`, `z.lazy()`, metadata).
  - Milestone 3: Dual Mode (Static TypeScript Emission + Dynamic Runtime Validator via `z.fromJSONSchema`).
  - Milestone 4: CLI Integration (`oa-gen generate:zod --spec <path> --output <dir>`).

## Phase 2: Final Verification & Hardening
- Run full E2E suite against implementation until 100% pass.
- Adversarial review & stress testing (Challengers).
- Forensic integrity audit (`teamwork_preview_auditor`).
- Multi-reviewer gate approval.
- Final completion report delivery to user.
