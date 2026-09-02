# Handoff Report: Milestone 2 — CLI Category-Aware Linting & Profile-Aware Validation (R2)

**Author**: Worker Agent M2  
**Date**: 2026-09-02T22:16:00Z  
**Type**: Hard Handoff (Complete)

---

## 1. Observation

1. **Category-Aware Linting**:
   - In `packages/codegen/src/cli/commands/lint.ts`:
     - Added `ALLOWED_LINT_CATEGORIES`: `['structure', 'operations', 'parameters', 'refs', 'security', 'style', 'components', 'surface']`.
     - Added helper functions `isLintCategory(value)` and `parseLintCategories(raw)`.
     - Declared `categories` option in `lint.options`: `{ type: 'string', description: '실행할 규칙 카테고리 (쉼표 구분: structure, operations, parameters, refs, security, style, components, surface)' }`.
     - Parsed categories and passed to `lintDocument(doc, { basePath, lookupSourceLocation, ...(categories ? { categories } : {}) })`.
     - Throws descriptive `Error` when invalid or empty categories are provided, and throws `CliExitError(1)` when any error-severity lint diagnostics are detected.

2. **Profile-Aware Validation**:
   - In `packages/codegen/src/cli/commands/validate.ts`:
     - Declared `profile` option in `validate.options`: `{ type: 'string', description: 'OpenAPI 프로젝션 프로필 (component-bundle | operation-contract | full-api-document)' }`.
     - Validated profile parameter using `isOpenApiProjectionProfile(rawProfile)` from `@oa-sdk/openapi-projection-contract`.
     - If valid profile is provided, executes Step 1.5 with `validateOpenApiProjection({ profile, projection: doc, refs: [], diagnostics: [], sources: {}, versionHash: 'cli-validation' })`.
     - Formats and displays profile diagnostics with severity icons (`❌`, `⚠️`, `ℹ️`), passes profile diagnostics to SQLite incremental index, and triggers `throw new CliExitError(1)` when profile invariants fail (e.g., `operation-contract` having no operations under `paths`).

3. **Test Coverage**:
   - Added unit, integration, and runner tests in `packages/codegen/test/cli/`:
     - `packages/codegen/test/cli/lint-categories.test.ts` (11 test cases)
     - `packages/codegen/test/cli/validate-profile.test.ts` (7 test cases)
     - `packages/codegen/test/cli/cli-runner.test.ts` (2 test cases)

4. **Build & Test Results**:
   - `pnpm --filter @oa-sdk/codegen build`: Succeeded.
   - `pnpm --filter @oa-sdk/codegen test`: 92 test files passed, 1092 tests passed.
   - `pnpm typecheck:core`: 13/13 tasks succeeded.
   - `pnpm --filter @oa-sdk/parser test`: 31 files passed, 333 tests passed.
   - `pnpm --filter @oa-sdk/openapi-projection-contract test`: 10 files passed, 197 tests passed.

---

## 2. Logic Chain

1. **Category Filtering**:
   - `lintDocument` in `@oa-sdk/parser` already supports `categories?: LintCategory[]`. By wiring `parseLintCategories` to extract comma-separated category strings and validate each against `ALLOWED_LINT_CATEGORIES`, users can run targeted rule suites (e.g. `--categories surface`).
   - If an unrecognized category name is supplied, `parseLintCategories` throws a clear error detailing the 8 allowed categories.
   - When only specific categories are requested (such as `surface`), violations in other categories (such as `structure` or `operations`) are not evaluated or reported.

2. **Projection Profile Validation**:
   - When `--profile` is passed, `validateOpenApiProjection` verifies the document against profile-specific semantics defined in `@oa-sdk/openapi-projection-contract`.
   - Specifically:
     - `operation-contract` requires at least one operation in `paths`. If `paths: {}`, it produces diagnostic code `'openapi-projection/profile-requirement'` and causes validation to fail with exit code 1.
     - `component-bundle` allows empty or omitted `paths`, but requires non-empty `components.schemas`.
     - `full-api-document` validates full document structure.
   - Profile diagnostics are displayed clearly in CLI output and recorded in the SQLite workspace cache when incremental validation is enabled.

---

## 3. Caveats

- No caveats. The implementation strictly adheres to the existing `@oa-sdk/parser` and `@oa-sdk/openapi-projection-contract` domain models and the CLI option conventions.

---

## 4. Conclusion

- Requirement R2 (CLI Category-Aware Linting & Profile-Aware Validation) is fully implemented, verified, and backed by comprehensive unit, integration, and CLI runner test suites.
- Monorepo builds, typecheck, and all test suites pass with 0 errors.

---

## 5. Verification Method

```bash
# 1. Build codegen package
pnpm --filter @oa-sdk/codegen build

# 2. Run new CLI test suite
npx vitest run test/cli

# 3. Run all codegen tests
pnpm --filter @oa-sdk/codegen test

# 4. Run monorepo typecheck
pnpm typecheck:core
```
