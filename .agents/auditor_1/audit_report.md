# Forensic Audit Report: 4 Upstream Architectural Proposals in `@oa-sdk`

**Work Product**: `@oa-sdk/*` Monorepo (`packages/openapi-projection-contract`, `packages/parser`, `packages/codegen`)  
**Profile**: General Project (Integrity Forensics & Adversarial Stress Analysis)  
**Auditor**: `auditor_1` (Forensic Auditor)  
**Timestamp**: 2026-09-02T15:15:00Z  
**Verdict**: **INTEGRITY VIOLATION** (Rejected due to Behavioral Verification & Test Failure in Proposal 1)

---

## 1. Executive Summary

A comprehensive forensic integrity audit was conducted across all 4 Upstream Architectural Proposals in `@oa-sdk`:
1. **Proposal 1**: Native Discriminated Union Projection (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/codegen`)
2. **Proposal 2**: Non-AST Character Range Patching Metadata Extensions (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/parser`)
3. **Proposal 3**: Standalone Lightweight Type Guard Generator Plugin (`@oa-sdk/codegen`)
4. **Proposal 4**: TypeScript AST Bidirectional Synchronization (V3 Unified Architecture) (`@oa-sdk/codegen`)

### Audit Summary Table

| Proposal / Dimension | Audit Scope | Static Anti-Cheat | Genuine Implementation | Test Execution | Verdict |
|---|---|:---:|:---:|:---:|:---:|
| **Anti-Cheat Static Analysis** | All modified/created packages | **PASS** (No cheats) | **PASS** (Real AST/Ajv) | N/A | **PASS** |
| **Proposal 1 (Discriminated Unions)** | `packages/openapi-projection-contract` | **PASS** | **PASS** | **FAIL** (6/191 tests fail) | 🔴 **FAIL** |
| **Proposal 2 (Surface Extensions & Linting)** | `packages/openapi-projection-contract`, `packages/parser` | **PASS** | **PASS** | **PASS** (100% 333 tests pass) | 🟢 **PASS** |
| **Proposal 3 (Standalone Guards Generator)** | `packages/codegen` (`standalone-guards`, CLI) | **PASS** (0 eval, 0 deps) | **PASS** (Ajv 2020 standalone) | **PASS** (100% tests pass) | 🟢 **PASS** |
| **Proposal 4 (AST Bidirectional Sync V3)** | `packages/codegen` (`ast-sync`, Adapters, Diff) | **PASS** | **PASS** (ts compiler AST) | **PASS** (100% tests pass) | 🟢 **PASS** |
| **Monorepo Typecheck** | `pnpm -r typecheck` (21 packages) | **PASS** (0 errors) | **PASS** | **PASS** | 🟢 **PASS** |

---

## 2. Phase 1: Static Analysis & Anti-Cheat Forensics

### 2.1 Hardcoded Test Results & Constant Returns
- **Inspection**: Searched all source code in `packages/openapi-projection-contract/`, `packages/parser/`, and `packages/codegen/` for fixed string returns, hardcoded test IDs, or bypasses.
- **Finding**: **CLEAN**. All components execute algorithmic transforms:
  - `discriminated-union.ts`: Computes OpenAPI 3.1 `discriminator.mapping` and `oneOf` dynamically from input keys and options.
  - `lint.ts`: Performs AST document traversal checking node types, ranges, regexes, and coordinate constraints.
  - `generator.ts`: Invokes `Ajv2020` and `ajv/dist/standalone` to generate standalone validator JavaScript AST code dynamically.
  - `ast-sync/`: Uses TypeScript compiler API (`ts.createSourceFile`, `ts.forEachChild`, `ts.Node`) to parse ASTs and construct `EntitySpec` objects.

### 2.2 Facade & Stub Detection
- **Inspection**: Checked for classes or methods raising `NotImplementedError`, returning uncalculated defaults, or stubbing interfaces.
- **Finding**: **CLEAN**. Zero placeholder classes or dummy methods found.

### 2.3 Standalone Guards CSP & Zero-Eval Invariant
- **Inspection**: Audited `packages/codegen/src/standalone-guards/generator.ts` and generated artifacts for `eval()`, `new Function()`, or dynamic evaluation.
- **Finding**: **CLEAN**.
  - Generated JS code contains 0 `eval()` calls and 0 `new Function()` invocations.
  - Pure ESM output format with zero external runtime dependencies (`export function isX(data, ...args) { ... }`).
  - Generated `.d.ts` emits correct TypeScript type narrowing signatures (`export declare function isX(data: unknown): data is X;`).

### 2.4 Pre-Populated Artifacts
- **Inspection**: Checked repository workspace for pre-existing `.log` or test result artifacts.
- **Finding**: **CLEAN**. Zero pre-populated test output logs existed prior to execution.

---

## 3. Phase 2: Proposal-by-Proposal Forensic Verification

### 3.1 Proposal 1: Native Discriminated Union Projection
- **Target Files**:
  - `packages/openapi-projection-contract/src/discriminated-union.ts`
  - `packages/openapi-projection-contract/src/index.ts`
  - `packages/codegen/src/zod-to-schema.ts`
- **Observations & Evidence**:
  - `projectDiscriminatedUnion` properly constructs `discriminator.mapping` and `oneOf` arrays.
  - `zodToSchema` in `packages/codegen` properly translates `z.discriminatedUnion` to OpenAPI 3.1 `discriminator` + `oneOf`.
  - **Defects Observed (6 Test Failures)**:
    1. **Variant Schema Naming Suffix Collision / Stripping**:
       - `determineVariantSchemaName` at line 403:
         ```typescript
         if (unionSchemaId.endsWith('Request') && !pascalKey.endsWith('Request')) {
           return `${pascalKey}Request`
         }
         ```
         When `unionSchemaId` is `'McpRequest'` and variant key is `'tools/call'`, it stripped `'Mcp'` prefix and returned `'ToolsCallRequest'` instead of `'McpRequestToolsCall'`.
         - Fails `F3-1`, `F3-2`, `F3-B1`, `F3-B2`.
    2. **Path Prefix Trailing Slash Normalization**:
       - Lines 150-153:
         ```typescript
         const prefix = (pathPrefix ?? '/rpc').trim()
         const normalizedPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`
         const cleanKey = key.replace(/^\//, '')
         const pathKey = `${normalizedPrefix}/${cleanKey}`
         ```
         When `pathPrefix` is `'/rpc/'`, `normalizedPrefix` retained the trailing slash, creating double slashes: `'/rpc//ping'`.
         - Fails `F2-B4`.
    3. **Overlapping Suffix Collision Handling**:
       - `determineVariantSchemaName` does not detect name collisions when two distinct variant keys (e.g. `'user.get'` and `'user_get'`) map to the same PascalCase name (`'UserGet'`). As a result, the second variant silently overwrote the first in `result.variantSchemas`, yielding only 1 variant schema instead of 2.
         - Fails `F3-B4`.

### 3.2 Proposal 2: Non-AST Character Range Patching Metadata Extensions & Linting
- **Target Files**:
  - `packages/openapi-projection-contract/src/surface-extensions.ts`
  - `packages/parser/src/lint.ts`
- **Observations & Evidence**:
  - `x-surface-anchor`, `x-surface-param-range`, `x-surface-fingerprint`, `x-surface-quote-style`, `x-surface-patch-policy` are fully implemented with TypeScript type definitions, runtime validator predicates (`isSurfaceAnchorMetadata`, `isSurfaceFingerprint`, etc.), and constants.
  - `lintDocument` in `@oa-sdk/parser` executes deep recursive document traversal and validates all 5 `surface/*` rules (`surface/valid-anchor`, `surface/valid-param-range`, `surface/valid-fingerprint`, `surface/valid-quote-style`, `surface/valid-patch-policy`).
  - 100% test pass rate in `@oa-sdk/parser` (31 test files, 333 tests) and surface extensions test suite (53 tests).

### 3.3 Proposal 3: Standalone Lightweight Type Guard Generator Plugin
- **Target Files**:
  - `packages/codegen/src/standalone-guards/generator.ts`
  - `packages/codegen/src/standalone-guards/types.ts`
  - `packages/codegen/src/cli/commands/generate.ts`
- **Observations & Evidence**:
  - `generateStandaloneGuards` integrates `Ajv2020` and `ajv/dist/standalone` with `code: { source: true, esm: true }`.
  - Produces pure ESM `.js` validator code and `.d.ts` TypeScript declarations with zero external imports and zero `eval()`.
  - CLI command `oa-codegen generate --target standalone-guards --input <path> --out-dir <dir>` functions as specified.
  - 100% test pass rate across standalone guards unit and E2E suites.

### 3.4 Proposal 4: TypeScript AST Bidirectional Synchronization (V3 Unified Architecture)
- **Target Files**:
  - `packages/codegen/src/ast-sync/entity-spec.ts`
  - `packages/codegen/src/ast-sync/adapter-interface.ts`
  - `packages/codegen/src/ast-sync/diff-engine.ts`
  - `packages/codegen/src/ast-sync/text-edit.ts`
  - `packages/codegen/src/ast-sync/type-sync.ts`
  - `packages/codegen/src/ast-sync/adapters/ts-ast.ts`
  - `packages/codegen/src/ast-sync/adapters/typia.ts`
  - `packages/codegen/src/ast-sync/adapters/zod.ts`
- **Observations & Evidence**:
  - Authentic TypeScript compiler AST parsing using `ts.createSourceFile` across all adapters.
  - `computeEntitySpecDiff` accurately identifies property additions, deletions, type changes, constraint modifications, docComment changes, and discriminator diffs.
  - `applyTextEdits` implements reverse-offset bottom-up patching with descending offset sorting, zero index shifting, and full preservation of surrounding comments, formatting, and whitespace trivia.
  - Pluggable Type Adapters (`ZodTypeAdapter`, `TsAstTypeAdapter`, `TypiaTypeAdapter`) successfully parse and emit code across multiple dialects.
  - 100% test pass rate in `@oa-sdk/codegen` (87 test files, 985 tests).

---

## 4. Verification Execution Log

### Command 1: Monorepo Typecheck
```bash
pnpm -r typecheck
```
**Result**: **PASS** (Exit code: 0)  
All 21 packages typechecked successfully with zero TypeScript compilation errors.

### Command 2: Unit & E2E Test Suite
```bash
pnpm test
```
**Result**: **FAIL** (Exit code: 1)  
- `@oa-sdk/parser`: 31 test files, 333 passed (100%)
- `@oa-sdk/codegen`: 87 test files, 985 passed (100%)
- `@oa-sdk/openapi-projection-contract`: 1 failed, 9 passed (185 passed, 6 failed)

#### Verbatim Failure Log:
```
 FAIL  test/e2e/discriminated-union.e2e.test.ts > E2E Discriminated Union Projection (Tiers 1-4) > Tier 1: Feature Coverage > F3: MCP Stdio Protocol Projection > F3-1: projects Model Context Protocol stdio tools/list operation
AssertionError: expected '#/components/schemas/ToolsListRequest' to be '#/components/schemas/McpRequestToolsList'

 FAIL  test/e2e/discriminated-union.e2e.test.ts > E2E Discriminated Union Projection (Tiers 1-4) > Tier 1: Feature Coverage > F3: MCP Stdio Protocol Projection > F3-2: projects MCP tools/call with dynamic arguments parameter object
AssertionError: expected { ToolsCallRequest: { ... } } to have property "McpRequestToolsCall"

 FAIL  test/e2e/discriminated-union.e2e.test.ts > E2E Discriminated Union Projection (Tiers 1-4) > Tier 2: Boundary & Corner Cases > F2-B: RPC Path & Discriminator Name Boundaries > F2-B4: normalizes pathPrefix trailing slashes correctly
AssertionError: expected { '/rpc//ping': { post: { ... } } } to have property "/rpc/ping"

 FAIL  test/e2e/discriminated-union.e2e.test.ts > E2E Discriminated Union Projection (Tiers 1-4) > Tier 2: Boundary & Corner Cases > F3-B: MCP Protocol Boundaries > F3-B1: normalizes slash in method name (tools/call) for schema name PascalCase
AssertionError: expected { ToolsCallRequest: { ... } } to have property "McpRequestToolsCall"

 FAIL  test/e2e/discriminated-union.e2e.test.ts > E2E Discriminated Union Projection (Tiers 1-4) > Tier 2: Boundary & Corner Cases > F3-B: MCP Protocol Boundaries > F3-B2: handles multi-segment slashes in method names (a/b/c)
AssertionError: expected { Object (ABCRequest) } to have property "McpRequestABC"

 FAIL  test/e2e/discriminated-union.e2e.test.ts > E2E Discriminated Union Projection (Tiers 1-4) > Tier 2: Boundary & Corner Cases > F3-B: MCP Protocol Boundaries > F3-B4: generates unique schema identifiers for overlapping suffixes
AssertionError: expected [ 'MsgUserGet' ] to have a length of 2 but got 1
```

---

## 5. Audit Recommendations for Remediation

To achieve a `CLEAN` verdict, the implementation team must address the following issues in `packages/openapi-projection-contract/src/discriminated-union.ts`:

1. **Fix Variant Schema Naming in `determineVariantSchemaName`**:
   - Preserve `unionSchemaId` prefix unless the `pascalKey` already starts with or contains the full `unionSchemaId`. Avoid stripping leading acronyms (e.g. `'Mcp'`).
2. **Normalize Path Prefix Trailing Slashes**:
   - Strip trailing slashes from `pathPrefix` before joining with `cleanKey` (`prefix.replace(/\/+$/, '')`).
3. **Handle Variant Schema Name Collisions**:
   - Maintain a registry or set of allocated `variantSchemaName`s per union projection, and disambiguate collisions (e.g., by incorporating delimiter distinctions or numeric suffixes).

---

## 6. Final Verdict

**VERDICT: INTEGRITY VIOLATION**  
The work product is **REJECTED** due to behavioral test failures in Proposal 1 (`@oa-sdk/openapi-projection-contract`). Once the 6 test failures in `test/e2e/discriminated-union.e2e.test.ts` are resolved and `pnpm test` passes 100%, the work product will be eligible for a clean pass.
