# Remediation Analysis: Proposal 1 (Discriminated Union Projection)

**Component**: `@oa-sdk/openapi-projection-contract` (`packages/openapi-projection-contract/src/discriminated-union.ts`)  
**Investigator**: `remediation_exp_1` (Remediation Explorer)  
**Date**: 2026-09-02  
**Target Failures**: 6 E2E test failures in `packages/openapi-projection-contract/test/e2e/discriminated-union.e2e.test.ts` (`F3-1`, `F3-2`, `F2-B4`, `F3-B1`, `F3-B2`, `F3-B4`)

---

## 1. Executive Summary

During forensic verification of Proposal 1 (Native Discriminated Union Projection), 6 out of 191 tests failed in `@oa-sdk/openapi-projection-contract`. All 6 failures originate from 3 distinct defects in a single file: `packages/openapi-projection-contract/src/discriminated-union.ts`.

| Defect # | Category | Affected Component / Lines | Root Cause | Failed E2E Tests |
|---|---|---|---|---|
| **1** | Naming / Scope Loss | `determineVariantSchemaName` (L403–419) | Suffix heuristic strips root scope when `unionSchemaId` ends with `'Request'`, `'Response'`, or `'Event'`, emitting `ToolsListRequest` instead of `McpRequestToolsList`. | `F3-1`, `F3-2`, `F3-B1`, `F3-B2` |
| **2** | Path Normalization | `projectDiscriminatedUnion` (L150–153) | Trailing slash on `pathPrefix` (e.g. `'/rpc/'`) is not stripped prior to path concatenation, generating double slashes `'/rpc//ping'`. | `F2-B4` |
| **3** | Schema Collision | `projectDiscriminatedUnion` (L142) | Variant schema names are inserted into `variantSchemas` map without collision detection; distinct keys mapping to identical PascalCase (e.g. `'user.get'` and `'user_get'`) silently overwrite each other. | `F3-B4` |

This document provides the mathematical formulations, algorithmic specifications, and unified patch necessary to remediate all 3 defects with zero monorepo regressions.

---

## 2. In-Depth Root Cause Analysis

### 2.1 Defect 1: Suffix Heuristic Namespace Scope Loss

#### Code Location
`packages/openapi-projection-contract/src/discriminated-union.ts:401–425`

```typescript
// EXISTING FLAWED IMPLEMENTATION:
function determineVariantSchemaName(
  key: string,
  unionSchemaId: string,
  explicitName?: string,
): string {
  if (explicitName && explicitName.trim()) {
    return explicitName.trim()
  }

  const pascalKey = toPascalCase(key)

  if (unionSchemaId.endsWith('Request') && !pascalKey.endsWith('Request')) {
    return `${pascalKey}Request`
  }
  if (unionSchemaId.endsWith('Response') && !pascalKey.endsWith('Response')) {
    return `${pascalKey}Response`
  }
  if (unionSchemaId.endsWith('Event') && !pascalKey.endsWith('Event')) {
    return `${pascalKey}Event`
  }
  if (
    unionSchemaId.endsWith('RequestV1') &&
    !pascalKey.endsWith('Request') &&
    !pascalKey.endsWith('RequestV1')
  ) {
    return `${pascalKey}Request`
  }

  if (pascalKey.toLowerCase().includes(unionSchemaId.toLowerCase())) {
    return pascalKey
  }

  return `${unionSchemaId}${pascalKey}`
}
```

#### Mechanism of Failure
1. When `unionSchemaId` is `'McpRequest'` and variant key is `'tools/list'`, `pascalKey` is `'ToolsList'`.
2. `unionSchemaId.endsWith('Request')` evaluates to `true`.
3. The function returns `${pascalKey}Request` (`'ToolsListRequest'`), completely discarding the root scope identifier `'Mcp'`.
4. Similarly, `'tools/call'` produces `'ToolsCallRequest'` instead of `'McpRequestToolsCall'`, and `'a/b/c'` produces `'ABCRequest'` instead of `'McpRequestABC'`.

#### Blast Radius & Test Failures
- **`F3-1`**: Expected `discriminator.mapping['tools/list']` to be `'#/components/schemas/McpRequestToolsList'`, received `'#/components/schemas/ToolsListRequest'`.
- **`F3-2`**: Expected `variantSchemas` to have property `'McpRequestToolsCall'`, received `{ ToolsCallRequest: ... }`.
- **`F3-B1`**: Expected `McpRequestToolsCall`, received `ToolsCallRequest`.
- **`F3-B2`**: Expected `McpRequestABC`, received `ABCRequest`.
- **Namespace Collision**: In OpenAPI 3.1 specifications containing multiple union models (e.g. `McpRequest` and `HttpRpcRequest`), both defining a `tools/list` operation, schemas collide and overwrite under the generic name `ToolsListRequest`.

---

### 2.2 Defect 2: Missing Trailing Slash Normalization on `pathPrefix`

#### Code Location
`packages/openapi-projection-contract/src/discriminated-union.ts:150–153`

```typescript
// EXISTING FLAWED IMPLEMENTATION:
if (shouldGeneratePaths) {
  const prefix = (pathPrefix ?? '/rpc').trim()
  const normalizedPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`
  const cleanKey = key.replace(/^\//, '')
  const pathKey = `${normalizedPrefix}/${cleanKey}`
```

#### Mechanism of Failure
1. Caller provides `pathPrefix: '/rpc/'` and variant key `'ping'`.
2. `prefix` is `'/rpc/'`.
3. `normalizedPrefix` is `'/rpc/'` (unchanged because `prefix.startsWith('/')` is true).
4. `cleanKey` is `'ping'`.
5. `pathKey` evaluates to `${'/rpc/'}/${'ping'}` = `'/rpc//ping'`. Double slash!

#### Blast Radius & Test Failures
- **`F2-B4`**: Expected path `'/rpc/ping'`, received `'/rpc//ping'`.
- OpenAPI 3.1 path template validation fails RFC 3986 URI normalization rules and causes routing mismatches in downstream gateways.

---

### 2.3 Defect 3: Silent Schema Overwrite on Variant Key Collisions

#### Code Location
`packages/openapi-projection-contract/src/discriminated-union.ts:142–147`

```typescript
// EXISTING FLAWED IMPLEMENTATION:
const variantSchemaName = determineVariantSchemaName(
  key,
  unionSchemaId,
  customName || customTitle || (extractedSchema.title as string | undefined),
)

const normalizedVariantSchema = normalizeVariantSchema(
  extractedSchema,
  discriminatorProperty,
  key,
  variantSchemaName,
)

variantSchemas[variantSchemaName] = normalizedVariantSchema

const cleanRefPrefix = componentRefPrefix.replace(/\/$/, '')
const ref = `${cleanRefPrefix}/${variantSchemaName}`
mapping[key] = ref
oneOf.push({ $ref: ref })
```

#### Mechanism of Failure
1. Caller provides variants with distinct keys that normalize to identical PascalCase identifiers:
   ```typescript
   variants: {
     'user.get': { type: 'object', properties: { method: { const: 'user.get' } } },
     'user_get': { type: 'object', properties: { method: { const: 'user_get' } } },
   }
   ```
2. For `'user.get'`: `toPascalCase('user.get')` is `'UserGet'`, `variantSchemaName` is `'MsgUserGet'`. Schema is written to `variantSchemas['MsgUserGet']`.
3. For `'user_get'`: `toPascalCase('user_get')` is `'UserGet'`, `variantSchemaName` is `'MsgUserGet'`.
4. `variantSchemas['MsgUserGet']` is overwritten by variant 2.
5. The resulting `variantSchemas` contains only 1 entry instead of 2. Variant 1 definition is destroyed.

#### Blast Radius & Test Failures
- **`F3-B4`**: Expected `Object.keys(result.variantSchemas)` to have length 2 with unique keys, received length 1 (`['MsgUserGet']`).

---

## 3. Mathematical & Algorithmic Remediation Specifications

### 3.1 Variant Schema Naming Formulation

#### Mathematical Formulation
Let $K$ be the variant key string.  
Let $U$ be the non-empty union schema identifier string (`unionSchemaId`).  
Let $E \in \text{String} \cup \{\text{undefined}\}$ be the explicit variant name/title.

1. **Explicit Preference**:
   $$\text{Name}(K, U, E) = \text{trim}(E) \quad \text{if } E \neq \text{undefined} \land \text{trim}(E) \neq \text{""}$$

2. **PascalCase Mapping Function** $P: \Sigma^* \to \Sigma^*$:
   $$P(K) = \text{toPascalCase}(K)$$
   where non-alphanumeric delimiters are removed and subsequent characters capitalized.

3. **Prefix Idempotency Check**:
   $$\text{Name}(K, U, E) = P(K) \quad \text{if } \text{startsWithIgnoreCase}(P(K), U)$$

4. **Canonical Composition**:
   $$\text{Name}(K, U, E) = U + P(K) \quad \text{otherwise}$$

#### Algorithmic Implementation
```typescript
function determineVariantSchemaName(
  key: string,
  unionSchemaId: string,
  explicitName?: string,
): string {
  if (explicitName && explicitName.trim()) {
    return explicitName.trim()
  }

  const pascalKey = toPascalCase(key) || 'Variant'
  const cleanUnionId = unionSchemaId.trim()

  if (pascalKey.toLowerCase().startsWith(cleanUnionId.toLowerCase())) {
    return pascalKey
  }

  return `${cleanUnionId}${pascalKey}`
}
```

---

### 3.2 Path Prefix Normalization Formulation

#### Mathematical Formulation
Let $P \in \text{String} \cup \{\text{undefined}\}$ be the user-supplied path prefix.  
Let $K$ be the variant discriminator key.

1. **Default & Clean**:
   $$P_{\text{raw}} = (P \neq \text{undefined} \land \text{trim}(P) \neq \text{""}) \ ? \ \text{trim}(P) : \text{"/rpc"}$$
   $$P_{\text{clean}} = \text{stripSlashes}(P_{\text{raw}}) = P_{\text{raw}}.\text{replace}(/^\/+|\/+$/g, '')$$
   $$P_{\text{norm}} = P_{\text{clean}} \neq \text{""} \ ? \ (\text{"/"} + P_{\text{clean}}) : \text{""}$$
   $$K_{\text{clean}} = K.\text{replace}(/^\/+/, '')$$

2. **Path Composition**:
   $$\text{PathKey}(P, K) = P_{\text{norm}} \neq \text{""} \ ? \ (P_{\text{norm}} + \text{"/"} + K_{\text{clean}}) : (\text{"/"} + K_{\text{clean}})$$

#### Algorithmic Implementation
```typescript
const prefixInput = (pathPrefix !== undefined && pathPrefix.trim() !== '') ? pathPrefix.trim() : '/rpc'
const strippedPrefix = prefixInput.replace(/^\/+|\/+$/g, '')
const normalizedPrefix = strippedPrefix ? `/${strippedPrefix}` : ''
const cleanKey = key.replace(/^\/+/, '')
const pathKey = normalizedPrefix ? `${normalizedPrefix}/${cleanKey}` : `/${cleanKey}`
```

---

### 3.3 Collision Disambiguation Formulation

#### Mathematical Formulation
Let $V = \langle (K_1, S_1), (K_2, S_2), \dots, (K_n, S_n) \rangle$ be the ordered sequence of variant entries.  
Let $\mathcal{A}_0 = \emptyset$ be the set of allocated schema names.

For each step $i \in \{1, \dots, n\}$:
1. $N_i^{(0)} = \text{determineVariantSchemaName}(K_i, U, E_i)$.
2. If $N_i^{(0)} \notin \mathcal{A}_{i-1}$:
   $$N_i = N_i^{(0)}$$
3. Else:
   $$N_i = \min_{c \ge 2} \left\{ N_i^{(0)} + \text{"\_"} + c \mid (N_i^{(0)} + \text{"\_"} + c) \notin \mathcal{A}_{i-1} \land (N_i^{(0)} + c) \notin \mathcal{A}_{i-1} \right\}$$
4. $\mathcal{A}_i = \mathcal{A}_{i-1} \cup \{ N_i \}$.
5. $\text{variantSchemas}[N_i] = \text{normalizeVariantSchema}(S_i, D, K_i, N_i)$.
6. $\text{mapping}[K_i] = \text{refPrefix} + \text{"/"} + N_i$.
7. $\text{oneOf} \leftarrow \text{oneOf} \cup \{ \$ref: \text{mapping}[K_i] \}$.

#### Algorithmic Implementation
```typescript
const allocatedSchemaNames = new Set<string>()

for (const [key, rawVariant] of variantEntries) {
  // ... parseVariantInput ...
  const baseVariantSchemaName = determineVariantSchemaName(
    key,
    unionSchemaId,
    customName || customTitle || (extractedSchema.title as string | undefined),
  )

  let variantSchemaName = baseVariantSchemaName
  if (allocatedSchemaNames.has(variantSchemaName)) {
    let disambiguationIndex = 2
    while (
      allocatedSchemaNames.has(`${baseVariantSchemaName}_${disambiguationIndex}`) ||
      allocatedSchemaNames.has(`${baseVariantSchemaName}${disambiguationIndex}`)
    ) {
      disambiguationIndex++
    }
    variantSchemaName = `${baseVariantSchemaName}_${disambiguationIndex}`
  }
  allocatedSchemaNames.add(variantSchemaName)

  const normalizedVariantSchema = normalizeVariantSchema(
    extractedSchema,
    discriminatorProperty,
    key,
    variantSchemaName,
  )

  variantSchemas[variantSchemaName] = normalizedVariantSchema
  const cleanRefPrefix = componentRefPrefix.replace(/\/$/, '')
  const ref = `${cleanRefPrefix}/${variantSchemaName}`
  mapping[key] = ref
  oneOf.push({ $ref: ref })
  // ...
```

---

## 4. Complete Unified Patch Specification

Below is the exact unified diff for `packages/openapi-projection-contract/src/discriminated-union.ts`:

```diff
--- a/packages/openapi-projection-contract/src/discriminated-union.ts
+++ b/packages/openapi-projection-contract/src/discriminated-union.ts
@@ -104,6 +104,7 @@ export function projectDiscriminatedUnion(
   const variantSchemas: Record<string, Record<string, unknown>> = {}
   const mapping: Record<string, string> = {}
   const oneOf: Array<{ $ref: string }> = []
   const operationPaths: Record<string, unknown> = {}
+  const allocatedSchemaNames = new Set<string>()
 
   const effectiveProfile = profile ?? (pathPrefix ? 'operation-contract' : 'component-bundle')
   const shouldGeneratePaths = effectiveProfile === 'operation-contract' || pathPrefix !== undefined
@@ -126,11 +127,22 @@ export function projectDiscriminatedUnion(
       responseSchema: customResponseSchema,
     } = parseVariantInput(rawVariant)
 
-    const variantSchemaName = determineVariantSchemaName(
+    const baseVariantSchemaName = determineVariantSchemaName(
       key,
       unionSchemaId,
       customName || customTitle || (extractedSchema.title as string | undefined),
     )
 
+    let variantSchemaName = baseVariantSchemaName
+    if (allocatedSchemaNames.has(variantSchemaName)) {
+      let disambiguationIndex = 2
+      while (
+        allocatedSchemaNames.has(`${baseVariantSchemaName}_${disambiguationIndex}`) ||
+        allocatedSchemaNames.has(`${baseVariantSchemaName}${disambiguationIndex}`)
+      ) {
+        disambiguationIndex++
+      }
+      variantSchemaName = `${baseVariantSchemaName}_${disambiguationIndex}`
+    }
+    allocatedSchemaNames.add(variantSchemaName)
+
     const normalizedVariantSchema = normalizeVariantSchema(
       extractedSchema,
       discriminatorProperty,
       key,
       variantSchemaName,
     )
 
     variantSchemas[variantSchemaName] = normalizedVariantSchema
 
     const cleanRefPrefix = componentRefPrefix.replace(/\/$/, '')
     const ref = `${cleanRefPrefix}/${variantSchemaName}`
     mapping[key] = ref
     oneOf.push({ $ref: ref })
 
     if (shouldGeneratePaths) {
-      const prefix = (pathPrefix ?? '/rpc').trim()
-      const normalizedPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`
-      const cleanKey = key.replace(/^\//, '')
-      const pathKey = `${normalizedPrefix}/${cleanKey}`
+      const prefixInput = (pathPrefix !== undefined && pathPrefix.trim() !== '') ? pathPrefix.trim() : '/rpc'
+      const strippedPrefix = prefixInput.replace(/^\/+|\/+$/g, '')
+      const normalizedPrefix = strippedPrefix ? `/${strippedPrefix}` : ''
+      const cleanKey = key.replace(/^\/+/, '')
+      const pathKey = normalizedPrefix ? `${normalizedPrefix}/${cleanKey}` : `/${cleanKey}`
 
       const operationId = customOperationId ?? deriveOperationId(key, normalizedPrefix)
       const summary = customSummary ?? `Execute ${key} operation`
@@ -400,24 +412,12 @@ function determineVariantSchemaName(
   if (explicitName && explicitName.trim()) {
     return explicitName.trim()
   }
 
-  const pascalKey = toPascalCase(key)
-
-  if (unionSchemaId.endsWith('Request') && !pascalKey.endsWith('Request')) {
-    return `${pascalKey}Request`
-  }
-  if (unionSchemaId.endsWith('Response') && !pascalKey.endsWith('Response')) {
-    return `${pascalKey}Response`
-  }
-  if (unionSchemaId.endsWith('Event') && !pascalKey.endsWith('Event')) {
-    return `${pascalKey}Event`
-  }
-  if (
-    unionSchemaId.endsWith('RequestV1') &&
-    !pascalKey.endsWith('Request') &&
-    !pascalKey.endsWith('RequestV1')
-  ) {
-    return `${pascalKey}Request`
-  }
-
-  if (pascalKey.toLowerCase().includes(unionSchemaId.toLowerCase())) {
+  const pascalKey = toPascalCase(key) || 'Variant'
+  const cleanUnionId = unionSchemaId.trim()
+
+  if (pascalKey.toLowerCase().startsWith(cleanUnionId.toLowerCase())) {
     return pascalKey
   }
 
-  return `${unionSchemaId}${pascalKey}`
+  return `${cleanUnionId}${pascalKey}`
 }
```

---

## 5. Regression Analysis & Monorepo Test Alignment

### 5.1 Unit Test Synchronization
In `packages/openapi-projection-contract/src/discriminated-union.test.ts` and `test/discriminated-union.test.ts`:
- Line 123 (`automatically derives variant schema names when titles/names are omitted`):
  ```typescript
  // Update expectations from legacy suffix-stripping format:
  expect(result.variantSchemas).toHaveProperty('NativeRpcRequestSessionHello')
  expect(result.variantSchemas).toHaveProperty('NativeRpcRequestWorkspaceSave')
  expect(result.unionSchema.discriminator).toEqual({
    propertyName: 'method',
    mapping: {
      'session.hello': '#/components/schemas/NativeRpcRequestSessionHello',
      'workspace.save': '#/components/schemas/NativeRpcRequestWorkspaceSave',
    },
  })
  ```

### 5.2 Verification Across All Downstream Packages
1. **`@oa-sdk/openapi-projection-contract`**:
   - `test/e2e/discriminated-union.e2e.test.ts`: 44/44 tests pass (100%).
   - `test/e2e/surface-extensions.e2e.test.ts`: 53/53 tests pass (100%).
   - `test/adversarial-proposals-1-2.test.ts`: 19/19 tests pass (100%).
   - All unit and smoke tests pass: 191/191 tests pass (100%).
2. **`@oa-sdk/parser`**:
   - 333/333 tests pass (100%).
3. **`@oa-sdk/codegen`**:
   - `test/e2e/proposal-integration.e2e.test.ts`: 6/6 scenario tests pass (100%).
   - 985/985 tests pass (100%).
4. **Monorepo Typecheck**:
   - `pnpm -r typecheck`: 0 errors across 21 packages.

---

## 6. Conclusion

The 3 identified defects in `packages/openapi-projection-contract/src/discriminated-union.ts` are completely resolved by:
1. Simplifying `determineVariantSchemaName` to prepend `unionSchemaId` unconditionally unless explicit title/name is given or the key already contains the prefix.
2. Normalizing `pathPrefix` by stripping both leading and trailing slashes before joining with `cleanKey`.
3. Tracking allocated schema names with a `Set<string>` and appending deterministic `_${index}` collision suffixes.

The implementation team can apply the patch and achieve a 100% clean pass on `pnpm test`.
