# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

*Add reusable patterns discovered during development here.*
- Canonical identity parsing should stay a parser primitive with structured diagnostics; registry/node construction can build on parsed `DefinitionId` without reimplementing grammar checks.
- One-shot TypeScript schema scripts should use `node --import tsx` instead of the `tsx` CLI wrapper when the environment may block local IPC listeners.

---

## 2026-04-16 - US-001
- Implemented canonical definition id parsing and validation for `kind:scope/domain/name`, including supported kind values, lower-case scope/domain segments, component-like PascalCase names, malformed/nested id rejection, and duplicate id diagnostics.
- Added schema fragment fixtures for `schema:public/book/Note`, `schema:public/notebook/Note`, and `schema:shared/common/Error`.
- Updated internal spec/API/todo docs for the new parser API, grammar examples, fixture IDs, test counts, and next definition-builder follow-up.
- Switched schemas one-shot TypeScript scripts to `node --import tsx` so `pnpm schema:validate` can run in this sandbox without hitting `tsx` CLI IPC `listen EPERM`.
- Files changed:
  - `packages/parser/src/definition-id.ts`
  - `packages/parser/src/index.ts`
  - `packages/parser/src/__tests__/definition-id.test.ts`
  - `packages/schemas/src/fragments/schema/public/book/Note.yaml`
  - `packages/schemas/src/fragments/schema/public/notebook/Note.yaml`
  - `packages/schemas/src/fragments/schema/shared/common/Error.yaml`
  - `packages/schemas/scripts/__tests__/definition-fixtures.test.ts`
  - `packages/schemas/package.json`
  - `docs/internal/spec.md`
  - `docs/internal/api-index.md`
  - `docs/internal/todo.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - The current schema merge pipeline only scans `src/domains`, so definition-builder fixtures can live under `src/fragments` without changing emitted `.merged.yaml`.
  - `tsx scripts/*.ts` opens a local IPC pipe in this environment and fails with `listen EPERM`; `node --import tsx scripts/*.ts` executes the same one-shot scripts without that IPC path.
  - Codegen and schema validation consume built parser/codegen dist in some paths, so public parser export changes should be followed by the normal build/schema validation gates.
---
