# Project: TypeSpec Ecosystem Expansion (Phases 2, 3, 4)

## Architecture
- **Layer 1: TypeSpec Modeling & Decorators (`@oa-sdk/typespec-decorators`)**:
  - `@personaCapability` decorator validating against 24 traits from `packages/personas/src/traits/skill.yaml` and emitting `x-oa-sdk-persona-traits`.
  - `@pseudonymize` decorator enforcing DPM safety rules (`SAF001`, `SAF002`, `SAF010`) and emitting `x-oa-sdk-dpm-projection`.
- **Layer 2: In-Memory Compiler & Semantic Engine (`@oa-sdk/codegen`)**:
  - Semantic AST Diff: parses base and head TypeSpec programs via `@typespec/compiler`, `@typespec/http`, and `@typespec/openapi`. Extracts operations and models into normalized semantics, classifies breaking vs non-breaking changes across 7 categories, supports git refs and local files.
  - In-Memory Zero-Disk Compiler: compiles TypeSpec directly to OpenAPI 3.2 in-memory via `@typespec/compiler` (`noEmit: true`) and `@typespec/openapi3` (`getOpenAPI3`), avoiding intermediate YAML disk writes.
  - Multi-token CLI routing: supports compound commands like `oa-gen tsp diff` and single-token aliases `tsp-diff`.
- **Layer 3: Runtime Mock Server (`@oa-sdk/mock-server`)**:
  - `NodeMockServer.updateSpec(nextSpec)` allows atomic replacement of routing/validation state while keeping the HTTP listener alive on port 4010 without dropped connections.
  - Watch mode (`--watch`) leverages `node:fs.watch` and incremental `@typespec/compiler` recompilation (~360ms) to trigger `updateSpec` dynamically.
- **Layer 4: Downstream Validation & Governance (`@oa-sdk/personas`, `@oa-sdk/dpm`, `@spec-platform/document-gates`)**:
  - `@oa-sdk/personas`: extracts `x-oa-sdk-persona-traits` during `pnpm personas:check` and verifies persona capability fulfillment.
  - `@oa-sdk/dpm`: consumes `x-oa-sdk-dpm-projection` and verifies data-binding safety against schema projections.
  - Governance Gates: `createCliReferenceGate`, `createCliExampleGate`, `pnpm check:docs`, and `pnpm schema:typespec-check`.

## Code Layout
- `packages/codegen/src/cli/commands/tsp-diff.ts`: CLI command handler for `oa-gen tsp diff`.
- `packages/codegen/src/cli/lib/typespec-ast-diff.ts`: Semantic AST diff extraction and classification engine.
- `packages/codegen/src/cli/lib/typespec-ref-resolver.ts`: Resolver for git refs (`HEAD~1`) and file paths.
- `packages/codegen/src/cli/commands/mock.ts`: CLI command handler for `oa-gen mock --tsp`.
- `packages/codegen/src/cli/lib/typespec-mock-compiler.ts`: In-memory zero-build TypeSpec compiler and watch loop.
- `packages/codegen/src/cli/index.ts`: Compound subcommand lookahead router.
- `packages/codegen/src/cli/commands.ts`: Central command registry.
- `packages/mock-server/src/adapters/node-http.ts`: `NodeMockServer` with atomic `updateSpec` method.
- `packages/typespec-decorators/lib/decorators.tsp`: TypeSpec extern declarations for `@personaCapability` and `@pseudonymize`.
- `packages/typespec-decorators/src/decorators.ts`: TypeScript compiler implementations for the decorators.
- `packages/typespec-decorators/src/lib.ts`: Diagnostic definitions (`invalid-persona-trait`, `invalid-pseudonymize-rule`, etc.).
- `packages/personas/src/load.ts` & `validate.ts`: Consumption of `x-oa-sdk-persona-traits`.
- `docs/guides/cli-command-reference.md`: Complete documentation of all registered `oa-gen` commands.
- `tests/e2e/`: Requirement-driven E2E test suite.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | In-Memory TypeSpec AST Program Compilation | `compile(NodeHost, path, { noEmit: true })` without disk YAML emission | M1, M2 | Survey 1, 2 |
| 2 | HTTP Operation & Route Extraction | Extract routes, verbs, parameters, status codes from `getAllHttpServices` | M1 | Survey 1 |
| 3 | Model & Property Semantic Traversal | Extract domain models, properties, types, optionality via `navigateProgram` | M1 | Survey 1 |
| 4 | Git Ref & File Path Resolution | Support resolving both file paths and git refs (`HEAD~1`) for base/head | M1 | Survey 1 |
| 5 | 7-Category Breaking Change Classification | Classify removed ops, altered routes/methods, removed models, removed props, newly required props, removed status codes, changed @operationId | M1 | Survey 1 |
| 6 | Non-Breaking Change Classification | Classify added operations, added models, added optional properties, added status codes | M1 | Survey 1 |
| 7 | CLI Command `oa-gen tsp diff` & `--fail-on-breaking` | CLI command exiting with code 1 on breaking changes when requested | M1 | Survey 1 |
| 8 | Multi-token CLI Router | Compound command lookahead for `oa-gen tsp diff` in `packages/codegen/src/cli/index.ts` | M1 | Survey 1 |
| 9 | In-Memory OpenAPI 3.2 Emission | `getOpenAPI3(program, { 'openapi-versions': ['3.2.0'] })` returning in-memory JS doc | M2 | Survey 2 |
| 10 | Direct In-Memory Schema Mocking | Feed in-memory OpenAPI 3.2 doc into `createNodeMockServer` on `localhost:4010` | M2 | Survey 2 |
| 11 | Atomic Route Hot-Reload (`updateSpec`) | `NodeMockServer.updateSpec(nextSpec)` hot-swapping routes without socket drop | M2 | Survey 2 |
| 12 | File Watching & Incremental Recompilation | `--watch` mode using `node:fs.watch` and `compile(..., oldProgram)` in ~360ms | M2 | Survey 2 |
| 13 | CLI Command `oa-gen mock --tsp` | Interactive mock command with `--tsp`, `--watch`, `--port`, `--host` | M2 | Survey 2 |
| 14 | TypeSpec `@personaCapability` Decorator | Decorator on `Operation` validating 24 traits from `skill.yaml` and rejecting unknown traits | M3 | Survey 3 |
| 15 | OpenAPI Extension `x-oa-sdk-persona-traits` | Emitted array under Operation Object with sorted, deduplicated traits | M3 | Survey 3 |
| 16 | TypeSpec `@pseudonymize` Decorator | Decorator on `ModelProperty` enforcing DPM safety (`SAF001`, `SAF002`, `SAF010`) | M3 | Survey 3 |
| 17 | OpenAPI Extension `x-oa-sdk-dpm-projection` | Emitted object under Schema Object property with privacy policy transforms | M3 | Survey 3 |
| 18 | Persona Verification Gate Integration | `loadOperationsFromMergedSpec` and `validate.ts` verifying trait obligations in `pnpm personas:check` | M3 | Survey 3 |
| 19 | DPM Schema & Projection Gate Integration | DPM data-binding and safety validators accepting TypeSpec-emitted projections | M3 | Survey 3 |
| 20 | CLI Command Registration in `commands.ts` | Register `tspDiff`, `mock`, and `generateZod` in `packages/codegen/src/cli/commands.ts` | M4 | Survey 1, 2, 3 |
| 21 | CLI Documentation in `cli-command-reference.md` | Document all commands and options in `docs/guides/cli-command-reference.md` | M4 | Survey 3 |
| 22 | Monorepo Governance Compliance | Pass `pnpm check:docs` (0 errors), `pnpm schema:typespec-check`, `turbo run test` | M4 | Survey 3 |
| 23 | E2E Testing Suite (Tiers 1-4) | Comprehensive opaque-box test suite verifying all features derived from requirements | E2E | Project Pattern |
| 24 | Adversarial Coverage Hardening (Tier 5) | White-box stress testing, edge-case generation, and regression verification | Final | Project Pattern |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Design test harness, runner, and test cases across Tiers 1-4 for all features | None | PLANNED |
| M1 | Phase 2: TypeSpec AST Semantic Diff | Features 1, 2, 3, 4, 5, 6, 7, 8: Diff engine, git ref resolver, CLI `tsp diff`, unit/integration tests | None | PLANNED |
| M2 | Phase 3: Zero-Build Instant Mock Server | Features 1, 9, 10, 11, 12, 13: `updateSpec` in mock-server, in-memory compiler, watch loop, CLI `mock` | None | PLANNED |
| M3 | Phase 4: Personas & DPM Native Decorators | Features 14, 15, 16, 17, 18, 19: `@personaCapability`, `@pseudonymize`, extensions, `personas:check`, DPM gates | None | PLANNED |
| M4 | Monorepo Governance & CLI Documentation | Features 20, 21, 22: `commands.ts`, `cli-command-reference.md`, `pnpm check:docs`, `pnpm schema:typespec-check` | M1, M2, M3 | PLANNED |
| Final | 100% E2E Pass & Tier 5 Hardening | Features 23, 24: Pass 100% E2E tests + Tier 5 adversarial testing + forensic audit | M1, M2, M3, M4, E2E | PLANNED |

## Interface Contracts
### `@oa-sdk/mock-server` ↔ `@oa-sdk/codegen`
```typescript
// In packages/mock-server/src/adapters/node-http.ts
export type NodeMockServer = {
  start(): Promise<void>
  stop(): Promise<void>
  readonly url: string
  override(operationId: string, response: OverrideResponse): void
  clearOverride(operationId: string): void
  clearOverrides(): void
  updateSpec(spec: OasDocument | Record<string, unknown>): { routesCount: number }
}
```

### `@typespec/compiler` ↔ `oa-gen tsp diff`
```typescript
// In packages/codegen/src/cli/lib/typespec-ast-diff.ts
export interface TypeSpecDiffResult {
  baseRef: string
  headRef: string
  breakingChanges: TypeSpecDiffChange[]
  nonBreakingChanges: TypeSpecDiffChange[]
  allChanges: TypeSpecDiffChange[]
  summary: { totalChanges: number; breakingCount: number; nonBreakingCount: number }
}
export function diffTypeSpecSemantics(base: TypeSpecSemantics, head: TypeSpecSemantics, options: { baseRef: string; headRef: string }): TypeSpecDiffResult
```

### `@oa-sdk/typespec-decorators` ↔ Downstream OpenAPI Extensions
```yaml
# paths[path][method]:
x-oa-sdk-persona-traits:
  - pagination
  - filter-by-role

# components.schemas[Model].properties[Prop]:
x-oa-sdk-dpm-projection:
  transform: mask # keep | redact | mask | null | hash | generalize | relationship_token | polymorphic_relationship_token
  role: direct_identifier # optional
  pii: true # optional
  relationship: rel_id # optional
```

### CLI Command Registry ↔ Documentation Gate
- Every command in `packages/codegen/src/cli/commands.ts` MUST have an entry in `docs/guides/cli-command-reference.md` matching `` `oa-gen <name>` `` and listing all option flags.
- Must satisfy `createCliReferenceGate` and `createCliExampleGate` in `scripts/check-docs.ts`.
