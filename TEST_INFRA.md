# E2E Test Infrastructure: Root Discovery, Declarative Config, Drift Governance & Browser Studio Integration

## 1. Test Architecture & Philosophy

The end-to-end (E2E) test infrastructure for `@oa-sdk` establishes an **opaque-box, requirement-driven, 4-tier verification model** governing:
1. Upward hierarchical project root discovery (`findProjectRoot`, `--root`, `--project-root`)
2. Declarative specification and guard governance (`defineConfig`, `loadOaConfig`, `oa.config.ts`)
3. Deterministic version hashing and monorepo spec drift enforcement (`x-schema-engine-version-hash`, `oa-gen drift:check`, `oa-gen diff --fail-on-breaking`)
4. Downstream consumer integration and deep subdirectory execution resilience (`browser-studio`, 5 domain profiles, 29 standalone guards, nested submodules)

### Core Testing Invariants
1. **Opaque-Box Evaluation**: Tests treat the CLI engine (`oa-gen`) and public APIs (`@oa-sdk/core`, `@oa-sdk/codegen`) strictly as external black boxes. Invocations execute via standard child processes (`node dist/cli/index.js` or `tsx src/cli/index.ts`) and public entry points without relying on internal private state.
2. **Submodule Traversal Invariant**: When navigating from a nested git submodule or workspace package, rule 3 (`oa.config.ts`) takes precedence across ancestor directories before stopping at submodule boundary markers (`.git`, `pnpm-workspace.yaml`).
3. **Deterministic & Isolated Execution**: Every test executes within an isolated temporary filesystem fixture (`fs.mkdtemp`) containing dedicated workspaces, fake submodules, configuration files, and git markers. Environment variables (`OA_PROJECT_ROOT`) are strictly isolated per test run and restored.
4. **Authoritative Expected Output Derivation**: Expected outputs (status codes, stdout messages, SHA-256 hashes, emitted artifacts, error diagnostics) are derived directly from `ORIGINAL_REQUEST.md` and `PROJECT.md` specifications.

---

## 2. 4-Tier Test Matrix & Coverage Thresholds

| Tier | Focus Area | Requirement Scope | Minimum Threshold |
|---|---|---|:---:|
| **Tier 1** | **Feature Coverage** | Primary happy-path behaviors in isolation (>=5 tests per feature) | 16 × 5 = **80 tests** |
| **Tier 2** | **Boundary & Corner Cases** | Edge cases, malformed configs, precedence conflicts, symlinks, deep paths (>=5 tests per feature) | 16 × 5 = **80 tests** |
| **Tier 3** | **Cross-Feature Interactions** | Pairwise and multi-feature pipelines (root discovery + config load + multi-target generate + drift check) | **16 tests** |
| **Tier 4** | **Real-World Scenarios** | Monorepo integration, nested submodules, downstream `browser-studio` 5 profiles & 29 guards | **8 tests** |
| **Total** | **Comprehensive Test Suite** | **All 16 Features (F1 - F16)** | **184+ tests** |

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 1: FEATURE COVERAGE (80 tests: 5 tests × 16 features)                             │
│   • Upward root discovery (CLI flag, env var, config, workspace, VCS, fallback)        │
│   • Global CLI flag parsing (--root / --project-root) across all 24 commands           │
│   • Declarative config loading (.ts, .mjs, .json, .oarc.json) and defineConfig schema  │
│   • No-arg generate/validate dispatch, canonical SHA-256 hashing, drift exit code 1    │
│   • Semantic breaking diff, browser-studio 5 profiles & 29 guards, deep subdirs        │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 2: BOUNDARY & CORNER CASES (80 tests: 5 tests × 16 features)                      │
│   • Missing root paths, non-existent directories, permission denied, Windows slashes   │
│   • Precedence collision resolution (flag overrides env, env overrides config, etc.)   │
│   • Malformed configs, missing entries, empty profiles, syntax errors in ts config     │
│   • Schema whitespace drift, comment-only changes, zero-byte artifacts, cyclic refs    │
│   • Deep nested execution (8+ levels), submodule boundary crossings, CSP violations    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 3: CROSS-FEATURE INTERACTIONS (16 pairwise/multi-stage pipelines)                 │
│   • Flag override -> load custom config -> dispatch multi-target generate -> CSP audit  │
│   • Deep nested execution -> upward discovery -> load config -> validate all profiles │
│   • Schema mutation -> in-memory projection -> version hash mismatch -> drift failure │
│   • Root-aware diff between two commits across nested monorepo packages                │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 4: REAL-WORLD APPLICATION SCENARIOS (8 end-to-end workflows)                      │
│   • Complete Browser Studio production build (5 domain profiles + 29 guards)           │
│   • Nested submodule `packages/browser-mapper` execution with root boundary crossing   │
│   • CI/CD spec drift gate rejecting out-of-sync Zod schemas                            │
│   • Production release preflight with 0 CSP violations and 100% typecheck conformance  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Feature Inventory Mapping (16 Features)

| Feature # | Feature ID | Name | Spec Source | Tier 1 Target | Tier 2 Target | Tier 3 Target | Tier 4 Target |
|:---:|:---:|---|---|:---:|:---:|:---:|:---:|
| **1** | `F01` | `findProjectRoot` Utility | `ORIGINAL_REQUEST §R1`, `PROJECT §M1` | 5 | 5 | 1 | 1 |
| **2** | `F02` | Global `--root` / `--project-root` Flags | `ORIGINAL_REQUEST §R1`, `PROJECT §M1` | 5 | 5 | 1 | 1 |
| **3** | `F03` | Core Root Re-export & Propagation | `PROJECT §M1` | 5 | 5 | 1 | 0 |
| **4** | `F04` | CLI Spec Check Alignment | `PROJECT §M1` | 5 | 5 | 1 | 0 |
| **5** | `F05` | Declarative `defineConfig` Schema | `ORIGINAL_REQUEST §R2`, `PROJECT §M2` | 5 | 5 | 1 | 0 |
| **6** | `F06` | Asynchronous Config Loader (`loadOaConfig`) | `ORIGINAL_REQUEST §R2`, `PROJECT §M2` | 5 | 5 | 1 | 1 |
| **7** | `F07` | Config-Driven `oa-gen generate` | `ORIGINAL_REQUEST §R2`, `PROJECT §M2` | 5 | 5 | 1 | 1 |
| **8** | `F08` | Config-Driven `oa-gen validate` | `ORIGINAL_REQUEST §R2`, `PROJECT §M2` | 5 | 5 | 1 | 1 |
| **9** | `F09` | Deterministic Schema Hashing | `ORIGINAL_REQUEST §R3`, `PROJECT §M3` | 5 | 5 | 1 | 0 |
| **10** | `F10` | Spec Freshness & Drift Detection | `ORIGINAL_REQUEST §R3`, `PROJECT §M3` | 5 | 5 | 1 | 1 |
| **11** | `F11` | Semantic Breaking Diff (`--fail-on-breaking`) | `ORIGINAL_REQUEST §R3`, `PROJECT §M3` | 5 | 5 | 1 | 0 |
| **12** | `F12` | Browser Studio `oa.config.ts` | `ORIGINAL_REQUEST §R4`, `PROJECT §M4` | 5 | 5 | 1 | 1 |
| **13** | `F13` | Deep Subdirectory Execution Conformance | `ORIGINAL_REQUEST §R4`, `PROJECT §M4` | 5 | 5 | 1 | 1 |
| **14** | `F14` | 5 Domain Profiles Generation & Validation | `ORIGINAL_REQUEST §R4`, `PROJECT §M4` | 5 | 5 | 1 | 1 |
| **15** | `F15` | 29 Standalone Guards & CSP Audit | `ORIGINAL_REQUEST §R4`, `PROJECT §M4` | 5 | 5 | 1 | 1 |
| **16** | `F16` | Monorepo E2E Conformance & Adversarial Hardening | `PROJECT §M5` | 5 | 5 | 1 | 1 |
| **TOTAL** | | | | **80** | **80** | **16** | **8** |

---

## 4. Directory Layout & Runner Definition

### Directory Layout
```
packages/codegen/
├── src/
│   ├── cli/
│   │   ├── commands/             # CLI command implementations
│   │   ├── lib/
│   │   │   ├── config-loader.ts  # loadOaConfig implementation
│   │   │   └── run.ts            # Global --root option interception
│   │   └── index.ts              # CLI entry point (oa-gen)
│   ├── config.ts                 # defineConfig & OaConfig types
│   └── __tests__/
│       └── e2e/                  # E2E Test Suite Directory
│           ├── fixtures/         # Mock monorepo fixture generators
│           ├── helpers/          # CLI process runner & temp filesystem utils
│           ├── tier1-feature-coverage.test.ts   # 80 Tier 1 tests (F01 - F16)
│           ├── tier2-boundary-cases.test.ts     # 80 Tier 2 tests (F01 - F16)
│           ├── tier3-interactions.test.ts       # 16 Tier 3 tests
│           └── tier4-real-world.test.ts         # 8 Tier 4 tests
packages/core/
├── src/
│   ├── root.ts                   # findProjectRoot upward traversal logic
│   └── index.ts                  # Re-export findProjectRoot & options
```

### Test Runner Definition
- **Test Engine**: Vitest (v4.1.4+) configured in `packages/codegen/vitest.config.ts`.
- **Environment**: Node.js `>=24.0.0` native ESM runtime with TypeScript support.
- **Worker Concurrency**:
  - CI / Suite runs: `--maxWorkers 2` (or `--no-file-parallelism` for strict process isolation).
  - Timeout: 60,000ms per test file to support complex file IO and subprocess execution.
- **Execution Commands**:
  ```bash
  # Execute full E2E test suite in packages/codegen
  pnpm --filter @oa-sdk/codegen test src/__tests__/e2e

  # Execute specific tier suites
  pnpm --filter @oa-sdk/codegen test src/__tests__/e2e/tier1-feature-coverage.test.ts
  pnpm --filter @oa-sdk/codegen test src/__tests__/e2e/tier2-boundary-cases.test.ts
  pnpm --filter @oa-sdk/codegen test src/__tests__/e2e/tier3-interactions.test.ts
  pnpm --filter @oa-sdk/codegen test src/__tests__/e2e/tier4-real-world.test.ts

  # Monorepo typecheck gate
  pnpm -r typecheck

  # Downstream Browser Studio verification
  pnpm --dir /Users/junwoobang/workflow/browser-studio test:e2e
  ```

---

## 5. Detailed Test Specifications (Tier 1 & Tier 2)

### Tier 1: Feature Coverage (5 Tests × 16 Features = 80 Tests)

#### Feature 1: `findProjectRoot` Utility (F01)
- `T1-F01-1`: Discovers root directory by locating `oa.config.ts` in ancestor hierarchy.
- `T1-F01-2`: Discovers root directory by locating `pnpm-workspace.yaml` monorepo marker.
- `T1-F01-3`: Discovers root directory by locating `.git` repository marker.
- `T1-F01-4`: Resolves root from environment variable `OA_PROJECT_ROOT` when present.
- `T1-F01-5`: Falls back to `process.cwd()` when no markers or configurations exist.

#### Feature 2: Global `--root` / `--project-root` CLI Flags (F02)
- `T1-F02-1`: Explicit `--root <path>` overrides automatic root discovery across CLI commands.
- `T1-F02-2`: Explicit `--project-root <path>` alias behaves identically to `--root`.
- `T1-F02-3`: All 24 `oa-gen` commands accept `--root` without throwing unrecognized option errors.
- `T1-F02-4`: Global `--root` properly sets the base directory for input file resolution.
- `T1-F02-5`: Global `--root` properly sets the base directory for output file generation.

#### Feature 3: Core Root Re-export & Propagation (F03)
- `T1-F03-1`: `@oa-sdk/codegen` re-exports `findProjectRoot` from `@oa-sdk/core`.
- `T1-F03-2`: `@oa-sdk/core/browser` safely handles `findProjectRoot` in browser environment or warns.
- `T1-F03-3`: CLI runner propagates resolved root context to command execute handlers.
- `T1-F03-4`: `FindProjectRootOptions` interface matches specified contract in `packages/core/src/root.ts`.
- `T1-F03-5`: Core exports include TypeScript type definitions for root discovery.

#### Feature 4: CLI Spec Check Alignment (F04)
- `T1-F04-1`: `scripts/check-cli-spec.ts` recognizes `--root` as a valid global option.
- `T1-F04-2`: `scripts/check-cli-spec.ts` recognizes `--project-root` as a valid global option.
- `T1-F04-3`: Command help (`oa-gen <command> --help`) lists global root options uniformly.
- `T1-F04-4`: CLI spec verification script exits with status 0 against updated CLI definitions.
- `T1-F04-5`: Required option validation triggers only after global options are extracted.

#### Feature 5: Declarative `defineConfig` Schema (F05)
- `T1-F05-1`: `defineConfig` validates and returns typed `OaConfig` with `rootDir`.
- `T1-F05-2`: `defineConfig` supports `specs` array with `id`, `profile`, `schemaEntry`, `outDir`.
- `T1-F05-3`: `defineConfig` supports `guards` configuration (`outDir`, `split`, `moduleFormat`, `auditCsp`).
- `T1-F05-4`: `defineConfig` supports legacy `schemas` dictionary for backward compatibility.
- `T1-F05-5`: Type inference properly types config return value for TypeScript autocomplete.

#### Feature 6: Asynchronous Config Loader (`loadOaConfig`) (F06)
- `T1-F06-1`: Loads `oa.config.ts` via dynamic ESM import / tsx loader.
- `T1-F06-2`: Loads `oa.config.mjs` native ESM configuration file.
- `T1-F06-3`: Loads `oa.config.json` static JSON configuration file.
- `T1-F06-4`: Loads `.oarc.json` configuration file when standard filenames are absent.
- `T1-F06-5`: Returns `null` or default configuration cleanly when no config file is found.

#### Feature 7: Config-Driven `oa-gen generate` (F07)
- `T1-F07-1`: Invoking `oa-gen generate` with no arguments loads `oa.config.ts` automatically.
- `T1-F07-2`: Generates all configured spec targets defined in `specs` array.
- `T1-F07-3`: Generates standalone guards when `guards` is configured in `oa.config.ts`.
- `T1-F07-4`: Emits output files into specified `outDir` paths relative to resolved `rootDir`.
- `T1-F07-5`: Displays execution summary listing all generated targets and guard bundles.

#### Feature 8: Config-Driven `oa-gen validate` (F08)
- `T1-F08-1`: Invoking `oa-gen validate` with no arguments loads `oa.config.ts` automatically.
- `T1-F08-2`: Validates all targets in `specs` against their declared `profile`.
- `T1-F08-3`: Validates `component-bundle` targets (allowing empty paths, requiring schemas).
- `T1-F08-4`: Validates `operation-contract` targets (requiring paths with HTTP operations).
- `T1-F08-5`: Exits with code 0 when all configured profile targets are valid.

#### Feature 9: Deterministic Schema Hashing (F09)
- `T1-F09-1`: Computes SHA-256 hash using `stableStringify` of core OpenAPI document.
- `T1-F09-2`: Excludes non-deterministic or volatile metadata prior to hash computation.
- `T1-F09-3`: Produces identical bit-for-bit `x-schema-engine-version-hash` across repeated runs.
- `T1-F09-4`: Generates standard 64-character hexadecimal SHA-256 string.
- `T1-F09-5`: Injects `x-schema-engine-version-hash` into projected OpenAPI root info or extensions.

#### Feature 10: Spec Freshness & Drift Detection (F10)
- `T1-F10-1`: `oa-gen drift:check` passes with exit code 0 when artifacts match source schemas.
- `T1-F10-2`: `oa-gen drift:check` exits with non-zero exit code (1) when source schema is modified.
- `T1-F10-3`: `oa-gen check-artifact` verifies committed spec files against live projection.
- `T1-F10-4`: Drift reporter outputs human-readable diff highlighting modified schema components.
- `T1-F10-5`: Drift detection operates seamlessly across all targets declared in `oa.config.ts`.

#### Feature 11: Semantic Breaking Diff (`--fail-on-breaking`) (F11)
- `T1-F11-1`: `oa-gen diff --fail-on-breaking` exits with code 1 when required property is removed.
- `T1-F11-2`: Exits with code 1 when property type changes incompatibly.
- `T1-F11-3`: Exits with code 0 on non-breaking additions (e.g. new optional property).
- `T1-F11-4`: Resolves `--base` and `--head` spec paths relative to resolved project root.
- `T1-F11-5`: Enforces all 11 semantic breaking change rules defined in specifications.

#### Feature 12: Browser Studio `oa.config.ts` (F12)
- `T1-F12-1`: Browser Studio root contains valid `oa.config.ts`.
- `T1-F12-2`: Declares all 5 domain profile targets (`devlink-contracts`, `devlink-mcp`, `surface-engine`, `visual-ir`, `inspector-controls`).
- `T1-F12-3`: Declares standalone guards target configured for `dist/guards`.
- `T1-F12-4`: Enables `auditCsp: true` on guard target configuration.
- `T1-F12-5`: All path references in `oa.config.ts` resolve valid existing source entry files.

#### Feature 13: Deep Subdirectory Execution Conformance (F13)
- `T1-F13-1`: `oa-gen validate` executes successfully from `packages/surface-engine`.
- `T1-F13-2`: `oa-gen generate` executes successfully from `packages/surface-engine`.
- `T1-F13-3`: `oa-gen audit:csp` executes successfully from nested submodule subdirectories.
- `T1-F13-4`: Output directories are created relative to repository root, not invocation subdirectory.
- `T1-F13-5`: Relative paths in command arguments are correctly resolved relative to project root.

#### Feature 14: 5 Domain Profiles Generation & Validation (F14)
- `T1-F14-1`: Generates and validates `devlink-contracts` profile artifact.
- `T1-F14-2`: Generates and validates `devlink-mcp` profile artifact.
- `T1-F14-3`: Generates and validates `surface-engine` profile artifact.
- `T1-F14-4`: Generates and validates `visual-ir` profile artifact.
- `T1-F14-5`: Generates and validates `inspector-controls` profile artifact.

#### Feature 15: 29 Standalone Guards & CSP Audit (F15)
- `T1-F15-1`: Generates all 29 standalone type guards into configured output directory.
- `T1-F15-2`: Running `oa-gen audit:csp` against emitted guards reports 0 CSP violations.
- `T1-F15-3`: Generated guards contain 0 calls to `eval()` or `new Function()`.
- `T1-F15-4`: Generated guards contain 0 runtime imports of `ajv`, `zod`, or `@oa-sdk`.
- `T1-F15-5`: Emitted guards include index barrel and TypeScript declaration files.

#### Feature 16: Monorepo E2E Conformance & Adversarial Hardening (F16)
- `T1-F16-1`: Monorepo root `pnpm -r typecheck` passes with 0 errors.
- `T1-F16-2`: Full core test suite `pnpm test:core` passes.
- `T1-F16-3`: Browser Studio test suite `pnpm test:e2e` passes (609+ tests pass).
- `T1-F16-4`: Spec governance checks `pnpm check:spec-governance` pass.
- `T1-F16-5`: Release preflight validation script executes cleanly without failure.

---

### Tier 2: Boundary & Corner Cases (5 Tests × 16 Features = 80 Tests)

#### Feature 1 Boundaries: Root Discovery (F01)
- `T2-F01-1`: Resolves root when invocation directory is 10+ levels deep.
- `T2-F01-2`: Precedence order: explicit CLI `--root` overrides `OA_PROJECT_ROOT` env variable.
- `T2-F01-3`: Precedence order: `OA_PROJECT_ROOT` env variable overrides `oa.config.ts`.
- `T2-F01-4`: Precedence order: `oa.config.ts` overrides monorepo workspace marker (`pnpm-workspace.yaml`).
- `T2-F01-5`: Submodule boundary invariant: ancestor `oa.config.ts` takes precedence over nested `.git` directory.

#### Feature 2 Boundaries: Global CLI Flags (F02)
- `T2-F02-1`: Handles non-existent directory passed to `--root` with graceful error (exit code 1).
- `T2-F02-2`: Handles `--root` path containing spaces, unicode characters, and relative segments (`./foo/../bar`).
- `T2-F02-3`: Normalizes Windows-style backslashes (`\`) to standard paths on POSIX/Mac.
- `T2-F02-4`: Combines global `--root` with command-specific options without argument parsing conflicts.
- `T2-F02-5`: Rejects empty string `--root ""` with clear validation message.

#### Feature 3 Boundaries: Core Root Re-export (F03)
- `T2-F03-1`: `findProjectRoot` handles root filesystem `/` gracefully without infinite loop.
- `T2-F03-2`: Handles directories with restricted read permissions without crashing unhandled.
- `T2-F03-3`: Accepts options object with custom marker filenames.
- `T2-F03-4`: Handles symbolic links pointing across different filesystem directories.
- `T2-F03-5`: Works consistently when `process.cwd()` has been deleted or changed during runtime.

#### Feature 4 Boundaries: CLI Spec Check Alignment (F04)
- `T2-F04-1`: Validates commands where option definitions have aliases (`-r` vs `--root`).
- `T2-F04-2`: Ensures no command shadows global `--root` with conflicting local `--root` semantics.
- `T2-F04-3`: Verifies all commands handle missing required arguments with custom error message instead of stack dump.
- `T2-F04-4`: Validates unknown options (`--unknown-flag`) return exit code 1 across all commands.
- `T2-F04-5`: Validates `--help` flag exit code 0 when combined with global flags.

#### Feature 5 Boundaries: Declarative `defineConfig` Schema (F05)
- `T2-F05-1`: Throws validation error if a spec target is missing required `id` or `schemaEntry`.
- `T2-F05-2`: Throws validation error if an invalid `profile` name is provided.
- `T2-F05-3`: Rejects duplicate `id` values in `specs` array.
- `T2-F05-4`: Accepts empty `specs` array without throwing runtime exceptions.
- `T2-F05-5`: Accepts relative `rootDir` and normalizes to absolute path.

#### Feature 6 Boundaries: Asynchronous Config Loader (F06)
- `T2-F06-1`: Handles syntax errors in `oa.config.ts` with descriptive line/column errors.
- `T2-F06-2`: Handles malformed JSON in `oa.config.json` with clear parse diagnostics.
- `T2-F06-3`: Falls back from `.ts` to `.mjs` to `.json` in order of availability.
- `T2-F06-4`: Defensive fallback when config file exports non-object or promise rejection.
- `T2-F06-5`: Loads configuration exported as default export or named `config` export.

#### Feature 7 Boundaries: Config-Driven Generate (F07)
- `T2-F07-1`: Gracefully warns and skips when configured `schemaEntry` file does not exist.
- `T2-F07-2`: Generates targets into nested output directories creating missing parent folders.
- `T2-F07-3`: Preserves existing files in output directory not managed by generator.
- `T2-F07-4`: Overwrites previously generated artifacts cleanly without file locking issues.
- `T2-F07-5`: Handles configuration containing only guards or only specs.

#### Feature 8 Boundaries: Config-Driven Validate (F08)
- `T2-F08-1`: Reports all validation failures across multiple targets rather than halting at first error.
- `T2-F08-2`: Fails validation if an operation-contract spec has invalid HTTP response status codes.
- `T2-F08-3`: Fails validation if a component-bundle spec contains orphan/unresolved $ref schemas.
- `T2-F08-4`: Handles OpenAPI 3.0 vs 3.1 schema dialects appropriately.
- `T2-F08-5`: Exits with code 1 if at least one target fails validation, specifying failure count.

#### Feature 9 Boundaries: Deterministic Schema Hashing (F09)
- `T2-F09-1`: Key order independence: identical schemas with different object key ordering produce identical hash.
- `T2-F09-2`: Whitespace independence: formatting differences in JSON do not alter version hash.
- `T2-F09-3`: Description and summary changes do not alter schema hash when stripped by projection rules.
- `T2-F09-4`: Adding an enum value alters the computed version hash.
- `T2-F09-5`: Modifying field optionality alters the computed version hash.

#### Feature 10 Boundaries: Spec Freshness & Drift (F10)
- `T2-F10-1`: Detects drift when committed artifact is missing from disk.
- `T2-F10-2`: Detects drift when artifact has zero bytes (empty file).
- `T2-F10-3`: Detects drift when stored hash header does not match computed hash.
- `T2-F10-4`: Tolerates non-semantic differences (timestamp comments, line ending `\r\n` vs `\n`).
- `T2-F10-5`: Exits with status 1 on drift even in silent or non-interactive mode.

#### Feature 11 Boundaries: Semantic Breaking Diff (F11)
- `T2-F11-1`: Removing an HTTP method from an existing path triggers breaking change error.
- `T2-F11-2`: Adding a required request body parameter triggers breaking change error.
- `T2-F11-3`: Narrowing numeric bounds (`maximum` lowered) triggers breaking change error.
- `T2-F11-4`: Removing an enum value from response triggers non-breaking change (valid client behavior).
- `T2-F11-5`: Handles comparison between two specs located in different repository subtrees.

#### Feature 12 Boundaries: Browser Studio `oa.config.ts` (F12)
- `T2-F12-1`: Validates against custom module aliases used in `browser-studio`.
- `T2-F12-2`: Resolves schema entries located inside nested packages (e.g. `packages/surface-engine`).
- `T2-F12-3`: Handles guard output directory outside package root (e.g. `dist/guards`).
- `T2-F12-4`: Handles ESM import specifiers in generated guard barrel index.
- `T2-F12-5`: Conforms to browser-studio tsconfig paths and workspace references.

#### Feature 13 Boundaries: Deep Subdirectory Execution (F13)
- `T2-F13-1`: Executes `oa-gen validate` from nested submodule directory with relative path argument.
- `T2-F13-2`: Resolves output paths correctly when executing from `tool-module-lab/` directory.
- `T2-F13-3`: Verifies environment variable `OA_PROJECT_ROOT` takes effect across nested subshells.
- `T2-F13-4`: Traverses upwards past intermediate `package.json` files without stopping until root marker.
- `T2-F13-5`: Handles deep subdirectories containing duplicate config filenames.

#### Feature 14 Boundaries: 5 Domain Profiles (F14)
- `T2-F14-1`: `surface-engine`: validates non-AST character range patch operation schemas.
- `T2-F14-2`: `devlink-contracts`: validates dual HTTP RPC operations and MCP tool definitions.
- `T2-F14-3`: `visual-ir`: validates large multi-megabyte complex IR schema bundle.
- `T2-F14-4`: `inspector-controls`: validates UI property inspector binding schemas.
- `T2-F14-5`: `devlink-mcp`: validates JSON-RPC schema structures and tool call signatures.

#### Feature 15 Boundaries: 29 Standalone Guards & CSP (F15)
- `T2-F15-1`: Single schema splitting produces clean individual module without bundle pollution.
- `T2-F15-2`: Recursive schema references inlined without causing stack overflow during execution.
- `T2-F15-3`: Identifiers with reserved words sanitized in generated guard function names.
- `T2-F15-4`: CSP scanner flags sneaky `globalThis['ev' + 'al']` pattern.
- `T2-F15-5`: CSP scanner flags `new (Function)('...')` with parenthesized constructor.

#### Feature 16 Boundaries: Monorepo E2E & Hardening (F16)
- `T2-F16-1`: Clean run with no `.turbo` cache produces identical deterministic results.
- `T2-F16-2`: Handles concurrent test execution without temporary file collisions.
- `T2-F16-3`: Typecheck verifies zero implicit `any` in public API surface.
- `T2-F16-4`: Handles symlinked workspace packages without circular resolution loop.
- `T2-F16-5`: Verifies graceful teardown of all child processes and temp directories.

---

## 6. Tier 3: Cross-Feature Interactions (16 Tests)

1. `T3-01`: Explicit `--root` + Asynchronous `oa.config.ts` load + multi-target `oa-gen generate`.
2. `T3-02`: Upward root discovery from deep subdirectory + config loading + `oa-gen validate`.
3. `T3-03`: Config-driven generation of 5 profiles -> deterministic hash computation -> bit-for-bit hash verification.
4. `T3-04`: Config-driven generation -> standalone guard emission -> automated `oa-gen audit:csp` scan -> 0 violations.
5. `T3-05`: Zod schema mutation -> config-driven projection -> `oa-gen drift:check` detects divergence and exits 1.
6. `T3-06`: Spec artifact update -> `oa-gen drift:check` passes -> `oa-gen diff --fail-on-breaking` checks breaking changes.
7. `T3-07`: `OA_PROJECT_ROOT` env var override -> load `.oarc.json` config -> generate guards to custom directory.
8. `T3-08`: Deep nested execution in submodule -> root boundary traversal -> load `browser-studio/oa.config.ts`.
9. `T3-09`: Breaking schema change -> `diff --fail-on-breaking` blocks pipeline -> drift check reports discrepancy.
10. `T3-10`: Multi-profile validation across `component-bundle` and `operation-contract` targets in single run.
11. `T3-11`: Standalone guard splitting with selective filtering via config -> CSP audit on filtered directory.
12. `T3-12`: Spec freshness verification against git index across branch switch simulation.
13. `T3-13`: `defineConfig` with custom `rootDir` -> config loader -> multi-target generation with path remapping.
14. `T3-14`: CLI `--project-root` passed to `oa-gen audit:csp` scanning remote bundle directory.
15. `T3-15`: Legacy `schemas` compatibility config -> migration to `specs` array -> generate produces identical specs.
16. `T3-16`: Full CI governance dry-run: root discovery + config validation + spec freshness + CSP audit.

---

## 7. Tier 4: Real-World Application Scenarios (8 Tests)

1. `T4-01: Full Browser Studio Spec & Guard Governance Pipeline`:
   Executes `oa.config.ts` in `/Users/junwoobang/workflow/browser-studio`, generating all 5 profiles and 29 guards, confirming 0 CSP violations and 0 drift.
2. `T4-02: Nested Submodule Subdirectory Execution Conformance`:
   Simulates developer running `oa-gen validate` from `packages/browser-mapper/packages/selector-evaluator`, asserting automatic discovery of `browser-studio` root without manual flags.
3. `T4-03: CI Pull Request Spec Freshness Gate`:
   Simulates CI environment checking whether committed OpenAPI artifacts in `artifacts/specs/` match live Zod schemas, halting PR on untracked schema modification.
4. `T4-04: Breaking Change Semantic Gate in Release Workflow`:
   Runs `oa-gen diff --base v1.0.0 --head HEAD --fail-on-breaking`, confirming that incompatible contract alterations exit with code 1 and prevent accidental API breakage.
5. `T4-05: Manifest V3 Content Script Live-Editing Sandbox Invariant`:
   Compiles 29 standalone guards and verifies dynamic import execution in strict VM sandbox with `eval` and `Function` disabled.
6. `T4-06: Clean Git Clone Fresh-Start Build`:
   Clones repository into isolated temporary folder with no pre-existing caches, executes `pnpm build` and `oa-gen generate`, verifying clean generation.
7. `T4-07: Downstream Package Monorepo Linking Resilience`:
   Verifies `@oa-sdk/codegen` linked into `browser-studio` via `link:../oa-sdk/packages/codegen` works seamlessly without duplicate dependency resolution issues.
8. `T4-08: Complete Release Packaging & CSP Audit Gate`:
   Executes `pnpm release:preflight` verifying 100% build pass, typecheck pass, CSP audit pass, and zero engine leakage into public guard artifacts.

---

## 8. Verification & Gate Commands

```bash
# 1. Run all E2E test suites in codegen
pnpm --filter @oa-sdk/codegen test src/__tests__/e2e

# 2. Run full monorepo typecheck
pnpm -r typecheck

# 3. Verify CLI specification compliance
pnpm check:cli-spec

# 4. Verify Browser Studio end-to-end conformance
pnpm --dir /Users/junwoobang/workflow/browser-studio test:e2e

# 5. Run complete core test suite
pnpm test:core
```
