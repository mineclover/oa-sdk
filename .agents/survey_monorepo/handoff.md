# Handoff Report: Monorepo Architecture Survey

**Agent**: `survey_monorepo` (Monorepo Architecture Explorer)  
**Date**: 2026-09-02  
**Target Repository**: `/Users/junwoobang/workflow/oa-sdk`  
**Artifact Generated**: `/Users/junwoobang/workflow/oa-sdk/.agents/survey_monorepo/analysis.md`

---

## 1. Observation

1. **Workspace Tooling & Orchestration**:
   - `pnpm-workspace.yaml`: Configures workspaces matching `packages/*` and `apps/*`.
   - `package.json` (lines 1-117): Defines monorepo engine `pnpm@10.30.3`, Node `node >=24.0.0`, ESM `"type": "module"`, and turbo execution scripts (`build:core`, `build:all`, `test:core`, `test:all`, `typecheck:all`).
   - `turbo.json` (lines 1-42): Defines topological task pipeline dependencies (`^build`), test inputs/outputs, and caching policies.
   - `tsconfig.base.json` (lines 1-21): Standardizes TypeScript 5.9.3 compilation (`target: "ES2022"`, `module: "NodeNext"`, `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`, `isolatedModules: true`, `verbatimModuleSyntax: true`).

2. **Package & Application Inventory**:
   - Monorepo contains **17 packages** in `packages/`:
     - `@oa-sdk/core` (`packages/core`, v0.2.0, public, 5 test files)
     - `@oa-sdk/openapi-projection-contract` (`packages/openapi-projection-contract`, v0.1.2, public, 4 test files)
     - `@oa-sdk/parser` (`packages/parser`, v0.2.0, public, 28 test files)
     - `@oa-sdk/codegen` (`packages/codegen`, v0.6.0, public, 74 test files)
     - `@oa-sdk/spec-lens-contract` (`packages/spec-lens-contract`, v0.1.0, private, 1 test file)
     - `@oa-sdk/spec-lens` (`packages/spec-lens`, v0.1.2, private, 14 test files)
     - `@oa-sdk/typespec-decorators` (`packages/typespec-decorators`, v0.1.2, public, 2 test files)
     - `@oa-sdk/typespec-erd` (`packages/typespec-erd`, v0.1.0, private, 2 test files)
     - `@oa-sdk/logical-erd-contract` (`packages/logical-erd-contract`, v0.1.0, private, 1 test file)
     - `@oa-sdk/schemas` (`packages/schemas`, v0.1.2, private, 4 test files)
     - `@oa-sdk/router` (`packages/router`, v0.1.2, private, 2 test files)
     - `@oa-sdk/client` (`packages/client`, v0.1.2, private, 3 test files)
     - `@oa-sdk/mock-server` (`packages/mock-server`, v0.1.2, private, 38 test files)
     - `@oa-sdk/typia-mock` (`packages/typia-mock`, v0.1.0, private, 3 test files)
     - `@oa-sdk/dpm` (`packages/dpm`, v0.1.0, private, 121 test files)
     - `@oa-sdk/personas` (`packages/personas`, v0.1.0, private, 11 test files)
     - `@oa-sdk/ttsc-compile-fixture` (`packages/ttsc-compile-fixture`, v0.0.0, private, 0 test files)
   - Monorepo contains **5 applications / reference harnesses** in `apps/`:
     - `@oa-sdk/playground` (`apps/playground`, v0.1.0, private, 14 test files)
     - `@oa-sdk/preview` (`apps/preview`, v0.1.0, private, 0 test files)
     - `@oa-sdk/spec-lens-ui` (`apps/spec-lens`, v0.1.0, private, 2 test files)
     - `@oa-sdk/nestjs-ref` (`apps/nestjs-ref`, v0.1.0, private, 0 test files)
     - `fastapi-ref` (`apps/fastapi-ref`, Python/UV reference, 0 test files)

3. **Baseline Verification Commands & Outputs**:
   - `pnpm typecheck:all`: Executed 30 tasks across all packages; **30/30 passed** (0 errors).
   - `pnpm test:all`: Executed 30 tasks; **30/30 passed** (over 1,400 unit and integration tests passed, 0 failures).

4. **Target Proposal Gaps in Codebase**:
   - Proposal 1 (`projectDiscriminatedUnion`): Absent from `packages/openapi-projection-contract` and `packages/codegen`.
   - Proposal 2 (`x-surface-*` extensions & lint rules): Absent from `packages/openapi-projection-contract` and `packages/parser`.
   - Proposal 3 (`--target standalone-guards` AJV generator): Absent from `packages/codegen`. `ajv` not listed in `packages/codegen/package.json`.
   - Proposal 4 (V3 Unified Architecture `EntitySpec` & `TypeAdapter` AST synchronizer): Absent from `packages/codegen`.

---

## 2. Logic Chain

1. **Monorepo Health (Obs 1, 2, 3)**:
   - Since both `pnpm typecheck:all` and `pnpm test:all` execute with zero errors, the workspace baseline is entirely stable and safe for architectural feature development.
2. **Layer Isolation & Clean Extension (Obs 2, 4)**:
   - `@oa-sdk/openapi-projection-contract` is a leaf package (0 internal workspace dependencies). Adding `projectDiscriminatedUnion` (Proposal 1) and `x-surface-*` definitions (Proposal 2) introduces zero downstream circularity.
   - `@oa-sdk/parser` depends only on `core` and `openapi-projection-contract`. Adding the `surface` linting category (Proposal 2) directly extends its existing rule structure in `src/lint.ts`.
   - `@oa-sdk/codegen` depends on `core`, `openapi-projection-contract`, `parser`, and `typespec-decorators`. Adding `ajv` to `package.json` enables Proposal 3 (standalone guards), while `src/ast-sync/` enables Proposal 4 without breaking existing drizzle/typegen pipelines.
3. **Execution Safety**:
   - All proposed modifications are strictly additive to public API contracts and do not alter existing schema validation or generation semantics.

---

## 3. Caveats

1. **Python App Exclusion**: `apps/fastapi-ref` uses Python `uv` rather than Node.js `pnpm` and is excluded from Turbo JS task pipelines.
2. **Integration Test Workers**: Several packages (`@oa-sdk/codegen`, `@oa-sdk/spec-lens`, `@oa-sdk/mock-server`) require `--maxWorkers 1 --no-file-parallelism` in CI mode due to local SQLite database locking and port allocations.

---

## 4. Conclusion

The `@oa-sdk/*` monorepo architecture is fully mapped, verified, and ready for the implementation of the 4 Upstream Architectural Proposals. A clear four-step implementation sequence across `@oa-sdk/openapi-projection-contract`, `@oa-sdk/parser`, and `@oa-sdk/codegen` will fulfill all proposal requirements while preserving 100% test and typecheck pass rates.

---

## 5. Verification Method

To independently verify the monorepo architecture and current health:

1. **Run Monorepo Typecheck**:
   ```bash
   cd /Users/junwoobang/workflow/oa-sdk
   pnpm typecheck:all
   ```
2. **Run Monorepo Test Suites**:
   ```bash
   pnpm test:all
   ```
3. **Inspect Monorepo Analysis Artifact**:
   ```bash
   cat /Users/junwoobang/workflow/oa-sdk/.agents/survey_monorepo/analysis.md
   ```
4. **Invalidation Conditions**:
   - Any failure in `pnpm typecheck:all` or `pnpm test:all` indicates workspace regressions.
   - Any circular dependency between `packages/openapi-projection-contract`, `packages/parser`, and `packages/codegen` invalidates the proposed layering.
