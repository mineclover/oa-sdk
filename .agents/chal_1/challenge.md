# Adversarial Challenge Report — Proposals 1 & 2

## Challenge Summary

**Overall risk assessment**: **HIGH**  
**Verdict**: **REJECT** (Proposal 1: FAILED on 6 E2E test cases; Proposal 2: APPROVED with 100% pass rate)

---

## Challenges Identified

### [High] Challenge 1: `determineVariantSchemaName` Heuristic Scope Loss on `Request`/`Response`/`Event` Suffixes

- **Assumption Challenged**: The assumption that if `unionSchemaId` ends with `'Request'`, any variant schema should simply append `'Request'` to the variant's PascalCase name (e.g. `McpRequest` + `'tools/list'` -> `'ToolsListRequest'`), rather than prefixing with the union schema scope (`'McpRequestToolsList'`).
- **Attack Scenario**:
  When configuring an MCP or DevLink stdio request union:
  ```typescript
  projectDiscriminatedUnion({
    discriminatorProperty: 'method',
    unionSchemaId: 'McpRequest',
    variants: {
      'tools/list': { ... },
      'tools/call': { ... }
    }
  })
  ```
  `determineVariantSchemaName` produces `ToolsListRequest` and `ToolsCallRequest` instead of `McpRequestToolsList` and `McpRequestToolsCall`. This breaks schema name encapsulation when multiple request unions exist in the same OpenAPI specification (e.g., `McpRequest` vs `HttpRpcRequest` both defining `tools/list`).
- **Blast Radius**:
  Causes schema namespace collisions in generated OpenAPI `components.schemas`, breaking downstream code generation and failing E2E tests (`F3-1`, `F3-2`, `F3-B1`, `F3-B2` in `test/e2e/discriminated-union.e2e.test.ts`).
- **Mitigation**:
  Adjust `determineVariantSchemaName` to respect the full `unionSchemaId` prefix when generating default variant names, e.g. `${unionSchemaId}${pascalKey}`, or only strip/adjust suffixes when `pascalKey` already explicitly contains `unionSchemaId`.

---

### [Medium] Challenge 2: Incomplete Trailing Slash Normalization on `pathPrefix`

- **Assumption Challenged**: The assumption that path prefixes supplied by users do not contain trailing slashes or that string concatenation `prefix + '/' + key` is safe.
- **Attack Scenario**:
  A caller passes `pathPrefix: '/rpc/'`:
  ```typescript
  projectDiscriminatedUnion({
    discriminatorProperty: 'method',
    unionSchemaId: 'Rpc',
    pathPrefix: '/rpc/',
    variants: { ping: { ... } }
  })
  ```
  `discriminated-union.ts` evaluates:
  ```typescript
  const prefix = (pathPrefix ?? '/rpc').trim()
  const normalizedPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`
  const cleanKey = key.replace(/^\//, '')
  const pathKey = `${normalizedPrefix}/${cleanKey}` // Result: '/rpc//ping'
  ```
- **Blast Radius**:
  Generates invalid OpenAPI 3.1 path items containing double slashes (`/rpc//ping`), failing RFC URI specifications, client routing, and E2E test `F2-B4`.
- **Mitigation**:
  Strip trailing slashes from `pathPrefix` during normalization:
  ```typescript
  const normalizedPrefix = (pathPrefix ?? '/rpc').trim().replace(/\/+$/, '')
  const cleanKey = key.replace(/^\/+/, '')
  const pathKey = `${normalizedPrefix.startsWith('/') ? normalizedPrefix : `/${normalizedPrefix}`}/${cleanKey}`
  ```

---

### [High] Challenge 3: Silent Schema Overwrite on PascalCase Key Collisions

- **Assumption Challenged**: The assumption that distinct variant keys always produce distinct PascalCase schema identifiers.
- **Attack Scenario**:
  A protocol defines variants with different separators:
  ```typescript
  projectDiscriminatedUnion({
    discriminatorProperty: 'method',
    unionSchemaId: 'Msg',
    variants: {
      'user.get': { type: 'object', properties: { method: { const: 'user.get' } } },
      'user_get': { type: 'object', properties: { method: { const: 'user_get' } } },
    }
  })
  ```
  Both `'user.get'` and `'user_get'` evaluate to PascalCase `'UserGet'`, producing variant schema name `'MsgUserGet'`.
  `variantSchemas['MsgUserGet'] = normalizedVariantSchema` overwrites the first variant with the second variant. The resulting `variantSchemas` contains only 1 schema instead of 2.
- **Blast Radius**:
  Silent data loss of schema definitions in polymorphic unions. Fails E2E test `F3-B4`.
- **Mitigation**:
  Track generated variant schema names in a Set/Map and disambiguate collisions (e.g. by incorporating separator semantics or numeric disambiguation suffixes) or throw a descriptive error when a naming collision occurs.

---

## Stress Test Results

| # | Test Scenario | Expected Behavior | Actual Behavior | Result |
|---|---------------|-------------------|-----------------|:------:|
| 1 | `projectDiscriminatedUnion` with empty variants `{}` | Throw error | Throws "at least one variant" | **PASS** |
| 2 | `projectDiscriminatedUnion` with empty `discriminatorProperty` | Throw error | Throws "discriminatorProperty must be a non-empty string" | **PASS** |
| 3 | `projectDiscriminatedUnion` with empty `unionSchemaId` | Throw error | Throws "unionSchemaId must be a non-empty string" | **PASS** |
| 4 | Variant schema with mismatched `const` discriminator | Throw error | Throws "mismatched const value" | **PASS** |
| 5 | Variant schema with mismatched `enum` discriminator | Throw error | Throws "mismatched enum value" | **PASS** |
| 6 | Chrome Native Messaging 4-byte RPC projection | Generate `/rpc/{method}` paths & discriminator mapping | Generates valid paths & mapping | **PASS** |
| 7 | MCP stdio operation contract projection (`tools/list`, `tools/call`) | Schema names matching `McpRequestToolsList`, `McpRequestToolsCall` | Returned `ToolsListRequest`, `ToolsCallRequest` | **FAIL** (E2E) |
| 8 | Trailing slash path prefix `/rpc/` | Output path `/rpc/ping` | Outputted `/rpc//ping` | **FAIL** (E2E) |
| 9 | Overlapping variant keys (`user.get` vs `user_get`) | Maintain 2 distinct variant schemas | Overwrote to 1 schema `MsgUserGet` | **FAIL** (E2E) |
| 10 | Profile `component-bundle` vs `operation-contract` | Omit paths in bundle mode; include paths in contract mode | Correctly toggles paths | **PASS** |
| 11 | `isOpenApiSurfaceExtensionName` predicate | Recognize all 5 `x-surface-*` extensions; reject others | Matches exact enum | **PASS** |
| 12 | `isSurfaceFingerprint` with invalid hashes/prefixes/lengths | Reject invalid hashes | Rejects md5, uppercase, non-hex, length != 64 | **PASS** |
| 13 | `isSurfaceAnchorMetadata` with line <= 0, col <= 0, empty id | Reject invalid coordinates | Rejects non-finite/negative numbers, empty IDs | **PASS** |
| 14 | `isSurfaceParamRangeMetadata` with negative offsets & fps <= 0 | Reject invalid ranges | Rejects negative offsets, fps <= 0 | **PASS** |
| 15 | `isSurfacePatchPolicyMetadata` with bad drift policies | Reject invalid policies | Accepts only abort, rebase, force | **PASS** |
| 16 | Parser `surface/valid-anchor` lint rule | Report error on invalid anchor | Emits error | **PASS** |
| 17 | Parser `surface/valid-param-range` lint rule | Report error when targetProperty missing in schema | Emits error with property name | **PASS** |
| 18 | Parser `surface/valid-fingerprint` lint rule | Report error on malformed sha256 | Emits error | **PASS** |
| 19 | Parser `surface/valid-quote-style` lint rule | Report error on non-standard quote | Emits error | **PASS** |
| 20 | Parser `surface/valid-patch-policy` lint rule | Report error on unknown drift | Emits error | **PASS** |
| 21 | Category filtering `categories: ['surface']` | Execute only surface rules | Isolates surface rules with zero interference | **PASS** |
| 22 | Rules override (`off`, `warn`, `error`) | Suppress or adjust severity | Honors configuration | **PASS** |
| 23 | Deep traversal across schemas, params, operations | Detect violations in nested nodes | Successfully traverses and flags | **PASS** |
| 24 | Monorepo Core Typecheck (`pnpm typecheck:core`) | 0 TypeScript errors across all 13 core packages | 13/13 tasks passed cleanly | **PASS** |

---

## Unchallenged Areas

- Proposals 3 and 4 (Standalone Type Guards & AST Bidirectional Sync) were verified by dedicated parallel workers and out of scope for Challenger 1, though full core typecheck (`pnpm typecheck:core`) was verified cleanly across all packages.
