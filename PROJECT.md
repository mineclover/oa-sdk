# Project: 4 Upstream Architectural Proposals in `@oa-sdk/*`

## Architecture

The `@oa-sdk/*` monorepo implements 4 upstream architectural proposals to support high-performance visual IDE tooling, multi-protocol schema projection, secure client-side type checking, and lossless AST synchronization.

```
                                  [ User Request / Specs ]
                                              │
                         ┌────────────────────┴────────────────────┐
                         ▼                                         ▼
            [ Implementation Track ]                      [ E2E Testing Track ]
       (M1 -> M2 -> M3 -> M4 -> Final)               (Tiers 1-4 Opaque-Box E2E Suite)
                         │                                         │
                         │                                         │
                         ▼                                         ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │ Packages Layer Topology:                                               │
   │                                                                        │
   │ 1. @oa-sdk/openapi-projection-contract (Leaf Contract Layer)            │
   │    - projectDiscriminatedUnion API                                     │
   │    - x-surface-* vendor extensions metadata models                     │
   │                                                                        │
   │ 2. @oa-sdk/parser (Parsing & Linting Layer)                            │
   │    - Surface category lint rules (valid-anchor, param-range, etc.)     │
   │                                                                        │
   │ 3. @oa-sdk/codegen (Code Generation & AST Engine Layer)                │
   │    - Standalone ESM Type Guard Generator (ajv/standalone, zero-eval)  │
   │    - V3 Unified Architecture AST Bidirectional Sync (EntitySpec,       │
   │      Zod/TS/Typia Adapters, Diff Engine, Bottom-Up TextEdit Patching)  │
   │    - CLI: oa-codegen generate --target standalone-guards               │
   │                                                                        │
   │ 4. @oa-sdk/spec-lens & @oa-sdk/schemas (Integration & Storage)         │
   │    - Canonical EntitySpec IR schema export & adapters alignment        │
   └────────────────────────────────────────────────────────────────────────┘
```

## Feature Inventory

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | `projectDiscriminatedUnion` Core API | Project polymorphic schemas / RPC ops into OpenAPI 3.1 discriminator + oneOf | M1 | Proposal 1 Spec §1.3 |
| 2 | Single-Stream Multiplexed RPC Projection | Map multi-method RPC endpoints to /rpc/{method} with discriminator bindings | M1 | Proposal 1 Spec §1.2 |
| 3 | MCP Stdio Protocol Projection | Project MCP JSON-RPC 2.0 stdio operations into OpenAPI 3.1 operation contracts | M1 | Proposal 1 Spec §1.2 |
| 4 | Projection Profile Integration | Tag and validate union models under `component-bundle` and `operation-contract` | M1 | `@oa-sdk/openapi-projection-contract` |
| 5 | `zod-to-schema` Discriminated Union Emission | Augment Zod converter to emit OpenAPI 3.1 discriminator objects | M1 | Proposal 1 Spec §1.3 |
| 6 | `x-surface-anchor` Extension | Schema metadata for source anchor coordinates (id, line, column, raw, commentType) | M2 | Proposal 2 Spec §2.2 |
| 7 | `x-surface-param-range` Extension | Schema metadata for live byte offsets (start, end, maxFramerateHz) | M2 | Proposal 2 Spec §2.2 |
| 8 | `x-surface-fingerprint` Extension | SHA-256 source block hash for drift detection (`sha256:...`) | M2 | Proposal 2 Spec §2.2 |
| 9 | `x-surface-quote-style` Extension | Syntax quotation style metadata ('single' \| 'double' \| 'backtick' \| 'none') | M2 | Proposal 2 Spec §2.2 |
| 10 | `x-surface-patch-policy` Extension | Concurrency drift policy configuration ('abort' \| 'rebase' \| 'force') | M2 | Proposal 2 Spec §2.2 |
| 11 | Parser Linting Rules for `x-surface-*` | Custom `surface` category rules in `@oa-sdk/parser` for OAS 3.1 validation | M2 | Proposal 2 Spec §2.4 |
| 12 | `generateStandaloneGuards` Core API | Compile JSON Schema 2020-12 to standalone pure ESM functions (0 deps, 0 eval) | M3 | Proposal 3 Spec §3.2 |
| 13 | CLI `oa-codegen --target standalone-guards` | CLI command interface for invoking standalone guard generation | M3 | Proposal 3 Spec §3.3 |
| 14 | Pure ESM Zero-Dependency Output Invariant | Output validator JS file with zero external imports, CSP-safe | M3 | Proposal 3 Spec §3.1 |
| 15 | TypeScript Guard Signature Generation | Emit `export declare function isType(data: unknown): data is Type;` | M3 | Proposal 3 Spec §3.2 |
| 16 | `EntitySpec` Intermediate Representation | Canonical normalized AST IR for schemas, interfaces, and types | M4 | Proposal 4 Spec §4.2 |
| 17 | Pluggable `TypeAdapter` Interface | Universal adapter interface for AST parsing, code emission, and patching | M4 | Proposal 4 Spec §4.3 |
| 18 | `ZodTypeAdapter` | Bidirectional adapter between `z.object` AST and `EntitySpec` | M4 | Proposal 4 Spec §4.2 |
| 19 | `TsAstTypeAdapter` | Bidirectional adapter between TypeScript `interface`/`type` and `EntitySpec` | M4 | Proposal 4 Spec §4.2 |
| 20 | `TypiaTypeAdapter` | Bidirectional adapter for interfaces with JSDoc validation tags | M4 | Proposal 4 Spec §4.2 |
| 21 | `computeEntitySpecDiff` Engine | Granular structural and semantic AST difference computation | M4 | Proposal 4 Spec §4.2 |
| 22 | Reverse-Offset Bottom-Up `TextEdit` Patching | Surgical TextEdit patching preserving comments, indentation, and trivia | M4 | Proposal 4 Spec §4.2 |
| 23 | `syncEntitySpecWithCode` Core Synchronizer | High-level synchronizer parsing, diffing, and applying patches | M4 | Proposal 4 Spec §4.2 |

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Requirement-driven opaque-box E2E test suite (Tiers 1-4) -> TEST_READY.md | none | DONE |
| M1 | Native Discriminated Union Projection | `@oa-sdk/openapi-projection-contract`, `@oa-sdk/codegen`: `projectDiscriminatedUnion`, RPC/MCP projection, zod-to-schema | none | DONE |
| M2 | Non-AST Character Range Metadata Extensions | `@oa-sdk/openapi-projection-contract`, `@oa-sdk/parser`: `x-surface-*` extensions and `surface` lint rules | none | DONE |
| M3 | Standalone Lightweight Type Guard Generator | `@oa-sdk/codegen`: `generateStandaloneGuards`, CLI `--target standalone-guards`, Ajv 2020 standalone ESM | M1, M2 | DONE |
| M4 | TypeScript AST Bidirectional Synchronization | `@oa-sdk/codegen`, `@oa-sdk/spec-lens`, `@oa-sdk/schemas`: `EntitySpec`, `TypeAdapter`s, `computeEntitySpecDiff`, `applyTextEdits` | none | DONE |
| M5 | Final Milestone: Full E2E Pass & Adversarial Hardening | Pass 100% E2E tests (Tiers 1-4) + Tier 5 adversarial coverage hardening | E2E, M1, M2, M3, M4 | DONE |

## Interface Contracts

### `@oa-sdk/openapi-projection-contract`
```typescript
export interface DiscriminatedUnionProjectionOptions {
  discriminatorProperty: string;
  unionSchemaId: string;
  variants: Record<string, unknown>;
  profile?: 'operation-contract' | 'component-bundle';
  pathPrefix?: string;
  description?: string;
}

export interface DiscriminatedUnionProjectionResult {
  unionSchema: Record<string, unknown>;
  variantSchemas: Record<string, Record<string, unknown>>;
  paths?: Record<string, unknown>;
}

export function projectDiscriminatedUnion(
  options: DiscriminatedUnionProjectionOptions
): DiscriminatedUnionProjectionResult;

// Surface extension constants & types
export const OPENAPI_SURFACE_ANCHOR_EXTENSION = 'x-surface-anchor' as const;
export const OPENAPI_SURFACE_PARAM_RANGE_EXTENSION = 'x-surface-param-range' as const;
export const OPENAPI_SURFACE_FINGERPRINT_EXTENSION = 'x-surface-fingerprint' as const;
export const OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION = 'x-surface-quote-style' as const;
export const OPENAPI_SURFACE_PATCH_POLICY_EXTENSION = 'x-surface-patch-policy' as const;
```

### `@oa-sdk/parser`
```typescript
// Added 'surface' to LintOptions categories
export interface LintOptions {
  categories?: Array<'structure' | 'operations' | 'parameters' | 'refs' | 'security' | 'style' | 'components' | 'surface'>;
  rules?: Record<string, 'off' | 'warn' | 'error'>;
}
```

### `@oa-sdk/codegen`
```typescript
export interface StandaloneGuardTarget {
  name: string;
  typeName: string;
  schema: Record<string, unknown> | string;
}

export interface StandaloneGuardGeneratorOptions {
  schemaDocument: Record<string, unknown>;
  outDir: string;
  guards?: StandaloneGuardTarget[];
  typeImportSpecifier?: string;
  generateDeclarations?: boolean;
  moduleFormat?: 'esm';
}

export function generateStandaloneGuards(
  options: StandaloneGuardGeneratorOptions
): Promise<GeneratedGuardArtifact[]>;

// AST Bidirectional Sync
export interface EntitySpec {
  id: string;
  name: string;
  kind: 'schema' | 'interface' | 'type-alias' | 'object-literal' | 'node';
  docComment?: string;
  properties: Record<string, EntityPropertySpec>;
  extends?: string[];
  discriminator?: { propertyName: string; value: string };
  metadata?: Record<string, unknown>;
  sourceSpan?: { start: number; end: number };
}

export function computeEntitySpecDiff(currentSpec: EntitySpec, targetSpec: EntitySpec): ASTDiff[];
export function applyTextEdits(originalSource: string, edits: TextEdit[]): string;
export function syncEntitySpecWithCode(
  existingCode: string,
  updatedSpec: EntitySpec,
  options?: { adapter?: string | TypeAdapter }
): SyncResult;
```

## Code Layout

- `packages/openapi-projection-contract/src/`
  - `index.ts` — Public export re-exports
  - `discriminated-union.ts` — Discriminated union projection logic
  - `surface-extensions.ts` — Standardized `x-surface-*` extension types and constants
- `packages/parser/src/`
  - `lint.ts` — Surface linting category & rules (`surface/valid-anchor`, `surface/valid-param-range`, `surface/valid-fingerprint`, `surface/valid-quote-style`, `surface/valid-patch-policy`)
- `packages/codegen/src/`
  - `standalone-guards/`
    - `generator.ts` — Standalone ESM type guard generator using Ajv 2020 standalone
    - `types.ts` — Standalone guard options & artifact models
  - `ast-sync/`
    - `entity-spec.ts` — EntitySpec and PropertySpec types & normalization
    - `adapter-interface.ts` — Pluggable TypeAdapter contract
    - `adapters/zod.ts` — ZodTypeAdapter
    - `adapters/ts-ast.ts` — TsAstTypeAdapter
    - `adapters/typia.ts` — TypiaTypeAdapter
    - `diff-engine.ts` — computeEntitySpecDiff implementation
    - `text-edit.ts` — Reverse-offset bottom-up applyTextEdits
    - `type-sync.ts` — syncEntitySpecWithCode orchestrator
  - `cli/commands/generate.ts` — CLI `--target standalone-guards` flag and execution
  - `zod-to-schema.ts` — Zod discriminated union mapper
