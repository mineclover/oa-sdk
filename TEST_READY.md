# Test Readiness Report: OA-SDK & Browser-Studio CLI Expansions & Conventions

**Document Status**: `TEST_READY`  
**Target Repository**: `@oa-sdk/*` & `@browser-studio/*`  
**Test Harness Location**: `packages/codegen/test/e2e/cli-expansions.e2e.test.ts`  
**Target Dialects**: OpenAPI 3.1.0 / JSON Schema Draft 2020-12 / TypeScript AST / Pure ESM  
**Requirements Covered**: R1 (Standalone Guards Split & Filtering), R2 (Lint Categories & Validate Profiles), R3 (Manifest V3 CSP Audit Scanner), R4 (Schema Authoring Conventions)

---

## 1. Executive Summary & Verification Matrix

The comprehensive opaque-box E2E test suite for the high-priority CLI feature expansions and authoring conventions has been authored and verified across all 4 tiers:
- **62 out of 62 tests passing (100% pass rate)** in `packages/codegen/test/e2e/cli-expansions.e2e.test.ts`.
- **Zero dynamic eval, zero new Function, and zero runtime imports** verified in standalone generated guards.
- **Manifest V3 CSP scanner** verified against clean bundles and adversarial AST violation fixtures.
- **Normative documentation & authoring conventions** verified for RFC 9457 Problem Details, strict numeric bounds, `z.lazy` recursive schemas, `x-surface-*` scope rules, and V3 JSDoc tags.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ TEST EXECUTION SUMMARY: 62 TESTS (100% PASSING)                                        │
├────────────────────────────────────────┬────────────┬─────────────┬────────────────────┤
│ Milestone / Requirement Group          │ Test Count │ Pass / Fail │ Invariants         │
├────────────────────────────────────────┼────────────┼─────────────┼────────────────────┤
│ R1: Standalone Guards Split & Filter   │ 20 tests   │ 20 / 0      │ 0 eval, 0 Function │
│ R2: CLI Lint Categories & Profiles     │ 15 tests   │ 15 / 0      │ Category/Profile   │
│ R3: Manifest V3 CSP Audit Scanner      │ 15 tests   │ 15 / 0      │ AST Detection      │
│ R4: Schema Conventions Documentation   │ 12 tests   │ 12 / 0      │ Normative Standard │
├────────────────────────────────────────┼────────────┼─────────────┼────────────────────┤
│ TOTAL (Tiers 1-4)                      │ 62 tests   │ 62 / 0 PASS │ 100% VERIFIED      │
└────────────────────────────────────────┴────────────┴─────────────┴────────────────────┘
```

---

## 2. Test Suite Inventory

| Suite | File Path | Scope Covered | Tests | Status |
|---|---|---|:---:|:---:|
| **CLI Expansions & Conventions E2E** | `packages/codegen/test/e2e/cli-expansions.e2e.test.ts` | Tiers 1-4 full coverage across R1, R2, R3, R4 | **62** | **PASS (100%)** |
| **Standalone Guards E2E** | `packages/codegen/test/e2e/standalone-guards.e2e.test.ts` | Core generator and monolithic guard emission | **27** | **PASS (100%)** |
| **Proposal Integration E2E** | `packages/codegen/test/e2e/proposal-integration.e2e.test.ts` | Upstream proposal workflows & scenarios | **6** | **PASS (100%)** |
| **Total** | | | **95 tests** | **100% PASS** |

---

## 3. Tier Coverage Breakdown

### Tier 1: Feature Coverage (>=5 test cases per feature)
- **R1.1 Standalone Guards `--split` Option**: 5 tests (`T1-R1-F1-1` .. `T1-R1-F1-5`)
  - `guards/<TypeName>.js` and `.d.ts` file generation
  - Root `index.js` and `index.d.ts` barrel re-exports
  - `typeImportSpecifier` propagation
  - `components.schemas` discovery
- **R1.2 Standalone Guards `--schemas` Selective Filtering**: 5 tests (`T1-R1-F2-1` .. `T1-R1-F2-5`)
  - Exact type name matching (`SurfaceBlock`)
  - Guard function name matching (`isSurfaceParam`)
  - Comma-separated multi-schema filtering
  - Selective splitting with updated index barrel
  - Case-insensitive / prefix matching
- **R1.3 Zero-Eval & Zero-Dependency Invariants**: 5 tests (`T1-R1-F3-1` .. `T1-R1-F3-5`)
  - 0 `eval()` calls in generated JS
  - 0 `new Function()` or `Function()` calls
  - 0 runtime imports (`ajv`, `zod`, `@oa-sdk`)
  - Self-contained referenced `$ref` inlining
  - Dynamic ESM execution and type narrowing verification
- **R2.1 CLI Lint `--categories` Flag**: 5 tests (`T1-R2-F1-1` .. `T1-R2-F1-5`)
  - Category argument parser & allowed category validation
  - Targeted category execution (`surface`, `operations`, `parameters`, `structure`)
  - Suppression of unselected category diagnostics
  - CLI options declaration
- **R2.2 CLI Validate `--profile` Flag**: 5 tests (`T1-R2-F2-1` .. `T1-R2-F2-5`)
  - `component-bundle` profile: allows empty paths, enforces schemas
  - `operation-contract` profile: enforces non-empty paths with operations
  - `full-api-document` profile: full OpenAPI 3.x document rules
  - CLI options declaration & profile enum validation
- **R3.1 Manifest V3 CSP Audit Scanner**: 5 tests (`T1-R3-F1-1` .. `T1-R3-F1-5`)
  - Clean standalone guard bundle passes with exit code 0
  - `eval()` detection (`csp/no-eval`)
  - `new Function()` / `Function()` detection (`csp/no-new-function`)
  - String timer detection (`csp/no-string-settimeout`, `csp/no-string-setinterval`)
  - Disallowed heavy engine imports detection (`ajv`, `zod`, `@oa-sdk`)
- **R4.1 Schema Authoring Conventions Completeness**: 5 tests (`T1-R4-F1-1` .. `T1-R4-F1-5`)
  - RFC 9457 Problem Details schema specification
  - Strict numeric bounds (`exclusiveMinimum: 0` vs `minimum: 0`)
  - Recursive schemas with `z.lazy`
  - `x-surface-*` scope rules (`targetProperty` vs inline)
  - V3 Unified Architecture JSDoc annotation tags

### Tier 2: Boundary & Corner Cases (>=5 test cases per feature)
- **R1 Boundaries**:
  - Single-component schema splitting (`T2-R1-B1`)
  - Multi-level nested $ref chains in split mode (`T2-R1-B2`)
  - Special characters and underscores in type names (`T2-R1-B3`)
  - Empty schema object `{}` in split mode (`T2-R1-B4`)
  - Non-matching schema filter handling (`T2-R1-B5`)
- **R2 Boundaries**:
  - Irregular whitespace and commas in categories (`T2-R2-B1`)
  - Extended HTTP verbs (query, trace) (`T2-R2-B2`)
  - Path items containing only path-level parameters without operations (`T2-R2-B3`)
  - Full API document validation (`T2-R2-B4`)
  - Non-3.x openapi version rejection (`T2-R2-B5`)
- **R3 Boundaries**:
  - Safe callback `setTimeout(() => {}, 100)` non-violation (`T2-R3-B1`)
  - Template literal strings in timers (`T2-R3-B2`)
  - Identifiers containing "eval" substring (`T2-R3-B3`)
  - Dynamic `import('zod')` detection (`T2-R3-B4`)
  - Recursive multi-extension bundle collection (`.js`, `.mjs`, `.cjs`) (`T2-R3-B5`)
- **R4 Boundaries**:
  - Numeric `exclusiveMinimum` dialect validation (`T2-R4-B1`)
  - RFC 9457 error response taxonomy (`T2-R4-B2`)
  - Projection profiles enumeration (`T2-R4-B3`)
  - Allowed lint categories enumeration (`T2-R4-B4`)
  - CSP audit CLI command registration (`T2-R4-B5`)

### Tier 3: Cross-Feature Interactions (Pairwise combinations)
- **T3-1: End-to-End Guard Generation -> CSP Audit -> Dynamic Execution**:
  Compiles split guards with selective schema filtering, scans output directory with `auditCspBundle`, asserts 0 violations, and executes dynamic type narrowing.
- **T3-2: Category Linting -> Profile Validation -> Split Guard Compilation**:
  Lints `x-surface-*` extensions with `--categories surface`, validates spec under `component-bundle`, and compiles to split standalone guards.
- **T3-3: RFC 9457 Problem Details Pipeline**:
  Compiles standalone type guard for RFC 9457 Problem Details schema, verifies CSP compliance, and executes dynamic validation on 422 error payload.
- **T3-4: Discriminated Union Pipeline**:
  Compiles multi-variant discriminated union with internal references into split guards, verifies CSP compliance, and tests each discriminated branch.

### Tier 4: Real-World Application Scenarios
- **T4-1: Chrome Extension Manifest V3 Content Script Live-Editing Sandbox**:
  Generates split guards for `SurfaceBlock` and `SurfaceParam`, audits with CSP scanner, disables `globalThis.Function` and `globalThis.eval`, and executes 500 validation cycles in $<100\text{ms}$.
- **T4-2: DevLink Native RPC & MCP CI Governance Pipeline**:
  Validates 17-method Native RPC spec with `--profile operation-contract` and lints surface extensions with `--categories surface`.
- **T4-3: Production Release Packaging Gate**:
  Generates production standalone guard bundle, audits all output chunks with CSP scanner, injects adversarial `ajv` import, and verifies that the audit gate halts release with exit code 1.

---

## 4. Test Runner Commands

```bash
# Run the newly authored E2E test suite (62 tests)
pnpm --filter @oa-sdk/codegen exec vitest run test/e2e/cli-expansions.e2e.test.ts

# Run all E2E test suites in codegen
pnpm --filter @oa-sdk/codegen exec vitest run test/e2e/

# Run full codegen test suite
pnpm --filter @oa-sdk/codegen test

# Run monorepo typecheck
pnpm -r typecheck
```
