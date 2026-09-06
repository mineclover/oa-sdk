# Implementation Plan: Typia AST Tags, Validation Benchmark Suite & Architectural Docs

## Overview
Implement, benchmark, document, and verify:
1. R1: Typia Type-Level Tag AST Parsing & Bidirectional Sync (`@oa-sdk/codegen` in `packages/codegen/src/ast-sync/adapters/typia.ts` and test suite `packages/codegen/test/ast-sync/typia-adapter.test.ts`)
2. R2: Validation Engine Performance Benchmark Suite (`@oa-sdk/codegen` in `packages/codegen/scripts/bench-validation-engines.ts` with npm script `bench:validation` in `packages/codegen/package.json`)
3. R3: Architectural Positioning & Comparative Benchmark Report Documentation (`docs/benchmarks/validation-engines.md`, `docs/README.md`, `docs/concepts/runtime-and-generation.md`, `docs/guides/schema-architecture-and-conventions.md`, `docs/internal/platform-scope.md`)
4. Monorepo Integrity & E2E Verification: `pnpm test` and `pnpm -r typecheck` clean.

## Execution Phases

### Phase 0: Survey & Project Blueprint
- Dispatch 3 Explorers:
  - Explorer 1: Codegen AST sync, `packages/codegen/src/ast-sync/adapters/typia.ts`, existing `EntityPropertySpec.constraints`, comment retention, and test suite.
  - Explorer 2: Validation benchmark infrastructure (`packages/codegen/scripts/bench-validation-engines.ts`), benchmark engines (Zod, Standalone type guards `ajv/dist/standalone`, Typia `typia.is<T>`), CSP audit, metrics.
  - Explorer 3: Documentation structure (`docs/`), existing benchmark docs, concepts, guides, and platform-scope.
- Synthesize into updated `PROJECT.md` and `TEST_INFRA.md`.

### Phase 1: Dual Track Execution
- **Track A: E2E Testing Track**
  - Design and implement comprehensive tests covering Tiers 1-4 for R1, R2, and R3.
  - Publish `TEST_READY.md`.
- **Track B: Implementation Track Milestones**
  - Milestone 1: Typia Type-Level Tag AST Parsing & Bidirectional Sync (R1)
  - Milestone 2: Validation Engine Performance Benchmark Suite (R2)
  - Milestone 3: Architectural Positioning & Comparative Benchmark Report Documentation (R3)

### Phase 2: Final Milestone
- Verify 100% E2E test pass across Tiers 1-4
- Tier 5 adversarial coverage hardening

### Phase 3: Monorepo Integrity & Final Verification
- Full monorepo typecheck: `pnpm -r typecheck` / `pnpm run check`
- Full monorepo unit test suites: `pnpm test`
- Independent Forensic Integrity Audit verdict: CLEAN
- Final completion report to parent
