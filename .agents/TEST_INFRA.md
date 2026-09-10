# E2E Test Infra: OpenAPI 3.2 to Zod 4 Code Generator & CLI

## Test Philosophy
- **Opaque-box, requirement-driven testing**: All assertions are derived directly from `ORIGINAL_REQUEST.md` (§R1, §R2, §R3, §R4), `PROJECT.md`, the OpenAPI 3.2.0 Specification (§4.8.24 Discriminator, JSON Schema Draft 2020-12 dialect), and official Zod 4.4.3 runtime semantics.
- **4-Tier Test Architecture**:
  1. **Tier 1 (Feature Coverage)**: Validates the happy-path behavior of every feature in isolation with at least 5 distinct test cases per feature.
  2. **Tier 2 (Boundary & Corner Cases)**: Adversarial boundary stress testing including float/negative/zero boundaries, closed/open tuples, empty sealed objects, mutual/self recursion, and complex discriminator hierarchies.
  3. **Tier 3 (Cross-Feature Combinations)**: Multi-keyword interactions, nested sealed objects with tuples and numeric constraints, recursive trees with discriminated union variants, and full approved OpenAPI 3.2.0 specification integration.
  4. **Tier 4 (Real-World Application Scenarios)**: High-fidelity end-to-end domain models (E-commerce order lifecycle, File system directory tree with recursive entries, RFC 9457 ProblemDetails with discriminated extensions, CLI build pipeline, and Static vs Dynamic validation parity).
- **Standalone test execution**: `packages/codegen/test/e2e/zod4-generator.e2e.test.ts` runs directly under Vitest with zero side effects.
- **Zero coupling to private internals**: Tests interface strictly with public contracts (`generateZodFromSpec`, `createZod4Algebra`, `createRuntimeZodValidators`, `createDynamicZodValidator`, and `oa-gen generate:zod` CLI).
- **Authoritative Expected Output Derivation**: For every test case, expected outputs are grounded in Zod 4's native parsing rules (`zod@4.4.3`), OpenAPI 3.2 specification definitions, and real runtime `.parse()` / `.safeParse()` outcomes.

---

## Feature Inventory Coverage Matrix

| # | Feature | Requirement Source | Milestone | Tier 1 (Happy Path) | Tier 2 (Boundaries) | Tier 3 (Cross-Feature) | Tier 4 (Real-World) |
|---|---------|-------------------|:---------:|:-------------------:|:-------------------:|:----------------------:|:-------------------:|
| **F1** | Catamorphic Zod 4 Algebra (`createZod4Algebra`) | ORIGINAL_REQUEST §R1 | M1 | 5 tests | 5 tests | T3-01, T3-04 | T4-01 |
| **F2** | Document Generator Engine (`generateZodFromSpec`) | ORIGINAL_REQUEST §R1 | M1 | 5 tests | 5 tests | T3-02, T3-03 | T4-01, T4-04 |
| **F3** | Numeric Exclusive Bounds (`.gt()`, `.lt()`) | ORIGINAL_REQUEST §R2 | M2 | 5 tests | 5 tests | T3-01, T3-05 | T4-01, T4-02 |
| **F4** | Tuples & Rest (`z.tuple().rest()`) | ORIGINAL_REQUEST §R2 | M2 | 5 tests | 5 tests | T3-01, T3-06 | T4-01, T4-02 |
| **F5** | Object Sealing (`.strict()`) | ORIGINAL_REQUEST §R2 | M2 | 5 tests | 5 tests | T3-01, T3-07 | T4-01, T4-03 |
| **F6** | Circular References (`z.lazy()`) | ORIGINAL_REQUEST §R2 | M2 | 5 tests | 5 tests | T3-02, T3-08 | T4-02 |
| **F7** | Discriminator & `defaultMapping` | ORIGINAL_REQUEST §R2 | M2 | 5 tests | 5 tests | T3-02, T3-09 | T4-03 |
| **F8** | JSDoc & Metadata (`.describe()`, `.default()`) | ORIGINAL_REQUEST §R2 | M2 | 5 tests | 5 tests | T3-02, T3-10 | T4-01 |
| **F9** | Dynamic Runtime Validator (`z.fromJSONSchema`) | ORIGINAL_REQUEST §R3 | M3 | 5 tests | 5 tests | T3-03, T3-11 | T4-05 |
| **F10** | CLI Command `generate:zod` | ORIGINAL_REQUEST §R4 | M4 | 5 tests | 5 tests | T3-03, T3-12 | T4-04 |

---

## 4-Tier Test Architecture Breakdown

### Tier 1: Feature Coverage (>=5 test cases per feature = 45 tests)
1. **F3: Numeric Exclusive Bounds**:
   - `exclusiveMinimum` compiles to `.gt(n)` and rejects equality.
   - `exclusiveMaximum` compiles to `.lt(n)` and rejects equality.
   - Combined `exclusiveMinimum` and `exclusiveMaximum` form strict open intervals `(min, max)`.
   - Integer bounds with `type: "integer"` map to `.int().gt(n)`.
   - Sibling `multipleOf` constraints combine cleanly with exclusive bounds.
2. **F4: Tuples & Rest**:
   - `prefixItems` with two elements generates `z.tuple([S1, S2])`.
   - `prefixItems` + `items: Schema` generates `z.tuple([...]).rest(S)`.
   - Closed tuple with `items: false` rejects elements exceeding prefix length.
   - Empty tuple `prefixItems: []` validates only empty arrays `[]`.
   - Min/max item bounds on tuples generate `.check(z.minLength())` or length constraints.
3. **F7: Discriminator & `defaultMapping`**:
   - Discriminator with `propertyName` synthesizes `z.discriminatedUnion(prop, [...])`.
   - Explicit `mapping` with multiple aliases routes to correct schemas.
   - OAS 3.2 `defaultMapping` generates fallback variant handling missing discriminator keys.
   - Discriminator options referencing external schemas wrap with `z.lazy()`.
   - Payloads with invalid discriminator values fail with `invalid_union`.
4. **F5: Object Sealing (`.strict()`)**:
   - `unevaluatedProperties: false` emits `.strict()`.
   - `additionalProperties: false` emits `.strict()`.
   - `additionalProperties: true` emits `.passthrough()`.
   - `additionalProperties: Schema` emits `.catchall(Schema)`.
   - Undeclared keys on strict objects throw `unrecognized_keys`.
5. **F6: Circular References (`z.lazy()`)**:
   - Self-referencing schema (e.g. `Node -> Node`) emits `z.lazy(() => NodeSchema)`.
   - Mutual cross-component recursion (`A -> B -> A`) resolves without TDZ `ReferenceError`.
   - Recursive array child properties (`children: [z.lazy(() => NodeSchema)]`) validate multi-level trees.
   - Circular reference inside optional property passes runtime validation when undefined.
   - Deep recursive tree validation evaluates correctly at runtime.
6. **F8: JSDoc & Metadata**:
   - Schema `description` maps to `.describe("...")`.
   - Schema `default` maps to `.default(...)` and supplies fallback values for `undefined`.
   - Property-level descriptions and defaults are preserved on object properties.
   - Escape sequences in descriptions (quotes, backslashes) are correctly encoded.
   - Method chaining preserves `.describe()` outermost without stripping `.default()`.
7. **F1 & F2: Static Code Generation Engine**:
   - `generateZodFromSpec` emits valid TypeScript source with `import { z } from 'zod'`.
   - Generates both schema `export const <Name>Schema = ...` and type `export type <Name> = z.infer<typeof <Name>Schema>`.
   - Respects `style: "schema"` to omit type exports when requested.
   - Formats generated code cleanly via `@oa-sdk/core` `formatGeneratedTs`.
   - Emits banner header comments when `banner: true`.
8. **F9: Dynamic Runtime Validator**:
   - `createRuntimeZodValidators(doc)` returns an executable validator dictionary keyed by schema name.
   - `createDynamicZodValidator(schema, doc)` parses in-memory OAS schemas using `z.fromJSONSchema`.
   - Normalizer aliases `components.schemas` to `$defs` for zero-build reference resolution.
   - Normalizer adapts `unevaluatedProperties: false` so native `fromJSONSchema` does not throw.
   - Validates live payloads at runtime with identical success/failure outcomes.
9. **F10: CLI Execution (`oa-gen generate:zod`)**:
   - Command registered with `--spec`, `--output`, `--style` options.
   - Executes cleanly against spec file path and writes output file.
   - Emits formatted code to stdout when `--output` is omitted.
   - Supports directory output writing to `<dir>/schemas.ts`.
   - Rejects missing `--spec` flag with informative error.

### Tier 2: Boundary & Corner Cases (>=5 test cases per area = 25 tests)
1. **Float, Negative, and Zero Bounds**:
   - Float boundaries with high precision: `exclusiveMinimum: 0.001` accepts `0.00101`, rejects `0.001`.
   - Negative boundaries: `exclusiveMinimum: -50`, `exclusiveMaximum: -10` accepts `-25`, rejects `-50` and `-10`.
   - Zero boundaries: `exclusiveMinimum: 0` accepts `0.000001`, strictly rejects `0` and negative numbers.
   - Mixed signs: `exclusiveMinimum: -1.5`, `exclusiveMaximum: 1.5` accepts `0`, rejects `-1.5` and `1.5`.
   - Scientific notation bounds: `exclusiveMaximum: 1e6` correctly compiles and validates.
2. **Closed Tuples vs Open Tuples vs Rest Tuples**:
   - Tuple with single prefix item and `items: false` rejects length 2 array.
   - Tuple with multiple prefix items and typed rest (`items: { type: "string" }`) validates trailing strings and rejects trailing numbers.
   - Tuple with untyped open rest (`items: true` or omitted) allows arbitrary trailing elements.
   - Tuple with `minItems` greater than `prefixItems.length`.
   - Empty tuple with `items: false` rejects non-empty array `[1]`.
3. **Empty Objects Sealed with `.strict()`**:
   - Empty object with `additionalProperties: false` accepts `{}`.
   - Empty object with `additionalProperties: false` rejects `{ foo: "bar" }` with `unrecognized_keys`.
   - Empty object with `unevaluatedProperties: false` accepts `{}` and rejects any key.
   - Empty object with optional properties sealed with `.strict()` accepts empty object.
   - Object with all optional properties rejects unexpected additional keys when strict.
4. **Mutual and Self Recursion**:
   - Direct self-recursion: `TreeNode` having `children?: TreeNode[]`.
   - Mutual 2-node cycle: `User` has `roles: Role[]`, `Role` has `members: User[]`.
   - Mutual 3-node cycle: `A -> B -> C -> A`.
   - Circular reference combined with array and nullable (`parent: TreeNode | null`).
   - Circular reference inside discriminated union variant branch.
5. **Complex Nested Discriminator Hierarchies**:
   - Two-level discriminator: Outer `Vehicle` (Car/Boat), Inner `Car` (Sedan/SUV).
   - Discriminator mapping with special character values (hyphens, dots, colons).
   - OAS 3.2 `defaultMapping` alongside multiple explicit mappings.
   - Discriminator property declared as optional on default fallback variant.
   - Discriminator with union of literal values per variant option.

### Tier 3: Cross-Feature Combinations (>=10 tests)
- **T3-01**: Sealed object (`.strict()`) containing tuple with rest and exclusive numeric bounds.
- **T3-02**: Recursive tree (`z.lazy()`) with discriminated union variants, JSDoc metadata, and defaults.
- **T3-03**: Dual-mode parity: static generated code vs dynamic runtime validator on complex polymorphic schemas.
- **T3-04**: Sealed object with nested nullable circular references and numeric bounds.
- **T3-05**: Tuple containing discriminated union elements and sealed object elements.
- **T3-06**: Integer exclusive bounds combined with formatted strings and sealed objects.
- **T3-07**: Object with `additionalProperties` catchall schema containing tuples with rest.
- **T3-08**: Multi-component spec with cross-component references, object sealing, and defaults.
- **T3-09**: Discriminator with variants using tuples and exclusive bounds.
- **T3-10**: Full approved OpenAPI 3.2 spec integration (`packages/schemas/typespec/approved.openapi.yaml`).

### Tier 4: Real-World Application Scenarios (5 Scenarios)
- **T4-01 (E-commerce Order Lifecycle)**: Multi-state order schema (`Pending`, `Paid`, `Shipped`, `Delivered`, `Cancelled`) with line items (prefix tuple for primary items + rest), monetary amounts with float bounds (`exclusiveMinimum: 0`), sealed billing/shipping addresses (`.strict()`), and metadata (`.describe()`, `.default()`).
- **T4-02 (File System Directory Tree)**: Recursive file system model with `DirectoryNode` containing recursive `children: Array<FSNode>`, `FileNode` with byte size bounds (`exclusiveMinimum: 0`, `maximum: 1073741824`), `SymlinkNode` with target path, unified via discriminated union on `nodeType`.
- **T4-03 (RFC 9457 ProblemDetails with Extensions)**: Standard HTTP Problem Details object with `type`, `title`, `status`, `detail`, `instance`, extended with discriminated union error payloads (`ValidationErrorProblem`, `PaymentRequiredProblem`, `AuthForbiddenProblem`), sealed with `unevaluatedProperties: false`.
- **T4-04 (CLI Full Spec Build & Emission)**: End-to-end command line invocation of `oa-gen generate:zod` against multi-schema fixture files, verifying output file structure, valid ESM syntax, and `tsc --noEmit` compilation.
- **T4-05 (Dynamic vs Static Parity)**: Simultaneous validation of positive and negative fixtures through both `generateZodFromSpec` emitted code and `createRuntimeZodValidators`, asserting identical acceptance/rejection semantics and error paths.

---

## Test Execution & Verification Commands

```bash
# Execute full 4-Tier E2E test suite
pnpm --filter @oa-sdk/codegen exec vitest run test/e2e/zod4-generator.e2e.test.ts

# Run with coverage
pnpm --filter @oa-sdk/codegen exec vitest run test/e2e/zod4-generator.e2e.test.ts --coverage

# Typecheck test suite and codegen
pnpm --filter @oa-sdk/codegen run typecheck
```

---

## Coverage Thresholds
- **Total Test Cases Target**: ≥ 85 tests
  - Tier 1: ≥ 45 tests (9 features × 5 tests)
  - Tier 2: ≥ 25 tests (5 boundary areas × 5 tests)
  - Tier 3: ≥ 10 tests (Cross-feature interactions & approved spec)
  - Tier 4: ≥ 5 tests (Real-world domain scenarios)
