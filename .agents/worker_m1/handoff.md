# Handoff Report: Milestone 1 — TypeSpec AST Semantic Diff & Breaking Change Analyzer (R1 Phase 2)

## 1. Observation

### 1.1 Implemented & Modified Files
1. **`packages/codegen/src/cli/lib/typespec-ast-diff.ts`**:
   - In-memory programmatic compilation using `@typespec/compiler` (`noEmit: true`), `@typespec/http` (`getAllHttpServices`), and `@typespec/openapi` (`getOperationId`).
   - Semantic extraction of operations (`signature`, `verb`, `path`, `operationId`, `statusCodes`, `parameters`) and domain models (`name`, `properties`, `optional`, `typeStr`).
   - Full 7-category breaking change classification:
     - `operation-removed`: Operation exists in base but absent in head.
     - `route-changed`: Operation with matching `@operationId` changed route path.
     - `http-method-changed`: Operation with matching `@operationId` changed HTTP verb.
     - `operation-id-changed`: `@operationId` changed or removed.
     - `status-code-removed`: Response status code in base removed from head.
     - `model-removed`: Domain model in base deleted in head.
     - `property-removed`: Property on domain model in base deleted in head.
     - `property-required`: Existing optional property became required.
     - `required-property-added`: Newly added property is required.
     - `property-type-changed`: Property type kind/name modified.
     - Parameter breaking changes: `parameter-removed`, `parameter-required`, `required-parameter-added`.
   - Non-breaking change classification:
     - `operation-added`, `model-added`, `property-added`, `property-optional`, `status-code-added`, `parameter-added`, `parameter-optional`.
   - Output formatters: `formatTypeSpecDiffMarkdown` and `formatTypeSpecDiffJson`.

2. **`packages/codegen/src/cli/lib/typespec-ref-resolver.ts`**:
   - Handles local file paths, directories (locating `main.tsp` or `tspconfig.yaml`), and git references (`HEAD`, `HEAD~1`, branch names, commit hashes).
   - For git refs: validates via `git rev-parse --verify`, extracts archive into an isolated temporary workspace (`git archive ... | tar -x -C`), symlinks root `node_modules` and package-level `node_modules` (`packages/schemas/node_modules`), compiles the program with zero diagnostics, and cleans up temp trees in `cleanup()`.

3. **`packages/codegen/src/cli/commands/tsp-diff.ts`**:
   - Registered options:
     - `--base <ref>` (required string)
     - `--head <ref>` (required string)
     - `--fail-on-breaking` (boolean flag)
     - `--format <format>` (string: `markdown` | `json`)
   - Computes semantic diff between base and head.
   - Throws `new CliExitError(1)` when `--fail-on-breaking` is supplied and `hasBreakingChanges(result)` is true.

4. **`packages/codegen/src/cli/index.ts`**:
   - Implemented compound command lookahead for multi-token CLI subcommands (e.g. `oa-gen tsp diff`).
   - Registered `tspDiff` and aliases (`tsp diff`, `tsp-diff`, `tsp:diff`).
   - Slices `commandArgs` with `consumedTokens` offset.

5. **`packages/codegen/src/__tests__/tsp-diff.test.ts`**:
   - 29 comprehensive unit and integration tests covering:
     - All 7 breaking change categories
     - Non-breaking additive changes
     - Markdown and JSON formatters
     - Identical spec zero-diff assertion
     - CLI exit code assertions with and without `--fail-on-breaking`
     - Aliases `tsp-diff` and `tsp:diff`
     - Git ref resolution (`HEAD` vs local spec, `HEAD~1` vs `HEAD`)
     - Error handling (missing options, non-existent references)

### 1.2 Verbatim Verification Outputs
```bash
$ pnpm --filter @oa-sdk/codegen test src/__tests__/tsp-diff.test.ts
 ✓ src/__tests__/tsp-diff.test.ts (29 tests) 8479ms
 Test Files  1 passed (1)
      Tests  29 passed (29)

$ pnpm --filter @oa-sdk/codegen test src/__tests__/diff-cli.test.ts
 ✓ src/__tests__/diff-cli.test.ts (33 tests) 18426ms
 Test Files  1 passed (1)
      Tests  33 passed (33)

$ pnpm --filter @oa-sdk/codegen build
ESM ⚡️ Build success in 82ms
DTS ⚡️ Build success in 3574ms
```

---

## 2. Logic Chain

1. **In-Memory Zero-Disk AST Traversal**:
   - Direct reliance on `@typespec/compiler`, `@typespec/http`, and `@typespec/openapi` guarantees that inheritance, decorators (`@route`, `@operationId`), and type bindings are resolved without emitting intermediate YAML/JSON files.
2. **Git Reference Transparency**:
   - Historical git revisions lack built artifacts or local node_modules. Archiving the commit to a temporary folder and symlinking the monorepo root and package `node_modules` allows `@typespec/compiler` to compile historical trees seamlessly.
3. **CI Breaking Gate Reliability**:
   - Using `hasBreakingChanges(result)` and throwing `CliExitError(1)` ensures deterministic non-zero exit codes for automated CI gates when `--fail-on-breaking` is set, while exiting 0 when clean or without the flag.
4. **Multi-Token CLI Dispatch**:
   - Lookahead inspection in `src/cli/index.ts` enables both ergonomic multi-token syntax (`oa-gen tsp diff`) and legacy kebab-case (`oa-gen tsp-diff`).

---

## 3. Caveats

- **Git Subprocess Availability**: Resolving git references requires `git` to be installed and executable in `$PATH`, and the execution directory must be inside a git repository. If executed outside a git repository with a non-existent path, the command reports a clean error and exits with code 1.
- **`commands.ts` Registry**: Registration of `tspDiff` in `commands.ts` and documentation in `docs/guides/cli-command-reference.md` are scheduled for Milestone 4 to satisfy documentation gates (`pnpm check:docs`). `src/cli/index.ts` currently routes `tsp diff` directly.

---

## 4. Conclusion

Requirement R1 (Phase 2): TypeSpec AST Semantic Diff & Breaking Change Analyzer is 100% implemented, verified, and ready.
- All 7 breaking categories and non-breaking categories are implemented and tested.
- Git ref resolution works seamlessly across local files and git commits (`HEAD`, `HEAD~1`).
- Multi-token routing for `oa-gen tsp diff` is operational.
- All 29 new tests pass, regression tests pass (33/33 in `diff-cli.test.ts`), and `tsup` build succeeds.

---

## 5. Verification Method

### 5.1 Project Test Commands
```bash
# 1. Run tsp-diff unit & integration test suite
pnpm --filter @oa-sdk/codegen test src/__tests__/tsp-diff.test.ts

# 2. Run existing OpenAPI diff regression tests
pnpm --filter @oa-sdk/codegen test src/__tests__/diff-cli.test.ts

# 3. Test CLI manual execution
node packages/codegen/dist/cli/index.js tsp diff --base packages/schemas/typespec/main.tsp --head packages/schemas/typespec/main.tsp

# 4. Test git ref diffing
node packages/codegen/dist/cli/index.js tsp diff --base HEAD --head packages/schemas/typespec/main.tsp --format json

# 5. Build packages/codegen
pnpm --filter @oa-sdk/codegen build
```

### 5.2 Invalidation Conditions
- Changes to `@typespec/compiler` breaking `getAllHttpServices` or `compile(NodeHost, ...)`.
- Modifications to `runCommand` error handling altering `CliExitError` status propagation.
