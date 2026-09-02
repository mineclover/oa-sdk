# Comprehensive Codegen, AST & Projection Integration Analysis

**Document Status**: Final Architectural & Integration Blueprint  
**Author**: Codegen & AST Integration Explorer  
**Date**: 2026-09-02  
**Target Monorepo**: `/Users/junwoobang/workflow/oa-sdk`  
**Reference Proposals**: `/Users/junwoobang/workflow/browser-studio/docs/specs/oa-sdk-integration-proposals.md`

---

## 1. Executive Summary

This investigation analyzed the codebase in `/Users/junwoobang/workflow/oa-sdk` to produce an exhaustive integration map for the 4 Upstream Architectural Proposals:
1. **Proposal 1: Native Discriminated Union Projection** (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/codegen`, `@oa-sdk/parser`)
2. **Proposal 2: Non-AST Character Range Patching Metadata Extensions** (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/parser`)
3. **Proposal 3: Standalone Lightweight Type Guard Generator Plugin** (`@oa-sdk/codegen`)
4. **Proposal 4: TypeScript AST Bidirectional Synchronization (V3 Unified Architecture)** (`@oa-sdk/codegen`, `@oa-sdk/spec-lens`, `@oa-sdk/schemas`, `@oa-sdk/spec-lens-contract`)

The existing codebase contains robust foundations:
- `@oa-sdk/openapi-projection-contract` provides profile semantics (`component-bundle`, `operation-contract`, `full-api-document`) and envelope serialization.
- `@oa-sdk/parser` includes a native OAS 3.2 linter (`lintDocument`), schema validator (`Ajv2020`), and projection adapters.
- `@oa-sdk/codegen` includes a TypeScript AST Canonical IR (`type-registry-canonical-ir.ts`), Zod-to-schema compiler (`zod-to-schema.ts`), typegen (`schema-to-ts.ts`), and source adapters (`source-adapters.ts`).
- `@oa-sdk/spec-lens-contract` and `@oa-sdk/spec-lens` provide snapshot, timeline diff, and provenance mapping infrastructure.

---

## 2. Package-by-Package Current Architecture & Gap Analysis

### 2.1 `@oa-sdk/openapi-projection-contract`
- **Current State**:
  - `src/index.ts` defines profiles (`OPENAPI_PROJECTION_PROFILES = ['component-bundle', 'operation-contract', 'full-api-document']`).
  - Standard extensions: `x-schema-engine-profile`, `x-schema-engine-version-hash`, `x-schema-engine-sources`, `x-schema-engine-refs`.
  - Validation: `validateOpenApiProjection()` enforces profile-specific requirements (e.g., `component-bundle` requires schemas, `operation-contract` requires operations).
- **Gaps for Proposals**:
  - **Proposal 1**: Lacks `projectDiscriminatedUnion` helper API and `DiscriminatedUnionProjectionOptions` interface for projecting multiplexed single-stream RPC/stdio operations into OpenAPI 3.1 `discriminator` + `mapping` + `oneOf` models.
  - **Proposal 2**: Lacks standardized vendor extensions for live patching: `x-surface-anchor`, `x-surface-param-range`, `x-surface-fingerprint`, `x-surface-quote-style`, `x-surface-patch-policy`, and their type definitions and validation helpers.

### 2.2 `@oa-sdk/parser`
- **Current State**:
  - `src/lint.ts`: Custom linter for OAS 3.2 supporting categories: `structure`, `operations`, `parameters`, `refs`, `security`, `style`, `components`.
  - `src/schema-validator.ts`: Schema Object validation using `Ajv2020({ allErrors: true, strict: false })`.
  - `src/definition-openapi-projection.ts`: Transforms definition registry & selections into projection envelopes.
- **Gaps for Proposals**:
  - **Proposal 1**: Needs tolerance and lint rules for discriminated union mappings in schemas and operations.
  - **Proposal 2**: Needs linting rules for `x-surface-*` vendor extensions:
    - `surface/valid-anchor`: Validate `id`, `line >= 1`, `column >= 1`.
    - `surface/valid-param-range`: Validate `start <= end`, non-negative integer character ranges.
    - `surface/valid-fingerprint`: Validate SHA-256 hash formatting.
    - `surface/valid-quote-style`: Validate quote style enums (`single`, `double`, `backtick`, `none`).
    - `surface/valid-patch-policy`: Validate concurrency policies (`abort`, `rebase`, `force`).

### 2.3 `@oa-sdk/codegen`
- **Current State**:
  - CLI commands in `src/cli/commands/`: `generate.ts`, `typegen.ts`, `build-spec.ts`, etc.
  - `src/zod-to-schema.ts`: Translates Zod schemas to OAS 3.2 Schema Objects (supports `z.ZodDiscriminatedUnion` but only outputs `discriminator.propertyName`, omitting `mapping` and full union schema projection).
  - `src/type-registry-canonical-ir.ts`: Comprehensive TypeScript AST parser producing normalized Shape IR, Semantic IR, and token stream hashes.
  - `src/typegen/schema-to-ts.ts`: Fold-based schema-to-TypeScript algebra.
  - `src/cli/lib/source-adapters.ts`: Extensible adapter pattern (`zod`, `drizzle`, `openapi-projection-envelope`, `python-contract-spec-snapshot`).
- **Gaps for Proposals**:
  - **Proposal 1**: `zod-to-schema.ts` needs full `discriminator.mapping` emission when variant schemas are named in context.
  - **Proposal 3**: Lacks standalone type guard generator plugin (`--target standalone-guards`) that uses `ajv/dist/2020` and `ajv/dist/standalone` to generate pure ESM `.js` (0 runtime dependencies, 0 `eval`) and `.d.ts` declaration files. `ajv` is currently missing from `packages/codegen/package.json`.
  - **Proposal 4**: Lacks the V3 Unified Architecture bidirectional synchronization engine:
    - Pluggable `TypeAdapter` interface (`read`, `write`, `diff`).
    - `ZodAdapter` (Zod <-> EntitySpec).
    - `TsAstAdapter` (TypeScript AST <-> EntitySpec with reverse-offset bottom-up `TextEdit` patching).
    - `TypiaAdapter` (Typia serializer adapter).
    - `EntitySpec` & `EntitySpecDiff` core models.

### 2.4 `@oa-sdk/spec-lens` & `@oa-sdk/spec-lens-contract`
- **Current State**:
  - `packages/spec-lens-contract/src/index.ts`: Definitive contract types for SpecSnapshot (`definition-builder`, `typespec-bundle`), SpecTimelineDiff, SpecCompositionReport, Provenance.
  - `packages/spec-lens/`: Snapshot engine, source adapters, SQLite cache, and REST presentation.
- **Gaps for Proposals**:
  - **Proposal 4**: Integration of `EntitySpec` intermediate representations and diff models into spec contracts and snapshot comparison pipelines.

### 2.5 `@oa-sdk/schemas`
- **Current State**:
  - Schema fragments, domains, build scripts (`build-spec`, `downgrade-3.1`, `validate:spectral`).
- **Gaps for Proposals**:
  - Verification target for `x-surface-*` extensions and discriminated union models.

---

## 3. Proposal-by-Proposal Detailed Integration Map

### 3.1 Proposal 1: Native Discriminated Union Projection

#### Target Schema Structure (OpenAPI 3.1)
```json
{
  "components": {
    "schemas": {
      "NativeRpcRequest": {
        "type": "object",
        "required": ["id", "method", "params"],
        "properties": {
          "id": { "type": "string" },
          "method": { "type": "string" },
          "params": { "type": "object" }
        },
        "discriminator": {
          "propertyName": "method",
          "mapping": {
            "session.hello": "#/components/schemas/SessionHelloRequest",
            "workspace.snapshot.save": "#/components/schemas/WorkspaceSnapshotSaveRequest",
            "materialize.css": "#/components/schemas/MaterializeCssRequest",
            "lease.acquire": "#/components/schemas/LeaseAcquireRequest"
          }
        },
        "oneOf": [
          { "$ref": "#/components/schemas/SessionHelloRequest" },
          { "$ref": "#/components/schemas/WorkspaceSnapshotSaveRequest" },
          { "$ref": "#/components/schemas/MaterializeCssRequest" },
          { "$ref": "#/components/schemas/LeaseAcquireRequest" }
        ]
      }
    }
  }
}
```

#### Module Specifications & Code Placement
1. **`packages/openapi-projection-contract/src/discriminated-union.ts`** (New File):
   ```typescript
   export interface DiscriminatedUnionProjectionOptions {
     discriminatorProperty: string;
     unionSchemaId: string;
     variants: Record<string, Record<string, unknown>>;
     profile: 'operation-contract' | 'component-bundle';
     baseProperties?: Record<string, Record<string, unknown>>;
     baseRequired?: string[];
   }

   export interface DiscriminatedUnionProjectionResult {
     unionSchema: Record<string, unknown>;
     variantSchemas: Record<string, Record<string, unknown>>;
     paths?: Record<string, unknown>;
   }

   export function projectDiscriminatedUnion(
     options: DiscriminatedUnionProjectionOptions,
   ): DiscriminatedUnionProjectionResult;
   ```
2. **`packages/openapi-projection-contract/src/index.ts`** (Edit):
   - Export `DiscriminatedUnionProjectionOptions`, `DiscriminatedUnionProjectionResult`, and `projectDiscriminatedUnion`.
3. **`packages/codegen/src/zod-to-schema.ts`** (Edit):
   - Enhance `convertType` for `z.ZodDiscriminatedUnion` to construct `discriminator.mapping` from `context.refs`.
4. **`packages/codegen/src/cli/lib/source-adapters.ts`** (Edit):
   - Integrate `projectDiscriminatedUnion` when encountering multiplexed RPC/stdio schemas or profile envelopes.

---

### 3.2 Proposal 2: Non-AST Character Range Patching Metadata Extensions

#### Standardized `x-surface-*` Vendor Extensions
| Extension Key | Type | Fields / Spec |
|---|---|---|
| `x-surface-anchor` | `object` | `{ id: string, line: number, column: number, raw?: string, commentType?: 'line' \| 'block' \| 'jsdoc' }` |
| `x-surface-param-range` | `object` | `{ targetProperty?: string, supportsLivePatch?: boolean, maxFramerateHz?: number, nameRange?: CharRange, valueRange?: CharRange, unquotedRange?: CharRange, delimiterBounds?: CharRange }` |
| `x-surface-fingerprint` | `string` | SHA-256 string (`sha256:[a-f0-9]{64}`) |
| `x-surface-quote-style` | `enum` | `'single' \| 'double' \| 'backtick' \| 'none'` |
| `x-surface-patch-policy` | `object` | `{ concurrency: 'abort' \| 'rebase' \| 'force', retryLimit?: number, maxStalenessMs?: number }` |

#### Module Specifications & Code Placement
1. **`packages/openapi-projection-contract/src/surface-extensions.ts`** (New File):
   - Define constants:
     - `OPENAPI_SURFACE_ANCHOR_EXTENSION = 'x-surface-anchor'`
     - `OPENAPI_SURFACE_PARAM_RANGE_EXTENSION = 'x-surface-param-range'`
     - `OPENAPI_SURFACE_FINGERPRINT_EXTENSION = 'x-surface-fingerprint'`
     - `OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION = 'x-surface-quote-style'`
     - `OPENAPI_SURFACE_PATCH_POLICY_EXTENSION = 'x-surface-patch-policy'`
     - `OPENAPI_SURFACE_EXTENSION_NAMES = [...] as const`
   - Define types:
     - `SurfaceCharRange = { start: number; end: number }`
     - `SurfaceAnchorExtension`, `SurfaceParamRangeExtension`, `SurfaceQuoteStyleExtension`, `SurfacePatchPolicyExtension`
     - `SurfaceExtensions = { ... }`
   - Define validation helper: `validateSurfaceExtensions(schema: unknown, pointer?: string): SchemaDiagnostic[]`
2. **`packages/openapi-projection-contract/src/index.ts`** (Edit):
   - Re-export all surface extension constants, types, and validators.
3. **`packages/parser/src/lint.ts`** (Edit):
   - Add `'surface'` to `LintOptions['categories']`.
   - Implement `lintSurfaceExtensions(spec, results)` checking:
     - `surface/anchor-valid`: checks `id` (non-empty string), `line >= 1`, `column >= 1`.
     - `surface/param-range-valid`: checks `start <= end`, non-negative integers.
     - `surface/fingerprint-valid`: checks SHA-256 format or valid non-empty hash.
     - `surface/quote-style-valid`: checks enum values.
     - `surface/patch-policy-valid`: checks concurrency policy values.
4. **`packages/parser/src/schema-validator.ts`** (Edit):
   - Ensure `x-surface-*` extensions pass schema validation gracefully without triggering AJV keyword errors.

---

### 3.3 Proposal 3: Standalone Lightweight Type Guard Generator Plugin

#### Architecture & Zero-Eval CSP Invariant
```
┌─────────────────────────────────┐
│ JSON Schema Draft 2020-12 / OAS │
└───────────────┬─────────────────┘
                │
                ▼ oa-gen generate --target standalone-guards
┌─────────────────────────────────┐
│     AJV 2020 Standalone Engine  │
│       (ajv/dist/standalone)     │
└───────────────┬─────────────────┘
                ├─────────────────────────────────────────┐
                ▼                                         ▼
┌───────────────────────────────┐         ┌───────────────────────────────┐
│  Pure ESM Type Guards (.js)   │         │  TypeScript Types (.d.ts)     │
│  - 0 external dependencies    │         │  export declare function      │
│  - 0 eval() / new Function()  │         │    isFoo(data: unknown):      │
│  - Pre-compiled JS AST exprs  │         │    data is Foo;               │
└───────────────────────────────┘         └───────────────────────────────┘
```

#### Module Specifications & Code Placement
1. **`packages/codegen/package.json`** (Edit):
   - Add `"ajv": "^8.17.0"` and `"ajv-formats": "^3.0.1"` to `dependencies`.
2. **`packages/codegen/src/standalone-guards/types.ts`** (New File):
   ```typescript
   export interface StandaloneGuardGeneratorOptions {
     schemaDocument: Record<string, unknown>;
     outDir: string;
     schemas?: string[];
     generateDeclarations?: boolean;
     dialect?: 'draft-2020-12' | 'oas31' | 'oas32';
     moduleFormat?: 'esm' | 'cjs';
     includeHelpers?: boolean;
   }

   export interface GeneratedGuardArtifact {
     filename: string;
     content: string;
     isDeclaration: boolean;
   }
   ```
3. **`packages/codegen/src/standalone-guards/generator.ts`** (New File):
   ```typescript
   import Ajv2020 from 'ajv/dist/2020.js'
   import standaloneCode from 'ajv/dist/standalone/index.js'
   import { schemaToTs } from '../typegen/schema-to-ts.js'
   import type { StandaloneGuardGeneratorOptions, GeneratedGuardArtifact } from './types.js'

   export async function generateStandaloneGuards(
     options: StandaloneGuardGeneratorOptions,
   ): Promise<GeneratedGuardArtifact[]>;
   ```
   - Normalizes input schemas (extracts `components.schemas` or root schema).
   - Configures AJV with `{ code: { source: true, esm: true }, allErrors: true, strict: false }`.
   - Creates mapping: `{ [guardName]: schemaId }`.
   - Invokes `standaloneCode(ajv, mapping)` to generate pure ESM JavaScript.
   - Generates matching `.d.ts` declaration file using `schemaToTs` and `data is T` function signatures.
4. **`packages/codegen/src/standalone-guards/index.ts`** (New File):
   - Export generator functions and types.
5. **`packages/codegen/src/cli/commands/generate.ts`** (Edit):
   - Add support for options:
     - `--target`: `'standalone-guards'`
     - `--input` / `-i`: schema JSON / YAML file path
     - `--out-dir` / `-o`: output directory
     - `--dialect`: `'draft-2020-12'`
     - `--schemas`: comma-separated schema names
     - `--generate-declarations`: boolean
   - Route to `generateStandaloneGuards`.
6. **`packages/codegen/src/index.ts`** (Edit):
   - Export `generateStandaloneGuards`, `StandaloneGuardGeneratorOptions`, and `GeneratedGuardArtifact`.

---

### 3.4 Proposal 4: TypeScript AST Bidirectional Synchronization (V3 Unified Architecture)

#### V3 Architecture & SSOT Pipeline
```
                      ┌────────────────────┐
                      │     EntitySpec     │
                      │  (Master In-Memory)│
                      └─────────┬──────────┘
                                │
             ▲                  ▼                  ▲
  Bidirectional Sync    Bidirectional Sync    Bidirectional Sync
             │                  │                  │
  ┌──────────┴────────┐┌────────┴─────────┐┌───────┴──────────┐
  │  Zod Type Adapter ││  TS Type Adapter ││Typia Type Adapter│
  │ (packages/schemas)││  (AST Syncer)    ││(Fast Serializer) │
  └───────────────────┘└──────────────────┘└──────────────────┘
```

#### Pluggable Type Adapter Interface
```typescript
export interface TypeAdapter<TSource = unknown, TTarget = unknown> {
  name: string;
  supportedDialects: string[];
  read(source: TSource): EntitySpec | EntitySpec[];
  write(spec: EntitySpec, originalSource?: TSource): TTarget;
  diff(a: EntitySpec, b: EntitySpec): EntitySpecDiff;
}
```

#### Reverse-Offset Bottom-Up TextEdit Patching Engine
To achieve **zero-loss trivia retention** (comments, formatting, indentation):
1. Parse original source code into TypeScript AST (`ts.createSourceFile`).
2. Identify target nodes (e.g. `ts.InterfaceDeclaration`, `ts.TypeAliasDeclaration`, `ts.PropertySignature`).
3. Compute `TextEdit` operations: `{ range: { start: number, end: number }, newText: string }`.
4. Sort all text edits in **reverse order of start offset** (`start` descending):
   $$\text{edits.sort}((a, b) \to b.range.start - a.range.start)$$
5. Apply edits sequentially from the bottom up.
6. Since bottom edits do not alter character offsets of preceding lines, leading trivia, comments, and unaffected declarations remain untouched.

#### Module Specifications & Code Placement
1. **`packages/codegen/src/ast-sync/entity-spec.ts`** (New File):
   - `EntityFieldSpec`: `{ name: string, type: string, required: boolean, nullable?: boolean, description?: string, defaultValue?: unknown, format?: string, constraints?: Record<string, unknown>, surfaceExtensions?: Record<string, unknown>, metadata?: Record<string, unknown> }`
   - `EntitySpec`: `{ id: string, name: string, kind: 'entity' | 'enum' | 'type-alias' | 'union' | 'interface', description?: string, fields: EntityFieldSpec[], heritage?: string[], rawAstRef?: unknown, sourceLocation?: { filePath: string, line: number, column: number, range: { start: number, end: number } }, metadata?: Record<string, unknown> }`
   - `EntityFieldDiff`, `EntitySpecDiff`
   - `diffEntitySpecs(a: EntitySpec, b: EntitySpec): EntitySpecDiff`
2. **`packages/codegen/src/ast-sync/text-edit.ts`** (New File):
   - `TextEdit`: `{ start: number, end: number, newText: string }`
   - `applyTextEdits(originalSource: string, edits: TextEdit[]): string` (implements reverse-offset bottom-up application)
3. **`packages/codegen/src/ast-sync/type-adapter.ts`** (New File):
   - `TypeAdapter<TSource, TTarget>` interface and registry.
4. **`packages/codegen/src/ast-sync/ts-ast-adapter.ts`** (New File):
   - `TsAstAdapter implements TypeAdapter<string | ts.SourceFile, string>`:
     - `read()`: uses `type-registry-canonical-ir.ts` and `ts.createSourceFile` to extract `EntitySpec`.
     - `write()`: generates `TextEdit`s against `originalSource` using reverse-offset patching, or emits new AST code if no original source is provided.
     - `diff()`: semantic AST comparison.
5. **`packages/codegen/src/ast-sync/zod-adapter.ts`** (New File):
   - `ZodAdapter implements TypeAdapter<z.ZodTypeAny | Record<string, z.ZodTypeAny>, string>`:
     - `read()`: extracts `EntitySpec` from `z.ZodObject`, `z.ZodDiscriminatedUnion`, etc.
     - `write()`: generates Zod schema declaration code.
     - `diff()`: compares Zod schemas via `EntitySpec`.
6. **`packages/codegen/src/ast-sync/typia-adapter.ts`** (New File):
   - `TypiaAdapter implements TypeAdapter<string, string>`:
     - High-performance serializer / validator code emitter.
7. **`packages/codegen/src/ast-sync/index.ts`** (New File):
   - Export all adapters, `EntitySpec`, `applyTextEdits`, and `diffEntitySpecs`.
8. **`packages/codegen/src/index.ts`** (Edit):
   - Export AST sync symbols.

---

## 4. Comprehensive File Modification & Creation Matrix

| Package | File Path | Action | Role / Rationale | Target Proposal |
|---|---|---|---|---|
| `@oa-sdk/openapi-projection-contract` | `src/discriminated-union.ts` | **Create** | `projectDiscriminatedUnion` helper API & `DiscriminatedUnionProjectionOptions` | Proposal 1 |
| `@oa-sdk/openapi-projection-contract` | `src/surface-extensions.ts` | **Create** | `x-surface-*` extension constants, types, and validation helper | Proposal 2 |
| `@oa-sdk/openapi-projection-contract` | `src/index.ts` | **Modify** | Re-export discriminated union and surface extension APIs | Proposal 1, 2 |
| `@oa-sdk/openapi-projection-contract` | `src/discriminated-union.test.ts` | **Create** | Unit tests for discriminated union projection | Proposal 1 |
| `@oa-sdk/openapi-projection-contract` | `src/surface-extensions.test.ts` | **Create** | Unit tests for surface extension validation | Proposal 2 |
| `@oa-sdk/parser` | `src/lint.ts` | **Modify** | Add `surface` lint category & rules (`surface/valid-anchor`, etc.) | Proposal 2 |
| `@oa-sdk/parser` | `src/schema-validator.ts` | **Modify** | Ensure `x-surface-*` vendor extensions pass schema validation | Proposal 2 |
| `@oa-sdk/parser` | `src/definition-openapi-projection.ts` | **Modify** | Ensure projection metadata handles discriminated unions and surface extensions | Proposal 1, 2 |
| `@oa-sdk/parser` | `src/__tests__/lint-surface-extensions.test.ts` | **Create** | Unit tests for surface extension lint rules | Proposal 2 |
| `@oa-sdk/codegen` | `package.json` | **Modify** | Add `"ajv": "^8.17.0"` and `"ajv-formats": "^3.0.1"` dependencies | Proposal 3 |
| `@oa-sdk/codegen` | `src/zod-to-schema.ts` | **Modify** | Enhance `z.ZodDiscriminatedUnion` to emit `discriminator.mapping` | Proposal 1 |
| `@oa-sdk/codegen` | `src/standalone-guards/types.ts` | **Create** | Type definitions for standalone guard generator | Proposal 3 |
| `@oa-sdk/codegen` | `src/standalone-guards/generator.ts` | **Create** | AJV standalone ESM compiler & `.d.ts` generator | Proposal 3 |
| `@oa-sdk/codegen` | `src/standalone-guards/index.ts` | **Create** | Module entry point for standalone guard generator | Proposal 3 |
| `@oa-sdk/codegen` | `src/cli/commands/generate.ts` | **Modify** | Support `--target standalone-guards` and guard generation options | Proposal 3 |
| `@oa-sdk/codegen` | `src/ast-sync/entity-spec.ts` | **Create** | `EntitySpec`, `EntityFieldSpec`, `EntitySpecDiff` IR & diffing | Proposal 4 |
| `@oa-sdk/codegen` | `src/ast-sync/text-edit.ts` | **Create** | Reverse-offset bottom-up `TextEdit` patching engine | Proposal 4 |
| `@oa-sdk/codegen` | `src/ast-sync/type-adapter.ts` | **Create** | Pluggable `TypeAdapter` interface & registry | Proposal 4 |
| `@oa-sdk/codegen` | `src/ast-sync/ts-ast-adapter.ts` | **Create** | TypeScript AST Type Adapter with zero trivia loss | Proposal 4 |
| `@oa-sdk/codegen` | `src/ast-sync/zod-adapter.ts` | **Create** | Zod Type Adapter for EntitySpec conversion | Proposal 4 |
| `@oa-sdk/codegen` | `src/ast-sync/typia-adapter.ts` | **Create** | Typia serializer/validator Adapter | Proposal 4 |
| `@oa-sdk/codegen` | `src/ast-sync/index.ts` | **Create** | Module entry point for AST sync engine | Proposal 4 |
| `@oa-sdk/codegen` | `src/index.ts` | **Modify** | Re-export standalone guard and AST sync APIs | Proposal 3, 4 |
| `@oa-sdk/codegen` | `src/__tests__/standalone-guards.test.ts` | **Create** | Unit tests for standalone guard generator (0 eval invariant) | Proposal 3 |
| `@oa-sdk/codegen` | `src/__tests__/ast-sync-ts-adapter.test.ts` | **Create** | Unit tests for TS AST roundtrip and comment preservation | Proposal 4 |
| `@oa-sdk/codegen` | `src/__tests__/ast-sync-zod-adapter.test.ts` | **Create** | Unit tests for Zod adapter bidirectional sync | Proposal 4 |
| `@oa-sdk/codegen` | `src/__tests__/discriminated-union-codegen.test.ts` | **Create** | Unit tests for discriminated union schema to TS | Proposal 1 |
| `@oa-sdk/spec-lens-contract` | `src/index.ts` | **Modify** | Re-export EntitySpec contract types if needed | Proposal 4 |

---

## 5. Dependency Manifest & Packaging Changes

1. **`packages/openapi-projection-contract`**:
   - Dependencies: No new external runtime dependencies needed (pure TypeScript/contracts).
   - Node engine: `>=22.0.0`.
2. **`packages/parser`**:
   - Dependencies: `@oa-sdk/core`, `@oa-sdk/openapi-projection-contract`, `ajv`, `yaml` (already present).
3. **`packages/codegen`**:
   - Add to `dependencies`:
     ```json
     "ajv": "^8.17.0",
     "ajv-formats": "^3.0.1"
     ```
   - Already present: `@oa-sdk/core`, `@oa-sdk/openapi-projection-contract`, `@oa-sdk/parser`, `yaml`, `zod`, `typescript`.
4. **`packages/spec-lens` & `@oa-sdk/schemas`**:
   - Depend on `@oa-sdk/codegen`, `@oa-sdk/spec-lens-contract`, `@oa-sdk/parser` via workspace protocol (`workspace:*`).

---

## 6. Implementation Sequencing & Verification Strategy

### Step 1: Foundation Contracts (`@oa-sdk/openapi-projection-contract`)
1. Implement `src/discriminated-union.ts` (Proposal 1).
2. Implement `src/surface-extensions.ts` (Proposal 2).
3. Export from `src/index.ts`.
4. Run `pnpm --filter @oa-sdk/openapi-projection-contract test` & `typecheck`.

### Step 2: Parser Linter & Validation (`@oa-sdk/parser`)
1. Add `surface` lint category and rules in `src/lint.ts` (Proposal 2).
2. Ensure `src/schema-validator.ts` tolerates `x-surface-*` extensions.
3. Wire projection adapter in `src/definition-openapi-projection.ts`.
4. Run `pnpm --filter @oa-sdk/parser test` & `typecheck`.

### Step 3: Codegen Extensions (`@oa-sdk/codegen`)
1. Add `ajv` to `packages/codegen/package.json`.
2. Update `src/zod-to-schema.ts` for `discriminator.mapping` (Proposal 1).
3. Implement `src/standalone-guards/` generator & wire into `src/cli/commands/generate.ts` (Proposal 3).
4. Implement `src/ast-sync/` (`EntitySpec`, `applyTextEdits`, `TsAstAdapter`, `ZodAdapter`, `TypiaAdapter`) (Proposal 4).
5. Export from `src/index.ts`.
6. Run `pnpm --filter @oa-sdk/codegen test` & `typecheck`.

### Step 4: Monorepo Verification
1. Run full monorepo typecheck: `pnpm -r typecheck`.
2. Run full monorepo test suite: `pnpm test`.
3. Verify zero-eval CSP invariant on generated standalone guard code.
4. Verify trivia preservation across round-trip AST edits.
