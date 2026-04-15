# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

*Add reusable patterns discovered during development here.*
- Resolver baseline tests should cover parser graph/deref behavior separately from codegen alias behavior: parser owns ref traversal/deref semantics, while typegen calls `resolveRefGraph()` for external schema aliases and passes `refNameOverrides` into `schemaToTs()`.

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
