# Project: oa-sdk Root Discovery, Declarative Config, Drift Governance & Browser Studio Integration

## Architecture
- **Monorepo Topology**:
  - `packages/core`: Base utilities with zero dependencies. Exports Node module (`dist/index.js`) and browser module (`dist/browser.js`). Hosts `findProjectRoot()`.
  - `packages/codegen`: Code generator, AST transformers, and CLI engine `oa-gen` (using `node:util parseArgs`). Hosts `defineConfig`, config loader, global `--root`/`--project-root` option handling, `generate`, `validate`, `diff`, `check-artifact`, `drift:check`, and `audit:csp`.
  - `packages/openapi-projection-contract`: Profile definitions (`component-bundle`, `operation-contract`, `full-api-document`) and standard extensions (`x-schema-engine-version-hash`, `x-schema-engine-profile`, `x-schema-engine-sources`, `x-schema-engine-refs`).
  - Downstream consumer: `browser-studio` (`/Users/junwoobang/workflow/browser-studio`), linking `@oa-sdk/codegen`, `@oa-sdk/openapi-projection-contract`, and `@oa-sdk/parser`. Contains 5 domain profiles, 29 standalone guards, nested submodule `packages/browser-mapper`.
- **Data Flow & Precedence**:
  1. `findProjectRoot(cwd, explicitRoot)` resolves repository base by checking:
     (1) Explicit CLI flag `--root` / `--project-root`
     (2) Env `OA_PROJECT_ROOT`
     (3) Config file: `oa.config.ts`, `oa.config.mjs`, `oa.config.json`, `.oarc.json`
     (4) Workspace marker: `pnpm-workspace.yaml`, `turbo.json`, `lerna.json`, `package.json` with `workspaces`
     (5) VCS marker: `.git`
     (6) Fallback: `process.cwd()`
     *Submodule Invariant*: Rule 3 (`oa.config.ts`) takes precedence across ancestor traversal before stopping at nested submodule workspace/git markers.
  2. CLI commands receive resolved `projectRoot` and resolve all inputs/outputs relative to it.
  3. `defineConfig` provides typed configuration for `rootDir`, `specs` (domain profile targets), and `guards` (standalone type guards).
  4. Config loader imports `oa.config.ts` via native ESM dynamic import with defensive fallback.
  5. Multi-target generation and validation iterates over configured specs and guards.
  6. Drift detection projects Zod schemas in-memory, computes canonical `x-schema-engine-version-hash` via `stableStringify` + SHA-256, compares with committed artifact, and exits 1 on divergence.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | `findProjectRoot` utility | Upward traversal project root discovery adhering to 6-tier precedence in `@oa-sdk/core` | M1 | survey |
| 2 | Global `--root` / `--project-root` CLI flags | Uniform option parsing across all 24 `oa-gen` commands in `packages/codegen/src/cli/lib/run.ts` | M1 | survey |
| 3 | Core Root Re-export | `@oa-sdk/codegen` re-exports `findProjectRoot` and passes resolved root context | M1 | survey |
| 4 | CLI Spec Check Alignment | Updates to `scripts/check-cli-spec.ts` to recognize global root options without CI breakage | M1 | survey |
| 5 | Declarative `defineConfig` schema | Extended `defineConfig` supporting `rootDir`, `specs` (id, profile, schemaEntry, outDir, title, version), `guards` (outDir, split, moduleFormat, auditCsp), and legacy `schemas` | M2 | survey |
| 6 | Asynchronous Config Loader | Loads `oa.config.ts`, `oa.config.mjs`, `oa.config.json`, `.oarc.json` via dynamic ESM import / JSON parser | M2 | survey |
| 7 | Config-Driven `oa-gen generate` | Running with no args auto-loads config and generates all configured profile specs and standalone guards | M2 | survey |
| 8 | Config-Driven `oa-gen validate` | Running with no args auto-loads config and validates all configured spec targets | M2 | survey |
| 9 | Deterministic Schema Hashing | Bit-for-bit reproducible `x-schema-engine-version-hash` via `stableStringify` of core OpenAPI doc + SHA-256 | M3 | survey |
| 10 | Spec Freshness Check (`drift:check` / `check-artifact`) | Compares source Zod AST projection against committed artifact, exiting non-zero on drift | M3 | survey |
| 11 | Semantic Breaking Diff (`diff --fail-on-breaking`) | Enforces 11 breaking change rules with root path resolution and exit code 1 | M3 | survey |
| 12 | Browser Studio `oa.config.ts` | Complete root configuration for `browser-studio` covering 5 profiles and 29 guards | M4 | survey |
| 13 | Deep Subdirectory Execution Conformance | Verification that `oa-gen validate`, `generate`, `audit:csp` execute from nested directories without relative path errors | M4 | survey |
| 14 | 5 Domain Profiles Generation & Validation | Build and validate `devlink-contracts`, `devlink-mcp`, `surface-engine`, `visual-ir`, `inspector-controls` | M4 | survey |
| 15 | 29 Standalone Guards & CSP Audit | Build 29 standalone guards and confirm 0 CSP violations via `oa-gen audit:csp` | M4 | survey |
| 16 | E2E Conformance & Adversarial Hardening | Pass 100% E2E test suite (Tiers 1-4), 609+ browser-studio tests, monorepo typecheck, and Tier 5 adversarial tests | M5 | survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Root Discovery & CLI Flag Conformance | `@oa-sdk/core` `findProjectRoot`, `@oa-sdk/codegen` global `--root`/`--project-root`, CLI spec alignment | none | DONE (Verified: 100 core tests, 12 codegen tests, 21 packages typecheck, 0 audit violations) |
| M2 | Declarative Config & Pipeline Dispatch | `defineConfig` schema, asynchronous config loader, no-arg multi-target `generate` & `validate`, governance reconciliation | M1 | DONE (Verified: 52 codegen M2 tests, 15 cli.test.ts, 46 challenger tests, 21 packages typecheck, 0 audit violations) |
| M3 | Deterministic Hashing & Spec Drift Governance | Canonical SHA-256 `x-schema-engine-version-hash`, `check-artifact` / `drift:check` with `oa.config.ts`, breaking diff | M1, M2 | DONE (Verified: 107 M3 & challenger tests, 1519 codegen tests, 21 packages typecheck, 0 audit violations) |
| M4 | Browser Studio Integration & Subdirectory Conformance | `browser-studio/oa.config.ts`, 5 profiles & 29 guards pipeline, deep subdirectory execution, CSP audit | M1, M2, M3 | DONE (Verified: 109 M4 & challenger tests, 609 browser-studio tests, 21 packages typecheck, 0 audit violations) |
| M5 | Final Milestone: E2E Suite Pass & Adversarial Hardening | Pass 100% E2E tests (Tiers 1-4), browser-studio 609+ tests, `@oa-sdk` typecheck, Tier 5 adversarial hardening | M1, M2, M3, M4 | DONE (Verified: 202 E2E tests, 38 Tier 5 adversarial tests, 1727 codegen tests, 609 browser-studio tests, 21 packages typecheck, 0 audit violations) |

## Interface Contracts

### `@oa-sdk/core` ↔ `@oa-sdk/codegen`
```typescript
// packages/core/src/root.ts
export interface FindProjectRootOptions {
  cwd?: string
  explicitRoot?: string
  envVarName?: string // Defaults to 'OA_PROJECT_ROOT'
  markers?: {
    configFiles?: string[] // ['oa.config.ts', 'oa.config.mjs', 'oa.config.json', '.oarc.json']
    workspaceFiles?: string[] // ['pnpm-workspace.yaml', 'turbo.json', 'lerna.json', 'package.json']
    vcsDirs?: string[] // ['.git']
  }
}

export function findProjectRoot(options?: FindProjectRootOptions | string): string
export function findProjectRootDetail(options?: FindProjectRootOptions | string): ProjectRootDetail
```

### `defineConfig` Contract (`packages/codegen/src/config.ts`)
```typescript
export interface ProfileTargetConfig {
  id: string
  profile: 'component-bundle' | 'operation-contract' | 'full-api-document'
  schemaEntry: string
  outDir: string
  title?: string
  version?: string
}

export interface GuardTargetConfig {
  outDir: string
  split?: boolean
  moduleFormat?: 'esm' | 'cjs'
  auditCsp?: boolean
}

export interface OaConfig {
  rootDir?: string
  specs?: ProfileTargetConfig[]
  guards?: GuardTargetConfig
  // Legacy compatibility
  schemas?: Record<string, any>
}

export function defineConfig(config: OaConfig): OaConfig
```

### CLI Global Options Context (`packages/codegen/src/cli/lib/run.ts`)
```typescript
export interface GlobalCliOptions {
  root?: string
  'project-root'?: string
}

export interface CommandContext {
  projectRoot: string
  cwd: string
}
```

## Code Layout
- `packages/core/src/root.ts`: Root discovery implementation.
- `packages/core/src/index.ts`: Re-export `findProjectRoot` and `FindProjectRootOptions`.
- `packages/core/src/__tests__/root.test.ts`: Root discovery unit tests.
- `packages/codegen/src/config.ts`: `defineConfig`, schemas, assertions (`assertOaConfig`), and types.
- `packages/codegen/src/cli/lib/config-loader.ts`: Config loading utility (`loadOaConfig`).
- `packages/codegen/src/spec-projector.ts`: Dual OpenAPI 3.1 & Draft 2020-12 spec and guard projection.
- `packages/codegen/src/cli/commands/generate.ts`: Multi-target profile and guard generation.
- `packages/codegen/src/cli/commands/validate.ts`: Multi-target profile validation with `--config` support.
- `packages/codegen/src/cli/commands/check-artifact.ts` / `drift.ts`: Config-driven spec freshness verification.
- `packages/codegen/src/cli/commands/diff.ts`: Root-aware path resolution for base/head specs.
- `/Users/junwoobang/workflow/browser-studio/oa.config.ts`: Browser studio declarative governance config.
