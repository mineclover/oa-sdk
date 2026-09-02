# Comprehensive Specification Inventory & Requirement Analysis

**Target Upstream Repository**: `@oa-sdk/*` (`packages/openapi-projection-contract`, `packages/codegen`, `packages/parser`, `packages/spec-lens`, `packages/spec-lens-contract`, `packages/schemas`)  
**Target Dialect**: OpenAPI 3.1.0 / JSON Schema Draft 2020-12  
**Authoritative Source Documents**:
1. `/Users/junwoobang/workflow/browser-studio/docs/specs/oa-sdk-integration-proposals.md`
2. `/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md`
3. Reference implementations in `/Users/junwoobang/workflow/browser-studio/tools/` and `/Users/junwoobang/workflow/browser-studio/packages/visual-ir/src/ast/`

---

## Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|---|---|---|---|---|---|---|
| 1 | Discriminated Union Projection | `projectDiscriminatedUnion` Core API | Projects polymorphic Zod / JSON schemas and multiplexed RPC operations into canonical OpenAPI 3.1 `discriminator` + `oneOf` models. | `DiscriminatedUnionProjectionOptions` (`discriminatorProperty`, `unionSchemaId`, `variants`, `profile`) | `{ unionSchema: Record<string, unknown>, variantSchemas: Record<string, Record<string, unknown>>, paths?: Record<string, unknown> }` | Throws `Error` if `variants` is empty, if `discriminatorProperty` is missing in variant schemas, or if `unionSchemaId` is not a valid non-empty string. | Proposal 1 Spec §1.3, `export-openapi-specs.mjs:936-995` |
| 2 | Discriminated Union Projection | Single-Stream Multiplexed RPC Projection | Maps multi-method RPC endpoints (e.g. Chrome Native Messaging length-prefixed protocol) to `/rpc/{method}` or unified union request/response payloads. | Operation definitions, discriminator field (`method`), variant map | OpenAPI 3.1 Operation objects with `discriminator.propertyName` and `$ref` mappings | Validates that all mapped variants exist in `components.schemas` and match operationId uniqueness rules. | Proposal 1 Spec §1.2, `export-openapi-specs.mjs:595-864` |
| 3 | Discriminated Union Projection | MCP Stdio Protocol Projection | Projects Model Context Protocol (MCP) JSON-RPC 2.0 stdio operations into OpenAPI 3.1 operation contracts with explicit `operationId` and `requestBody` bindings. | MCP variant definitions, discriminator field (`operation` or `method`) | OpenAPI 3.1 `paths` map (`/mcp/{op}`) + `components.schemas` variants | Generates `422` error envelopes and schema validation diagnostics if variant definitions mismatch. | Proposal 1 Spec §1.2, `export-openapi-specs.mjs:916-1050` |
| 4 | Discriminated Union Projection | Projection Profile Integration | Seamlessly validates and tags discriminated union models under `component-bundle` and `operation-contract` profiles. | `OpenApiProjectionResult`, `OpenApiProjectionProfile` | Projected document with `x-schema-engine-profile`, `x-schema-engine-refs`, `x-schema-engine-version-hash` | `validateOpenApiProjection` produces diagnostics with severity `error` if profile invariants (e.g. paths vs component requirements) are violated. | `@oa-sdk/openapi-projection-contract:1-180` |
| 5 | Non-AST Range Metadata | `x-surface-anchor` Extension | Standardized vendor extension capturing source-code location anchor binding (`id`, `line`, `column`, `raw`, `commentType`). | Target schema object, anchor coordinate object | Schema envelope with attached `x-surface-anchor` | Parser validation error if `id` is empty, or `line`/`column` are not positive integers. | Proposal 2 Spec §2.2, `surface-engine/schemas.ts` |
| 6 | Non-AST Range Metadata | `x-surface-param-range` Extension | Standardized vendor extension defining exact character byte offsets (`start`, `end`) for parameter name, value, unquoted string, delimiter bounds, and live patching capability. | Target schema property, parameter range config (`targetProperty`, `supportsLivePatch`, `maxFramerateHz`) | Schema property definition with attached `x-surface-param-range` | Parser validation error if `targetProperty` does not exist in schema `properties`, or `maxFramerateHz` <= 0. | Proposal 2 Spec §2.2, §2.3 |
| 7 | Non-AST Range Metadata | `x-surface-fingerprint` Extension | Standardized vendor extension recording SHA-256 cryptographic hash of source block content for drift detection prior to byte patching. | Schema block object, SHA-256 hex/prefixed string (`sha256:...`) | Schema envelope with attached `x-surface-fingerprint` | Parser validation error if fingerprint does not conform to regex `^sha256:[a-f0-9]{64}$`. | Proposal 2 Spec §2.2, `export-openapi-specs.mjs:485-488` |
| 8 | Non-AST Range Metadata | `x-surface-quote-style` Extension | Standardized vendor extension specifying syntax quotation style preference (`single`, `double`, `backtick`, `none`). | Enum value (`'single'`, `'double'`, `'backtick'`, `'none'`) | Schema property metadata | Parser validation error if value is outside allowed enum values. | Proposal 2 Spec §2.2 |
| 9 | Non-AST Range Metadata | `x-surface-patch-policy` Extension | Standardized vendor extension configuring concurrency handling and drift resolution policies (`abort`, `rebase`, `force`). | Policy config object (`onDrift: 'abort' \| 'rebase' \| 'force'`, `retryLimit?: number`) | Schema envelope metadata | Parser validation error if unknown policy string or negative retry limit provided. | Proposal 2 Spec §2.2 |
| 10 | Non-AST Range Metadata | Parser Linting Rules for `x-surface-*` | Custom OAS 3.1 / JSON Schema 2020-12 parser linting category (`surface`) validating structural integrity and cross-references of `x-surface-*` vendor extensions. | OpenAPI 3.1 document / schema objects | `LintResult[]` with `severity`, `rule` (e.g. `surface/valid-anchor`, `surface/valid-param-range`), `message`, `source` | Emits `error` on malformed extension shapes and `warning` on missing recommended metadata. | `packages/parser/src/lint.ts:65-77` |
| 11 | Standalone Type Guards | `generateStandaloneGuards` Generator API | Pre-compiles JSON Schema Draft 2020-12 definitions into pure ESM validator functions and `.d.ts` type guard declarations with zero runtime dependencies and zero dynamic `eval()` / `new Function()`. | `StandaloneGuardGeneratorOptions` (`schemaDocument`, `outDir`, `schemas`, `generateDeclarations`, `moduleFormat`) | `GeneratedGuardArtifact[]` (`filePath`, `content`, `kind: 'esm' \| 'dts'`) | Throws if AJV compilation fails due to unsupported schema keywords or cyclic unresolved references. | Proposal 3 Spec §3.2, §3.3, `generate-standalone-guards.mjs` |
| 12 | Standalone Type Guards | CLI Command: `oa-codegen generate --target standalone-guards` | CLI command interface for invoking standalone guard generation from CLI. | `--input <path>`, `--target standalone-guards`, `--out-dir <path>`, `--dialect draft-2020-12`, `--module-format esm` | Output directory populated with `*.guards.js`, `*.guards.d.ts`, `index.js`, `index.d.ts` | Exits with code `1` and prints diagnostic error summary if input schema is missing, invalid, or compilation fails. | Proposal 3 Spec §3.3, `packages/codegen/src/cli/commands/generate.ts` |
| 13 | Standalone Type Guards | Pure ESM Zero-Dependency Output Invariant | Inlines validation logic into pure JavaScript expressions; imports no external runtime libraries (`ajv`, `zod`, etc.). | Pre-compiled AJV AST / standalone code mapping | Pure JavaScript ESM file (`*.guards.js`) | Rejects dynamic runtime evaluation (`eval()`, `new Function()`) to satisfy Chrome Manifest V3 CSP. | Proposal 3 Spec §3.1, §3.2 |
| 14 | Standalone Type Guards | TypeScript Type Guard Signature Generation | Emits type predicate declarations (`export declare function isType(data: unknown): data is Type;`) with proper module imports. | Target schema name, mapped TypeScript type name, package type import specifier | TypeScript declaration file (`*.guards.d.ts`) | Emits fallback `data is unknown` if TypeScript type name cannot be inferred and no type mapping is provided. | Proposal 3 Spec §3.2, `generate-standalone-guards.mjs:145-176` |
| 15 | AST Bidirectional Sync | `EntitySpec` Canonical Intermediate Representation | Normalized, framework-agnostic schema IR representing types, interfaces, properties, doc comments, constraints, and source spans. | Source AST node or schema object | `EntitySpec` object (`id`, `name`, `kind`, `docComment`, `properties`, `extends`, `discriminator`, `sourceSpan`) | Validation errors if `name` or `properties` is missing. | Proposal 4 Spec §4.2, `visual-ir/src/ast/types.ts:91-107` |
| 16 | AST Bidirectional Sync | Pluggable `TypeAdapter` Interface | Universal interface allowing pluggable adapters (`ZodAdapter`, `TsAstAdapter`, `TypiaAdapter`, etc.) to parse source into `EntitySpec`, emit code, and generate surgical patches. | AST node, `AdapterContext` (`sourceFile`, `sourceCode`, `typeChecker`) | `EntitySpec`, generated code string, or `TextEdit[]` patches | Throws error if node kind is unsupported by adapter. | Proposal 4 Spec §4.3, `visual-ir/src/ast/adapters/adapter-interface.ts` |
| 17 | AST Bidirectional Sync | `ZodTypeAdapter` | Bi-directional adapter converting between `z.object({...})` AST nodes and `EntitySpec`, including modifier unwrapping (`.optional()`, `.nullable()`, `.default()`, `.describe()`, `.min()`, `.max()`, `.regex()`). | `ts.VariableDeclaration` / `ts.VariableStatement` or `EntitySpec` | `EntitySpec` or TypeScript Zod schema code | Throws if variable declaration does not contain a recognizable Zod expression. | Proposal 4 Spec §4.2, `visual-ir/src/ast/adapters/zod.ts` |
| 18 | AST Bidirectional Sync | `TsAstTypeAdapter` | Bi-directional adapter converting between TypeScript `interface` / `type` alias AST nodes and `EntitySpec`. | `ts.InterfaceDeclaration` / `ts.TypeAliasDeclaration` or `EntitySpec` | `EntitySpec` or TypeScript interface code | Throws if AST node is not an interface or type literal. | Proposal 4 Spec §4.2, `visual-ir/src/ast/adapters/ts-ast.ts` |
| 19 | AST Bidirectional Sync | `TypiaTypeAdapter` | Bi-directional adapter converting between TypeScript interfaces with JSDoc validation tags (`@minimum`, `@maximum`, `@format`, `@default`) and `EntitySpec`. | `ts.InterfaceDeclaration` / `ts.TypeAliasDeclaration` or `EntitySpec` | `EntitySpec` or TypeScript interface code with JSDoc annotations | Preserves non-Typia JSDoc comments while parsing validation tags into `PropertyConstraint[]`. | Proposal 4 Spec §4.2, `visual-ir/src/ast/adapters/typia.ts` |
| 20 | AST Bidirectional Sync | `computeEntitySpecDiff` Engine | Computes granular structural and semantic differences (`ASTDiff[]`) between two `EntitySpec` instances (property addition, removal, type change, value change, default value, doc comments, constraints). | `currentSpec: EntitySpec`, `targetSpec: EntitySpec` | `ASTDiff[]` (`op`, `path`, `entityName`, `oldValue`, `newValue`, `propertySpec`) | Returns empty array if specs are identical. | Proposal 4 Spec §4.2, `visual-ir/src/ast/diff-engine.ts` |
| 21 | AST Bidirectional Sync | Reverse-Offset Bottom-Up `TextEdit` Patching | Generates and applies surgical `TextEdit[]` modifications directly to original source text sorted descending by start offset (`start`, `end`, `replacementText`) to guarantee zero offset shifting and zero trivia destruction. | `originalSource: string`, `edits: TextEdit[]` | Patched source code string | Throws `Error` if overlapping `TextEdit` ranges are detected (`next.end > current.start`). | Proposal 4 Spec §4.2, `visual-ir/src/ast/ast-utils.ts:154-177` |
| 22 | AST Bidirectional Sync | `syncEntitySpecWithCode` Core Synchronizer | High-level synchronization API that parses existing code, detects the appropriate adapter, computes diffs against updated `EntitySpec`, and applies non-destructive surgical patches. | `existingCode: string`, `updatedSpec: EntitySpec`, `options?: { adapter?: string \| TypeAdapter }` | `SyncResult` (`code: string`, `modified: boolean`, `diffs: ASTDiff[]`, `detectedAdapter: string`, `warnings: string[]`) | Throws `Error` if target entity declaration is not found in source code. | Proposal 4 Spec §4.2, `visual-ir/src/ast/type-sync.ts:94-135` |

---

## Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---|---|---|
| 1 | Discriminated Union Projection | Variant schema with nested/missing discriminator property | If a variant schema does not contain the specified discriminator property as a literal `const` or `enum`, projection validation emits diagnostic error `openapi-projection/invalid-discriminator-variant`. |
| 2 | Discriminated Union Projection | Zero-variant union schema | If `variants` record is empty, `projectDiscriminatedUnion` throws `Error("Discriminated union must contain at least one variant")`. |
| 3 | Discriminated Union Projection | Multi-transport operation with identical discriminator key across namespaces | Maps each operation to distinct path item `/rpc/{method}` or `/mcp/{operation}` while generating unique component schema names in `components.schemas` to prevent collisions. |
| 4 | Character Range Metadata | Negative or inverted character offsets in `x-surface-param-range` | Range validation fails if `start < 0` or `end < start`, flagging invalid byte coordinates. |
| 5 | Character Range Metadata | Fingerprint drift detected on live patch | When `x-surface-patch-policy` is set to `abort`, patch operations reject mutations if current buffer SHA-256 does not match `x-surface-fingerprint`. When set to `rebase`, the scanner attempts relative offset relocation. |
| 6 | Standalone Type Guards | Recursive / self-referencing JSON Schema (`$ref: "#"`) | `ajv/dist/standalone` generates named internal recursive function calls in ESM output without stack overflow, preserving `data is RecursiveType`. |
| 7 | Standalone Type Guards | Schema containing keywords that require `eval` in standard AJV | In standalone mode, `code: { source: true, esm: true }` pre-renders all keywords (including `pattern`, `format`, `allOf`, `anyOf`, `oneOf`) into static inline JS conditional expressions; zero calls to `eval()` or `Function()`. |
| 8 | Standalone Type Guards | Schema without declared `$id` | Automatically assigned synthetic URN (`urn:guard:${name}`) to prevent AJV registration collision during multi-schema standalone bundle generation. |
| 9 | AST Bidirectional Sync | Overlapping TextEdit patch operations | `applyTextEdits` validates descending sort order and throws an explicit error if `next.end > current.start`, preventing corrupted partial replacements. |
| 10 | AST Bidirectional Sync | Source code with complex inline JSDoc and non-standard whitespace | Reverse-offset patching replaces only the exact property token boundaries without re-formatting untouched properties, preserving all surrounding trivia, trailing commas, and inline comments. |
| 11 | AST Bidirectional Sync | Schema property addition to empty object/interface | Indentation detector analyzes parent node indentation and inserts new property with matching indentation level (`\t` or `N` spaces) before the closing brace `}`. |
| 12 | AST Bidirectional Sync | Type adapter auto-detection on ambiguous source file | `resolveAdapter` inspects AST node syntax (`isZodCallExpression`, interface with `@tags`, standard interface) and falls back gracefully to `ts-ast` or configured default if undetermined. |

---

## Detailed Specification Breakdown

### Proposal 1: Native Discriminated Union Projection (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/codegen`)

#### 1. Problem & Architecture Overview
In distributed client-host architectures (such as Chrome Native Messaging 4-byte length-prefixed protocol and Model Context Protocol stdio JSON-RPC 2.0 streams), all remote procedure calls flow through a single physical transport channel. Upstream `@oa-sdk` requires native projection utilities to transform these multiplexed discriminated unions and polymorphic schemas into canonical OpenAPI 3.1 `discriminator` + `oneOf` models.

#### 2. Public Interface Contracts
In `packages/openapi-projection-contract/src/index.ts`:

```typescript
import type { OpenApiProjectionProfile } from './index.js';

export interface DiscriminatedUnionProjectionOptions {
  /** Discriminator property name in JSON payload (e.g., 'method', 'operation', 'type', 'kind') */
  discriminatorProperty: string;
  /** Name/Identifier for the projected union schema (e.g., 'NativeRpcRequest', 'DevLinkMcpControlRequestV1') */
  unionSchemaId: string;
  /** Mapping of discriminator values to variant schemas (Zod schema instances or raw JSON Schema objects) */
  variants: Record<string, unknown>;
  /** Target OpenAPI Projection Profile ('operation-contract' | 'component-bundle') */
  profile?: 'operation-contract' | 'component-bundle';
  /** Base path prefix when projecting operation paths (e.g., '/rpc', '/mcp') */
  pathPrefix?: string;
  /** Human-readable description for the root union schema */
  description?: string;
}

export interface DiscriminatedUnionProjectionResult {
  /** Root union schema containing discriminator and oneOf array */
  unionSchema: Record<string, unknown>;
  /** Extracted reusable component schemas for each variant */
  variantSchemas: Record<string, Record<string, unknown>>;
  /** Generated OpenAPI 3.1 paths object (if profile is 'operation-contract' or pathPrefix is provided) */
  paths?: Record<string, unknown>;
}

/**
 * Projects polymorphic schemas or multiplexed RPC operations into canonical OpenAPI 3.1
 * discriminator mappings and oneOf variant schemas.
 */
export function projectDiscriminatedUnion(
  options: DiscriminatedUnionProjectionOptions
): DiscriminatedUnionProjectionResult;
```

#### 3. Canonical OpenAPI 3.1 Output Structure
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

---

### Proposal 2: Non-AST Character Range Patching Metadata Extensions (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/parser`)

#### 1. Problem & Architecture Overview
Interactive UI controls (60fps color pickers, number scrubbers, visual drag-and-drop handles) cannot re-parse entire source ASTs on every frame without substantial CPU overhead and destruction of non-standard syntax and trivia. The **Surface Engine** model uses exact byte ranges (`CharRange = { start: number, end: number }`) and cryptographic content hashes (`SurfaceBlock.fingerprint`). `@oa-sdk` standardizes these extensions under the `x-surface-*` namespace.

#### 2. Canonical Vendor Extensions Definition
In `packages/openapi-projection-contract/src/index.ts`:

```typescript
export const OPENAPI_SURFACE_ANCHOR_EXTENSION = 'x-surface-anchor' as const;
export const OPENAPI_SURFACE_PARAM_RANGE_EXTENSION = 'x-surface-param-range' as const;
export const OPENAPI_SURFACE_FINGERPRINT_EXTENSION = 'x-surface-fingerprint' as const;
export const OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION = 'x-surface-quote-style' as const;
export const OPENAPI_SURFACE_PATCH_POLICY_EXTENSION = 'x-surface-patch-policy' as const;

export const OPENAPI_SURFACE_EXTENSION_NAMES = [
  OPENAPI_SURFACE_ANCHOR_EXTENSION,
  OPENAPI_SURFACE_PARAM_RANGE_EXTENSION,
  OPENAPI_SURFACE_FINGERPRINT_EXTENSION,
  OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION,
  OPENAPI_SURFACE_PATCH_POLICY_EXTENSION,
] as const;

export interface SurfaceAnchorMetadata {
  id: string;
  line: number;
  column: number;
  raw?: string;
  commentType?: 'leading' | 'trailing' | 'inline';
}

export interface SurfaceParamRangeMetadata {
  targetProperty: string;
  supportsLivePatch: boolean;
  maxFramerateHz?: number;
  unquotedOffset?: { start: number; end: number };
}

export type SurfaceQuoteStyle = 'single' | 'double' | 'backtick' | 'none';

export interface SurfacePatchPolicyMetadata {
  onDrift: 'abort' | 'rebase' | 'force';
  retryLimit?: number;
  rebaseToleranceChars?: number;
}
```

#### 3. Parser Linting Rules
In `packages/parser/src/lint.ts`:
- Category: `'surface'` (enabled by default or via `categories: ['surface']`)
- Rules:
  - `surface/valid-anchor`: Validates `x-surface-anchor` structure (`id` is non-empty string, `line >= 1`, `column >= 1`).
  - `surface/valid-param-range`: Validates `x-surface-param-range` (`targetProperty` exists in schema properties, `maxFramerateHz > 0`).
  - `surface/valid-fingerprint`: Validates SHA-256 hash formatting (`^sha256:[a-f0-9]{64}$`).
  - `surface/valid-quote-style`: Validates enum against `'single' | 'double' | 'backtick' | 'none'`.
  - `surface/valid-patch-policy`: Validates policy attributes (`onDrift` in `['abort', 'rebase', 'force']`).

---

### Proposal 3: Standalone Lightweight Type Guard Generator Plugin (`@oa-sdk/codegen`)

#### 1. Problem & Architecture Overview
Chrome Extension Manifest V3 enforces strict CSP (`script-src 'self'`; no `eval()`, no `new Function()`). Pre-compiling JSON Schema Draft 2020-12 specifications into pure static ESM validator functions using `ajv/dist/2020` and `ajv/dist/standalone` produces zero-eval, zero-runtime dependency validators (<5KB per domain) and matching `.d.ts` type guard declarations (`data is T`).

#### 2. Generator Core API & CLI Interface
In `packages/codegen/src/typegen/standalone-guards.ts`:

```typescript
export interface StandaloneGuardTarget {
  /** Guard function name (e.g., 'isSurfaceBlock', 'isNativeRpcRequest') */
  name: string;
  /** Exported TypeScript type name (e.g., 'SurfaceBlock', 'NativeRpcRequest') */
  typeName: string;
  /** JSON Schema Draft 2020-12 object or schema name within document */
  schema: Record<string, unknown> | string;
}

export interface StandaloneGuardGeneratorOptions {
  /** Input OpenAPI 3.1 or JSON Schema Draft 2020-12 document */
  schemaDocument: Record<string, unknown>;
  /** Output directory for generated code */
  outDir: string;
  /** Target schemas/guards to compile */
  guards?: StandaloneGuardTarget[];
  /** TypeScript import module specifier for type declarations (e.g., '@oa-sdk/parser') */
  typeImportSpecifier?: string;
  /** Whether to emit .d.ts declaration files (default: true) */
  generateDeclarations?: boolean;
  /** Module format: 'esm' (default) */
  moduleFormat?: 'esm';
}

export interface GeneratedGuardArtifact {
  filePath: string;
  content: string;
  kind: 'js' | 'dts';
}

export async function generateStandaloneGuards(
  options: StandaloneGuardGeneratorOptions
): Promise<GeneratedGuardArtifact[]>;
```

#### 3. CLI Command Signature
```bash
oa-codegen generate \
  --target standalone-guards \
  --input <path-to-openapi-or-json-schema> \
  --out-dir <output-directory> \
  [--type-import <package-name>] \
  [--module-format esm]
```

CLI Argument Wiring in `packages/codegen/src/cli/commands/generate.ts`:
- Added `--target` option (supporting `'components'` | `'standalone-guards'`).
- Added `--input` option for source schema file path.
- Added `--type-import` option for configuring `.d.ts` type import specifier.

#### 4. Emitted Code Format
- JavaScript (`*.guards.js`):
  ```javascript
  // Pure ESM, 0 external imports, 0 eval, 0 new Function
  export function isSurfaceBlock(data) {
    if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
    if (typeof data.id !== "string" || data.id.length < 1) return false;
    ...
    return true;
  }
  ```
- TypeScript Declarations (`*.guards.d.ts`):
  ```typescript
  import type { SurfaceBlock } from '@oa-sdk/core';
  export declare function isSurfaceBlock(data: unknown): data is SurfaceBlock;
  ```

---

### Proposal 4: TypeScript AST Bidirectional Synchronization (V3 Unified Architecture)

#### 1. Problem & Architecture Overview
To achieve zero-loss bidirectional synchronization between schema models (`EntitySpec`) and source code across multiple type dialects (Zod, TypeScript AST, Typia), the V3 Unified Architecture introduces:
1. Canonical in-memory intermediate representation: `EntitySpec`.
2. Pluggable `TypeAdapter` pattern (`ZodTypeAdapter`, `TsAstTypeAdapter`, `TypiaTypeAdapter`).
3. Granular difference engine: `computeEntitySpecDiff`.
4. Reverse-offset bottom-up `TextEdit` patching to preserve comments, indentation, and surrounding trivia.

#### 2. Canonical `EntitySpec` & AST Diff Model
In `packages/codegen/src/ast/types.ts` and `packages/schemas/src/ast/types.ts`:

```typescript
export type EntityPropertyKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'undefined'
  | 'object'
  | 'array'
  | 'tuple'
  | 'union'
  | 'intersection'
  | 'literal'
  | 'enum'
  | 'reference'
  | 'any'
  | 'unknown';

export interface PropertyConstraint {
  kind: 'min' | 'max' | 'length' | 'minLength' | 'maxLength' | 'regex' | 'format' | 'int' | 'positive' | 'nonnegative';
  value?: number | string | RegExp;
  message?: string;
}

export interface EntityPropertySpec {
  name: string;
  kind: EntityPropertyKind;
  value?: unknown;
  defaultValue?: unknown;
  optional: boolean;
  nullable?: boolean;
  docComment?: string;
  literalValue?: string | number | boolean | null;
  referenceName?: string;
  properties?: Record<string, EntityPropertySpec>;
  elementSpec?: EntityPropertySpec;
  tupleElements?: EntityPropertySpec[];
  members?: EntityPropertySpec[];
  enumValues?: Array<string | number>;
  constraints?: PropertyConstraint[];
  tags?: Record<string, string | number | boolean>;
  sourceSpan?: { start: number; end: number; line?: number; column?: number };
}

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

export interface TextEdit {
  start: number;
  end: number;
  replacementText: string;
  description?: string;
}

export type ASTDiffOpKind =
  | 'SET_PROPERTY_VALUE'
  | 'SET_PROPERTY_TYPE'
  | 'ADD_PROPERTY'
  | 'REMOVE_PROPERTY'
  | 'UPDATE_DOC_COMMENT'
  | 'UPDATE_DEFAULT_VALUE'
  | 'UPDATE_CONSTRAINT'
  | 'RENAME_ENTITY';

export interface ASTDiff {
  op: ASTDiffOpKind;
  path: string[];
  entityName: string;
  oldValue?: unknown;
  newValue?: unknown;
  propertySpec?: EntityPropertySpec;
}
```

#### 3. Pluggable Type Adapter Interface
In `packages/codegen/src/ast/adapters/adapter-interface.ts`:

```typescript
import type ts from 'typescript';

export interface AdapterContext {
  sourceFile: ts.SourceFile;
  sourceCode: string;
  typeChecker?: ts.TypeChecker;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export interface TypeAdapter<TNode extends ts.Node = ts.Node> {
  readonly name: string;
  readonly supportedDialects: string[];
  canHandle(node: ts.Node): boolean;
  toSpec(node: TNode, context: AdapterContext): EntitySpec;
  generateCode(spec: EntitySpec, formatting?: FormattingOptions): string;
  createPatches(
    sourceFile: ts.SourceFile,
    targetNode: TNode,
    diffs: ASTDiff[],
    context: AdapterContext
  ): TextEdit[];
  validate(spec: EntitySpec): ValidationResult;
}
```

#### 4. Type Adapter Matrix
1. **`ZodTypeAdapter` (`name: 'zod'`)**:
   - Parses `z.object({...})` call expressions into `EntitySpec`.
   - Recognizes chained methods: `.min()`, `.max()`, `.regex()`, `.default()`, `.describe()`, `.optional()`, `.nullable()`.
   - Emits Zod variable declarations + `z.infer<typeof Schema>`.
   - Surgical patch updates property initializer or chained method arguments.
2. **`TsAstTypeAdapter` (`name: 'ts-ast'`)**:
   - Parses TypeScript `interface` and `type` alias ASTs.
   - Emits standard TypeScript interfaces.
   - Surgical patch updates property signature types or appends new member signatures before closing `}`.
3. **`TypiaTypeAdapter` (`name: 'typia'`)**:
   - Parses TypeScript interfaces with JSDoc validation tags (`@minimum`, `@maximum`, `@format`, `@default`).
   - Converts JSDoc tags into `PropertyConstraint[]` in `EntitySpec`.
   - Emits TypeScript interfaces annotated with JSDoc validation tags.
   - Surgical patch replaces or prepends JSDoc comments alongside property signatures.

#### 5. Bidirectional Synchronization & Bottom-Up Diff Application
1. `codeToSpec(sourceCode, options)`: Parses source into AST, selects target declaration, invokes matching `TypeAdapter.toSpec()`.
2. `computeEntitySpecDiff(currentSpec, targetSpec)`: Recursively traverses spec properties, identifying modified, added, and removed fields, constraints, doc comments, and default values.
3. `syncEntitySpecWithCode(existingCode, updatedSpec, options)`:
   - Computes `ASTDiff[]`.
   - Calls `adapter.createPatches()` to produce `TextEdit[]`.
   - Sorts edits descending by start offset (`b.start - a.start`).
   - Verifies no overlapping edits (`next.end <= current.start`).
   - Applies edits from bottom to top to preserve character offsets and trivia.

---

## Cross-Package Architecture & Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│             @oa-sdk/openapi-projection-contract             │
│  • OPENAPI_PROJECTION_PROFILES ('component-bundle', etc.)  │
│  • projectDiscriminatedUnion API                            │
│  • x-surface-* vendor extensions metadata definitions       │
└──────────────────────────────┬──────────────────────────────┘
                               │
       ┌───────────────────────┼──────────────────────────────┐
       ▼                                                      ▼
┌─────────────────────────────┐                ┌─────────────────────────────┐
│       @oa-sdk/parser        │                │      @oa-sdk/codegen        │
│  • OAS 3.1 / 3.2 Parser     │                │  • Typegen & AST Sync       │
│  • Surface Linting Rules    │                │  • Standalone Guard Gen     │
│  • JSON Schema Validator    │                │  • Pluggable Type Adapters  │
└─────────────────────────────┘                │  • Reverse-Offset TextEdit  │
                                               └──────────────┬──────────────┘
                                                              │
                                               ┌──────────────▼──────────────┐
                                               │      @oa-sdk/spec-lens      │
                                               │  • EntitySpec Diff Engine   │
                                               │  • Snapshot & Provenance    │
                                               └─────────────────────────────┘
```

---

## Conformance & Verification Requirements

1. **CSP Safety Invariant**: All files produced by `generateStandaloneGuards` must contain 0 instances of `eval(` and 0 instances of `new Function(`.
2. **Lossless Trivia Invariant**: Roundtrip sync tests (`code -> spec -> code`) must preserve all non-modified property comments, whitespace, and formatting.
3. **Deterministic Projection Invariant**: `projectDiscriminatedUnion` output must produce canonical OpenAPI 3.1 `discriminator` mappings and validate cleanly under `@oa-sdk/openapi-projection-contract`.
4. **Monorepo Build & Test**:
   - `pnpm test` passes across all packages.
   - `pnpm -r typecheck` / `pnpm run check` passes with 0 type errors.
