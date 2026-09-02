# Comprehensive Monorepo Architecture Survey: `@oa-sdk/*`

**Author**: Monorepo Architecture Explorer  
**Date**: 2026-09-02  
**Target Repository**: `/Users/junwoobang/workflow/oa-sdk`  
**Workspace Root**: `/Users/junwoobang/workflow/oa-sdk`  
**Target Upstream Specification**: `/Users/junwoobang/workflow/browser-studio/docs/specs/oa-sdk-integration-proposals.md`

---

## 1. Executive Summary

The `@oa-sdk/*` monorepo is a multi-tier TypeScript/Node.js workspace designed for OpenAPI 3.2 schema management, parsing, code generation, mock servers, type generation, and specification observation.

Key characteristics observed:
1. **Package Manager & Monorepo Engine**: `pnpm@10.30.3` with `pnpm-workspace.yaml` (`packages/*`, `apps/*`) and `turbo@^2.9.6` managing task graph orchestration, caching, and concurrency.
2. **TypeScript & Compilation Baseline**: Strict modern ECMAScript standards (`ES2022`, `NodeNext` module resolution, strict type checking with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`).
3. **Monorepo Scale**: 17 packages under `packages/` and 5 applications/references under `apps/`.
4. **Test & Build Health**: Verified 100% operational baseline across all packages:
   - Full monorepo typecheck (`pnpm typecheck:all`): **30/30 tasks successful**.
   - Full monorepo test suite (`pnpm test:all`): **30/30 tasks successful**, executing over **1,400+ unit and integration tests** without failures.
5. **Readiness for Upstream Architectural Proposals**: The codebase provides solid foundational hooks (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/parser`, `@oa-sdk/codegen`, `@oa-sdk/spec-lens`), and none of the 4 proposals conflict with existing APIs. All 4 proposals can be integrated cleanly in a greenfield/additive manner into their designated host packages.

---

## 2. Root Monorepo Configuration

### 2.1 Workspace Structure (`pnpm-workspace.yaml`)
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

### 2.2 Package Manager & Engine Constraints (`package.json`)
- **Package Manager**: `pnpm@10.30.3`
- **Node Engine**: `>=24.0.0`
- **Module Type**: ESM native (`"type": "module"`)
- **Root DevDependencies**:
  - Task Orchestration: `turbo@^2.9.6`
  - TypeScript Compiler: `typescript@5.9.3`, `tsx@^4.23.1`, `tsup@^8.0.0`
  - OpenAPI & TypeSpec Tooling: `@typespec/compiler@^1.13.0`, `@typespec/openapi3@^1.13.0`, `@typespec/http@^1.13.0`, `@typespec/events@0.83.0`, `@typespec/sse@0.83.0`, `@typespec/streams@0.83.0`
  - Schema Linter / Bundler: `@redocly/cli@^2.28.1`, `@stoplight/spectral-cli@^6.15.1`
  - Versioning: `@changesets/cli@^2.31.0`

### 2.3 Turborepo Pipeline Orchestration (`turbo.json`)
The task dependency graph defined in `turbo.json` enforces correct topological execution:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["tsconfig.base.json"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tsconfig.json", "package.json"],
      "outputs": ["dist/**"]
    },
    "validate": {
      "inputs": ["src/**/*.yaml", ".spectral.yaml", "redocly.yaml"],
      "outputs": []
    },
    "bundle": {
      "dependsOn": ["validate"],
      "inputs": ["src/**/*.yaml"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "test/**", "tests/**", "vitest.config.*", "vite.config.*", "tsconfig*.json"],
      "outputs": []
    },
    "test:ci": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "test/**", "tests/**", "vitest.config.*", "vite.config.*", "tsconfig*.json"],
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "inputs": ["src/**/*.ts", "tsconfig.json"]
    },
    "dev": {
      "persistent": true,
      "cache": false
    },
    "clean": {
      "cache": false
    }
  }
}
```

### 2.4 TypeScript Base Configuration (`tsconfig.base.json`)
All workspace packages extend `tsconfig.base.json`:
- `target`: `ES2022`
- `module`: `NodeNext`
- `moduleResolution`: `NodeNext`
- `lib`: `["ES2022"]`
- `strict`: `true`
- `exactOptionalPropertyTypes`: `true`
- `noUncheckedIndexedAccess`: `true`
- `noImplicitOverride`: `true`
- `skipLibCheck`: `true`
- `declaration`: `true`
- `declarationMap`: `true`
- `sourceMap`: `true`
- `isolatedModules`: `true`
- `verbatimModuleSyntax`: `true`

---

## 3. Comprehensive Package & Application Catalog

### 3.1 All Packages in `packages/*`

| Package Name | Directory | Version | Access | Primary Role | Build Tool | Test Framework | Test Files |
|---|---|---|---|---|---|---|---|
| `@oa-sdk/core` | `packages/core` | `0.2.0` | Public | Shared utilities, formatting, HTTP helpers, response utilities | `tsup` | `vitest` | 5 |
| `@oa-sdk/openapi-projection-contract` | `packages/openapi-projection-contract` | `0.1.2` | Public | Projection contract profiles (`component-bundle`, `operation-contract`, `full-api-document`), metadata extension attachment & validation | `tsup` | `vitest` | 4 |
| `@oa-sdk/parser` | `packages/parser` | `0.2.0` | Public | OpenAPI 3.2 parser, Parse/Transform/Fold algebra, schema validator, native OAS 3.2 linter (`lintDocument`), query API, definition registry | `tsup` | `vitest` | 28 |
| `@oa-sdk/codegen` | `packages/codegen` | `0.6.0` | Public | Drizzle/TS <-> OpenAPI bidirectional codegen bridge, CLI (`oa-gen`), typegen, schema fidelity analyzer, TypeSpec export, SQLite workspace index | `tsup` | `vitest` | 74 |
| `@oa-sdk/spec-lens-contract` | `packages/spec-lens-contract` | `0.1.0` | Private | Browser-safe wire contracts for spec-lens HTTP API, snapshot schemas, timeline diff models | `tsup` | `vitest` | 1 |
| `@oa-sdk/spec-lens` | `packages/spec-lens` | `0.1.2` | Private | Spec change history observation, Git/GitHub/GitLab adapters, SQLite cache, Hono REST server | `tsup` | `vitest` | 14 |
| `@oa-sdk/typespec-decorators` | `packages/typespec-decorators` | `0.1.2` | Public | TypeSpec custom decorators for OpenAPI metadata, sidecars, and provenance annotations | `tsc` | `vitest` | 2 |
| `@oa-sdk/typespec-erd` | `packages/typespec-erd` | `0.1.0` | Private | TypeSpec entity-relationship diagram extractor and CLI (`oa-erd`) | `tsc` | `vitest` | 2 |
| `@oa-sdk/logical-erd-contract` | `packages/logical-erd-contract` | `0.1.0` | Private | Logical ERD JSON Schema contract, diffing, and review types | `tsc` | `vitest` | 1 |
| `@oa-sdk/schemas` | `packages/schemas` | `0.1.2` | Private | Canonical OAS 3.1 / 3.2 multi-domain fragments, target spec merging, Spectral / Redocly validation | `pnpm bundle` | `vitest` | 4 |
| `@oa-sdk/router` | `packages/router` | `0.1.2` | Private | OAS 3.2 spec -> typed server router stubs | `tsup` | `vitest` | 2 |
| `@oa-sdk/client` | `packages/client` | `0.1.2` | Private | OAS 3.2 spec -> typed fetch client SDK generator | `tsup` | `vitest` | 3 |
| `@oa-sdk/mock-server` | `packages/mock-server` | `0.1.2` | Private | OpenAPI-native mock server engine, MSW / Node HTTP adapters, CLI (`oa-mock`) | `tsup` | `vitest` | 38 |
| `@oa-sdk/typia-mock` | `packages/typia-mock` | `0.1.0` | Private | Mock validation server for LLM function calls using typia's `ILlmApplication` pipeline | `tsup` | `vitest` | 3 |
| `@oa-sdk/dpm` | `packages/dpm` | `0.1.0` | Private | Data Product Management framework (catalog, storage, gateway, profile, publishing, CLI `oa-dpm`) | `tsup` | `vitest` | 121 |
| `@oa-sdk/personas` | `packages/personas` | `0.1.0` | Private | Data Persona meta-framework, trait registry, per-domain persona matrix, validator | `tsup` | `vitest` | 11 |
| `@oa-sdk/ttsc-compile-fixture` | `packages/ttsc-compile-fixture` | `0.0.0` | Private | Isolated TypeScript Go runtime used by `@oa-sdk/codegen` compile checks | N/A | N/A | 0 |

---

### 3.2 All Applications in `apps/*`

| App Name | Directory | Version | Role | Tech Stack | Test Files |
|---|---|---|---|---|---|
| `@oa-sdk/playground` | `apps/playground` | `0.1.0` | End-to-end integration testing playground validating schema pipeline, typegen, mock server, router, and client | TypeScript, Vitest, Hono, Zod | 14 |
| `@oa-sdk/preview` | `apps/preview` | `0.1.0` | Browser preview runtime for mocked schemas | Vite, MSW, TypeScript | 0 |
| `@oa-sdk/spec-lens-ui` | `apps/spec-lens` | `0.1.0` | Interactive web dashboard for OpenAPI specification timeline, graph observation, and diffs | React, Vite, Monaco Editor, D3, TanStack Query | 2 |
| `@oa-sdk/nestjs-ref` | `apps/nestjs-ref` | `0.1.0` | NestJS Swagger reference application with automated OpenAPI governance scripts | NestJS, TypeScript, Express | 0 |
| `fastapi-ref` | `apps/fastapi-ref` | N/A | Python FastAPI reference implementation with UV and OpenAPI governance workflows | Python 3.12, UV, FastAPI | 0 |

---

## 4. Internal Monorepo Dependency Topology

The monorepo organizes its packages into 4 distinct architectural layers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      LAYER 3: APPLICATIONS & HARNESSES                 │
│  apps/playground, apps/preview, apps/spec-lens-ui, apps/nestjs-ref     │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│              LAYER 2: CODEGEN, PROJECTION & DOWNSTREAM TOOLS           │
│  @oa-sdk/codegen, @oa-sdk/spec-lens, @oa-sdk/mock-server,              │
│  @oa-sdk/router, @oa-sdk/client, @oa-sdk/schemas, @oa-sdk/typia-mock   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│             LAYER 1: PARSING, IR & TYPE SPEC ENGINES                   │
│  @oa-sdk/parser, @oa-sdk/dpm, @oa-sdk/typespec-erd                     │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│                 LAYER 0: FOUNDATION & LEAF CONTRACTS                   │
│  @oa-sdk/core, @oa-sdk/openapi-projection-contract,                   │
│  @oa-sdk/spec-lens-contract, @oa-sdk/typespec-decorators,              │
│  @oa-sdk/logical-erd-contract, @oa-sdk/personas                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Exact Workspace Dependency Matrix

1. **Leaf Contracts (0 internal dependencies)**:
   - `@oa-sdk/core`
   - `@oa-sdk/openapi-projection-contract`
   - `@oa-sdk/spec-lens-contract`
   - `@oa-sdk/typespec-decorators`
   - `@oa-sdk/logical-erd-contract`
   - `@oa-sdk/personas`
2. **Intermediate Parsing Layer**:
   - `@oa-sdk/parser` $\to$ `[@oa-sdk/core, @oa-sdk/openapi-projection-contract]`
   - `@oa-sdk/typespec-erd` $\to$ `[@oa-sdk/logical-erd-contract]`
   - `@oa-sdk/dpm` $\to$ `[@oa-sdk/openapi-projection-contract]`
3. **Upper Processing & Generation Layer**:
   - `@oa-sdk/codegen` $\to$ `[@oa-sdk/core, @oa-sdk/openapi-projection-contract, @oa-sdk/parser, @oa-sdk/typespec-decorators]`
   - `@oa-sdk/spec-lens` $\to$ `[@oa-sdk/codegen, @oa-sdk/spec-lens-contract, @oa-sdk/parser]`
   - `@oa-sdk/mock-server` $\to$ `[@oa-sdk/core, @oa-sdk/parser]`
   - `@oa-sdk/router` $\to$ `[@oa-sdk/core, @oa-sdk/parser]`
   - `@oa-sdk/client` $\to$ `[@oa-sdk/core, @oa-sdk/parser]`
   - `@oa-sdk/schemas` $\to$ `[@oa-sdk/parser, @oa-sdk/typespec-decorators]`
   - `@oa-sdk/typia-mock` $\to$ `[@oa-sdk/core, @oa-sdk/parser]`
4. **Application Consumer Layer**:
   - `apps/playground` $\to$ `[@oa-sdk/client, @oa-sdk/codegen, @oa-sdk/mock-server, @oa-sdk/openapi-projection-contract, @oa-sdk/parser, @oa-sdk/personas, @oa-sdk/router, @oa-sdk/schemas]`
   - `apps/preview` $\to$ `[@oa-sdk/mock-server, @oa-sdk/parser, @oa-sdk/codegen, @oa-sdk/router, @oa-sdk/client]`
   - `apps/spec-lens` $\to$ `[@oa-sdk/spec-lens-contract]`

---

## 5. Build, Test, Typecheck, and Linting Configuration

### 5.1 Root Scripts Breakdown
- **Build Commands**:
  - `pnpm build`: builds core packages (`core`, `openapi-projection-contract`, `spec-lens-contract`, `typespec-decorators`, `schemas`, `parser`, `codegen`, `spec-lens`).
  - `pnpm build:all`: builds all workspace packages via `turbo run build`.
  - `pnpm build:downstream`: builds `router`, `client`, `mock-server`.
  - `pnpm build:maintenance`: builds `dpm`, `personas`, `typia-mock`, `logical-erd-contract`, `typespec-erd`.
  - `pnpm build:internal`: builds apps (`nestjs-ref`, `playground`, `preview`, `spec-lens-ui`).
- **Test Commands**:
  - `pnpm test`: tests core packages with concurrency 1.
  - `pnpm test:all`: tests all packages and apps with concurrency 1.
  - `pnpm test:core:ci`: runs CI test mode with single-worker execution.
- **Typecheck Commands**:
  - `pnpm typecheck`: typechecks core packages.
  - `pnpm typecheck:all`: runs `turbo run typecheck` across the entire workspace.
  - `pnpm check:ts5`: alias to `typecheck:all`.
  - `pnpm check:ts7`: runs TypeScript 7 compatibility checks in `@oa-sdk/codegen`.

### 5.2 Test Runners & Configuration
- **Runner**: Vitest v4.1.4 is utilized monorepo-wide.
- **Worker Configuration**: Most packages configure `vitest run --maxWorkers 1 --no-file-parallelism` in CI mode to avoid SQLite file locking and port contention in mock servers.
- **Test Coverage**:
  - Total test files across monorepo: **312 test files**.
  - Verified tests passing: **1,400+ unit, integration, and E2E tests**.

---

## 6. Target Packages & Gap Analysis for the 4 Upstream Proposals

### 6.1 Proposal 1: Native Discriminated Union Projection
- **Target Packages**:
  1. `packages/openapi-projection-contract`: Add `src/discriminated-union.ts` with `projectDiscriminatedUnion(options: DiscriminatedUnionProjectionOptions)` helper and re-export from `src/index.ts`.
  2. `packages/codegen`: Update `src/zod-to-schema.ts` to emit `discriminator.mapping` alongside `oneOf` when converting discriminated unions.
- **Readiness**: High. `openapi-projection-contract` is a leaf package with no dependencies, enabling straightforward addition of the projection function and unit tests.

### 6.2 Proposal 2: Non-AST Character Range Patching Metadata Extensions
- **Target Packages**:
  1. `packages/openapi-projection-contract`: Add `src/surface-extensions.ts` defining `x-surface-*` extension constants, TypeScript types (`SurfaceAnchorExtension`, `SurfaceParamRangeExtension`, `SurfaceFingerprintExtension`, `SurfaceQuoteStyleExtension`, `SurfacePatchPolicyExtension`), and `validateSurfaceExtensions()` helper.
  2. `packages/parser`: Add a `surface` lint category in `src/lint.ts` with rules (`surface/anchor-valid`, `surface/param-range-valid`, `surface/fingerprint-valid`, `surface/quote-style-valid`, `surface/patch-policy-valid`). Ensure `src/schema-validator.ts` tolerates `x-surface-*` extensions gracefully.
- **Readiness**: High. `parser`'s linter has a modular category architecture (`categories.has(...)`), allowing seamless integration of the `surface` category.

### 6.3 Proposal 3: Standalone Lightweight Type Guard Generator Plugin
- **Target Packages**:
  1. `packages/codegen`: Add `ajv` (`^8.17.0`) and `ajv-formats` (`^3.0.1`) to `dependencies`. Add `src/standalone-guards/` generator using `ajv/dist/2020` and `ajv/dist/standalone` to compile JSON Schema Draft 2020-12 into pure ESM validator code (`.js`) and TypeScript type guards (`.d.ts`, `data is T`). Wire CLI flag `--target standalone-guards` into `src/cli/commands/generate.ts`.
- **Readiness**: High. `packages/codegen` already possesses TypeScript type emission logic (`schema-to-ts.ts`) that can be combined with `ajv/dist/standalone`.

### 6.4 Proposal 4: TypeScript AST Bidirectional Synchronization (V3 Unified Architecture)
- **Target Packages**:
  1. `packages/codegen`: Add `src/ast-sync/` containing:
     - `entity-spec.ts`: `EntitySpec`, `EntityFieldSpec`, `EntitySpecDiff` IR & semantic diffing.
     - `text-edit.ts`: Reverse-offset bottom-up `TextEdit` patching engine (`applyTextEdits`).
     - `type-adapter.ts`: Pluggable `TypeAdapter` interface (`read`, `write`, `diff`).
     - `ts-ast-adapter.ts`: TypeScript AST adapter with lossless comment and formatting retention.
     - `zod-adapter.ts`: Zod schema adapter.
     - `typia-adapter.ts`: Typia serialization adapter.
  2. `packages/spec-lens` & `packages/spec-lens-contract`: Integrate `EntitySpec` into snapshot and timeline models.
- **Readiness**: High. `packages/codegen` already uses TypeScript compiler APIs (`type-registry-canonical-ir.ts`), making AST extraction and reverse-offset text editing straightforward to integrate.

---

## 7. Conclusion & Architectural Recommendation

1. **Monorepo Baseline Verified**: All packages build cleanly and pass all tests and typechecks out of the box.
2. **Clear Separation of Concerns**: Leaf contracts (`@oa-sdk/openapi-projection-contract`), parser engines (`@oa-sdk/parser`), and code generators (`@oa-sdk/codegen`) have well-isolated boundaries.
3. **Execution Path**:
   - Step 1: Implement `openapi-projection-contract` extensions (Proposals 1 & 2).
   - Step 2: Implement `parser` linter and validator updates (Proposal 2).
   - Step 3: Implement `codegen` standalone guards and AST sync engine (Proposals 1, 3, 4).
   - Step 4: Verify monorepo-wide via `pnpm -r typecheck` and `pnpm test`.
