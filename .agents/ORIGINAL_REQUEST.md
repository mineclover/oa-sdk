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
