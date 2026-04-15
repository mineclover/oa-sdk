# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

*Add reusable patterns discovered during development here.*
- Typegen external alias allocation must reserve both local component schema names and generated operation type names before assigning aliases; unsupported schema-position refs into non-schema OAS roots should warn and rewrite to `unknown` so generated TS stays compilable.
- When `derefSpec()` folds an external target, carry both `RefResolution.documentRoot` and the resolved file `basePath`: documentRoot makes `#/...` pointers resolve against the loaded external document, while basePath keeps nested relative file refs source-local.
- Resolver baseline tests should cover parser graph/deref behavior separately from codegen alias behavior: parser owns ref traversal/deref semantics, while typegen calls `resolveRefGraph()` for external schema aliases and passes `refNameOverrides` into `schemaToTs()`.
- Keep low-level `$ref` mechanics in parser-only contracts: `RefResolver` returns a `RefResolution` value object with kind, cache keys, document root, source pointer, pointer/file metadata, and diagnostic, while callers keep traversal/folding behavior local.
- Typegen external schema aliases need two ref identities: raw `$ref` overrides only for entry-document refs, and canonical absolute file+pointer refs for external schema internals rewritten by sourceFilePath/sourcePointer before `schemaToTs()`.
- Typegen rename diagnostics should be emitted after deterministic alias names are assigned so warnings can report resolver-normalized `file#pointer -> TypeName` context without changing name allocation.
- External typegen alias discovery should be gated by the `$ref` source schema context, then named from the resolved target pointer: this supports `$defs` and custom schema roots without accidentally aliasing response/path-item refs.
- Incremental workspace boundaries belong outside parser: keep `WorkspaceIndex` in codegen/CLI layers, and make the default noop index mark every scanned file dirty so full rebuild remains the correctness path.
- Persistent workspace indexes are disposable optimization state: store schema/options compatibility metadata, wrap writes in transactions, and degrade storage mismatches or DB errors to full rebuild fallback instead of letting cache state affect correctness.
- Compute reverse dependency dirty sets before invalidating index rows: once source rows are deleted, refs.to_file edge context needed to mark referring specs dirty may be gone.
- CLI incremental orchestration should keep WorkspaceIndex as a sidecar around the existing full parser/codegen output path: scan, detect dirty files, invalidate stale rows, generate from current files, then refresh the index so cache fallback cannot change stdout or generated files.

---

## 2026-04-15 - US-001
- Implemented focused resolver baseline tests for `resolveRefGraph()` and `derefSpec()` covering internal refs, external YAML/JSON refs, nested external refs, missing refs, circular refs, and `$ref` sibling preservation.
- Added typegen baseline coverage for external YAML/JSON schema aliases, nested external aliases, and unresolved external schema diagnostics.
- Documented current resolver/typegen paths and known behavior gaps in internal docs; updated test counts.
- Files changed:
  - `packages/parser/src/__tests__/resolver-baseline.test.ts`
  - `packages/codegen/src/__tests__/typegen/generate-types.test.ts`
  - `docs/internal/spec.md`
  - `docs/internal/todo.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - `resolveRefGraph()` and `derefSpec()` share JSON Pointer resolution but keep separate traversal, cache, cycle stack, and diagnostic emission paths.
  - `generateTypesFromSpec()` intentionally parses without deref; external component aliases are discovered by `analyzeExternalSchemaRefs()` through `resolveRefGraph()` and then wired into `schemaToTs()` via `refNameOverrides`.
  - Typegen currently limits external alias generation to `#/components/schemas/*`, and unresolved external schema causes are collapsed into `external-schema-unresolved`.
---

## 2026-04-15 - US-002
- Implemented a parser-internal shared `RefResolver` contract for internal refs, external YAML/JSON refs, JSON Pointer lookup, document cache keys, source pointer metadata, missing refs, and circular refs.
- Rewired `resolveRefGraph()` and `derefSpec()` to use the shared resolver while preserving their public exports and caller-visible behavior.
- Added contract-level tests for internal and external ref resolution, including YAML/JSON document caching and missing/circular diagnostics.
- Updated internal docs and todo status for the completed resolver unification work and bumped parser/total test counts.
- Files changed:
  - `packages/parser/src/ref-resolver.ts`
  - `packages/parser/src/ref-graph.ts`
  - `packages/parser/src/deref.ts`
  - `packages/parser/src/__tests__/ref-resolver-contract.test.ts`
  - `docs/internal/spec.md`
  - `docs/internal/todo.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - `resolveRefGraph()` owns graph traversal and node shaping; the shared resolver should only return resolution facts and diagnostics.
  - `derefSpec()` owns sibling merge and cycle strategy; the shared resolver supplies the same cache key and diagnostic vocabulary used by the graph path.
  - Full `pnpm test` and `pnpm schema:validate` are blocked in this sandbox by `listen EPERM` for local sockets/tsx IPC, while parser-focused checks and full typecheck pass.
---

## 2026-04-15 - US-003
- Centralized codegen external schema loading on the shared `resolveRefGraph()` path by removing the `derefSpec()` fallback in `analyzeExternalSchemaRefs()`.
- Added source-file metadata to resolver diagnostics and ref graph nodes, and made external-document internal ref cache keys file-qualified.
- Rewrote nested external schema refs to canonical absolute file+pointer identities so identical raw relative refs from different source documents resolve deterministically.
- Preserved resolver diagnostic codes/source metadata in typegen external schema diagnostics and added coverage for cache reuse, source metadata, nested source-relative refs, and missing file/pointer failures.
- Files changed:
  - `packages/parser/src/ref-resolver.ts`
  - `packages/parser/src/ref-graph.ts`
  - `packages/parser/src/lint.ts`
  - `packages/parser/src/__tests__/ref-resolver-contract.test.ts`
  - `packages/parser/src/__tests__/ref-graph.test.ts`
  - `packages/parser/src/__tests__/lint.test.ts`
  - `packages/codegen/src/typegen/generate-types.ts`
  - `packages/codegen/src/__tests__/typegen/generate-types.test.ts`
  - `docs/internal/spec.md`
  - `docs/internal/api-index.md`
  - `docs/internal/todo.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - Codegen imports `@oa-sdk/parser` through the built package entry during tests, so parser dist must be rebuilt after parser public type/runtime changes before running codegen checks.
  - Raw relative `$ref` strings are not globally unique once traversal enters external documents; sourceFilePath/sourcePointer is needed to attach each nested ref to its resolved file identity.
  - Name collision analysis should only consider resolved external schema targets, otherwise missing refs can reserve type names or produce misleading collision warnings.
  - Full `pnpm test`, typia/playground integration tests, and `pnpm schema:validate` remain blocked in this sandbox by `listen EPERM` on localhost or tsx IPC; root typecheck and parser/codegen suites pass.
---

## 2026-04-15 - US-004
- Verified `resolveRefGraph()` already delegates internal and external lookup through shared `createRefResolver()` and preserves graph traversal ownership locally.
- Verified existing ref graph coverage includes internal refs, external refs, nested external refs, missing refs, and cycle diagnostics without adding or rebalancing tests.
- Ran required checks: `pnpm typecheck` passed; `pnpm test` passed through core/parser/router/client/codegen and failed in mock-server integration suites on sandbox `listen EPERM`; `pnpm schema:validate` built parser/codegen and failed when `tsx` attempted an IPC pipe with `listen EPERM`.
- Files changed:
  - `.ralph-tui/progress.md`
- **Learnings:**
  - `resolveRefGraph()` should keep traversal, node shaping, and recursive descent local while delegating all pointer/file/cache/diagnostic facts to `RefResolver`.
  - US-002/US-003 had already completed the US-004 runtime and test acceptance criteria, so no source, docs count, API index, or todo changes were needed.
---

## 2026-04-15 - US-005
- Updated `derefSpec()` external target folding to use the shared resolver's `documentRoot` when recursing into external YAML/JSON documents, so document-local `#/...` pointers inside external files resolve against the external document instead of the entry spec.
- Added deref regression coverage for an external YAML schema containing a document-local sibling `$ref`, while retaining existing sibling merge, external JSON/YAML, and cycle strategy coverage.
- Updated parser and total test counts in `docs/internal/spec.md`.
- Ran required checks: `pnpm typecheck` passed; parser deref slice and full parser package tests passed; root `pnpm test` passed core/parser/router/client/codegen and then failed in mock-server integration suites on sandbox `listen EPERM`; direct typia-mock/playground tests failed on the same localhost bind restriction; `pnpm schema:validate` built parser/codegen and failed when `tsx` attempted its IPC pipe with `listen EPERM`.
- Files changed:
  - `packages/parser/src/deref.ts`
  - `packages/parser/src/__tests__/deref.test.ts`
  - `docs/internal/spec.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - `RefResolution.documentRoot` is required for deref recursion into external documents; using only the target node and resolved file path is insufficient for external document-local pointers.
  - Keeping `basePath` and `documentRoot` separate mirrors `resolveRefGraph()` traversal and avoids duplicating pointer/file resolution logic in `DerefFolder`.
---

## 2026-04-15 - US-006
- Aligned typegen rename warnings with resolver-normalized external ref metadata by emitting collision warnings after deterministic alias names are assigned.
- Preserved existing external `#/components/schemas/*` alias generation and collision rename behavior while adding `resolved file#pointer -> generated type` context to collision and local-shadow warning messages.
- Expanded existing typegen collision coverage to assert generated aliases, warning propagation through `generateTypesFromSpec()`, and external file/pointer context without changing the codegen test count.
- Ran required checks: `pnpm typecheck` passed; `pnpm --filter @oa-sdk/codegen test` passed; root `pnpm test` passed core/parser/router/client/codegen and failed in mock-server integration suites on sandbox `listen EPERM`; `pnpm schema:validate` built parser/codegen and failed when `tsx` attempted an IPC pipe with `listen EPERM`.
- Files changed:
  - `packages/codegen/src/typegen/generate-types.ts`
  - `packages/codegen/src/__tests__/typegen/generate-types.test.ts`
  - `docs/internal/spec.md`
  - `docs/internal/todo.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - Collision warning text needs generated names, so it must be built after the alias assignment loop rather than during name grouping.
  - `resolveRefGraph()` already provides the target `filePath`/`pointer` needed for rename context; typegen only needs to format that resolver-normalized identity consistently.
  - Updating an existing test keeps `docs/internal/spec.md` test counts stable while still covering warning propagation after migration.
---

## 2026-04-15 - US-007
- Added a parser-external `WorkspaceIndex` boundary in `@oa-sdk/codegen` covering file hash records, components, ref edges, source locations, diagnostics, and type alias metadata.
- Implemented `createNoopWorkspaceIndex()` / `createWorkspaceIndex()` default no-op behavior that treats every scanned file as changed, plus `createMemoryWorkspaceIndex()` for in-memory metadata storage, diffing, and file invalidation.
- Exported the new public codegen API and documented the index as an optimization layer rather than a correctness source; updated test counts and todo status.
- Ran required checks: `pnpm typecheck` passed; `pnpm --filter @oa-sdk/codegen test` passed with 473 tests; `pnpm check:api-index` passed; `pnpm test` reached mock-server and failed on sandbox `listen EPERM`; `pnpm schema:validate` built parser/codegen and failed when `tsx` attempted an IPC pipe with `listen EPERM`; direct typia-mock/playground tests hit the same localhost bind restriction.
- Files changed:
  - `packages/codegen/src/workspace-index.ts`
  - `packages/codegen/src/index.ts`
  - `packages/codegen/src/__tests__/workspace-index.test.ts`
  - `docs/internal/spec.md`
  - `docs/internal/api-index.md`
  - `docs/internal/todo.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - A no-op incremental index should return empty reads but mark all scanned files dirty, preserving current full rebuild behavior without special CLI branching.
  - Keeping WorkspaceIndex row types independent from parser types avoids pulling parser correctness contracts or future SQLite details into browser/mock-server-safe parser bundles.
  - File-level `replaceFileIndex()` gives future SQLite orchestration the same invalidation unit described in ADR-006 while remaining easy to exercise in memory.
---

## 2026-04-15 - US-008
- Implemented `SQLiteWorkspaceIndex` in `@oa-sdk/codegen`, creating `.oa-cache/state.sqlite` by default with `meta`, `files`, `components`, `refs`, `source_locations`, `diagnostics`, and `type_aliases` tables.
- Enabled WAL mode, busy timeout, foreign keys, schema/options compatibility metadata, transaction-wrapped writes, cache clear, rollback, and full rebuild fallback for DB open/read/write errors.
- Added SQLite workspace-index tests for schema initialization/persistence, version/options mismatch rebuild, transaction rollback, and DB open fallback; codegen tests now pass with 477 cases.
- Updated internal spec/test counts, API index, ADR implementation status, and todo completion notes.
- Ran required checks: `pnpm typecheck` passed; `pnpm --filter @oa-sdk/codegen test` passed with 477 tests; `pnpm check:api-index` passed; `pnpm test` passed core/parser/router/client/codegen then failed in mock-server integration suites on sandbox `listen EPERM`; `pnpm schema:validate` built parser/codegen then failed when `tsx` attempted an IPC pipe with `listen EPERM`.
- Files changed:
  - `packages/codegen/src/sqlite-workspace-index.ts`
  - `packages/codegen/src/workspace-index.ts`
  - `packages/codegen/src/index.ts`
  - `packages/codegen/src/__tests__/workspace-index.test.ts`
  - `docs/internal/spec.md`
  - `docs/internal/api-index.md`
  - `docs/internal/todo.md`
  - `docs/internal/architecture/006-incremental-workspace-index.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - `node:sqlite` is available in the current Node 24 environment, but using `createRequire()` keeps TypeScript independent from Node 24-only ambient types.
  - SQLite `PRAGMA foreign_keys` is connection-local, so rollback coverage is better proven through an FK-violating transaction and reopening the DB to verify old rows remain.
  - Compatibility mismatch should clear persisted rows and force exactly one full rebuild diff; subsequent runs can reuse the freshly stamped schema/options metadata.
---

## 2026-04-15 - US-009
- Implemented workspace file scanning for entry specs, domain specs, profile specs, and external ref files using absolute path, realpath, size, mtime, and sha256 content hash metadata.
- Added dirty detection helpers that classify new/modified/deleted/unchanged files, compute refs.to_file reverse dependency closure for affected source specs, and invalidate stale rows for changed/deleted/dependent files before re-indexing.
- Added tests for external ref file changes invalidating the referring spec and deleted files removing stale diagnostics; updated internal test counts and incremental design notes.
- Files changed:
  - `packages/codegen/src/workspace-index.ts`
  - `packages/codegen/src/sqlite-workspace-index.ts`
  - `packages/codegen/src/__tests__/workspace-index.test.ts`
  - `docs/internal/spec.md`
  - `docs/internal/todo.md`
  - `docs/internal/architecture/006-incremental-workspace-index.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - File identity needs both absolute filePath for resolver/index joins and realPath for filesystem alias detection; comparisons should include realPath without replacing the logical key.
  - Dirty dependency expansion must happen before invalidation so existing ref edges can still identify source specs that depend on a changed external target.
  - US-009 is the reusable primitive layer; validate/typegen/dev CLI flags remain the US-010 wiring task.
---

## 2026-04-15 - US-010
- Added opt-in `--incremental` and `--cache-dir` options to `oa-gen validate` and `oa-gen typegen`.
- Added shared CLI incremental orchestration for scan, dirty detection, refs.to_file reverse invalidation, SQLite fallback, and index refresh; `oa-gen dev` watch mode now uses the same path and watches discovered external ref files.
- Kept validate/typegen stdout and generated output on the existing full rebuild path, with incremental index state maintained as a sidecar.
- Added CLI scenario coverage proving incremental validate output matches full rebuild output, and incremental typegen output matches full rebuild output before and after an external ref file change.
- Updated internal docs, ADR status, todo status, and codegen/total test counts.
- Ran checks: `pnpm typecheck` passed; `pnpm --filter @oa-sdk/codegen test` passed with 482 tests; `pnpm test` passed through codegen then failed in mock-server Node HTTP integration suites on sandbox `listen EPERM`; `pnpm schema:validate` built parser/codegen then failed when `tsx` attempted a sandbox-blocked IPC pipe with `listen EPERM`.
- Files changed:
  - `packages/codegen/src/cli/lib/incremental.ts`
  - `packages/codegen/src/cli/lib/args.ts`
  - `packages/codegen/src/cli/commands/validate.ts`
  - `packages/codegen/src/cli/commands/typegen.ts`
  - `packages/codegen/src/cli/commands/dev.ts`
  - `packages/codegen/src/__tests__/cli-scenarios.test.ts`
  - `docs/internal/spec.md`
  - `docs/internal/todo.md`
  - `docs/internal/architecture/006-incremental-workspace-index.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - Keeping incremental state as a sidecar makes equality tests simple: incremental validate/typegen stdout can match full rebuild output byte-for-byte while still updating SQLite dependency metadata.
  - The first incremental run must refresh the index with external files discovered from `resolveRefGraph()`, not only files known from the previous cache, so subsequent runs can detect external ref edits.
  - `dev` watch mode needs to resync watchers after each generation because the external ref file set can grow, shrink, or change after dirty invalidation.
---

## 2026-04-15 - US-011
- Defined and implemented the external alias policy for `$defs` and non-components schema roots: external YAML/JSON refs that appear in schema positions now normalize into generated aliases when they resolve to schema objects.
- Extended `analyzeExternalSchemaRefs()` beyond `#/components/schemas/*` by gating candidates on source schema context and then reusing resolver-normalized file+pointer identities for direct and nested external refs.
- Added codegen tests for external `#/$defs/*` aliases and a non-components `#/schemas/*` root with nested `#/models/*` refs; codegen now has 484 tests and the repo total is documented as 1605.
- Updated internal spec/API/todo docs and marked the completed todo policy item.
- Ran checks: `pnpm typecheck` passed; `pnpm --filter @oa-sdk/codegen test` passed with 484 tests; `pnpm test` passed core/parser/router/client/codegen then failed in mock-server Node HTTP integration suites on sandbox `listen EPERM`; `pnpm schema:validate` built parser/codegen then failed when `tsx` attempted a sandbox-blocked IPC pipe with `listen EPERM`.
- Files changed:
  - `packages/codegen/src/typegen/generate-types.ts`
  - `packages/codegen/src/__tests__/typegen/generate-types.test.ts`
  - `docs/internal/spec.md`
  - `docs/internal/api-index.md`
  - `docs/internal/todo.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - Target pointer shape alone is not enough for alias discovery once arbitrary schema roots are supported; the `$ref` source location must prove the ref is in schema context.
  - Existing alias naming and collision handling can be reused for `$defs` and custom schema roots because resolved file+pointer identity is already the stable join key.
  - Nested internal refs inside external `$defs` or custom roots need the same absolute file+pointer rewrite path as nested external component refs.
---

## 2026-04-15 - US-012
- Implemented deterministic aliases for supported external `$defs` and non-components schema refs by reserving generated operation type names alongside local component schema names before alias assignment.
- Reused file-stem based deterministic rename behavior for operation type collisions and added warnings that include resolver-normalized file/pointer and generated type context.
- Added unsupported external pointer diagnostics for schema-position refs into non-schema OAS roots, with `unknown` fallback overrides so generated TypeScript remains compilable instead of emitting dangling aliases.
- Added codegen typegen regressions for operation bundle name collision and unsupported pointer fallback; codegen test count is now 486 and documented repo total is 1607.
- Ran checks: `pnpm typecheck` passed; `pnpm --filter @oa-sdk/codegen test` passed; `pnpm check:api-index` passed; `git diff --check` passed. `pnpm test` reached mock-server and failed on sandbox `listen EPERM` for `127.0.0.1`; `pnpm schema:validate` built parser/codegen and failed when `tsx` attempted a sandbox-blocked IPC pipe with `listen EPERM`.
- Files changed:
  - `packages/codegen/src/typegen/generate-types.ts`
  - `packages/codegen/src/__tests__/typegen/generate-types.test.ts`
  - `docs/internal/spec.md`
  - `docs/internal/api-index.md`
  - `docs/internal/todo.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - `analyzeExternalSchemaRefs()` needs operation-name awareness because external aliases are merged into `doc.schemas` before operation types are emitted.
  - Operation bundle collisions are best handled before `uniqueTypeName()` by seeding `usedNames` with local and operation names, preserving the existing deterministic rename path.
  - Unsupported external pointer roots should be diagnosed before schema alias grouping; otherwise response/path-item objects can look like generic objects and accidentally become aliases.
---
