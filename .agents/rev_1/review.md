# Quality & Adversarial Review Report: Proposals 1 & 2

**Target Scope**:
- Proposal 1: Native Discriminated Union Projection (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/codegen`)
- Proposal 2: Non-AST Character Range Patching Metadata Extensions (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/parser`)

**Reviewer**: Reviewer 1 (Roles: Quality Reviewer, Adversarial Critic)  
**Date**: 2026-09-02  
**Verdict**: **REQUEST_CHANGES**

---

## 1. Executive Summary

A comprehensive quality and adversarial review was conducted across the source implementations, public contracts, and test suites for Proposal 1 and Proposal 2:
- `packages/openapi-projection-contract/src/discriminated-union.ts`
- `packages/openapi-projection-contract/src/surface-extensions.ts`
- `packages/parser/src/lint.ts`
- `packages/codegen/src/zod-to-schema.ts`
- Associated test suites and public package index files.

**Key Findings Summary**:
1. **Proposal 2 (`surface-extensions.ts`, `packages/parser/src/lint.ts`)**: **EXCELLENT (100% Pass)**. The `x-surface-*` vendor extensions, type guards, and parser linting rules are complete, robust, type-safe, and fully conform to the specifications with 100% test coverage (53 E2E tests in projection contract, 318 unit tests and 14 E2E tests in parser).
2. **Proposal 1 (`zod-to-schema.ts`)**: **GOOD (100% Pass)**. `zodToSchema` correctly maps `z.discriminatedUnion` to OpenAPI 3.1 `discriminator` + `oneOf` with `context.refs` resolution and Zod v4 shape unwrapping.
3. **Proposal 1 (`discriminated-union.ts`)**: **CRITICAL ISSUES FOUND (6 E2E Test Failures)**. While basic projection works, `projectDiscriminatedUnion` exhibits 3 defects under E2E testing:
   - Defect 1: `determineVariantSchemaName` heuristics strip the `unionSchemaId` prefix when `unionSchemaId` ends with `'Request'`, `'Response'`, or `'Event'`, causing `McpRequest` + `'tools/list'` to emit `ToolsListRequest` instead of `McpRequestToolsList`.
   - Defect 2: Missing trailing slash normalization in `pathPrefix` causes double slashes (e.g., `'/rpc/'` + `'ping'` -> `'/rpc//ping'`).
   - Defect 3: Silent overwrite and schema loss when two variant keys produce identical PascalCase names (e.g., `'user.get'` and `'user_get'`).

Because `@oa-sdk/openapi-projection-contract` fails 6 tests in `test/e2e/discriminated-union.e2e.test.ts`, the final review verdict is **REQUEST_CHANGES**.

---

## 2. Detailed Findings

### [Critical] Finding 1: Namespace Stripping in `determineVariantSchemaName` (Fails F3-1, F3-2, F3-B1, F3-B2)

- **Location**: `packages/openapi-projection-contract/src/discriminated-union.ts:392-425`
- **What**: When `unionSchemaId` has a semantic suffix like `'Request'` (e.g. `'McpRequest'`), `determineVariantSchemaName` uses the heuristic:
  ```typescript
  if (unionSchemaId.endsWith('Request') && !pascalKey.endsWith('Request')) {
    return `${pascalKey}Request`
  }
  ```
  This completely drops the root prefix (`'Mcp'`). As a result:
  - `unionSchemaId: 'McpRequest'`, key: `'tools/list'` -> produces `ToolsListRequest` (Expected: `McpRequestToolsList`).
  - `unionSchemaId: 'McpRequest'`, key: `'tools/call'` -> produces `ToolsCallRequest` (Expected: `McpRequestToolsCall`).
  - `unionSchemaId: 'McpRequest'`, key: `'a/b/c'` -> produces `ABCRequest` (Expected: `McpRequestABC`).
- **Why this is a problem**:
  1. Stripping the prefix violates namespace isolation when multiple discriminated union models exist within the same schema catalog or document.
  2. It violates the canonical discriminator mapping contract expected by MCP protocol implementations.
- **Suggested Fix**:
  Preserve `unionSchemaId` when forming variant schema names, or compose `${unionSchemaId}${pascalKey}` (unless explicit `name` or `title` is supplied):
  ```typescript
  function determineVariantSchemaName(
    key: string,
    unionSchemaId: string,
    explicitName?: string,
  ): string {
    if (explicitName && explicitName.trim()) {
      return explicitName.trim()
    }
    const pascalKey = toPascalCase(key)
    if (pascalKey.toLowerCase().startsWith(unionSchemaId.toLowerCase())) {
      return pascalKey
    }
    return `${unionSchemaId}${pascalKey}`
  }
  ```

---

### [Critical] Finding 2: Path Prefix Normalization Double-Slash Bug (Fails F2-B4)

- **Location**: `packages/openapi-projection-contract/src/discriminated-union.ts:150-153`
- **What**: When `pathPrefix` has a trailing slash (e.g., `pathPrefix: '/rpc/'`), `projectDiscriminatedUnion` computes:
  ```typescript
  const prefix = (pathPrefix ?? '/rpc').trim()
  const normalizedPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`
  const cleanKey = key.replace(/^\//, '')
  const pathKey = `${normalizedPrefix}/${cleanKey}`
  ```
  This creates double slashes: `'/rpc//ping'` instead of `'/rpc/ping'`.
- **Why this is a problem**: OpenAPI 3.1 path templates must not contain unnormalized double slashes, causing path routing and validation mismatches.
- **Suggested Fix**:
  Strip trailing slashes from `normalizedPrefix`:
  ```typescript
  const cleanPrefix = (pathPrefix ?? '/rpc').trim().replace(/\/+$/, '')
  const normalizedPrefix = cleanPrefix.startsWith('/') ? cleanPrefix : `/${cleanPrefix}`
  const cleanKey = key.replace(/^\/+/, '')
  const pathKey = `${normalizedPrefix}/${cleanKey}`
  ```

---

### [Critical] Finding 3: Silent Variant Key Collisions and Schema Overwrites (Fails F3-B4)

- **Location**: `packages/openapi-projection-contract/src/discriminated-union.ts:142`
- **What**: When multiple variant keys resolve to the same schema identifier (e.g., `variants: { 'user.get': ..., 'user_get': ... }` both resolving to `MsgUserGet`), `variantSchemas[variantSchemaName]` is overwritten:
  ```typescript
  variantSchemas[variantSchemaName] = normalizedVariantSchema
  ```
- **Why this is a problem**:
  1. The first variant schema is silently destroyed.
  2. `oneOf` contains duplicate or broken references pointing to the overwritten schema.
  3. `variantSchemas` ends up with fewer entries than `variants`.
- **Suggested Fix**:
  Detect collisions and disambiguate names (e.g. tracking used names and appending numeric suffixes or discriminator key segments), or throw a descriptive error when distinct variants collide without explicit titles.

---

### [Minor] Finding 4: Synthetic Pseudo-Hash in `simpleDeterministicHash`

- **Location**: `packages/openapi-projection-contract/src/discriminated-union.ts:472-485`
- **What**: `projectDiscriminatedUnionDocument` uses a custom bitwise hash generator (`simpleDeterministicHash`) to produce a 64-character hex string prefixed with `sha256:`.
- **Why this is notable**: While adequate for purely deterministic local diffing without Node.js `crypto` dependencies, using the `sha256:` prefix on non-cryptographic hashes could mislead downstream tools expecting a true cryptographic SHA-256 digest.
- **Suggested Fix**: Use standard SHA-256 (e.g. from `@oa-sdk/parser`'s existing hashing utilities) or document that this is a lightweight synthetic digest for version tagging.

---

## 3. Review by Dimension

### 3.1 Correctness & Integrity
- **Integrity Violations Check**: No integrity violations, facade implementations, dummy shortcuts, or hardcoded test bypasses were detected.
- **Proposal 1**: Core logic for mapping variants to `discriminator.mapping` and `oneOf` is functionally implemented, but has 3 specific algorithmic bugs (naming heuristics, path prefix concatenation, variant collision handling).
- **Proposal 2**: 100% correct. Constants, schemas, type guards, and linting rules match specification §2.2 and §2.4 precisely.

### 3.2 Interface Completeness & Conformance
- `DiscriminatedUnionProjectionOptions` and `DiscriminatedUnionProjectionResult` conform to `PROJECT.md` interface specifications.
- `OPENAPI_SURFACE_*` extension constants and types are exported correctly from `packages/openapi-projection-contract/src/index.ts`.
- `lintDocument` supports the `'surface'` category and individual rule configurations (`'surface/valid-anchor'`, `'surface/valid-param-range'`, `'surface/valid-fingerprint'`, `'surface/valid-quote-style'`, `'surface/valid-patch-policy'`).

### 3.3 Type Safety & Public Contracts
- Monorepo typechecking passes cleanly (`tsc --noEmit` on all packages).
- Public type definitions and exports are properly aligned with ESM imports and TypeScript declaration output.

---

## 4. Test Verification Matrix

| Target Package | Test Suite / Command | Total Tests | Passed | Failed | Status |
|---|---|:---:|:---:|:---:|:---:|
| `@oa-sdk/openapi-projection-contract` | `pnpm --filter @oa-sdk/openapi-projection-contract test` | 166 | 160 | 6 | ❌ **FAIL** |
| `@oa-sdk/openapi-projection-contract` | `pnpm --filter @oa-sdk/openapi-projection-contract typecheck` | - | - | - | ✅ **PASS** |
| `@oa-sdk/openapi-projection-contract` | `vitest run test/e2e/surface-extensions.e2e.test.ts` | 53 | 53 | 0 | ✅ **PASS** |
| `@oa-sdk/openapi-projection-contract` | `vitest run test/e2e/discriminated-union.e2e.test.ts` | 44 | 38 | 6 | ❌ **FAIL** |
| `@oa-sdk/parser` | `pnpm --filter @oa-sdk/parser test` | 318 | 318 | 0 | ✅ **PASS** |
| `@oa-sdk/parser` | `pnpm --filter @oa-sdk/parser typecheck` | - | - | - | ✅ **PASS** |
| `@oa-sdk/parser` | `vitest run test/e2e/surface-lint.e2e.test.ts` | 14 | 14 | 0 | ✅ **PASS** |
| `@oa-sdk/codegen` | `pnpm --filter @oa-sdk/codegen test` (all 86 suites) | 974 | 974 | 0 | ✅ **PASS** |

---

## 5. Adversarial Stress Test & Failure Modes

1. **Hostile Path Inputs**:
   - `pathPrefix: '/rpc/'` -> Produced `'/rpc//ping'` (Vulnerability confirmed in Finding 2).
   - `pathPrefix: ''` -> Handled correctly by defaulting to `/rpc` or root path.
2. **Conflicting Variant Names**:
   - `variants: { 'user.get': ..., 'user_get': ... }` -> Resulted in silent data loss (Vulnerability confirmed in Finding 3).
3. **Invalid Surface Range Coordinates**:
   - Non-positive line/column numbers (`line: 0`, `col: -1`) -> Properly rejected by `isSurfaceAnchorMetadata` and flagged by `surface/valid-anchor`.
   - Out-of-bounds `targetProperty` -> Properly flagged by `surface/valid-param-range` in `lintDocument`.
4. **Fingerprint Tampering & Drift**:
   - Uppercase / invalid hex / truncated hashes -> Properly rejected by `isSurfaceFingerprint` and `surface/valid-fingerprint`.
5. **Zero-Eval CSP Invariant**:
   - Verified that standalone type guards generated for projected discriminated unions contain 0 `eval()` calls and 0 `new Function()` invocations.

---

## 6. Actionable Recommendations for Approval

To achieve full approval, the following fixes are required in `packages/openapi-projection-contract/src/discriminated-union.ts`:
1. **Fix `determineVariantSchemaName`**: Remove the aggressive `unionSchemaId.endsWith('Request')` prefix stripping that drops the union prefix. Ensure `unionSchemaId` is consistently prefixed (e.g. `McpRequestToolsList`).
2. **Fix `pathPrefix` normalization**: Strip trailing slashes (`replace(/\/+$/, '')`) before joining with `cleanKey`.
3. **Add collision disambiguation**: Detect when two variant keys produce the same PascalCase schema name and disambiguate or throw an informative collision error.
4. **Re-run test suite**: Verify `pnpm --filter @oa-sdk/openapi-projection-contract test` achieves 100% pass rate (166/166 tests).
