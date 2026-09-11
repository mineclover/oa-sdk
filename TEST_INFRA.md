# E2E Test Infrastructure: Samchon-Inspired Contract Provenance, Type Taxonomy & Wire Safety

## Test Philosophy
- **Opaque-Box, Requirement-Driven Testing**: All assertions and expected behaviors are derived directly from:
  1. `ORIGINAL_REQUEST.md` (section timestamped `2026-09-11T04:41:22Z`, Requirements §R1–§R5)
  2. `PROJECT.md` (Features 1–20 across Layers 1–6)
  3. Reference implementations and test suites in `~/workflow/samchon/packages/ttsc-contract-provenance` and `~/workflow/samchon/examples/ttsc-fullstack-workspace`
  4. Authoritative TypeScript compiler AST and TypeChecker semantics (`typescript@5.x`)
  5. OpenAPI 3.2 Specification (§4.8.9 HTTP Methods including QUERY, §4.8.24 Operations)
  6. Pure JSON wire serialization invariants (`JSON.stringify` / `JSON.parse`)
- **4-Tier Test Architecture**:
  1. **Tier 1 (Feature Coverage)**: Validates primary behavior (happy path) for all 20 features in `PROJECT.md` with at least 5 isolated, self-contained tests per feature (100 tests total).
  2. **Tier 2 (Boundary & Corner Cases)**: Stress tests boundary limits, extreme type depths, empty objects, complex multi-hop alias cycles, JSONC comments with URLs, and syntax edge cases (at least 5 tests per boundary area, 30 tests total).
  3. **Tier 3 (Cross-Feature Combinations)**: Evaluates pairwise and multi-keyword interactions across different layers (e.g. taxonomy + cycle detection, JSDoc operations + wire-safe returns, tsconfig universe + SQLite cache key) (15 tests total).
  4. **Tier 4 (Real-World Application Scenarios)**: High-fidelity end-to-end workflows representing production developer usage (Enterprise microservice contract provenance, incremental build cache invalidation in Spec-Lens, monorepo governance CI gate, client SDK wire-safety emission, full compiler roundtrip) (5 scenarios total).
- **Progressive Testability & Independence**: Each test case is fully isolated, sets up its own state or in-memory virtual program, and cleans up any temporary resources. Tests run deterministically without execution order dependencies.
- **Zero Internals Coupling**: Tests exercise the public API contracts (`classifyTypeShape`, `auditTypeShapesInSource`, `JsonPrimitive<T>`, `Resolved<T>`, `extractOperationsFromSource`, `detectCyclesWithChecker`, `computeTsconfigUniverse`, `buildSpecProjectKey`, and `oa-gen` CLI commands).
- **Authoritative Expected Output Derivation**: For every test case, the expected output is derived from the TypeScript compiler API, TypeChecker symbol IDs, cryptographic SHA-256 digests, and RFC-compliant JSON representations.

---

## Feature Inventory Coverage Matrix

| # | Feature Name | Layer | Milestone | Tier 1 (Happy Path) | Tier 2 (Boundaries) | Tier 3 (Cross-Feature) | Tier 4 (Real-World) |
|---|--------------|:-----:|:---------:|:-------------------:|:-------------------:|:----------------------:|:-------------------:|
| **F1** | TypeScript Syntax Feature Taxonomy (24 features) | Layer 1 | M1 | T1-F1-1 to T1-F1-5 | T2-B1-1 to T2-B1-5 | T3-01, T3-08, T3-12 | T4-S1, T4-S3, T4-S5 |
| **F2** | Tripartite Projection Classification (`direct`/`policy`/`unsupported`) | Layer 1 | M1 | T1-F2-1 to T1-F2-5 | T2-B1-2, T2-B1-4 | T3-01, T3-05, T3-12 | T4-S1, T4-S3 |
| **F3** | AST Shape Diagnostics Engine (file/line/col pointers) | Layer 1 | M1 | T1-F3-1 to T1-F3-5 | T2-B1-5, T2-B6-2 | T3-05, T3-08 | T4-S3, T4-S5 |
| **F4** | CLI Command `oa-gen audit:shape` | Layer 1 | M1 | T1-F4-1 to T1-F4-5 | T2-B6-1 to T2-B6-5 | T3-08, T3-13 | T4-S3 |
| **F5** | Canonical `JsonPrimitive<T>` Utility (strips methods, Date->string) | Layer 2 | M2 | T1-F5-1 to T1-F5-5 | T2-B2-1 to T2-B2-5 | T3-02, T3-04, T3-11 | T4-S1, T4-S4 |
| **F6** | Canonical `Resolved<T>` Utility (strips methods, preserves Date) | Layer 2 | M2 | T1-F6-1 to T1-F6-5 | T2-B2-2, T2-B2-4 | T3-04, T3-14 | T4-S1, T4-S4 |
| **F7** | Wire-Safe Client SDK Signatures (`Promise<JsonPrimitive<T>>`, `Resolved<T>`) | Layer 2 | M2 | T1-F7-1 to T1-F7-5 | T2-B2-5 | T3-02, T3-04, T3-12 | T4-S1, T4-S4 |
| **F8** | JSDoc `@oaOperation` Tag Extraction (functions & type aliases) | Layer 3 | M3 | T1-F8-1 to T1-F8-5 | T2-B3-1 to T2-B3-5 | T3-02, T3-07, T3-10 | T4-S1, T4-S5 |
| **F9** | Operation Syntax & Route Validation (HTTP verbs, paths, errors) | Layer 3 | M3 | T1-F9-1 to T1-F9-5 | T2-B3-3, T2-B3-4 | T3-05, T3-14 | T4-S1, T4-S5 |
| **F10** | OpenAPI 3.2 Operation Synthesis (`OperationEntry` & path pointers) | Layer 3 | M3 | T1-F10-1 to T1-F10-5 | T2-B3-5 | T3-02, T3-09, T3-12 | T4-S1, T4-S5 |
| **F11** | TypeChecker Program Management (virtual host & tsconfig loader) | Layer 4 | M4 | T1-F11-1 to T1-F11-5 | T2-B4-1 to T2-B4-5 | T3-03, T3-12 | T4-S2, T4-S5 |
| **F12** | Canonical Symbol ID Resolution (`checker.getAliasedSymbol` -> `id`) | Layer 4 | M4 | T1-F12-1 to T1-F12-5 | T2-B4-2, T2-B4-3 | T3-01, T3-10, T3-15 | T4-S1, T4-S5 |
| **F13** | Cross-Module Dependency Graph (`schemaDependencies` map) | Layer 4 | M4 | T1-F13-1 to T1-F13-5 | T2-B4-4, T2-B4-5 | T3-01, T3-10, T3-15 | T4-S1, T4-S5 |
| **F14** | Precision DFS Cycle Detection (marks `"recursive-reference"`) | Layer 4 | M4 | T1-F14-1 to T1-F14-5 | T2-B1-3, T2-B4-1 | T3-01, T3-04, T3-15 | T4-S1, T4-S5 |
| **F15** | Transitive `tsconfig` Closure Walker (JSONC comments/trailing commas) | Layer 5 | M5 | T1-F15-1 to T1-F15-5 | T2-B5-1 to T2-B5-5 | T3-03, T3-06, T3-15 | T4-S2, T4-S5 |
| **F16** | Configuration Universe Hashing (SHA-256 `tsconfigUniverseDigest`) | Layer 5 | M5 | T1-F16-1 to T1-F16-5 | T2-B5-3, T2-B5-4 | T3-06, T3-09, T3-12 | T4-S2, T4-S5 |
| **F17** | Cache Key Invalidation Integration (`buildSpecProjectKey` hash) | Layer 5 | M5 | T1-F17-1 to T1-F17-5 | T2-B5-5 | T3-06, T3-09 | T4-S2 |
| **F18** | Automated Cache Invalidation Proof (extended config edit -> cache miss) | Layer 5 | M5 | T1-F18-1 to T1-F18-5 | T2-B5-4 | T3-06 | T4-S2 |
| **F19** | API Index Documentation & Gate (`docs/internal/api-index.md`) | Layer 6 | Final | T1-F19-1 to T1-F19-5 | T2-B6-3 | T3-13 | T4-S3 |
| **F20** | CLI Documentation & Governance Gate (`check:cli-spec` & `check:docs`) | Layer 6 | Final | T1-F20-1 to T1-F20-5 | T2-B6-4, T2-B6-5 | T3-13 | T4-S3 |

---

## 4-Tier Test Suite Structure

### Tier 1: Comprehensive Feature Coverage (100 Tests, 5 Tests per Feature)

#### Layer 1: Type Shape Taxonomy & Feasibility Diagnostics (Features 1–4)
- **Feature 1: TypeScript Syntax Feature Taxonomy** (`tier1-taxonomy.test.ts`):
  - `T1-F1-1`: Identifies primitive scalar and literal types (`literal`, `reference`).
  - `T1-F1-2`: Identifies compound structural features (`object`, `array`, `tuple`, `union`, `intersection`).
  - `T1-F1-3`: Identifies advanced type-system constructs (`conditional`, `mapped`, `indexed-access`, `type-operator`, `type-query`).
  - `T1-F1-4`: Identifies generic constructs (`generic-declaration`, `generic-instantiation`, `utility-type` like `Record`, `Partial`, `Pick`).
  - `T1-F1-5`: Identifies nullability and optionality (`nullable`, `undefined`, `optional`, `inheritance`).
- **Feature 2: Tripartite Projection Classification** (`tier1-taxonomy.test.ts`):
  - `T1-F2-1`: Classifies clean data models with primitives, objects, arrays, and unions as `direct`.
  - `T1-F2-2`: Classifies types containing `tuple`, `undefined`, `generic-declaration`, or `utility-type` as `policy-required`.
  - `T1-F2-3`: Classifies types containing `conditional`, `mapped`, or `indexed-access` as `unsupported`.
  - `T1-F2-4`: Enforces strict precedence: `unsupported` > `policy-required` > `direct` when multiple constructs coexist.
  - `T1-F2-5`: Classifies mutually recursive interfaces as `direct` with `"recursive-reference"` tagging.
- **Feature 3: AST Shape Diagnostics Engine** (`tier1-taxonomy.test.ts`):
  - `T1-F3-1`: Generates `ShapeDiagnostic` with exact 1-indexed `line` and `column` numbers for unsupported constructs.
  - `T1-F3-2`: Emits diagnostic with `severity: 'error'` and `code: 'unsupported-shape'` for conditional and mapped types.
  - `T1-F3-3`: Emits diagnostic with `severity: 'warning'` and `code: 'policy-required-shape'` for policy-required constructs.
  - `T1-F3-4`: Includes code snippet of the offending type node in diagnostic output.
  - `T1-F3-5`: Aggregates multiple diagnostics across an entire source file with `scannedDeclarations` count.
- **Feature 4: CLI Command `oa-gen audit:shape`** (`tier1-taxonomy.test.ts`):
  - `T1-F4-1`: Executes `audit:shape` against a clean TypeScript file and exits with code 0.
  - `T1-F4-2`: Detects unsupported shapes and reports file, line, and column coordinates in output.
  - `T1-F4-3`: Exits with code 1 when `--fail-on-unsupported` flag is specified on code with unsupported shapes.
  - `T1-F4-4`: Supports `--format json` output emitting machine-readable audit report.
  - `T1-F4-5`: Validates required CLI arguments and rejects missing target file with descriptive error.

#### Layer 2: Wire-Format Safety (`JsonPrimitive` & `Resolved`) (Features 5–7)
- **Feature 5: Canonical `JsonPrimitive<T>` Utility** (`tier1-wire-format.test.ts`):
  - `T1-F5-1`: Preserves JSON scalar primitives (`string`, `number`, `boolean`, `null`).
  - `T1-F5-2`: Transforms `Date` into ISO `string` representation.
  - `T1-F5-3`: Recursively strips function properties, class methods, and symbol keys from objects.
  - `T1-F5-4`: Unboxes boxed objects (`Boolean`, `Number`, `String`) to primitive types.
  - `T1-F5-5`: Converts `bigint` to `never` (as `bigint` throws TypeError in `JSON.stringify`).
- **Feature 6: Canonical `Resolved<T>` Utility** (`tier1-wire-format.test.ts`):
  - `T1-F6-1`: Strips class methods while preserving data properties.
  - `T1-F6-2`: Preserves `Date` instances as `Date` (allowing client request bodies to pass native Date objects).
  - `T1-F6-3`: Preserves array and tuple elements through recursive stripping of object methods.
  - `T1-F6-4`: Handles nullable and optional object properties without dropping property keys.
  - `T1-F6-5`: Correctly resolves nested class instances into method-free data property shapes.
- **Feature 7: Wire-Safe Client SDK Signatures** (`tier1-wire-format.test.ts`):
  - `T1-F7-1`: Generated client SDK operation return type wraps success payload in `Promise<JsonPrimitive<T>>`.
  - `T1-F7-2`: Generated `withResponse` handler wraps response body in `Promise<ClientResponse<JsonPrimitive<T>, ...>>`.
  - `T1-F7-3`: Generated client accepts `body: Resolved<T>` for typed request bodies.
  - `T1-F7-4`: Emits `JsonPrimitive<T>` and `Resolved<T>` utility type definitions inline for zero runtime dependencies.
  - `T1-F7-5`: Streaming operations return `AsyncGenerator<JsonPrimitive<T>>`.

#### Layer 3: Zero-Decorator Operation Extraction (Features 8–10)
- **Feature 8: JSDoc `@oaOperation` Tag Extraction** (`tier1-jsdoc-operations.test.ts`):
  - `T1-F8-1`: Extracts `@oaOperation GET /items` from exported function declarations.
  - `T1-F8-2`: Extracts `@oaOperation POST /items` from exported type alias declarations (bundle types).
  - `T1-F8-3`: Ignores unannotated exported functions (never guesses operations).
  - `T1-F8-4`: Ignores unexported annotated declarations (only exported contracts are indexed).
  - `T1-F8-5`: Extracts multi-line JSDoc comments preserving description and tag metadata.
- **Feature 9: Operation Syntax & Route Validation** (`tier1-jsdoc-operations.test.ts`):
  - `T1-F9-1`: Validates all 8 standard HTTP methods (`GET`, `PUT`, `POST`, `DELETE`, `OPTIONS`, `HEAD`, `PATCH`, `TRACE`).
  - `T1-F9-2`: Validates OpenAPI 3.2 `QUERY` method.
  - `T1-F9-3`: Rejects malformed tags missing leading slash (`@oaOperation GET items`) with `invalid-oa-operation`.
  - `T1-F9-4`: Rejects unsupported HTTP verbs (`@oaOperation INVALID /items`) with descriptive diagnostic.
  - `T1-F9-5`: Enforces uppercase HTTP method syntax in JSDoc tag.
- **Feature 10: OpenAPI 3.2 Operation Synthesis** (`tier1-jsdoc-operations.test.ts`):
  - `T1-F10-1`: Emits OpenAPI 3.2 path pointer `#/~1items/get` for extracted GET operations.
  - `T1-F10-2`: Encodes path parameters correctly in output pointer (`#/paths/~1users~1{id}/get`).
  - `T1-F10-3`: Maps function parameter types to operation parameters / requestBody.
  - `T1-F10-4`: Maps return type to OpenAPI 200 response schema reference.
  - `T1-F10-5`: Emits complete `OperationEntry` record matching parser contract.

#### Layer 4: Checker-Resolved Symbol ID Cycle Detection (Features 11–14)
- **Feature 11: TypeChecker Program Management** (`tier1-symbol-cycles.test.ts`):
  - `T1-F11-1`: Creates in-memory `ts.Program` and `ts.TypeChecker` with virtual compiler host.
  - `T1-F11-2`: Loads multi-file virtual source tree into single program instance.
  - `T1-F11-3`: Resolves standard library declarations and global types cleanly.
  - `T1-F11-4`: Exposes TypeScript compiler diagnostics without throwing uncaught exceptions.
  - `T1-F11-5`: Supports disk-backed tsconfig path resolution for real project trees.
- **Feature 12: Canonical Symbol ID Resolution** (`tier1-symbol-cycles.test.ts`):
  - `T1-F12-1`: Resolves local interface declaration to unique integer `symbol.id`.
  - `T1-F12-2`: Follows `import { X } from './b'` and dereferences alias to canonical declaration symbol.
  - `T1-F12-3`: Follows re-export barrel chain (`export { X as Y }`) and resolves to identical original `symbol.id`.
  - `T1-F12-4`: Disambiguates identically named symbols across different files.
  - `T1-F12-5`: Resolves aliased type references inside property signatures to canonical declaration ID.
- **Feature 13: Cross-Module Dependency Graph** (`tier1-symbol-cycles.test.ts`):
  - `T1-F13-1`: Constructs directed graph `Map<string, Set<string>>` of schema references across files.
  - `T1-F13-2`: Correctly registers forward references between module boundaries.
  - `T1-F13-3`: Excludes external library/built-in type references from internal schema dependency set.
  - `T1-F13-4`: Builds transitive reference chain A -> B -> C across 3 separate files.
  - `T1-F13-5`: Handles diamond dependencies (A -> B, A -> C, B -> D, C -> D) without duplicate edges.
- **Feature 14: Precision DFS Cycle Detection** (`tier1-symbol-cycles.test.ts`):
  - `T1-F14-1`: Detects direct self-recursion (`Node` referencing `Node`).
  - `T1-F14-2`: Detects 2-node mutual recursion (`User` <-> `Role`) across module boundaries.
  - `T1-F14-3`: Detects 3-node cycle spanning multiple files (`A -> B -> C -> A`).
  - `T1-F14-4`: Tags cyclic declarations with `"recursive-reference"` in their taxonomy shape.
  - `T1-F14-5`: Correctly isolates non-cyclic branches in a graph containing both cyclic and acyclic types.

#### Layer 5: Transitive tsconfig Universe Hashing (Features 15–18)
- **Feature 15: Transitive `tsconfig` Closure Walker** (`tier1-tsconfig-universe.test.ts`):
  - `T1-F15-1`: Traverses single tsconfig file and extracts root files and compiler options.
  - `T1-F15-2`: Recursively resolves `extends` relative path chain (`app -> base -> common`).
  - `T1-F15-3`: Recursively resolves `references` array for composite project configurations.
  - `T1-F15-4`: Parses JSONC files containing single-line `//` and multi-line `/* */` comments.
  - `T1-F15-5`: Tolerates trailing commas in JSONC configuration objects and arrays.
- **Feature 16: Configuration Universe Hashing** (`tier1-tsconfig-universe.test.ts`):
  - `T1-F16-1`: Computes deterministic SHA-256 digest for each configuration file in the closure.
  - `T1-F16-2`: Computes unified `tsconfigUniverseDigest` covering all configs and root files.
  - `T1-F16-3`: Digest remains 100% identical when configuration files are untouched.
  - `T1-F16-4`: Sorts configuration paths deterministically before hashing to ensure cross-platform stability.
  - `T1-F16-5`: Captures resolved source root files attributed to each configuration.
- **Feature 17: Cache Key Invalidation Integration** (`tier1-tsconfig-universe.test.ts`):
  - `T1-F17-1`: Integrates `tsconfigUniverseDigest` into Spec-Lens `buildSpecProjectKey`.
  - `T1-F17-2`: Generates different project keys when two projects have different base tsconfigs.
  - `T1-F17-3`: Incorporates project key into SQLite snapshot cache key `${projectKey}:${revision.id}`.
  - `T1-F17-4`: Produces stable cache keys when tsconfig universe digest is unchanged.
  - `T1-F17-5`: Handles specifications without tsconfig gracefully with fallback digest.
- **Feature 18: Automated Cache Invalidation Proof** (`tier1-tsconfig-universe.test.ts`):
  - `T1-F18-1`: Modifying `strict: true` in an extended `tsconfig.base.json` alters `universeDigest`.
  - `T1-F18-2`: Altered `universeDigest` causes `buildSpecProjectKey` to change immediately.
  - `T1-F18-3`: Changed project key causes SQLite WAL query to produce a cache MISS for existing revision.
  - `T1-F18-4`: Modifying whitespace/comments inside tsconfig triggers invalidation (preserving byte integrity).
  - `T1-F18-5`: Reverting tsconfig to original content restores original cache key and triggers cache HIT.

#### Layer 6: Monorepo Governance & Gates (Features 19–20)
- **Feature 19: API Index Documentation & Gate** (`tier1-governance-gates.test.ts`):
  - `T1-F19-1`: Verifies that all exported taxonomy interfaces are documented in `docs/internal/api-index.md`.
  - `T1-F19-2`: Verifies that `JsonPrimitive` and `Resolved` are documented under `@oa-sdk/core`.
  - `T1-F19-3`: Verifies that `@oaOperation` extractor APIs are documented under `@oa-sdk/parser`.
  - `T1-F19-4`: Verifies that tsconfig universe APIs are documented under `@oa-sdk/spec-lens`.
  - `T1-F19-5`: Validates that `pnpm check:api-index` gate passes with 0 violations.
- **Feature 20: CLI Documentation & Governance Gate** (`tier1-governance-gates.test.ts`):
  - `T1-F20-1`: Verifies `audit:shape` is documented in `docs/guides/cli-command-reference.md`.
  - `T1-F20-2`: Verifies `audit:shape` flags (`--bundle`, `--fail-on-unsupported`) are documented.
  - `T1-F20-3`: Verifies that CLI governance manifest in `@oa-sdk/codegen` includes `audit:shape`.
  - `T1-F20-4`: Validates that `pnpm check:cli-spec` passes cleanly.
  - `T1-F20-5`: Validates that `pnpm check:docs` markdown link and reference gates pass cleanly.

---

### Tier 2: Boundary & Corner Cases (30 Tests, 6 Areas)

- **Boundary Area 1: Extreme Type Shapes & AST Complexity** (`tier2-boundaries.test.ts`):
  - `T2-B1-1`: Empty interface declaration (`interface Empty {}`) classifies as `direct` with `object` feature.
  - `T2-B1-2`: Deeply nested conditional type `T extends string ? (U extends number ? A : B) : C` classifies as `unsupported`.
  - `T2-B1-3`: Direct self-referential property signature `interface Loop { self: Loop; }` tags `"recursive-reference"`.
  - `T2-B1-4`: Union of 20+ distinct literal types evaluates cleanly without stack overflow.
  - `T2-B1-5`: Interface containing symbol-keyed property signatures or unique symbols.
- **Boundary Area 2: Wire-Format Edge Cases** (`tier2-boundaries.test.ts`):
  - `T2-B2-1`: Type with custom `.toJSON(): { iso: string }` resolves to `JsonPrimitive<{ iso: string }>`.
  - `T2-B2-2`: Object containing only functions/methods converts to empty object `{}` in `JsonPrimitive`.
  - `T2-B2-3`: Recursive tuple with rest element `[string, ...number[]]` preserves tuple and rest array shape.
  - `T2-B2-4`: Classes with private `#privateField` and getter/setter pairs strip methods and getters.
  - `T2-B2-5`: `null | undefined` combined with complex objects resolves correctly without stripping `null`.
- **Boundary Area 3: JSDoc Annotation Syntax Boundaries** (`tier2-boundaries.test.ts`):
  - `T2-B3-1`: JSDoc tag with mixed tabs and multiple spaces between method and path.
  - `T2-B3-2`: Path containing query string parameters (`/items?limit=10`) parses path and query.
  - `T2-B3-3`: Lowercase HTTP method (`/** @oaOperation get /items */`) is strictly rejected.
  - `T2-B3-4`: Trailing whitespace after path in JSDoc tag is trimmed cleanly.
  - `T2-B3-5`: Multiple `@oaOperation` tags on a single function (extracts multiple or logs diagnostic).
- **Boundary Area 4: Complex Multi-Hop Alias Cycles** (`tier2-boundaries.test.ts`):
  - `T2-B4-1`: 3-file cycle: File 1 (`A { b: B }`) -> File 2 (`B { c: C }`) -> File 3 (`C { a: A }`).
  - `T2-B4-2`: Re-exported renamed alias (`export { Original as Renamed }`) resolves canonical ID.
  - `T2-B4-3`: Barrel re-export cycle through `index.ts` files across multiple subpackages.
  - `T2-B4-4`: Disconnected components: cyclic subgraph A <-> B alongside completely acyclic subgraph C -> D.
  - `T2-B4-5`: Diamond dependency graph with cyclic sub-loop.
- **Boundary Area 5: tsconfig Universe Boundaries** (`tier2-boundaries.test.ts`):
  - `T2-B5-1`: JSONC string literal containing `//` (e.g. `"url": "https://example.com"`) is NOT stripped.
  - `T2-B5-2`: Multiple trailing commas in nested arrays and objects (`{ a: [1, 2, ], }`).
  - `T2-B5-3`: Circular `extends` (`tsconfig.a.json` extends `tsconfig.b.json` and vice versa) terminates without infinite loop.
  - `T2-B5-4`: Transitive extends chain of depth 5 (`c1 -> c2 -> c3 -> c4 -> c5`).
  - `T2-B5-5`: tsconfig with empty `compilerOptions: {}` and missing `files`/`include` arrays.
- **Boundary Area 6: CLI & Governance Boundaries** (`tier2-boundaries.test.ts`):
  - `T2-B6-1`: `oa-gen audit:shape` on non-existent file path returns exit code 1 with clean error.
  - `T2-B6-2`: `oa-gen audit:shape` on TypeScript file with syntax errors reports parse diagnostics.
  - `T2-B6-3`: `oa-gen audit:shape` on empty `.ts` file succeeds with 0 scanned declarations.
  - `T2-B6-4`: CLI invocation with unknown flags (`--unknown-arg`) exits with code 1.
  - `T2-B6-5`: CLI help text outputs correct command usage and flag descriptions.

---

### Tier 3: Cross-Feature Combinations (15 Tests)

- **T3-01: Taxonomy Analysis + Symbol Cycle Detection**: Mutually recursive interfaces across separate files are parsed by `ts.Program`, resolved via `checker.getAliasedSymbol`, detected as cyclic via DFS, and classified with `"recursive-reference"` in their taxonomy shape.
- **T3-02: JSDoc Operation Extraction + Wire-Format Responses**: Extracted `@oaOperation` declarations with return types containing domain models are converted to client SDK method signatures returning `Promise<JsonPrimitive<T>>`.
- **T3-03: tsconfig Universe Hashing + TypeChecker Program**: A multi-file TypeScript program is constructed from files resolved via the transitive `tsconfig` universe and audited for type shape feasibility.
- **T3-04: Wire-Format Safety + Client SDK Emission with Recursive References**: Client SDK code generator emits `JsonPrimitive<T>` and `Resolved<T>` inline and successfully types recursive model responses without infinite instantiation errors.
- **T3-05: JSDoc Operation Extraction with Unsupported Types**: JSDoc operation whose parameter or return type contains `unsupported` taxonomy features (e.g. conditional types) emits both the extracted operation and shape feasibility diagnostics.
- **T3-06: Transitive tsconfig Update + Cache Invalidation + Symbol Cycle Integrity**: Modifying a base tsconfig invalidates the Spec-Lens SQLite cache key while the recomputed TypeChecker program correctly identifies identical symbol dependency cycles.
- **T3-07: Dual Extraction: Function Declaration and Type Alias**: File declaring both a function and a type alias annotated with `@oaOperation` extracts both operations into normalized `OperationEntry` records.
- **T3-08: Shape Audit CLI on Multi-File Dependency Graph**: `oa-gen audit:shape` scans an entire project graph, following imports and reporting diagnostics with file and line coordinates across all files.
- **T3-09: Spec-Lens SQLite Cache Key + JSDoc Operations**: Spec-Lens SQLite WAL cache indexes synthesized OpenAPI operations using the cache key incorporating `tsconfigUniverseDigest`.
- **T3-10: Multi-Module Barrel Re-Export Cycle with `@oaOperation`**: Exported operations in files that participate in circular barrel re-exports extract operations cleanly while accurately identifying circular references.
- **T3-11: `JsonPrimitive` Unboxing + OpenAPI 3.2 Schema Projection**: Model with boxed primitives (`String`, `Number`) and custom `toJSON()` method maps to unboxed wire format and projects valid OpenAPI 3.2 schemas.
- **T3-12: Complete End-to-End Pipeline**: Transitive tsconfig closure -> `ts.Program` -> Symbol Cycle DFS -> Taxonomy Feasibility -> `@oaOperation` extraction -> Wire-safe client signatures.
- **T3-13: CLI Audit Shape Reporting + API Index Verification**: Verification that all CLI reporting models and taxonomy functions match the public declarations audited by `pnpm check:api-index`.
- **T3-14: JSDoc Extraction with OAS 3.2 QUERY Method and `Resolved<T>` Body**: Extraction of `@oaOperation QUERY /search` with request body typed as `Resolved<SearchCriteria>`.
- **T3-15: Diamond Dependency Graph with Cyclic Sub-Loop and Transitive JSONC Closure**: Complex diamond project graph with circular type references and JSONC configs with comments verifies all layers simultaneously.

---

### Tier 4: Real-World Application Scenarios (5 Comprehensive Workflows)

- **Scenario 1: Enterprise Microservice Contract Provenance (`T4-S1`)**:
  Simulates a real-world enterprise microservice (Users, Accounts, Permissions) with multi-file domain models, circular references (`User` <-> `Department`), JSDoc `@oaOperation` endpoints (`GET /users`, `POST /users`, `QUERY /users/search`), taxonomy shape feasibility analysis, and wire-safe client response wrapping.
- **Scenario 2: Incremental Build & Cache Invalidation Lifecycle in Spec-Lens (`T4-S2`)**:
  Simulates an active developer workflow in Spec-Lens: initial compilation builds transitive JSONC tsconfig universe, derives SHA-256 digest, writes snapshot to SQLite WAL cache. Developer modifies compiler strictness in base tsconfig -> instant cache key invalidation -> SQLite cache miss -> re-indexing with updated compiler options.
- **Scenario 3: Monorepo Contract Governance CI Pipeline (`T4-S3`)**:
  Simulates the monorepo CI gate: runs `oa-gen audit:shape --fail-on-unsupported`, validates zero undocumented CLI drift via `pnpm check:cli-spec`, validates API index documentation via `pnpm check:api-index`, and confirms documentation link integrity via `pnpm check:docs`.
- **Scenario 4: High-Fidelity Client SDK Generation with Zero-Runtime-Dependency Wire Safety (`T4-S4`)**:
  Simulates building a standalone client SDK for external consumers: client template renders `JsonPrimitive<T>` and `Resolved<T>` inline, wraps responses in `Promise<JsonPrimitive<T>>`, strips class methods, unboxes primitives, and converts Dates to ISO strings with zero external npm dependencies.
- **Scenario 5: Full Spec-Lens & Codegen Pipeline Roundtrip with 100% Contract Integrity (`T4-S5`)**:
  Exercises the entire end-to-end toolchain: parses multi-file TypeScript specifications from a JSONC configuration universe, runs TypeChecker DFS cycle detection, computes tripartite taxonomy feasibility, extracts zero-decorator JSDoc operations into OpenAPI 3.2 `OperationEntry` records, and validates complete contract provenance.

---

## Test Execution & Verification Commands

```bash
# 1. Run full 4-Tier E2E test suite via Vitest
pnpm vitest run tests/e2e/samchon-improvements

# 2. Run standalone runner script
node --import tsx tests/e2e/samchon-improvements/runner.ts

# 3. Run specific tier suites
pnpm vitest run tests/e2e/samchon-improvements/tier1-taxonomy.test.ts
pnpm vitest run tests/e2e/samchon-improvements/tier1-wire-format.test.ts
pnpm vitest run tests/e2e/samchon-improvements/tier1-jsdoc-operations.test.ts
pnpm vitest run tests/e2e/samchon-improvements/tier1-symbol-cycles.test.ts
pnpm vitest run tests/e2e/samchon-improvements/tier1-tsconfig-universe.test.ts
pnpm vitest run tests/e2e/samchon-improvements/tier1-governance-gates.test.ts
pnpm vitest run tests/e2e/samchon-improvements/tier2-boundaries.test.ts
pnpm vitest run tests/e2e/samchon-improvements/tier3-combinations.test.ts
pnpm vitest run tests/e2e/samchon-improvements/tier4-scenarios.test.ts

# 4. Verify monorepo governance gates
pnpm check:api-index
pnpm check:cli-spec
pnpm check:docs
```
