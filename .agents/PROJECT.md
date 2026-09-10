# Project: OpenAPI 3.2 to Zod 4 Code Generator (`generateZodFromSpec` & `oa-gen generate:zod`)

## Architecture
This project implements an OpenAPI 3.2 Schema Object (JSON Schema Draft 2020-12 dialect) to Zod 4 code generation engine in `@oa-sdk/codegen`, integrating with `@oa-sdk/parser`'s `foldSchema` catamorphism.

### Key Architecture Components
1. **Catamorphic Schema Algebra (`packages/codegen/src/zodgen/schema-to-zod.ts`)**:
   - Implements `SchemaAlgebra<string>` via `createZod4Algebra(options)` to map OpenAPI 3.2 AST nodes to formatted Zod 4 expression strings.
   - Non-destructive preprocessing (`prepareSchemaForZod`) using `WeakMap<OasSchema, unknown>` to preserve `default` and `example` metadata without triggering `foldSchema`'s lines 80-82 short-circuit.
2. **Vocabulary & Spec Conformance**:
   - Strictly numeric exclusive bounds: `exclusiveMinimum: n` / `exclusiveMaximum: n` -> `.gt(n)` / `.lt(n)`.
   - Tuple and rest items: `prefixItems` -> `z.tuple([...])`, `items` -> `.rest(...)`.
   - Polymorphic discriminators: `propertyName`, `mapping`, and OAS 3.2 `defaultMapping` -> `z.discriminatedUnion(...)`.
   - Object sealing: `unevaluatedProperties: false` / `additionalProperties: false` -> `.strict()`.
   - Cycle elimination: `#/components/schemas/*` references -> `z.lazy(() => ComponentSchema)`.
   - Metadata: `.describe(...)` and `.default(...)`.
3. **Dual Mode Engine (`packages/codegen/src/zodgen/`)**:
   - **Static Emission**: `generateZodFromSpec(doc, options)` formats TypeScript source with `export const <Name>Schema = ...` and `export type <Name> = z.infer<typeof <Name>Schema>`.
   - **Dynamic Runtime Validator**: `createRuntimeZodValidators(doc)` / `createDynamicZodValidator(schema, doc)` with `normalizeOasForZodRuntime` bridging OAS 3.2 to Zod 4's native `z.fromJSONSchema` (mapping `components.schemas` to `$defs` and handling `unevaluatedProperties`).
4. **CLI Integration (`packages/codegen/src/cli/commands/generate-zod.ts`)**:
   - Command: `oa-gen generate:zod --spec <path> --output <dir> --style <schema|both>`.
   - Registered in `packages/codegen/src/cli/commands.ts`.
5. **Dual Track Verification**:
   - Opaque-box E2E testing track across 4 tiers (Tiers 1-4) publishing `TEST_READY.md`.
   - Adversarial hardening (Tier 5) with Challengers, Reviewers, and Forensic Auditor.

## Code Layout
- `packages/codegen/src/zodgen/schema-to-zod.ts`: `createZod4Algebra`, `schemaToZod`, `prepareSchemaForZod`.
- `packages/codegen/src/zodgen/generate-zod.ts`: `generateZodFromSpec`.
- `packages/codegen/src/zodgen/runtime-adapter.ts`: `createRuntimeZodValidators`, `createDynamicZodValidator`, `normalizeOasForZodRuntime`.
- `packages/codegen/src/zodgen/index.ts`: Public exports for `./zodgen`.
- `packages/codegen/src/cli/commands/generate-zod.ts`: `generate:zod` CLI command definition.
- `packages/codegen/src/cli/commands.ts`: Command registry exporting `commands: Command[]`.
- `packages/codegen/src/index.ts`: Monorepo root exports for `@oa-sdk/codegen`.
- `test/e2e/zod4-generator.e2e.test.ts`: 4-Tier E2E test suite.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | `createZod4Algebra()` Core | Catamorphic AST algebra implementation mapping leaf/composite types with `prepareSchemaForZod` WeakMap default preservation | M1 | ORIGINAL_REQUEST §R1 |
| F2 | `generateZodFromSpec()` Engine | Full document generator parsing `doc.schemas`, resolving component names, and emitting formatted TypeScript source code | M1 | ORIGINAL_REQUEST §R1 |
| F3 | Numeric Exclusive Bounds | Strictly numeric `exclusiveMinimum` / `exclusiveMaximum` mapped to `.gt(n)` and `.lt(n)` | M2 | ORIGINAL_REQUEST §R2 |
| F4 | Tuples & Rest Elements | `prefixItems` mapped to `z.tuple([...])` and rest elements mapped via `.rest(...)` | M2 | ORIGINAL_REQUEST §R2 |
| F5 | Object Sealing (`.strict()`) | `unevaluatedProperties: false` and `additionalProperties: false` mapped to `.strict()`, object catchall | M2 | ORIGINAL_REQUEST §R2 |
| F6 | Circular References (`z.lazy`) | `#/components/schemas/*` references mapped to `z.lazy(() => ComponentSchema)` for self and mutual cycle resolution | M2 | ORIGINAL_REQUEST §R2 |
| F7 | Discriminator & `defaultMapping` | §4.8.24 `propertyName`, `mapping`, and OAS 3.2 `defaultMapping` mapped to `z.discriminatedUnion(...)` | M2 | ORIGINAL_REQUEST §R2 |
| F8 | JSDoc & Metadata (`.describe`, `.default`) | `.describe()` for description and `.default()` for default values | M2 | ORIGINAL_REQUEST §R2 |
| F9 | Dynamic Runtime Validator | In-memory runtime validator leveraging Zod 4's native `z.fromJSONSchema` with OAS `$defs` normalizer | M3 | ORIGINAL_REQUEST §R3 |
| F10 | CLI Command `generate:zod` | `oa-gen generate:zod --spec <path> --output <dir>` CLI integration in `@oa-sdk/codegen` | M4 | ORIGINAL_REQUEST §R4 |
| F11 | E2E Testing Suite (Tiers 1-4) | Comprehensive opaque-box test suite verifying all features, parity, and CLI execution -> `TEST_READY.md` | E2E Track | ORIGINAL_REQUEST §R4 |
| F12 | Final Verification & Audit Gate | 100% test pass, adversarial challenger verification, 2 reviewer approvals, forensic auditor CLEAN verdict | M5 | ORIGINAL_REQUEST AC |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Features F11: 4-Tier test infra & test cases -> `TEST_READY.md` | none | IN_PROGRESS |
| M1 | Core Zod 4 Algebra & Engine | Features F1, F2 (`schema-to-zod.ts`, `generate-zod.ts`) | none | IN_PROGRESS |
| M2 | OAS 3.2 Vocabulary & Circular References | Features F3, F4, F5, F6, F7, F8 | M1 | PLANNED |
| M3 | Dual Mode Runtime Adapter | Feature F9 (`runtime-adapter.ts`, `normalizeOasForZodRuntime`) | M1 | PLANNED |
| M4 | CLI Command Integration | Feature F10 (`generate:zod` command in `cli/commands/`) | M1, M2, M3 | PLANNED |
| M5 | Final Milestone: 100% E2E Pass & Hardening | Feature F12: Tiers 1-4 E2E pass, Tier 5 Adversarial Hardening, Reviewers, Auditor | E2E, M1, M2, M3, M4 | PLANNED |

## Interface Contracts
### `createZod4Algebra(options)`
- Parameter: `options?: Zod4AlgebraOptions` (`refNameOverrides?: Record<string, string>`, `defaultValues?: WeakMap<OasSchema, unknown>`, `strictObjects?: boolean`)
- Return: `SchemaAlgebra<string>`

### `generateZodFromSpec(doc, options)`
- Parameter: `doc: OasDocument`, `options?: GenerateZodOptions` (`banner?: boolean`, `style?: 'schema' | 'both'`, `schemaSuffix?: string`)
- Return: `string` (formatted TypeScript source code)

### `createRuntimeZodValidators(doc)` / `createDynamicZodValidator(schema, doc)`
- Parameter: `schema: OasSchema`, `doc: OasDocument`
- Return: `z.ZodTypeAny`

### CLI Command `oa-gen generate:zod`
- Flags:
  - `--spec`, `-s`: required path to OpenAPI 3.2 spec (YAML/JSON)
  - `--output`, `-o`: optional output file or directory path
  - `--style`: optional `'schema' | 'both'` (default `'both'`)
