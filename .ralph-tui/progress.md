# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

*Add reusable patterns discovered during development here.*
- When `derefSpec()` folds an external target, carry both `RefResolution.documentRoot` and the resolved file `basePath`: documentRoot makes `#/...` pointers resolve against the loaded external document, while basePath keeps nested relative file refs source-local.
- Resolver baseline tests should cover parser graph/deref behavior separately from codegen alias behavior: parser owns ref traversal/deref semantics, while typegen calls `resolveRefGraph()` for external schema aliases and passes `refNameOverrides` into `schemaToTs()`.
- Keep low-level `$ref` mechanics in parser-only contracts: `RefResolver` returns a `RefResolution` value object with kind, cache keys, document root, source pointer, pointer/file metadata, and diagnostic, while callers keep traversal/folding behavior local.
- Typegen external schema aliases need two ref identities: raw `$ref` overrides only for entry-document refs, and canonical absolute file+pointer refs for external schema internals rewritten by sourceFilePath/sourcePointer before `schemaToTs()`.

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
