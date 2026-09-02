# Adversarial Challenge Handoff Report: R1 & R2 Stress Testing

**Challenger**: Challenger 1 (critic, specialist)  
**Target Scope**: R1 (Standalone Guards Splitting & Filtering) and R2 (CLI Category-Aware Linting & Profile-Aware Validation)  
**Date**: 2026-09-02T22:22:15Z  
**Verdict**: **APPROVE**

---

## 1. Observation

1. **Standalone Guards Splitting (`--split`) Invariants**:
   - Evaluated in `packages/codegen/test/adversarial/r1-r2-stress.test.ts` (tests `R1-ADV-1` through `R1-ADV-5`).
   - Deep cross-referencing schema chain ($A \to B \to C \to D \to E$): generated files `LevelA.js`, `LevelB.js`, `LevelC.js`, `LevelD.js`, and `LevelE.js` in `guards/` subdirectory alongside root `index.js` and `index.d.ts`.
   - Inlined references: AJV standalone pre-compiler emitted completely self-contained JavaScript functions in each modular file.
   - Dynamic ESM import: each emitted `.js` file was loaded dynamically into isolated ESM contexts (and verified inside an external Node child process subprocess) without global `eval` or `Function`, executing runtime validation against valid payloads (e.g. UUID formats, minLength bounds, numeric constraints) returning `true` and invalid payloads returning `false`.
   - Recursive schemas (`TreeNode -> children: TreeNode[]`) and polymorphic discriminated unions (`CommandBatch -> TextCommand | ImageCommand`) compiled into self-contained modular files and validated nested structures accurately.

2. **Selective Filtering (`--schemas`) Robustness**:
   - Tested in `R1-ADV-6` to `R1-ADV-8`.
   - Comma-separated strings with arbitrary whitespace (`'  surfaceblock  ', 'isSurfaceParam', '   '`) correctly matched the intended schemas (`SurfaceBlock`, `SurfaceParam`) while ignoring unselected components (`DataPipeline`, `ConfigManifest`).
   - Prefix `is` stripping/matching and case-insensitive matching verified.
   - Non-matching filter terms (matching 0 items) gracefully returned an empty array `[]` without throwing exceptions or leaving orphan files on disk.
   - CLI execution `oa-codegen generate --target standalone-guards --input <spec> --out-dir <dir> --split --schemas "isAlphaItem, BetaItem"` emitted exactly 6 artifacts (`AlphaItem.js`, `AlphaItem.d.ts`, `BetaItem.js`, `BetaItem.d.ts`, `index.js`, `index.d.ts`).

3. **Category-Aware Linting (`--categories`)**:
   - Tested in `R2-ADV-1` to `R2-ADV-3`.
   - `parseLintCategories` correctly parses single string, comma-separated tokens, and array inputs across all 8 allowed categories (`structure`, `operations`, `parameters`, `refs`, `security`, `style`, `components`, `surface`).
   - Empty inputs (`""`, `"   "`, `",,, , "`) and invalid category names (`"unknown_cat"`, `"fakeCategory"`) strictly throw descriptive error messages specifying allowed categories.
   - `lintDocument` enforces strict category isolation: when filtering by `surface`, errors in `structure`, `operations`, and `parameters` are 100% suppressed; when combining categories (e.g. `['parameters', 'surface']`), only rules matching the selected categories are executed.
   - CLI command `oa-codegen lint --spec <spec> --categories surface` exits cleanly with code 0 on specs containing non-surface errors.

4. **Profile-Aware Validation (`--profile`)**:
   - Tested in `R2-ADV-4` to `R2-ADV-7`.
   - `component-bundle`: passes with empty `paths: {}` or absent `paths` as long as `components.schemas` contains at least one schema; fails when `components.schemas` is empty or missing.
   - `operation-contract`: rejects empty `paths: {}`, rejects path items with only parameters (no HTTP method operations), and rejects path items with only summary or extensions; passes for OAS 3.1/3.2 operations including standard methods and OAS 3.2 `query` method.
   - `full-api-document`: enforces standard full document invariants (`info`, `title`, `version`, `paths`).
   - CLI command `oa-codegen validate --spec <spec> --profile <profile>` enforces profile invariants and exits with code 1 when requirements are violated.

5. **Monorepo Build & Test Execution**:
   - Monorepo typecheck: `pnpm -r typecheck` passed with 0 errors across all 21 workspace packages.
   - Target test execution: All 120 tests in `@oa-sdk/codegen` test suite passed:
     - `test/e2e/cli-expansions.e2e.test.ts`: 62/62 passed.
     - `test/adversarial/r1-r2-stress.test.ts`: 15/15 passed.
     - `test/standalone-guards/generator.test.ts`: 17/17 passed.
     - `test/standalone-guards/cli.test.ts`: 6/6 passed.
     - `test/cli/lint-categories.test.ts`: 8/8 passed.
     - `test/cli/validate-profile.test.ts`: 7/7 passed.
     - `test/cli/cli-runner.test.ts`: 5/5 passed.

---

## 2. Logic Chain

1. **Self-Containment & Isolation of Split Modules**:
   - *Observation*: Modular files generated with `--split` were directly imported in a clean Node subprocess and executed with banned `eval`/`Function`.
   - *Inference*: Each generated file contains full standalone inlined validation logic without requiring sibling imports or runtime schema dependencies. Tree-shaking is fully enabled.
2. **Schema Filter Correctness**:
   - *Observation*: Multiple filter variations (`is` prefix, case difference, whitespace padding) matched expected schema definitions and generated matching barrel files without orphan exports.
   - *Inference*: The fuzzy and prefix-tolerant filtering logic in `generator.ts` is robust against varied user CLI inputs.
3. **Lint Category Isolation**:
   - *Observation*: Running `lintDocument` on a multi-error document with category filtering returns only errors whose rule starts with the selected category prefix, suppressing other categories.
   - *Inference*: Category-aware linting allows developers to focus exclusively on specific sub-domains (e.g., surface extensions or operations) in CI workflows.
4. **Projection Profile Invariants**:
   - *Observation*: Edge case schemas (empty paths, path items with only parameters, component bundles) were verified against `validateOpenApiProjection`.
   - *Inference*: Profile rules strictly enforce the semantic boundaries of component bundles vs operation contracts.

---

## 3. Caveats

- **Identifier Sanitization**: AJV standalone generator requires schema component keys used as export names to be valid JS identifiers (e.g. `SurfaceBlock`, `user_profile_v1`). If an OpenAPI schema name contains hyphens (e.g. `user-profile`), users should provide explicit guard mapping or camelCase/PascalCase schema names as per standard TypeScript/OpenAPI naming conventions.
- **Node Runtime Setup**: Isolated subprocess tests verify standard Node.js ESM loader behavior. Browser runtime behavior is covered by CSP audit invariants (0 eval, 0 Function).

---

## 4. Conclusion

**Verdict**: **APPROVE**

All requirements and acceptance criteria for **R1 (Standalone Guards Splitting & Filtering)** and **R2 (CLI Category-Aware Linting & Profile-Aware Validation)** are fully verified and pass extensive adversarial stress testing without defects.

---

## 5. Verification Method

To independently verify all findings and test suites:

```bash
# 1. Run the new adversarial stress test suite (15 tests)
pnpm --filter @oa-sdk/codegen exec vitest run test/adversarial/r1-r2-stress.test.ts

# 2. Run full CLI expansions and unit suites (120 tests)
pnpm --filter @oa-sdk/codegen exec vitest run test/e2e/cli-expansions.e2e.test.ts test/adversarial/r1-r2-stress.test.ts test/standalone-guards/ test/cli/

# 3. Run monorepo typecheck
pnpm -r typecheck
```
