# Original User Request

## Initial Request — 2026-09-03T15:54:46Z

Implement Project Root Resolution (`findProjectRoot`, `--root` / `--project-root` CLI flags), Declarative Specification Configuration (`oa.config.ts`), and Monorepo Drift Governance across `@oa-sdk` and `@browser-studio`.

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. Hierarchical Upward Project Root Discovery (`@oa-sdk/core`, `@oa-sdk/codegen`)
Implement a robust upward traversal project root discovery utility `findProjectRoot()` that resolves root directories across nested packages, workspaces, and submodules:
- Resolution precedence:
  1. Explicit CLI argument (`--project-root <dir>` / `--root <dir>`)
  2. Environment variable (`OA_PROJECT_ROOT`)
  3. Spec configuration file (`oa.config.ts`, `oa.config.mjs`, `oa.config.json`, `.oarc.json`)
  4. Monorepo workspace marker (`pnpm-workspace.yaml`, `turbo.json`, `lerna.json`, `package.json` with `workspaces`)
  5. Version control marker (`.git`)
  6. Fallback: `process.cwd()`
- Wire `--root` / `--project-root` as a global option across all `oa-gen` commands (`generate`, `validate`, `lint`, `audit:csp`, `typegen`, `diff`, `collect`), allowing execution from any subdirectory without relative path breakage.

### R2. Declarative Spec & Governance Configuration (`oa.config.ts`)
Extend `defineConfig` in `@oa-sdk/codegen` with a comprehensive schema for monorepo-scale specification and guard governance:
- `rootDir`: Base directory for path resolution.
- `specs`: Array of domain profile targets (`id`, `profile`, `schemaEntry`, `outDir`, `title`, `version`).
- `guards`: Configuration for standalone type guards (`outDir`, `split`, `moduleFormat`, `auditCsp`).
- Config Loader: Asynchronously load `oa.config.ts` (using `jiti`, `tsx`, or dynamic ESM import) with fallback to JSON.

### R3. Automated Spec Freshness & Drift Detection
Implement automated freshness checks comparing source schemas (Zod AST) against projected artifacts (`artifacts/specs/*.openapi.json`):
- Compute deterministic SHA-256 content hashes (`x-schema-engine-version-hash`).
- Add `oa-gen drift:check` or wire into `oa-gen check-artifact` to verify whether committed spec artifacts are in sync with source code.
- Enforce semantic breaking-change detection via `oa-gen diff --fail-on-breaking`.

### R4. Browser Studio Integration & Subdirectory Execution Conformance
Apply `oa.config.ts` to `browser-studio` root and verify end-to-end operational resilience:
- Verify that running `oa-gen validate`, `oa-gen generate`, and `oa-gen audit:csp` from deep nested directories (e.g. `packages/surface-engine` or `packages/browser-mapper/packages/selector-evaluator`) seamlessly detects the root and executes without path errors.
- Ensure all 5 profiles and 29 standalone guards build and pass CSP audits identically through the config-driven pipeline.

## Acceptance Criteria

### Root Discovery & CLI Flag Conformance
- [ ] `findProjectRoot()` correctly resolves the repository root when invoked from `packages/codegen`, `packages/parser`, or arbitrary deep subdirectories.
- [ ] Passing `--root <path>` overrides automatic discovery and scopes all operations to the specified directory.
- [ ] All `oa-gen` commands accept `--root` without throwing unrecognized option errors.

### Config-Driven Specification Pipeline
- [ ] Running `oa-gen generate` or `oa-gen validate` with no arguments in a repository containing `oa.config.ts` automatically loads all configured profiles and processes them.
- [ ] The loader cleanly handles TypeScript config files (`oa.config.ts`) in native ESM environments.

### Spec Drift & Freshness Enforcement
- [ ] Modifying a Zod schema without re-exporting specs causes drift/freshness checks to exit with non-zero status.
- [ ] `x-schema-engine-version-hash` matches bit-for-bit between source projection and stored artifact.

### Monorepo Integration & Test Suite Conformance
- [ ] All unit and E2E tests in `@oa-sdk` pass (`pnpm test`).
- [ ] Full monorepo typecheck in `@oa-sdk` passes (`pnpm -r typecheck`).
- [ ] Full test suite in `browser-studio` passes (`pnpm run test:e2e`, 609+ tests pass).
- [ ] `oa-gen audit:csp` reports 0 CSP violations across all guard outputs.
