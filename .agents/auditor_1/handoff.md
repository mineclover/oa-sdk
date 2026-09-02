# Forensic Audit Handoff Report

**Agent**: `auditor_1` (Forensic Auditor)  
**Target**: 4 Upstream Architectural Proposals in `@oa-sdk/*`  
**Verdict**: **INTEGRITY VIOLATION** (Behavioral Verification Failure on Proposal 1)  
**Report Path**: `/Users/junwoobang/workflow/oa-sdk/.agents/auditor_1/audit_report.md`  

---

## 1. Observation

1. **Static Analysis & Anti-Cheat**:
   - Zero hardcoded test outputs or fixed return values detected across `packages/openapi-projection-contract/`, `packages/parser/`, and `packages/codegen/`.
   - Zero facade/mock implementations. Genuine TypeScript AST (`ts.createSourceFile`, `ts.Node`), Ajv 2020 standalone compilation (`ajv/dist/standalone`), and OpenAPI document traversal are used throughout.
   - Zero `eval()` or `new Function()` invocations in `packages/codegen/src/standalone-guards/generator.ts` and generated output files.
   - Zero pre-populated test output or log artifacts found in the repository.

2. **Build & Typecheck Results**:
   - `pnpm -r typecheck` executed across 21 workspace projects with exit code `0` (0 compilation errors).

3. **Test Execution Results**:
   - `packages/parser`: 31 test files, 333 passed (100% PASS).
   - `packages/codegen`: 87 test files, 985 passed (100% PASS).
   - `packages/openapi-projection-contract`: 9 test files passed, 1 test file failed (`test/e2e/discriminated-union.e2e.test.ts`), with 6 failed assertions out of 191 total tests (Exit code `1`).

4. **Verbatim Test Failures in Proposal 1**:
   - `F3-1`: Expected `#/components/schemas/McpRequestToolsList`, received `#/components/schemas/ToolsListRequest`.
   - `F3-2`: Expected property `McpRequestToolsCall` in `result.variantSchemas`, received `ToolsCallRequest`.
   - `F2-B4`: Expected path key `'/rpc/ping'`, received `'/rpc//ping'`.
   - `F3-B1`: Expected property `McpRequestToolsCall` in `result.variantSchemas`, received `ToolsCallRequest`.
   - `F3-B2`: Expected property `McpRequestABC` in `result.variantSchemas`, received `ABCRequest`.
   - `F3-B4`: Expected 2 distinct schema identifiers in `variantSchemas` for `['user.get', 'user_get']`, received 1 (`'MsgUserGet'`).

---

## 2. Logic Chain

1. **Rule Enforcement**:
   - The Forensic Auditor operating manual states: "Run build and tests to verify the work product... If ANY check fails, the verdict is INTEGRITY VIOLATION and the work product must be rejected."
   - The acceptance criteria in `ORIGINAL_REQUEST.md` mandate: "All package unit tests pass (`pnpm test`)."

2. **Root Cause Analysis**:
   - In `packages/openapi-projection-contract/src/discriminated-union.ts`:
     - Line 403: `determineVariantSchemaName` strips the prefix when `unionSchemaId.endsWith('Request')`, which inappropriately removes the `'Mcp'` prefix from `'McpRequest'` and emits `'ToolsCallRequest'` instead of `'McpRequestToolsCall'`.
     - Lines 150-153: `normalizedPrefix` does not strip trailing slashes, resulting in `'/rpc//ping'`.
     - `variantSchemas` dictionary assignment does not handle key collisions when different variant keys produce the same PascalCase schema identifier.

3. **Conclusion on Integrity & Deliverables**:
   - Proposals 2, 3, and 4 are fully functional, authentic, and verified clean.
   - Proposal 1 has genuine algorithmic logic but contains 3 concrete implementation defects causing 6 test failures in its E2E test suite.
   - Because test suites must pass 100% with zero failures, the work product cannot be certified `CLEAN` until Proposal 1 is corrected.

---

## 3. Caveats

- Downstream non-core demo/app packages (e.g., `apps/nestjs-ref`) do not have individual test runner harnesses and were excluded from core package testing, consistent with `test:core` in root `package.json`.
- The failures in Proposal 1 are algorithmic edge-case bugs rather than intentional bypasses or malicious facades.

---

## 4. Conclusion

**Verdict: INTEGRITY VIOLATION**  
The work product is **REJECTED** due to 6 test failures in `packages/openapi-projection-contract/test/e2e/discriminated-union.e2e.test.ts`.

Remediation required:
1. Fix schema name derivation in `determineVariantSchemaName` to keep `unionSchemaId` prefix intact.
2. Strip trailing slashes in `pathPrefix` normalization.
3. Disambiguate colliding schema identifiers in `variantSchemas`.

---

## 5. Verification Method

To independently verify this verdict:

```bash
# 1. Run monorepo typecheck (verifies compilation)
pnpm -r typecheck

# 2. Run openapi-projection-contract tests (reproduces the 6 failures)
pnpm --filter @oa-sdk/openapi-projection-contract exec vitest run test/e2e/discriminated-union.e2e.test.ts

# 3. Run codegen and parser test suites (verifies Proposals 2, 3, 4 pass 100%)
pnpm --filter @oa-sdk/parser exec vitest run
pnpm --filter @oa-sdk/codegen exec vitest run test/e2e/
```
