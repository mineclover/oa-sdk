# Project: Samchon-Inspired Contract Provenance, Type Taxonomy & Wire Safety

## Architecture
- **Layer 1: Type Shape Taxonomy & Feasibility Diagnostics (`@oa-sdk/ast-sync`, CLI `oa-gen audit:shape`)**:
  - Traverses TypeScript AST type nodes to catalog 23/24 syntax features: `array`, `conditional`, `constructor-type`, `function-type`, `generic-declaration`, `generic-instantiation`, `import-type`, `indexed-access`, `inheritance`, `intersection`, `literal`, `mapped`, `nullable`, `object`, `optional`, `recursive-reference`, `reference`, `template-literal`, `tuple`, `type-operator`, `type-query`, `undefined`, `union`, `utility-type`.
  - Tripartite projection feasibility classification: `unsupported` (e.g. conditional, mapped, indexed-access) > `policy-required` (e.g. tuple, undefined, generic-declaration, utility-type) > `direct` (primitives, objects, unions, intersections, arrays).
  - Emits line/column diagnostic pointers (`ShapeDiagnostic`) and terminal audit reporting via `oa-gen audit:shape` with `--fail-on-unsupported`.
- **Layer 2: Wire-Format Safety (`@oa-sdk/core`, `@oa-sdk/client`)**:
  - Canonical recursive utility types `JsonPrimitive<T>` and `Resolved<T>` in `@oa-sdk/core`.
  - `JsonPrimitive<T>` models strict JSON wire serialization: strips functions, methods, symbols, and prototypes; maps `Date` $\rightarrow$ `string`; resolves `toJSON()`; converts `bigint` to `never`.
  - `Resolved<T>` strips class methods to avoid requiring consumers to instantiate domain prototypes, while preserving `Date` and collections.
  - `@oa-sdk/client` code generator emits `JsonPrimitive<T>` / `Resolved<T>` utilities inline (zero external runtime dependencies) and wraps response return types (`Promise<JsonPrimitive<...>>`, `ClientResponse<JsonPrimitive<...>>`) and request bodies (`Resolved<...>`).
- **Layer 3: Zero-Decorator Operation Extraction (`@oa-sdk/parser`, `@oa-sdk/codegen`)**:
  - AST extractor in `@oa-sdk/parser` parsing explicit `/** @oaOperation <METHOD> <PATH> */` JSDoc annotations on exported functions and type aliases.
  - Strict syntax validation: enforces uppercase/lowercase HTTP verbs (`get`, `put`, `post`, `delete`, `options`, `head`, `patch`, `trace`, and OAS 3.2 `query`) and path coordinates starting with `/`.
  - Emits structured `invalid-oa-operation` diagnostics for malformed tags; never guesses or infers operations from unannotated declarations.
  - Emits normalized OpenAPI 3.2 `OperationEntry` structures.
- **Layer 4: Checker-Resolved Symbol ID Cycle Detection (`@oa-sdk/ast-sync`)**:
  - Multi-file TypeScript program analysis utilizing `ts.TypeChecker`.
  - Dereferences type aliases and imports via `checker.getSymbolAtLocation` and `checker.getAliasedSymbol` to canonical integer `symbol.id`.
  - Builds directed dependency graphs `schemaDependencies: Map<string, Set<string>>` using canonical symbol IDs.
  - Executes directed DFS cycle detection, detecting mutual recursions across re-exports and aliased imports with 100% precision, tagging cyclic declarations with `"recursive-reference"`.
- **Layer 5: Transitive tsconfig Universe Hashing (`@oa-sdk/spec-lens`)**:
  - Transitive configuration closure walker in `@oa-sdk/spec-lens` that recursively parses JSONC (stripping comments and trailing commas) across `extends` chains and project `references`.
  - Computes deterministic SHA-256 digests of all configuration files and compiler root files (`tsconfigUniverseDigest`).
  - Integrates `tsconfigUniverseDigest` into Spec-Lens SQLite WAL cache key derivation (`buildSpecProjectKey` and `cache-key.ts`), guaranteeing automatic cache invalidation when base tsconfigs change.
- **Layer 6: Monorepo Governance & Gates**:
  - Updates `docs/internal/api-index.md` and verifies `pnpm check:api-index`.
  - Updates `docs/guides/cli-command-reference.md` and verifies `pnpm check:docs` and `pnpm check:cli-spec`.
  - Full test suite passing across all packages (`pnpm test`, `pnpm test:core`, `pnpm --filter @oa-sdk/client test`).

## Code Layout
- `packages/ast-sync/src/taxonomy/features.ts`: 23/24 ContractShapeFeatures, TypeSpecProjection enum, diagnostic types.
- `packages/ast-sync/src/taxonomy/analyzer.ts`: AST visitor, feature collector, projection classifier, source range diagnostics.
- `packages/ast-sync/src/checker/program.ts`: ts.Program and TypeChecker factory (virtual host & tsconfig loader).
- `packages/ast-sync/src/checker/cycle-detector.ts`: Canonical symbol resolution, symbol ID dependency graph, DFS cycle detection.
- `packages/ast-sync/src/index.ts`: Public API exports for taxonomy and checker APIs.
- `packages/codegen/src/cli/commands/audit-shape.ts`: CLI command implementation for `oa-gen audit:shape`.
- `packages/codegen/src/cli/commands.ts`: Registry entry for `audit:shape`.
- `packages/core/src/wire-format.ts`: `JsonPrimitive<T>`, `Resolved<T>`, `ValueOf<T>`, `ClassProperties<T>`.
- `packages/core/src/index.ts` & `browser.ts`: Public API exports for wire-format utilities.
- `packages/client/src/generate-client-renderer.ts`: Inline emission of wire-safe utilities and response/body wrapping.
- `packages/client/src/index.ts` & `browser.ts`: Public re-exports for `JsonPrimitive` and `Resolved`.
- `packages/parser/src/ts-operation-extractor.ts`: JSDoc `@oaOperation` extractor, HTTP validator, OpenAPI OperationEntry synthesizer.
- `packages/parser/src/index.ts`: Public export for operation extractor.
- `packages/spec-lens/src/infrastructure/cache/sqlite/tsconfig-universe.ts`: Transitive JSONC config closure walker & SHA-256 hasher.
- `packages/spec-lens/src/infrastructure/cache/sqlite/cache-key.ts`: Cache key calculation integrating `tsconfigUniverseDigest`.
- `packages/spec-lens/src/domain/project.ts`: `SpecProjectKeyInput` and `buildSpecProjectKey` updating.
- `docs/internal/api-index.md`: Public API documentation for check:api-index.
- `docs/guides/cli-command-reference.md`: CLI documentation for check:docs and check:cli-spec.
- `tests/e2e/samchon-improvements/`: Requirement-driven E2E test suite.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | TypeScript Syntax Feature Taxonomy | Classifies AST type nodes into 23/24 syntax features | M1 | Survey 1, 2 |
| 2 | Tripartite Projection Classification | Categorizes types into `direct`, `policy-required`, `unsupported` | M1 | Survey 1, 2 |
| 3 | AST Shape Diagnostics Engine | Collects line/col source diagnostics for unsupported/policy types | M1 | Survey 1, 2 |
| 4 | CLI Command `oa-gen audit:shape` | Audits TypeScript bundles/files for type shape feasibility | M1 | Survey 2 |
| 5 | Canonical `JsonPrimitive<T>` Utility | Recursively strips functions/methods/prototypes, maps Date -> string | M2 | Survey 1, 3 |
| 6 | Canonical `Resolved<T>` Utility | Strips class methods while preserving Date and collections | M2 | Survey 1, 3 |
| 7 | Wire-Safe Client SDK Signatures | Generated client returns `Promise<JsonPrimitive<T>>` and accepts `Resolved<T>` | M2 | Survey 3 |
| 8 | JSDoc `@oaOperation` Tag Extraction | Extracts `@oaOperation <METHOD> <PATH>` from exported functions and type aliases | M3 | Survey 1, 2 |
| 9 | Operation Syntax & Route Validation | Validates HTTP verbs (including QUERY) and paths; emits `invalid-oa-operation` | M3 | Survey 1, 2 |
| 10 | OpenAPI 3.2 Operation Synthesis | Translates valid `@oaOperation` declarations to `OperationEntry` objects | M3 | Survey 2 |
| 11 | TypeChecker Program Management | Creates in-memory and tsconfig-backed `ts.Program` / `TypeChecker` instances | M4 | Survey 2 |
| 12 | Canonical Symbol ID Resolution | Dereferences aliases via `checker.getAliasedSymbol` to integer `symbol.id` | M4 | Survey 1, 2 |
| 13 | Cross-Module Dependency Graph | Builds directed symbol dependency graph across re-exports and imports | M4 | Survey 1, 2 |
| 14 | Precision DFS Cycle Detection | Detects mutual recursions across files and marks `"recursive-reference"` | M4 | Survey 1, 2 |
| 15 | Transitive `tsconfig` Closure Walker | Recursively follows `extends` and `references`, parsing JSONC comments | M5 | Survey 1, 3 |
| 16 | Configuration Universe Hashing | Computes deterministic SHA-256 digests over configs and root files | M5 | Survey 1, 3 |
| 17 | Cache Key Invalidation Integration | Incorporates `tsconfigUniverseDigest` into Spec-Lens SQLite WAL cache key | M5 | Survey 3 |
| 18 | Automated Cache Invalidation Proof | Editing extended tsconfig changes cache key and causes SQLite cache miss | M5 | Survey 3 |
| 19 | API Index Documentation & Gate | Updates `docs/internal/api-index.md` and passes `pnpm check:api-index` | Final | Survey 3 |
| 20 | CLI Documentation & Governance Gate | Updates `cli-command-reference.md` and passes `pnpm check:cli-spec` & `check:docs` | Final | Survey 2, 3 |
| 21 | Opaque-Box E2E Testing Suite (Tiers 1-4) | Comprehensive requirement-driven test suite across all 20 features | E2E | Project Pattern |
| 22 | Adversarial Hardening & Forensic Audit | White-box stress testing, edge-case generation, and clean integrity audit | Final | Project Pattern |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Requirement-driven test suite (Tiers 1-4) covering Features 1-20, publishing TEST_READY.md | None | DONE |
| M1 | Type Shape Taxonomy & Feasibility Diagnostics | Features 1, 2, 3, 4: `@oa-sdk/ast-sync` taxonomy + CLI `oa-gen audit:shape` | None | DONE |
| M2 | Wire-Format Safety (`JsonPrimitive` / `Resolved`) | Features 5, 6, 7: `@oa-sdk/core` utilities + `@oa-sdk/client` wire signatures | None | DONE |
| M3 | Zero-Decorator Operation Extraction | Features 8, 9, 10: `@oa-sdk/parser` `@oaOperation` extractor & validation | None | DONE |
| M4 | Checker-Resolved Symbol ID Cycle Detection | Features 11, 12, 13, 14: `@oa-sdk/ast-sync` TypeChecker symbol ID DFS | M1 | DONE |
| M5 | Transitive tsconfig Universe Hashing | Features 15, 16, 17, 18: `@oa-sdk/spec-lens` JSONC closure & SQLite cache key | None | DONE |
| Final | Monorepo Governance & 100% E2E Pass | Features 19, 20, 21, 22: API index, doc gates, 100% E2E test pass, Tier 5 hardening, audit | M1, M2, M3, M4, M5, E2E | DONE |

## Interface Contracts

### `@oa-sdk/ast-sync` ↔ `oa-gen audit:shape`
```typescript
// In packages/ast-sync/src/taxonomy/features.ts
export type ContractShapeFeature =
  | 'array' | 'conditional' | 'constructor-type' | 'function-type'
  | 'generic-declaration' | 'generic-instantiation' | 'import-type' | 'indexed-access'
  | 'inheritance' | 'intersection' | 'literal' | 'mapped' | 'nullable' | 'object'
  | 'optional' | 'recursive-reference' | 'reference' | 'template-literal' | 'tuple'
  | 'type-operator' | 'type-query' | 'undefined' | 'union' | 'utility-type';

export type TypeSpecProjection = 'direct' | 'policy-required' | 'unsupported';

export interface ContractTypeShape {
  readonly features: readonly ContractShapeFeature[];
  readonly typeSpecProjection: TypeSpecProjection;
}

export interface ShapeDiagnostic {
  readonly code: 'unsupported-shape' | 'policy-required-shape';
  readonly message: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly feature: ContractShapeFeature;
  readonly snippet?: string;
  readonly severity: 'error' | 'warning';
}

export interface ShapeAuditResult {
  readonly valid: boolean;
  readonly scannedDeclarations: number;
  readonly scannedFiles: number;
  readonly diagnostics: readonly ShapeDiagnostic[];
  readonly summary: string;
}

export function classifyTypeShape(features: ReadonlySet<ContractShapeFeature>): ContractTypeShape;
export function auditTypeShapesInSource(sourceText: string, filePath?: string): ShapeAuditResult;
```

### `@oa-sdk/core` ↔ `@oa-sdk/client`
```typescript
// In packages/core/src/wire-format.ts
export type ValueOf<T> = ...;
export type ClassProperties<T> = ...;
export type JsonPrimitive<T> = ...;
export type Resolved<T> = ...;
```
- In `@oa-sdk/client`, generated methods return `Promise<JsonPrimitive<TResponse>>` (or `ClientResponse<JsonPrimitive<TResponse>, ...>`) and accept `Resolved<TBody>`.

### `@oa-sdk/parser` ↔ Downstream Tools
```typescript
// In packages/parser/src/ts-operation-extractor.ts
export interface ExtractedOperation {
  readonly method: 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace' | 'query';
  readonly path: string;
  readonly declarationName: string;
  readonly declarationKind: 'function' | 'type-alias';
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly description?: string;
}

export interface OperationExtractResult {
  readonly operations: readonly ExtractedOperation[];
  readonly diagnostics: readonly OperationDiagnostic[];
}

export function extractOperationsFromSource(sourceText: string, filePath?: string): OperationExtractResult;
```

### `@oa-sdk/ast-sync` Checker Symbol Cycle Detection
```typescript
// In packages/ast-sync/src/checker/cycle-detector.ts
export interface SymbolCycleResult {
  readonly schemaDependencies: ReadonlyMap<string, ReadonlySet<string>>;
  readonly cyclicSchemaIds: ReadonlySet<string>;
  readonly symbolIdMap: ReadonlyMap<number, string>;
}

export function detectCyclesWithChecker(
  program: ts.Program,
  sourceFiles?: readonly ts.SourceFile[]
): SymbolCycleResult;
```

### `@oa-sdk/spec-lens` Transitive tsconfig Hashing
```typescript
// In packages/spec-lens/src/infrastructure/cache/sqlite/tsconfig-universe.ts
export interface ContractConfigDigest {
  readonly file: string;
  readonly digest: string;
}

export interface ContractConfigUniverse {
  readonly configs: readonly ContractConfigDigest[];
  readonly roots: readonly string[];
  readonly universeDigest: string;
}

export function computeTsconfigUniverse(
  tsconfigPath: string,
  repositoryRoot: string
): ContractConfigUniverse;
```
- `SpecProjectKeyInput` incorporates `tsconfigUniverseDigest?: string`.
- `buildSpecProjectKey` hashes `tsconfigUniverseDigest` into the project key.
