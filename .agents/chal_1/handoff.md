# Handoff Report — Challenger 1 (Proposals 1 & 2)

## 1. Observation

### Test Execution Commands & Verbatim Outputs

1. **`pnpm --filter @oa-sdk/openapi-projection-contract test`**:
   - Status: **FAILED (6 failures, 160 passed)**
   - Failing file: `packages/openapi-projection-contract/test/e2e/discriminated-union.e2e.test.ts`
   - Exact Failures:
     - `F3-1`: `AssertionError: expected '#/components/schemas/ToolsListRequest' to be '#/components/schemas/McpRequestToolsList'`
     - `F3-2`: `AssertionError: expected { ToolsCallRequest: { ... } } to have property "McpRequestToolsCall"`
     - `F2-B4`: `AssertionError: expected { '/rpc//ping': { post: { ... } } } to have property "/rpc/ping"`
     - `F3-B1`: `AssertionError: expected { ToolsCallRequest: { ... } } to have property "McpRequestToolsCall"`
     - `F3-B2`: `AssertionError: expected { Object (ABCRequest) } to have property "McpRequestABC"`
     - `F3-B4`: `AssertionError: expected [ 'MsgUserGet' ] to have a length of 2 but got 1`

2. **`pnpm --filter @oa-sdk/parser test`**:
   - Status: **PASSED (30 files passed, 318 tests passed)**
   - Surface linting unit tests (`test/surface-lint.test.ts`): 19 / 19 PASS
   - Surface linting E2E tests (`test/e2e/surface-lint.e2e.test.ts`): 14 / 14 PASS

3. **Adversarial Stress Suites**:
   - `packages/openapi-projection-contract/test/adversarial-proposals-1-2.test.ts`: **25 / 25 PASS**
   - `packages/parser/test/adversarial-surface-lint.test.ts`: **15 / 15 PASS**

4. **Core Typecheck (`pnpm typecheck:core`)**:
   - Status: **PASSED (13 successful tasks, 0 type errors)**

### Code Inspection Points in `packages/openapi-projection-contract/src/discriminated-union.ts`

- **Line 150–153**:
  ```typescript
  const prefix = (pathPrefix ?? '/rpc').trim()
  const normalizedPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`
  const cleanKey = key.replace(/^\//, '')
  const pathKey = `${normalizedPrefix}/${cleanKey}`
  ```
  When `pathPrefix` is `'/rpc/'`, `normalizedPrefix` retains the trailing slash, causing `pathKey` to become `'/rpc//ping'`.

- **Line 403–405**:
  ```typescript
  if (unionSchemaId.endsWith('Request') && !pascalKey.endsWith('Request')) {
    return `${pascalKey}Request`
  }
  ```
  When `unionSchemaId` is `'McpRequest'` and key is `'tools/list'`, it returns `'ToolsListRequest'` instead of `'McpRequestToolsList'`.

- **Line 142**:
  ```typescript
  variantSchemas[variantSchemaName] = normalizedVariantSchema
  ```
  When two distinct keys like `'user.get'` and `'user_get'` produce the identical `variantSchemaName` (`'MsgUserGet'`), one silently overwrites the other, reducing `variantSchemas` length to 1.

---

## 2. Logic Chain

1. **Step 1**: Opaque-box E2E tests in `packages/openapi-projection-contract/test/e2e/discriminated-union.e2e.test.ts` were executed to verify Proposal 1 requirements against the formal specification in `oa-sdk-integration-proposals.md` and `TEST_READY.md`.
2. **Step 2**: 6 test cases failed consistently across MCP Stdio operation naming (`F3-1`, `F3-2`, `F3-B1`, `F3-B2`), path prefix trailing slash normalization (`F2-B4`), and schema collision deduplication (`F3-B4`).
3. **Step 3**: Source analysis of `discriminated-union.ts` directly mapped the failures to specific implementation lines (lines 150–153 for path concatenation, lines 403–405 for suffix truncation, and line 142 for missing collision handling).
4. **Step 4**: Proposal 2 implementation in `packages/openapi-projection-contract/src/surface-extensions.ts` and `@oa-sdk/parser/src/lint.ts` was tested against all 5 vendor extensions, edge cases (negative coordinates, bad sha256 formats, invalid quote/drift enums), and category filtering (`categories: ['surface']`), achieving 100% test pass rate across all suites.
5. **Step 5**: In accordance with the Review-Only constraint, Challenger 1 does not alter production implementation code, but reports the empirical defects with reproduction steps and mitigations.

---

## 3. Caveats

- **Scope boundary**: Evaluation was strictly focused on Proposals 1 and 2 (`@oa-sdk/openapi-projection-contract` and `@oa-sdk/parser`). Proposals 3 and 4 were verified by parallel specialists and are not evaluated here.
- **Worker implementation**: The defects in Proposal 1 are isolated to `packages/openapi-projection-contract/src/discriminated-union.ts` and do not affect the public API signatures or type exports.

---

## 4. Conclusion

**Verdict: REJECT**

- **Proposal 1 (Native Discriminated Union Projection)**: **REJECTED** due to 6 reproducible E2E test failures in `packages/openapi-projection-contract`.
- **Proposal 2 (Non-AST Character Range Patching Metadata Extensions & Surface Linting)**: **APPROVED** with 100% test pass rate, full predicate coverage, robust error reporting, and zero linting regressions.

### Required Actions for Resolution

1. In `packages/openapi-projection-contract/src/discriminated-union.ts`:
   - Strip trailing slashes from `pathPrefix` before concatenation (`prefix.replace(/\/+$/, '')`).
   - Fix `determineVariantSchemaName` to retain `unionSchemaId` prefix for MCP / polymorphic variants (e.g. `${unionSchemaId}${pascalKey}`).
   - Add collision tracking/disambiguation in `projectDiscriminatedUnion` when distinct variant keys yield identical schema names.

---

## 5. Verification Method

To independently verify this assessment, run:

```bash
# Verify Proposal 1 E2E failure reproduction (6 failed tests):
pnpm --filter @oa-sdk/openapi-projection-contract exec vitest run test/e2e/discriminated-union.e2e.test.ts

# Verify Proposal 2 Surface Extensions (53 passed tests):
pnpm --filter @oa-sdk/openapi-projection-contract exec vitest run test/e2e/surface-extensions.e2e.test.ts

# Verify Proposal 2 Parser Linting (14 passed E2E tests, 19 unit tests):
pnpm --filter @oa-sdk/parser exec vitest run test/e2e/surface-lint.e2e.test.ts test/surface-lint.test.ts

# Verify Adversarial Stress Suites:
pnpm --filter @oa-sdk/openapi-projection-contract exec vitest run test/adversarial-proposals-1-2.test.ts
pnpm --filter @oa-sdk/parser exec vitest run test/adversarial-surface-lint.test.ts

# Verify Monorepo Typecheck:
pnpm typecheck:core
```
