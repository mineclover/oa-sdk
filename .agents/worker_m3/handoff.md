# Milestone 3 Handoff Report: Codegen Core Implementation

## 1. Observation

### Initial Codebase State & Deficiencies
1. **R5 (Import Resolver Monorepo Boundary)**:
   - File: `packages/codegen/src/routing/import-resolver.ts`
   - In cross-package situations within monorepos or multi-package workspaces, relative path resolution (`path.relative`) produced fragile, deeply nested paths like `../../../../packages/client/src/index.ts` instead of canonical package specifiers (e.g. `@oa-sdk/client` or `@org/pkg/subpath`).
   - Windows path detection previously utilized `path.win32.isAbsolute(fromFilePath)` directly, which on macOS/Linux returned `true` for standard POSIX absolute paths starting with `/` (e.g. `/var/folders/...`), incorrectly converting them into Windows backslashes (`\var\folders\...`) and breaking upward directory traversal.

2. **R7 (Unified Declarative Pipeline Execution)**:
   - File: `packages/codegen/src/cli/commands/generate.ts`
   - The CLI `oa-gen generate` command checked only for `loaded.config.schemas` or explicit flags. When `oa.config.ts` was provided with `specs`, `core.contracts`, `core.client`, and `product.outputRouting`, it only generated schema projections and standalone guards, omitting handler contracts (`@oa-sdk/router`), typed client SDK (`@oa-sdk/client`), and TanStack Query options (`@oa-sdk/client`).
   - Orphan pruning in `OaManifestManager` was bypassing auto-generated handler contracts and schemas due to `DEFAULT_BANNER_MARKERS` mismatch and absolute vs. relative path formatting.

3. **R8 (outputRouting Presets & Composer Object Array Syntax Bug)**:
   - Files: `packages/codegen/src/cli/commands/init.ts`, `packages/codegen/src/cli/lib/init/{composer,interactive,types,index}.ts`
   - `oa-gen init` did not support the `--routing <default|fsd|monorepo|by-kind>` (short: `-r`) option, interactive prompt, or preset emission in `product.outputRouting`.
   - Critical syntax bug in `packages/codegen/src/cli/lib/init/composer.ts` `formatObject`: When serializing array of objects (such as `rules: [{ ... }]`), array items were formatted without `{` and `}` delimiters, emitting invalid TypeScript code that failed compilation.

4. **R9 (Linux-Compatible File Watching Fallback)**:
   - File: `packages/codegen/src/cli/lib/spec-watcher.ts`
   - Inotify on Linux does not support recursive directory watching via `fs.watch(dir, { recursive: true })`.
   - In `spec-watcher.ts`, directory watcher events (`isDir: true`) passed the watched directory path `resolvedPath` to `parseSpecDocument` rather than the specific changed file (`fileToParse = isDir ? join(eventDir, name) : resolvedPath`), causing YAML/JSON parsing errors or timeouts.

---

## 2. Logic Chain

1. **Monorepo Package Boundary Awareness (R5)**:
   - Added `findNearestPackageJson(startPath)` in `import-resolver.ts` that walks up directories looking for the nearest `package.json` with a valid `name`, explicitly skipping root workspace manifests (indicated by `workspaces` field or `pnpm-workspace.yaml`).
   - Implemented `resolvePackageSpecifier(resolvedTo, toPkg)` to resolve target entrypoints against package `main`, `module`, and `exports` maps (`.` or subpaths), falling back to clean subpath specifiers.
   - Refined `isWindowsPath` detection to strictly check Windows drive letters (`/^[a-zA-Z]:[\\/]/`) and UNC paths (`/^\\\\[^\\]/`), preventing POSIX root slashes on macOS/Linux from being mangled into backslashes.
   - Integrated into `resolveImportSpecifier`: if `fromFilePath` and `toFilePath` reside in different packages, it returns the bare package specifier; if they are in the same package, it preserves standard relative `./...` resolution.

2. **Declarative Pipeline Orchestration (R7)**:
   - Extended `generate.run()` to detect declarative configs containing `specs`, `core`, or `product`.
   - In `runConfigDrivenPipeline`, orchestrated the full 5-phase generation flow:
     - Phase 1: `projectTargetSpec(target, rootDir)` -> OpenAPI 3.1 (`*.openapi.json`) and JSON Schema Draft 2020-12 (`*.schema.json`).
     - Phase 2: `projectTargetGuards(resolvedConfig.guards, ...)` -> standalone type guards via AJV.
     - Phase 3: `generateHandlerContract(res.openApiDoc, ...)` (@oa-sdk/router) -> pure handler contracts (`*.contract.ts`).
     - Phase 4: `generateClient(res.openApiDoc, ...)` (@oa-sdk/client) -> typed client SDK (`*.client.ts`).
     - Phase 5: `generateTanstackQuery(res.openApiDoc, ...)` (@oa-sdk/client) -> 3-tier TanStack Query options (`*.queries.ts`, `*.keys.ts`) with dynamic cross-artifact relative import calculation.
     - Phase 6: Atomic commit via `manifestManager.writeArtifacts` and safe orphan pruning via `manifestManager.pruneOrphans`.
     - Phase 7: Comprehensive formatted summary banner.

3. **Output Routing Presets & Composer Fix (R8)**:
   - Added `OutputRoutingPreset = 'default' | 'fsd' | 'monorepo' | 'by-kind'` in `types.ts`.
   - Wired `--routing <preset>` (short: `-r`) in `init.ts` with validation.
   - Added `promptRoutingSelection` in `interactive.ts` for guided setup.
   - Fixed `formatObject` in `composer.ts` to wrap object array elements with `{ ... }`, and implemented `getOutputRoutingSnippet(preset)` emitting idiomatic TypeScript routing configs for all 4 presets.

4. **Linux-Compatible Inotify Fallback & Watcher Hardening (R9)**:
   - Added `collectDirectoriesRecursively(rootDir, maxDepth)` ignoring `node_modules`, `.git`, `dist`, `.turbo`, `.next`.
   - Added `forceLinuxFallback` option to `SpecWatcherOptions`.
   - On Linux (`process.platform === 'linux'`) or when forced, recursively attaches individual `fs.watch` instances across all subdirectories and dynamically attaches watchers to newly created subdirectories on `rename` events without throwing errors or process crashes.
   - Corrected event target path calculation: `fileToParse = isDir ? (name ? join(eventDir, name) : resolvedPath) : resolvedPath` and verified file existence before invoking `parseSpecDocument`.

---

## 3. Caveats

1. **Governance Command Coordination (Milestone 4)**:
   - Command validation in `oa-gen-governance.ts` for `--routing` options is managed under Milestone 4 ownership scope; our implementation in `init.ts` and `composer.ts` strictly satisfies the core codegen contract and runtime validation without modifying files outside our exclusive ownership.
2. **Symlinked Monorepo Package Dependencies**:
   - `findNearestPackageJson` stops at workspace boundaries; packages with non-standard layout (e.g. nested monorepos without `workspaces` declared in manifest) fall back to canonical relative imports.

---

## 4. Conclusion

Milestone 3 requirements (R5, R7, R8, R9) are fully implemented, verified, and passing:
- **R5**: Monorepo package boundary awareness in import resolver is active, tested, and prevents deep relative path escapes.
- **R7**: `oa-gen generate` drives the unified multi-phase declarative pipeline end-to-end with manifest tracking and safe orphan pruning.
- **R8**: `oa-gen init` supports `--routing` presets (`default`, `fsd`, `monorepo`, `by-kind`), and the composer object array syntax bug is permanently resolved.
- **R9**: `spec-watcher.ts` provides robust Linux-compatible recursive directory watching with ignored paths and dynamic subtree attachment.
- All 147 test files and 2,998 tests in `@oa-sdk/codegen` pass, TypeScript compilation passes without errors (`tsc --noEmit`), and production build succeeds (`tsup`).

---

## 5. Verification Method

### Commands Executed & Results
1. **Package Build**:
   ```bash
   pnpm --filter @oa-sdk/codegen build
   ```
   *Result*: Code 0 (clean build of `src/index.ts`, `src/cli/index.ts`, `src/spec-lens/index.ts`, etc. with DTS emission).

2. **TypeScript Strict Typecheck**:
   ```bash
   pnpm --filter @oa-sdk/codegen typecheck
   ```
   *Result*: Code 0 (0 errors, 0 warnings).

3. **M3 Targeted Verification Suite**:
   ```bash
   pnpm --filter @oa-sdk/codegen test \
     src/__tests__/output-routing.test.ts \
     src/__tests__/cli/init.test.ts \
     src/__tests__/spec-watcher.test.ts \
     src/__tests__/cli/generate-pipeline.test.ts \
     src/__tests__/cli/generate-tanstack.test.ts
   ```
   *Result*: 5 passed test files, 98 passed tests (0 failed).

4. **Package-Wide Vitest Test Suite**:
   ```bash
   pnpm --filter @oa-sdk/codegen test
   ```
   *Result*: 147 test files passed, 2,998 tests passed (0 failed).

5. **Files to Inspect**:
   - `packages/codegen/src/routing/import-resolver.ts`
   - `packages/codegen/src/cli/commands/generate.ts`
   - `packages/codegen/src/cli/commands/init.ts`
   - `packages/codegen/src/cli/lib/init/composer.ts`
   - `packages/codegen/src/cli/lib/init/interactive.ts`
   - `packages/codegen/src/cli/lib/init/types.ts`
   - `packages/codegen/src/cli/lib/init/index.ts`
   - `packages/codegen/src/cli/lib/spec-watcher.ts`
   - `packages/codegen/src/__tests__/cli/generate-pipeline.test.ts`
