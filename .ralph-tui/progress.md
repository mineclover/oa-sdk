# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

*Add reusable patterns discovered during development here.*
- Definition registry graph construction should reuse the parser's JSON Pointer-aware `$ref` traversal and attach source coordinates through an optional lookup callback instead of embedding YAML parsing in registry code.
- Canonical identity parsing should stay a parser primitive with structured diagnostics; registry/node construction can build on parsed `DefinitionId` without reimplementing grammar checks.
- Definition builder primitives should keep pure fragment identity/source metadata models separate from registry graph and ref resolution so later stories can add behavior without changing the data contract.
- One-shot TypeScript schema scripts should use `node --import tsx` instead of the `tsx` CLI wrapper when the environment may block local IPC listeners.

---

## 2026-04-16 - US-003
- Implemented a public parser definition registry graph with unique node registration, canonical id node lookup, ref edge collection, and registry diagnostics.
- Added JSON Pointer-aware `$ref` collection from fragment `content`, including escaped object keys, array indexes, and valid `oa://...` canonical refs normalized into `targetId`.
- Added duplicate canonical id rejection with diagnostics that preserve duplicate and first-source path/pointer plus optional line/column coordinates.
- Updated internal spec, API index, and todo docs to mark registry graph/ref edge collection complete and leave source ref resolution/output rewrite as the next step.
- Files changed:
  - `packages/parser/src/definition-registry.ts`
  - `packages/parser/src/index.ts`
  - `packages/parser/src/__tests__/definition-registry.test.ts`
  - `docs/internal/spec.md`
  - `docs/internal/api-index.md`
  - `docs/internal/todo.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - `collectRefs()` already provides the JSON Pointer escaping behavior the registry needs, so registry code can stay focused on graph data and diagnostics.
  - Keeping duplicate-id detection in the registry layer lets `DefinitionNode` remain a reusable fragment primitive while registry construction rejects ambiguous graph state.
  - `DefinitionRegistryDiagnostic` should carry both duplicate and first-source coordinates because the actionable fix often requires comparing two fragment files.
---

## 2026-04-16 - US-002
- Implemented the public parser definition node/ref model with `DefinitionNode`, `DefinitionRef`, `DefinitionMetadata`, `createDefinitionNode()`, and `createDefinitionRef()`.
- Added focused parser tests for canonical identity-derived node construction, optional classification metadata, source path/pointer preservation, ref source metadata, and refs array copying.
- Updated internal spec, API index, and todo docs to mark the fragment definition node model complete and make registry graph/ref resolution the next blocking step.
- Files changed:
  - `packages/parser/src/definition-node.ts`
  - `packages/parser/src/index.ts`
  - `packages/parser/src/__tests__/definition-node.test.ts`
  - `docs/internal/spec.md`
  - `docs/internal/api-index.md`
  - `docs/internal/todo.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - Parser public exports are checked against `docs/internal/api-index.md`, so adding even small model helpers needs an API index row.
  - `exactOptionalPropertyTypes` means optional model fields should be omitted unless provided; construction helpers should assign them conditionally.
  - US-002 in the active PRD is intentionally only the node/ref data model; registry graph, ref collection, and duplicate detection are deferred to US-003.
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
