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

## 2026-09-05T06:38:42Z

Standardize and align documentation for declarative specification grammar (`oa.config.ts`, Zod SSOT, projection profiles) and 4-tier E2E test/governance infrastructure across `@oa-sdk`.

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. Declarative Specification Grammar & Authoring Conventions Alignment
Align and refine documentation covering the declarative syntax and conventions in `@oa-sdk`:
- Document `defineConfig({ rootDir, specs, guards })` schema, multi-format async config loader, and 6-tier hierarchical project root resolution (`findProjectRoot()`, Submodule Invariant).
- Standardize authoring conventions for Zod master schemas (SSOT), strict numeric bounds (`minimum: 0` vs `exclusiveMinimum: 0`), RFC 9457 `ProblemDetailsSchema`, recursive tree structures (`z.lazy`), and `x-surface-*` vendor extensions.
- Ensure all code examples in `docs/guides/declarative-spec-configuration.md` and `docs/guides/schema-architecture-and-conventions.md` are verified against production implementations.

### R2. 4-Tier Test & Governance Infrastructure Integration
Formally integrate and document the testing and governance infrastructure:
- Integrate `TEST_INFRA.md` into the formal documentation hierarchy under `docs/` (e.g. `docs/concepts/test-infrastructure.md` or `docs/guides/e2e-testing-model.md`), detailing the 4-tier verification model (Tier 1 Feature Coverage, Tier 2 Boundary Cases, Tier 3 Interactions, Tier 4 Real-World Workloads, plus Tier 5 Adversarial Hardening).
- Standardize documentation for deterministic SHA-256 spec version hashing (`x-schema-engine-version-hash`), automated drift detection (`oa-gen drift:check` / `check-artifact`), semantic breaking diff rules (`oa-gen diff --fail-on-breaking`), and Manifest V3 CSP audit (`oa-gen audit:csp`).

### R3. Monorepo Documentation Registry & Cross-References Harmonization
Cleanly structure all documentation navigation paths and cross-references:
- Update `docs/README.md`, `docs/concepts/cli-governance.md`, and `docs/guides/cli-command-reference.md` to cleanly index and link the declarative grammar and test infrastructure guides.
- Verify that every CLI option and argument documented matches `scripts/check-cli-spec.ts` and CLI parser behavior.
- Ensure 100% link validity with zero broken links across internal markdown references.

## Acceptance Criteria

### Grammar & Specification Coverage
- [ ] `docs/guides/declarative-spec-configuration.md` and `docs/guides/schema-architecture-and-conventions.md` provide complete, runnable TypeScript configurations for all 3 projection profiles (`component-bundle`, `operation-contract`, `full-api-document`) and standalone guards.
- [ ] Strict numeric bounds, RFC 9457 error contracts, and recursive schema guidelines are fully articulated with clear do/don't examples.

### Test Infrastructure & Governance Integration
- [ ] 4-Tier E2E test model and testing invariants are published within `docs/` and indexed in `docs/README.md`.
- [ ] Spec drift detection, deterministic SHA-256 hashing, breaking change classifications (11 endpoint + 7 schema rules), and CSP audit requirements are documented with normative workflow diagrams.

### Navigation & Repository Integrity
- [ ] All internal document links and code references resolve cleanly without broken relative paths.
- [ ] `pnpm exec tsx scripts/check-cli-spec.ts` exits with code 0 (CLI spec alignment confirmed).
- [ ] Full monorepo typecheck (`pnpm -r typecheck`) remains clean with 0 errors.

