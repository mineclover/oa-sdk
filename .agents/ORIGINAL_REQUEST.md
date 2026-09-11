# Original User Request

## 2026-09-10T22:55:03Z

Implement an OpenAPI 3.2 Schema Object (JSON Schema Draft 2020-12) to Zod 4 code generator (`generateZodFromSpec`) and CLI command (`oa-gen generate:zod`) in `@oa-sdk/codegen`, supporting modern Zod 4 idioms and circular references.

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. OpenAPI 3.2 Schema Object to Zod 4 Code Generation Engine
Implement `generateZodFromSpec(doc, options)` and `createZod4Algebra()` in `@oa-sdk/codegen` using `@oa-sdk/parser`'s `foldSchema` architecture, translating OpenAPI 3.2 Schema Objects (Draft 2020-12 dialect) into formatted TypeScript source code with idiomatic Zod 4 syntax.

### R2. OAS 3.2 & Draft 2020-12 Full Vocabulary Support
Support all core OpenAPI 3.2 Schema Object keywords including:
- Numeric exclusive boundaries: `exclusiveMinimum` / `exclusiveMaximum` (strictly numeric) mapped to `.gt()` / `.lt()`
- Tuples & Rest: `prefixItems` mapped to `z.tuple([...])` and rest items
- Discriminator (§4.8.24): `propertyName`, `mapping`, and OAS 3.2 `defaultMapping` mapped to `z.discriminatedUnion(...)`
- Object sealing: `unevaluatedProperties` / `additionalProperties: false` mapped to `.strict()`
- Circular & cross-component references: `#/components/schemas/*` mapped to `z.lazy(() => ComponentSchema)`
- JSDoc / Metadata: `.describe()` for description and `.default()` for default values

### R3. Dual Mode: Static Code Generation & Dynamic Runtime Validator
Provide both:
1. Static `.ts` code emission for build-time compilation and IDE autocomplete.
2. An optional in-memory runtime adapter leveraging Zod 4's native `z.fromJSONSchema` for zero-build testing/mock-server usage.

### R4. CLI Integration & Verification Suite
Expose the generator via `oa-gen generate:zod --spec <path> --output <dir>` and provide comprehensive unit/E2E test suites verifying bidirectional parity, cycle resolution, and downstream schema validity.

## Acceptance Criteria

### AST & Code Generation Parity
- [ ] `generateZodFromSpec` translates OpenAPI 3.2 `components.schemas` into clean TypeScript code targeting Zod 4.
- [ ] Numeric bounds (`exclusiveMinimum: n`) correctly compile to `.gt(n)` instead of legacy boolean flags.
- [ ] `prefixItems` generates `z.tuple(...)` matching Draft 2020-12 tuple semantics.
- [ ] Circular schema references successfully resolve at runtime using `z.lazy()` without recursion errors.
- [ ] `discriminator` with `defaultMapping` synthesizes valid `z.discriminatedUnion()`.

### CLI & Test Suite
- [ ] `oa-gen generate:zod` executes cleanly against local OpenAPI 3.2 specs in `packages/schemas`.
- [ ] Generated Zod 4 schemas pass `tsc --noEmit` and runtime `.parse()` / `.safeParse()` assertions.
- [ ] All new tests in `packages/codegen` pass under `pnpm test`.

## 2026-09-10T23:19:49Z

Implement Phases 2, 3, and 4 of the TypeSpec ecosystem expansion in the oa-sdk monorepo: TypeSpec AST Semantic Diff & Breaking Change Analyzer, Zero-Build Instant Mock Server, and Personas/DPM Native TypeSpec Decorator Integration.

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. TypeSpec AST Semantic Diff & Breaking Change Analyzer (Phase 2)
Implement `oa-gen tsp diff` CLI command that parses and compares two TypeSpec AST trees (e.g., base git ref vs head, or two file paths). Detect breaking changes: removed operations, altered HTTP methods/routes, removed/renamed models, removed properties, newly required properties, changed status codes, and changed `@operationId`. Support `--fail-on-breaking` flag to exit with non-zero code for CI gates.

### R2. Zero-Build Instant Mock Server (Phase 3)
Implement `oa-gen mock --tsp <path>` (and watch mode `--watch`) that compiles TypeSpec specifications directly in-memory via `@typespec/compiler` without writing intermediate OpenAPI YAML artifacts to disk. Feed the in-memory schema into `@oa-sdk/mock-server` to serve mock responses with HTTP validation on `localhost:4010`.

### R3. Personas & DPM Native TypeSpec Decorators (Phase 4)
Implement `@personaCapability` and `@pseudonymize` decorators in `@oa-sdk/typespec-decorators` (with TypeScript AST / compiler implementations). Emit OpenAPI extension payloads (`x-oa-sdk-persona-traits`, `x-oa-sdk-dpm-projection`) so that `@oa-sdk/personas` and `@oa-sdk/dpm` pipelines consume contracts directly from TypeSpec definitions.

### R4. Monorepo Governance, CLI Documentation & Gates
Register all new commands in `packages/codegen/src/cli/commands.ts` and document them in `docs/guides/cli-command-reference.md`. Ensure all tests, `pnpm check:docs`, and `pnpm schema:typespec-check` pass with 100% compliance.

## Acceptance Criteria

### Semantic Diff (Phase 2)
- [ ] `oa-gen tsp diff --base <ref> --head <ref>` accurately classifies breaking vs non-breaking changes from TypeSpec AST.
- [ ] Exits with code 1 when breaking changes are detected with `--fail-on-breaking`.
- [ ] Unit and integration tests cover operation removal, field deletion, and newly required fields.

### Instant Mock (Phase 3)
- [ ] `oa-gen mock --tsp packages/schemas/typespec/main.tsp` launches an HTTP server without requiring prior `pnpm build:merged`.
- [ ] Responds to valid mock requests matching schema status codes and example values.
- [ ] File watcher detects `.tsp` modifications and updates in-memory routes without restart.

### Personas & DPM Decorators (Phase 4)
- [ ] `@personaCapability` accepts valid capability traits from `skill.yaml` (rejecting unknown traits).
- [ ] `@pseudonymize` attaches column/field pseudonymization rules into emitted extensions.
- [ ] `pnpm personas:check` and DPM validation gates accept the TypeSpec-emitted extensions.

### Governance & Verification
- [ ] `pnpm check:docs` passes with 0 errors across all gates.
- [ ] `pnpm schema:typespec-check` passes with zero drift.
- [ ] All package test suites pass under `turbo run test`.

