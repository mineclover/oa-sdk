# E2E Test Infrastructure: CLI Feature Expansions & Authoring Conventions

## 1. Test Architecture & Philosophy

The test infrastructure for `@oa-sdk/codegen` CLI feature expansions and schema authoring conventions follows an **opaque-box, requirement-driven, 4-tier verification model**. Every test case is derived strictly from `ORIGINAL_REQUEST.md` and `PROJECT.md` specifications.

### Core Testing Invariants:
1. **Opaque-Box Evaluation**: Tests exercise external CLI commands (`oa-codegen generate --target standalone-guards`, `oa-codegen lint`, `oa-codegen validate`, `oa-codegen audit:csp`) and public APIs without inspecting private internal state.
2. **Zero-Dependency & Zero-Eval Invariant**: Generated standalone guards must execute in pure ESM mode with 0 calls to `eval()`, 0 calls to `new Function()`, and 0 runtime imports of `ajv`, `zod`, or `@oa-sdk`.
3. **Deterministic & Isolated Execution**: Every test runs in an isolated temporary directory (`fs.mkdtemp`) with self-contained schemas, ensuring zero inter-test coupling and clean teardown.
4. **Authoritative Expected Output Derivation**: All expected outcomes (exit codes, emitted files, TypeScript declarations, diagnostic error codes, AST violation markers) are derived directly from normative specifications.

---

## 2. 4-Tier Test Matrix

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 1: FEATURE COVERAGE (>=5 tests per feature across R1, R2, R3, R4)                 │
│   • Primary happy-path behaviors in isolation.                                         │
│   • CLI flag handling, output structure, schema filtering, AST scanning.              │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 2: BOUNDARY & CORNER CASES (>=5 tests per feature)                                │
│   • Malformed inputs, missing operations, recursive $ref, cyclic schemas.              │
│   • Special characters, empty schemas, whitespace trimming, forbidden edge patterns.  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 3: CROSS-FEATURE INTERACTIONS (Pairwise combinations)                             │
│   • Generate split guards -> audit bundle with CSP scanner -> dynamic import execution. │
│   • Category linting on x-surface-* -> profile validate -> split guard generation.     │
│   • ProblemDetails RFC 9457 -> profile validation -> guard emission -> CSP audit.     │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 4: REAL-WORLD APPLICATION SCENARIOS                                               │
│   • Chrome Extension Manifest V3 Content Script 60fps Live-Editing Sandbox.            │
│   • DevLink Native RPC & MCP CI Governance Pipeline.                                   │
│   • Production Release Packaging Gate with Zero-Engine Runtime Leakage.                │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Feature Inventory & Verification Goals

| # | Feature ID | Feature Name | Requirement Source | Tier 1 Goal | Tier 2 Goal | Tier 3 Interaction |
|---|---|---|---|:---:|:---:|:---:|
| 1 | `R1-F1` | Standalone Guards `--split` Option | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 2 | `R1-F2` | Standalone Guards `--schemas` Selective Filtering | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 3 | `R1-F3` | Split Guards $ref Inlining & Zero Dependency Invariant | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 4 | `R2-F1` | CLI Lint `--categories` Flag | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 5 | `R2-F2` | CLI Validate `--profile` Flag | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 6 | `R2-F3` | Operation-Contract Validation Rule | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 7 | `R3-F1` | Manifest V3 CSP Audit Command (`oa-codegen audit:csp`) | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 8 | `R3-F2` | CSP AST Unsafe Code & Heavy Engine Import Detection | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 9 | `R3-F3` | CSP Audit CLI Diagnostics & Non-Zero Exit Code | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 10 | `R4-F1` | RFC 9457 Problem Details Specification & Documentation | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |
| 11 | `R4-F2` | Strict Numeric Bounds Specification (`exclusiveMinimum: 0`) | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |
| 12 | `R4-F3` | Recursive Schemas with `z.lazy` Specification | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |
| 13 | `R4-F4` | `x-surface-*` Scope Rules Specification (`targetProperty`) | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |
| 14 | `R4-F5` | V3 Unified Architecture JSDoc Tag Specifications | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |

---

## 4. Tier Breakdown & Test Specifications

### Tier 1: Feature Coverage (>=5 tests per feature)

#### Feature 1: Standalone Guards `--split` Option
- **T1-R1-F1-1**: Emits individual `guards/<TypeName>.js` and `guards/<TypeName>.d.ts` files for each component schema.
- **T1-R1-F1-2**: Generates root `index.js` barrel re-exporting all emitted guard modules (`export * from './guards/<TypeName>.js'`).
- **T1-R1-F1-3**: Generates root `index.d.ts` barrel re-exporting all guard TypeScript type declarations.
- **T1-R1-F1-4**: Correctly maps custom `typeImportSpecifier` into individual split `.d.ts` files.
- **T1-R1-F1-5**: Supports multi-schema generation with distinct output filenames matching schema PascalCase type names.

#### Feature 2: Standalone Guards `--schemas` Selective Filtering
- **T1-R1-F2-1**: Filters generation by exact schema component type name (e.g. `SurfaceBlock`).
- **T1-R1-F2-2**: Filters generation by guard function name (e.g. `isSurfaceBlock` or `isSurfaceParam`).
- **T1-R1-F2-3**: Filters generation with comma-separated list matching multiple distinct schemas.
- **T1-R1-F2-4**: Combines `--split` with `--schemas` to emit only requested split guard files in `guards/`.
- **T1-R1-F2-5**: Generates root `index.js` barrel containing re-exports exclusively for filtered schemas.

#### Feature 3: Split Guards Invariant Verification
- **T1-R1-F3-1**: Zero `eval()` calls in all generated split `.js` files.
- **T1-R1-F3-2**: Zero `new Function()` or `Function()` constructor calls in all generated split `.js` files.
- **T1-R1-F3-3**: Zero external runtime dependencies (`ajv`, `zod`, `@oa-sdk`) in split files.
- **T1-R1-F3-4**: Inlines referenced internal `$ref` schemas directly into the split validator module.
- **T1-R1-F3-5**: Validates real JavaScript execution by importing generated split `.js` files and verifying valid/invalid input narrowing.

#### Feature 4: CLI Lint `--categories` Flag
- **T1-R2-F1-1**: Executes only `surface` rules when `--categories surface` is passed.
- **T1-R2-F1-2**: Executes only `operations` rules when `--categories operations` is passed.
- **T1-R2-F1-3**: Executes multiple targeted categories when `--categories surface,structure` is passed.
- **T1-R2-F1-4**: Suppresses diagnostics from unselected categories when spec contains cross-category violations.
- **T1-R2-F1-5**: Defaults to executing all categories when `--categories` flag is omitted.

#### Feature 5: CLI Validate `--profile` Flag
- **T1-R2-F2-1**: Validates spec against `component-bundle` profile, allowing empty `paths: {}`.
- **T1-R2-F2-2**: Fails `component-bundle` profile validation when `components.schemas` is missing or empty.
- **T1-R2-F2-3**: Validates spec against `operation-contract` profile when valid operations are defined.
- **T1-R2-F2-4**: Validates spec against `full-api-document` profile enforcing standard document invariants.
- **T1-R2-F2-5**: Fails validation with error code when an unsupported profile name is provided.

#### Feature 6: Operation-Contract Validation Rule
- **T1-R2-F3-1**: Rejects OpenAPI document under `--profile operation-contract` when `paths` is empty object `{}`.
- **T1-R2-F3-2**: Rejects OpenAPI document under `--profile operation-contract` when `paths` is omitted.
- **T1-R2-F3-3**: Rejects OpenAPI document when `paths` contains path items without HTTP method operations.
- **T1-R2-F3-4**: Accepts OpenAPI document when `paths` contains at least one valid POST/GET operation with responses.
- **T1-R2-F3-5**: Produces structured diagnostic `openapi-projection/profile-requirement` and exits with code 1.

#### Feature 7: Manifest V3 CSP Audit Command (`oa-codegen audit:csp`)
- **T1-R3-F1-1**: Scans clean standalone guard bundle directory and exits with code 0.
- **T1-R3-F1-2**: Detects `eval(...)` in bundle files and exits with code 1.
- **T1-R3-F1-3**: Detects `new Function(...)` / `Function(...)` in bundle files and exits with code 1.
- **T1-R3-F1-4**: Detects string-argument `setTimeout("...")` and `setInterval("...")` and exits with code 1.
- **T1-R3-F1-5**: Detects disallowed runtime engine imports (`ajv`, `zod`, `@oa-sdk`) in ESM and CommonJS formats.

#### Feature 8: CSP AST Violation Detection & Diagnostics
- **T1-R3-F2-1**: Emits `csp/no-eval` rule diagnostic with line and column numbers.
- **T1-R3-F2-2**: Emits `csp/no-new-function` rule diagnostic on `new Function` invocation.
- **T1-R3-F2-3**: Emits `csp/no-string-settimeout` rule diagnostic on string-based timers.
- **T1-R3-F2-4**: Emits `csp/no-disallowed-import` rule diagnostic on `import ... from 'ajv'` or `require('zod')`.
- **T1-R3-F2-5**: Aggregates multiple violations across multiple files in the bundle directory.

#### Feature 9: Schema Conventions Documentation Completeness
- **T1-R4-F1-1**: Verifies presence and normative specification of RFC 9457 `ProblemDetailsSchema`.
- **T1-R4-F1-2**: Verifies specification of strict numeric bounds (`exclusiveMinimum: 0` vs `minimum: 0`).
- **T1-R4-F1-3**: Verifies specification of recursive schema registry patterns (`z.lazy` + registry refs).
- **T1-R4-F1-4**: Verifies specification of `x-surface-*` scope rules (`targetProperty` vs inline property-level).
- **T1-R4-F1-5**: Verifies specification of V3 Unified Architecture JSDoc annotation tags (`@minimum`, `@format`, `@discriminator`).

---

### Tier 2: Boundary & Corner Cases (>=5 tests per feature)

- **R1 Boundaries**:
  - `T2-R1-B1`: Single-component schema splitting generates clean 1-module directory.
  - `T2-R1-B2`: Deeply nested multi-level $ref chains correctly resolved and inlined in split file.
  - `T2-R1-B3`: Schema type names containing dashes/underscores normalized to valid identifier filenames.
  - `T2-R1-B4`: Splitting with empty schema object `{}` produces valid fallback guard.
  - `T2-R1-B5`: Filtering with non-existent schema name outputs empty/noop bundle without crash.

- **R2 Boundaries**:
  - `T2-R2-B1`: Linting with all allowed categories explicitly listed in comma-separated string.
  - `T2-R2-B2`: Validating path items containing non-standard HTTP methods (e.g. `query`, `trace`).
  - `T2-R2-B3`: Validating path items containing only path-level parameters without operations.
  - `T2-R2-B4`: Linting spec with whitespace padding in category names (e.g. `--categories " surface , structure "`).
  - `T2-R2-B5`: Validating completely empty/malformed OpenAPI document envelope.

- **R3 Boundaries**:
  - `T2-R3-B1`: Safe `setTimeout(() => {}, 100)` with arrow function callback passes CSP audit.
  - `T2-R3-B2`: Template literal string arguments in `setTimeout(`${code}`, 100)` correctly flagged as violations.
  - `T2-R3-B3`: Identifiers containing "eval" as substring (e.g. `evaluateValue()`) not falsely flagged.
  - `T2-R3-B4`: Dynamic `import()` expressions evaluated for disallowed module specifiers.
  - `T2-R3-B5`: Scanning bundle directory containing nested subdirectories and mixed file extensions (`.js`, `.mjs`, `.cjs`).

- **R4 Boundaries**:
  - `T2-R4-B1`: Markdown guide code blocks are syntax-valid TypeScript/Zod/JSON Schema.
  - `T2-R4-B2`: RFC 9457 Problem Details schema enforces RFC-mandated URI reference `type` field.
  - `T2-R4-B3`: Numeric bounds section explains Draft 2020-12 numeric vs Draft 04 boolean distinction.
  - `T2-R4-B4`: Recursive schema documentation provides cycle-safe dereferencing and termination proof.
  - `T2-R4-B5`: Mirrored guide in `@oa-sdk/docs/guides/` matches `@browser-studio` normative copy.

---

### Tier 3: Cross-Feature Interactions (Pairwise Combinations)

- **T3-1: End-to-End Guard Generation & CSP Verification**:
  Generate split guards with selective `--schemas` filtering -> Scan emitted output directory with `oa-codegen audit:csp` -> Assert 0 violations -> Dynamically import and execute type guards.
- **T3-2: Category Linting -> Profile Validation -> Guard Generation**:
  Lint OpenAPI spec containing `x-surface-*` extensions with `--categories surface` -> Validate with `--profile component-bundle` -> Compile to split standalone guards.
- **T3-3: RFC 9457 Error Contract Pipeline**:
  Project RFC 9457 `ProblemDetailsSchema` -> Validate under `--profile operation-contract` as 422 error response -> Compile to standalone type guard -> Verify dynamic validation on error payload.
- **T3-4: Recursive Discriminated Union Pipeline**:
  Author recursive tree schema with `z.lazy` and discriminator `kind` -> Validate under `--profile component-bundle` -> Generate split standalone guards -> Verify $ref inlining and non-infinite loop execution.

---

### Tier 4: Real-World Application Scenarios

- **T4-1: Chrome Extension Manifest V3 Content Script 60fps Live-Editing Sandbox**:
  Simulates a browser extension content script environment where `globalThis.Function` and `globalThis.eval` are disabled. Standalone split guards for `SurfaceBlock`, `SurfaceParam`, and `PatchOp` are imported and execute 1000 validation cycles in $<10\text{ms}$.
- **T4-2: DevLink Native RPC & MCP CI Governance Pipeline**:
  Executes full spec validation on Native RPC contracts (`/rpc/session.hello`, `/rpc/materialize.css`) with `oa-codegen validate --profile operation-contract` and `oa-codegen lint --categories surface`, asserting 100% clean pipeline pass.
- **T4-3: Production Release Packaging Gate**:
  Generates production standalone guard bundle -> Audits all emitted files with `oa-codegen audit:csp` -> Injects adversarial violation (`eval` / `ajv` import) into build artifact -> Asserts audit gate blocks release with exit code 1.

---

## 5. Test Execution Commands

```bash
# Run full E2E test suite
pnpm --filter @oa-sdk/codegen test packages/codegen/test/e2e/cli-expansions.e2e.test.ts

# Run all codegen tests
pnpm --filter @oa-sdk/codegen test

# Run monorepo typecheck
pnpm -r typecheck
```
