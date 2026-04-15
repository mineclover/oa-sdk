# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

*Add reusable patterns discovered during development here.*
- Path-flattening collision tests can simulate a risky attempted naming policy through explicit allocator aliases, then assert registry nodes and `outputNames` stay canonical-id keyed while failure is reported only through output-name collision diagnostics.
- Collision/naming reports should be derived from allocator alias metadata plus final diagnostics, rather than widening alias metadata itself; this keeps the target-local output-name map stable while simulation layers add target name, reason, and severity.
- Output name allocation should run per target over that target's included registry nodes, emit a canonical-id keyed `outputNames` map plus alias metadata, and then feed the map into output `$ref` rewriting instead of storing global canonical-id aliases.
- Output `$ref` rewrite should key off registry ref-edge source path/pointer/raw-ref triples and resolved `targetId`, while keeping output naming injectable through a target-local map/callback for later naming policy work.
- Definition ref resolution should run after unique node registration so canonical refs can be checked against the full `nodeById` set and file refs can resolve through a source-path/pointer index.
- Definition registry graph construction should reuse the parser's JSON Pointer-aware `$ref` traversal and attach source coordinates through an optional lookup callback instead of embedding YAML parsing in registry code.
- Canonical identity parsing should stay a parser primitive with structured diagnostics; registry/node construction can build on parsed `DefinitionId` without reimplementing grammar checks.
- Definition builder primitives should keep pure fragment identity/source metadata models separate from registry graph and ref resolution so later stories can add behavior without changing the data contract.
- One-shot TypeScript schema scripts should use `node --import tsx` instead of the `tsx` CLI wrapper when the environment may block local IPC listeners.

---

## 2026-04-16 - US-005
- Implemented parser output `$ref` rewrite over resolved definition registries.
- Added `rewriteDefinitionOutputRefs()` with kind-specific OpenAPI component locations for schemas, responses, parameters, request bodies, headers, links, callbacks, and security schemes.
- Added target-local output name injection via map/callback so later naming-policy work can rewrite refs without changing source identities.
- Added parser tests covering nested canonical/file ref rewrite, all component-like kind locations, no `oa://` refs in rewritten output content, output-name aliases, and diagnostic source path/pointer preservation for missing refs.
- Updated internal spec, API index, and todo docs to mark output ref rewrite complete and leave output naming/collision simulation as the next blocker.
- Files changed:
  - `packages/parser/src/definition-output-refs.ts`
  - `packages/parser/src/index.ts`
  - `packages/parser/src/__tests__/definition-registry.test.ts`
  - `docs/internal/spec.md`
  - `docs/internal/api-index.md`
  - `docs/internal/todo.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - Registry `refEdges` already carry the exact source path/pointer/raw ref coordinates needed to rewrite content without re-resolving refs.
  - Output component locations should be centralized by canonical kind so schema/response/parameter/requestBody/header/link/callback/securityScheme rewrites stay consistent.
  - API index drift checks treat backticked identifiers in documented export tables as candidate symbols, so descriptions should avoid backticks around non-export component section names.
---

## 2026-04-16 - US-004
- Implemented source ref resolution in the parser definition registry.
- Canonical source refs like `oa://schema/public/book/Note` now normalize to `schema:public/book/Note`, and missing canonical targets produce `definition-registry/missing-ref` diagnostics.
- Relative file refs now resolve through registered definition source path/pointer metadata and normalize to canonical target ids when the target is known.
- Unsupported source refs preserve raw edge data and produce `definition-registry/unsupported-ref` diagnostics with source path/pointer and optional line/column.
- Added parser tests for canonical ref resolution, relative file ref resolution, missing refs, unsupported refs, and nested/transitive ref resolution.
- Updated internal spec, API index, and todo docs to document canonical source ref syntax and leave output OpenAPI ref rewrite as follow-up.
- Files changed:
  - `packages/parser/src/definition-registry.ts`
  - `packages/parser/src/__tests__/definition-registry.test.ts`
  - `docs/internal/spec.md`
  - `docs/internal/api-index.md`
  - `docs/internal/todo.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - Ref target validation needs the complete unique-node map, so registry construction is cleaner as register nodes first, resolve refs second.
  - Relative file refs can be normalized without reading files by indexing registered definition nodes by normalized `sourcePath` and `sourcePointer`.
  - With `exactOptionalPropertyTypes`, diagnostic helper inputs must omit optional fields instead of passing `undefined` through spread/object literals.
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

## 2026-04-16 - US-006
- Implemented target-local output name allocation in the parser with preserve-if-unique, domain-prefix, and explicit alias policies.
- Added alias metadata for each allocated component-like definition, mapping canonical id to output name, source segments, and policy reason through both array and by-id map forms.
- Added final output name collision diagnostics so colliding canonical ids are reported rather than merged.
- Added parser tests for unique names, same local name across domains, explicit aliases, same canonical id across different target allocations, and output ref rewrite integration with allocated names.
- Updated internal spec, API index, and todo docs for US-006 completion and remaining target bundle follow-up.
- Files changed:
  - `packages/parser/src/definition-output-names.ts`
  - `packages/parser/src/__tests__/definition-output-names.test.ts`
  - `packages/parser/src/index.ts`
  - `docs/internal/spec.md`
  - `docs/internal/api-index.md`
  - `docs/internal/todo.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - Target-local allocation is simplest as a pure function over included registry nodes; callers decide the target boundary by choosing the input node set.
  - Explicit aliases should be applied before preserve/domain-prefix fallback so a manual alias can resolve a local-name collision without forcing every remaining node through domain prefixing.
  - Final output name collision checks still need to run after all policies because explicit aliases can create component-section collisions.
---

## 2026-04-16 - US-007
- Implemented server/domain collision simulation support by adding target-aware `collisionReport` rows to `allocateDefinitionOutputNames()`.
- Added public/admin target fixtures and admin `Note` schema fragments so same-local-name collisions can be simulated independently per server target.
- Extended parser and schemas tests to cover no collision, domain-prefix rename collision, target-local naming, target fixture shape, and output-name collision report errors.
- Documented the collision report shape and updated internal todo status for US-007 completion.
- Files changed:
  - `packages/parser/src/definition-output-names.ts`
  - `packages/parser/src/index.ts`
  - `packages/parser/src/__tests__/definition-output-names.test.ts`
  - `packages/schemas/src/fragments/schema/admin/book/Note.yaml`
  - `packages/schemas/src/fragments/schema/admin/notebook/Note.yaml`
  - `packages/schemas/src/targets/public-api.yaml`
  - `packages/schemas/src/targets/admin-api.yaml`
  - `packages/schemas/scripts/__tests__/definition-fixtures.test.ts`
  - `docs/internal/spec.md`
  - `docs/internal/todo.md`
  - `docs/internal/api-index.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - Target simulation can stay pure by passing only the target's included nodes plus `targetName` into the allocator; future target config loading does not need to change naming policy semantics.
  - `collisionReport` is more useful as a per-definition row stream than as grouped diagnostics because downstream tooling can join rows by canonical id, target, domain, or severity.
  - Keeping fixture targets under `packages/schemas/src/targets` avoids changing the current domain merge pipeline while still giving the builder PRD stable server-level fixtures.
---

## 2026-04-16 - US-008
- Implemented path-flattening collision risk fixtures for `schema:public/a/Name`, `schema:public/aname/Name`, `schema:public/a-name/Name`, and `schema:admin/a/Name`.
- Extended public/admin target fixtures so builder simulations can include the new path-risk definitions without changing the existing merge output.
- Added parser tests proving all path-risk canonical IDs remain distinct registry nodes and that a simulated flattened naming policy mapping public fixtures to attempted output name `AName` emits `definition-output-name/collision` plus `output-name-collision` report rows instead of semantic dedupe.
- Updated internal spec/todo docs with fail-on-collision flattening guard behavior and story completion status.
- Files changed:
  - `packages/parser/src/__tests__/definition-id.test.ts`
  - `packages/parser/src/__tests__/definition-output-names.test.ts`
  - `packages/schemas/src/fragments/schema/public/a/Name.yaml`
  - `packages/schemas/src/fragments/schema/public/aname/Name.yaml`
  - `packages/schemas/src/fragments/schema/public/a-name/Name.yaml`
  - `packages/schemas/src/fragments/schema/admin/a/Name.yaml`
  - `packages/schemas/src/targets/public-api.yaml`
  - `packages/schemas/src/targets/admin-api.yaml`
  - `packages/schemas/scripts/__tests__/definition-fixtures.test.ts`
  - `docs/internal/spec.md`
  - `docs/internal/todo.md`
  - `.ralph-tui/progress.md`
- **Learnings:**
  - Explicit allocator aliases are a clean way to simulate a hypothetical flattened-path naming policy without adding a new source identity rule or target config parser.
  - `createDefinitionRegistry()` and `allocateDefinitionOutputNames()` both stay keyed by canonical id, so even identical attempted output names do not collapse semantic definitions.
  - Fragment and target fixtures under `packages/schemas/src/fragments` and `packages/schemas/src/targets` remain outside the current domain merge pipeline, which keeps schema validation output stable while builder behavior is simulated.
---
