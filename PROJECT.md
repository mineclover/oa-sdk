# Project: Multi-Framework Router Stubs, Target-Separated Onboarding Engine, and Live Mock Hot-Reload

## Architecture
- **Layer 0: TypeSpec-First Schema Authority (`packages/schemas/typespec/`)**:
  - Authoritative Single Source of Truth (SSOT) using TypeSpec (`*.tsp`) for all production API contracts per ADR-009.
  - Zero handwritten edits to `.merged*.yaml`, `dist/`, or generated snapshots.
  - In-memory TypeSpec compilation and live watch (`oa-gen mock --tsp ... --watch`), AST semantic diff (`oa-gen tsp diff`), and snapshot baseline approval (`pnpm schema:approve-typespec-reference`).
- **Layer 1: Multi-Framework Router Stubs & Pure Handler Contracts (`@oa-sdk/router`)**:
  - Deconstructed modular topology separating pure TypeScript business logic contracts from framework runtime mounting.
  - `src/contracts/handler-contract.ts`: `generateHandlerContract(spec, options)` generating standalone `*.contract.ts` files with context interfaces (`GetUserContext`), typed handler signatures (`GetUserHandler`), and aggregate interface `ApiHandlers`.
  - `src/targets/{fastify,elysia,hono,express}.ts`: Target-specific framework route binders.
    - **Fastify Target** (`fastify.ts`): Emits idiomatic `FastifyPluginAsync` with route `schema: { params, querystring, body, response }` for JIT acceleration (`fast-json-stringify` & `Ajv`), supporting standard verbs plus OAS 3.2 `QUERY`, `HEAD`, `TRACE`.
    - **Bun Elysia Target** (`elysia.ts`): Emits `new Elysia().get().post()` builder method chaining with selective zero-copy context destructuring (`{ params, query, body, set }`).
    - **Modernized Hono & Express Targets**: Preserves 100% backward compatibility with legacy inline stub generation when `contractImport` is omitted, while supporting contract-bound router factories (`createRouter(handlers: ApiHandlers)`) when `contractImport` is specified.
  - `src/common/{route-utils,body-parser,querystring-helper,response-headers,jsdoc}.ts`: Shared AST formatting, parameter extraction, and serialization helpers.
  - **Zero Framework Runtime Leaks**: `@oa-sdk/router` has 0 framework runtime dependencies in `package.json`.
- **Layer 2: Target-Separated Interactive Onboarding Engine (`oa-gen init`) (`@oa-sdk/codegen`)**:
  - Target Strategy Pattern in `packages/codegen/src/cli/lib/init/targets/` with `TargetProfile` interface implemented by 6 mutually exclusive targets: `fastify.ts`, `elysia.ts`, `hono.ts`, `express.ts`, `nestjs.ts`, `generic.ts`.
  - **Strict Runtime Isolation**: Bun/Elysia targets strictly inject Bun native scripts (`bun --watch`, `bun x`) with 0 Node tooling (`tsx`, `nodemon`); Node/Fastify targets inject Node ESM scripts (`tsx watch`) and Fastify-specific `oa.config.ts`.
  - `common/schema-detector.ts`: Agnostic discovery of `.tsp`, `openapi.yaml`, `openapi.json`, and `@oaOperation` JSDoc annotations across nested directories with confidence scoring.
  - `common/package-patcher.ts`: Non-destructive `package.json` merge preserving indentation (2-space, 4-space, tabs), line endings (CRLF/LF), trailing newlines, and guarding existing user scripts against silent overwrites unless `--force` is used.
- **Layer 3: Live OpenAPI & Source Route Hot-Reload (`oa-gen mock --watch`) (`@oa-sdk/codegen` & `@oa-sdk/mock-server`)**:
  - `packages/codegen/src/cli/lib/spec-watcher.ts`: Monitors OpenAPI specification files (`.yaml`, `.json`) and TypeScript source files with `@oaOperation` JSDoc annotations.
  - Debounces file system events, re-parses documents, and isolates syntax errors so invalid edits do not crash the mock server.
  - Invokes `@oa-sdk/mock-server`'s atomic `server.updateSpec(newDoc)` to hot-swap routing state without socket drops, port rebinding, or process restarts.
- **Layer 4: Monorepo Governance & Verification Gates**:
  - Documentation and command governance: `pnpm check:docs`, `pnpm check:cli-spec`, `pnpm check:api-index`, `pnpm check:release-policy`, `pnpm typecheck:all`.

## Code Layout
- `packages/router/src/contracts/handler-contract.ts`: Pure TypeScript handler contract generator (`generateHandlerContract`).
- `packages/router/src/targets/fastify.ts`: FastifyPluginAsync binder with JIT schema inlining and OAS 3.2 verbs.
- `packages/router/src/targets/elysia.ts`: Bun Elysia builder chaining and zero-copy context destructuring.
- `packages/router/src/targets/hono.ts`: Hono target with legacy stub and contract-binding modes.
- `packages/router/src/targets/express.ts`: Express target with legacy stub and contract-binding modes.
- `packages/router/src/common/route-utils.ts`: Parameter and path formatting helpers.
- `packages/router/src/common/body-parser.ts`: Content-type specific body parsing expressions.
- `packages/router/src/common/querystring-helper.ts`: OAS 3.2 raw querystring handling.
- `packages/router/src/common/response-headers.ts`: Response header serialization helpers.
- `packages/router/src/common/jsdoc.ts`: Safe JSDoc comment formatting.
- `packages/router/src/generate-router-renderer.ts`: Master router orchestration delegating to targets.
- `packages/router/src/index.ts` & `browser.ts`: Public router exports including `generateHandlerContract`.
- `packages/codegen/src/cli/commands/init.ts`: `oa-gen init` command entry point.
- `packages/codegen/src/cli/commands.ts`: CLI command registry including `init`.
- `packages/codegen/src/cli/lib/init/types.ts`: `TargetProfile`, `InitOptions`, `PackagePatchResult` interfaces.
- `packages/codegen/src/cli/lib/init/index.ts`: Master init orchestrator (`runInit`).
- `packages/codegen/src/cli/lib/init/common/schema-detector.ts`: Multi-format schema detection engine.
- `packages/codegen/src/cli/lib/init/common/package-patcher.ts`: Non-destructive `package.json` patcher.
- `packages/codegen/src/cli/lib/init/targets/`: 6 framework target strategies (`fastify.ts`, `elysia.ts`, `hono.ts`, `express.ts`, `nestjs.ts`, `generic.ts`).
- `packages/codegen/src/cli/lib/spec-watcher.ts`: Multi-format file watcher and atomic hot-reload dispatcher.
- `packages/codegen/src/cli/commands/mock.ts`: Extended `oa-gen mock` integrating `spec-watcher`.
- `docs/guides/cli-command-reference.md`: CLI documentation for `init` and `mock --watch`.
- `docs/internal/api-index.md`: API index documentation for `@oa-sdk/router`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Modular Router Topology | Deconstructs `generate-router-renderer.ts` into contracts, targets, and common helpers | M1 | Survey 1 |
| 2 | Pure TypeScript Handler Contracts | `generateHandlerContract` emits decoupled `*.contract.ts` with typed context & `ApiHandlers` | M1 | Survey 1 |
| 3 | Fastify JIT Schema Route Target | Emits `FastifyPluginAsync` with inlined `schema: { params, querystring, body, response }` | M1 | Survey 1 |
| 4 | OAS 3.2 Verbs in Fastify | Full support for `QUERY`, `HEAD`, `TRACE` via `fastify.route` | M1 | Survey 1 |
| 5 | Bun Elysia Chaining Target | Emits `new Elysia().get().post()` builder method chaining | M1 | Survey 1 |
| 6 | Elysia Zero-Copy Context Destructuring | Selectively destructures `{ params, query, body, set }` to prevent unused variable errors | M1 | Survey 1 |
| 7 | Hono & Express Contract Binding | Modernizes Hono & Express to bind to `ApiHandlers` | M1 | Survey 1 |
| 8 | Hono & Express Backward Compatibility | Preserves 100% byte-for-byte legacy inline stub generation when `contractImport` is omitted | M1 | Survey 1 |
| 9 | Zero Framework Runtime Dependencies | `@oa-sdk/router` has 0 framework runtime dependencies in `package.json` | M1 | Survey 1 |
| 10 | Target Strategy Pattern for Onboarding | `TargetProfile` interface and 6 mutually exclusive framework targets in `@oa-sdk/codegen` | M2 | Survey 2 |
| 11 | Strict Runtime Isolation in Onboarding | Bun/Elysia gets Bun-native scripts (`bun --watch`); Node/Fastify gets Node ESM scripts (`tsx watch`) | M2 | Survey 2 |
| 12 | Agnostic Schema Detection Engine | `schema-detector.ts` locates `.tsp`, `openapi.yaml`, `openapi.json`, and `@oaOperation` JSDoc | M2 | Survey 2 |
| 13 | Non-Destructive Package Patcher | `package-patcher.ts` preserves formatting, indentation, line endings, and protects user scripts | M2 | Survey 2 |
| 14 | `oa-gen init` CLI Command | Interactive & headless onboarding CLI with `--target`, `--yes`, `--cwd`, `--spec`, `--force` | M2 | Survey 2 |
| 15 | Live OpenAPI Spec Watcher | `spec-watcher.ts` monitors `.yaml`, `.yml`, `.json` and triggers hot-reload | M3 | Survey 3 |
| 16 | TypeScript `@oaOperation` Hot-Reload | `spec-watcher.ts` parses `@oaOperation` JSDoc in `.ts` files and builds in-memory OasDocument | M3 | Survey 3 |
| 17 | Atomic Socket-Preserving Mock Hot-Swap | Calls `server.updateSpec(newDoc)` without socket drops, port rebinding, or process restarts | M3 | Survey 3 |
| 18 | Mock Watcher Error Shielding | Syntax/parse errors in watched files do not crash the mock server; existing routes stay active | M3 | Survey 3 |
| 19 | Monorepo Governance Gates Compliance | Passes `pnpm check:docs`, `pnpm check:cli-spec`, `pnpm check:api-index`, `pnpm check:release-policy` | M4 | Survey 3 |
| 20 | Monorepo Full Test & Typecheck Pass | Passes `pnpm test` and `pnpm typecheck:all` across all packages | M4 | Survey 3 |
| 21 | Opaque-Box E2E Testing Suite (Tiers 1-4) | Comprehensive requirement-driven tests covering Features 1-20 | E2E | Project Pattern |
| 22 | Adversarial Hardening & Forensic Audit | White-box stress testing, edge-case generation, and clean integrity audit | Final | Project Pattern |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Requirement-driven test suite (Tiers 1-4) covering Features 1-20, publishing TEST_READY.md | None | DONE |
| M1 | Multi-Framework Router Stubs & Handler Contracts | Features 1-9: Modular router topology, handler contracts, Fastify JIT, Elysia chaining, Hono/Express modernize | None | DONE |
| M2 | Target-Separated Onboarding Engine (`oa-gen init`) | Features 10-14: Target Strategy Pattern, runtime isolation, schema-detector, package-patcher, init CLI | None | DONE |
| M3 | Live OpenAPI & Route Hot-Reload (`mock --watch`) | Features 15-18: `spec-watcher.ts`, atomic server.updateSpec hot-swap, error shielding | None | DONE |
| M4 | Monorepo Governance Gates & Build Verification | Features 19-20: API index, doc gates, cli-spec, release policy, full typecheck | M1, M2, M3 | DONE |
| Final | 100% E2E Pass, Adversarial Hardening & Audit | Features 21-22: Pass 100% of E2E suite, Tier 5 hardening, Forensic Integrity Audit | M1, M2, M3, M4, E2E | DONE |

## Interface Contracts

### `@oa-sdk/router` Handler Contract Generator
```typescript
// In packages/router/src/contracts/handler-contract.ts
export interface HandlerContractOptions {
  typesImport?: string
  banner?: boolean
  contractName?: string
}

export function generateHandlerContract(
  spec: OasDocument | ParsedDocument,
  options?: HandlerContractOptions & { basePath?: string },
): string
```

### `@oa-sdk/router` Router Options & Target Renderers
```typescript
// In packages/router/src/generate-router-renderer.ts
export type RouterTarget = 'hono' | 'express' | 'fastify' | 'elysia'
export type RouterMode = 'stub' | 'contract'

export interface RouterRenderOptions {
  target?: RouterTarget
  mode?: RouterMode
  typesImport?: string
  contractImport?: string
  contractName?: string
  banner?: boolean
}
```

### `@oa-sdk/codegen` Onboarding Target Profile
```typescript
// In packages/codegen/src/cli/lib/init/types.ts
export interface TargetProfile {
  readonly id: TargetFrameworkId
  readonly displayName: string
  readonly description: string
  readonly defaultRuntime: TargetRuntime
  detect(cwd: string): Promise<TargetDetectionResult>
  generateConfig(options: TargetGenerateOptions): Promise<string>
  getRecommendedScripts(options: TargetGenerateOptions): Record<string, string>
  getRecommendedDependencies(options: TargetGenerateOptions): RecommendedDependencies
}
```

### `@oa-sdk/codegen` Live Spec Watcher
```typescript
// In packages/codegen/src/cli/lib/spec-watcher.ts
export interface SpecWatcherOptions {
  debounceMs?: number
  onChange: (doc: OasDocument, context: { filePath: string; format: SpecFileFormat }) => Promise<void> | void
  onError?: (error: unknown, filePath: string) => void
}

export interface SpecWatcher {
  close(): void
  readonly watchedDirs: readonly string[]
  readonly targetFiles: readonly string[]
}

export function watchSpec(targetPath: string, options: SpecWatcherOptions): SpecWatcher
export function parseSpecDocument(filePath: string): Promise<{ document: OasDocument; format: SpecFileFormat }>
```
