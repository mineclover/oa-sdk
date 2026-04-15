# PRD: OpenAPI Definition Builder

## Overview

OpenAPI output should become a build artifact generated from smaller, reusable definition fragments. The current merge model can combine domain specs, but the next goal is finer-grained definition graph management: individual schemas, path fragments, responses, parameters, servers, and operations should be addressable by canonical identity and composed into target-specific OpenAPI documents.

This matters because `$ref` is not just a pointer syntax. It is the mechanism for naming and reusing conceptual definitions. Two definitions may share the local name `Note` while meaning different things, such as a book note versus a notebook note. The source definitions should not be renamed just to avoid output collisions. Instead, the builder should preserve source identity and resolve output component names through a naming policy.

The builder must never infer equivalence by flattening strings. For example, `schema:public/a/Name` and `schema:public/aname/Name` are different definitions even if a naming policy could emit the same output symbol. If flattening maps both to `AName`, the builder must report an output-name collision and resolve or fail according to policy.

## Goals

- Treat OpenAPI documents as build outputs, not the primary authoring source.
- Define a fragment format for schemas, paths, operations, parameters, responses, and servers.
- Track every fragment with a canonical identity such as `schema:public/book/Note`.
- Resolve source refs into canonical identities, then rewrite them into valid OpenAPI `$ref` strings.
- Compose multiple output targets for different servers, domains, and path subsets.
- Support duplicate-name cases without mutating source definitions.
- Distinguish semantic dedupe from structural similarity.
- Provide deterministic output component names and alias metadata.
- Manage name uniqueness from the target server scope down to domain scope and local definition names.
- Detect flattened-name collisions such as `schema:public/a/Name` versus `schema:public/aname/Name` without treating their canonical identities as equivalent.
- Simulate collision and duplicate-warning behavior before replacing current merge output.
- Build on the existing resolver, external alias, and WorkspaceIndex concepts.

## Package Ownership

- `@oa-sdk/schemas` owns fragment source layout, target configs, schema fixtures, and migration from the current domain merge.
- `@oa-sdk/parser` provides validation, source location, JSON Pointer traversal, and ref graph primitives.
- `@oa-sdk/codegen` exposes the builder through CLI, for example `oa-gen build-spec`, and integrates with WorkspaceIndex for future incremental target builds.

## Quality Gates

These commands must pass for every user story where applicable:

- `pnpm typecheck`
- `pnpm --filter @oa-sdk/parser test`
- `pnpm --filter @oa-sdk/codegen test`
- `pnpm --filter @oa-sdk/schemas test`
- `pnpm schema:validate`
- `pnpm build:scripts && pnpm check:api-index`

If a story changes schema fixtures, docs, or test counts:

- update `docs/internal/spec.md`
- update `docs/internal/api-index.md` if public exports change
- update `docs/internal/todo.md` if task status changes

## User Stories

### US-001: Define Canonical Identity Model
**Description:** As a spec author, I want each OpenAPI fragment to have canonical identity separate from output component name so that local names can stay natural inside each domain.

**Acceptance Criteria:**
- [ ] Define `DefinitionId` shape for schema/path/operation/parameter/response/server fragments.
- [ ] Canonical IDs use the fixed grammar `kind:scope/domain/name`.
- [ ] `kind` is one of `schema`, `response`, `parameter`, `requestBody`, `header`, `link`, `callback`, `path`, `operation`, `server`, `tag`, or `securityScheme`.
- [ ] `scope` represents API exposure/server family such as `shared`, `public`, `admin`, `internal`, or `partner`.
- [ ] `domain` represents bounded context such as `common`, `book`, `notebook`, `user`, `auth`, or `health`.
- [ ] `name` is the domain-local definition name and should be PascalCase for component-like definitions.
- [ ] Include canonical id, kind, scope, domain, local name, source path, source pointer, content hash, metadata, and refs.
- [ ] Document that source identity is stable and output name is derived later.
- [ ] Add fixtures for `schema:public/book/Note`, `schema:public/notebook/Note`, and `schema:shared/common/Error`.
- [ ] Reject malformed IDs such as `schema:book/Note`, `schema:Note`, and nested IDs such as `schema:public/book/chapter/Note`.
- [ ] Reject file path/frontmatter canonical id mismatches when both are available.

### US-002: Add Definition Registry Graph
**Description:** As a builder, I want to load fragments into a registry graph so that refs, duplicates, and target bundles can be reasoned about before emitting OpenAPI.

**Acceptance Criteria:**
- [ ] Add registry data structures for definition nodes and ref edges.
- [ ] Collect refs from fragment contents using JSON Pointer-aware traversal.
- [ ] Preserve source coordinates for diagnostics.
- [ ] Detect duplicate canonical ids as errors.
- [ ] Tests cover node registration, ref edge collection, and duplicate canonical id rejection.

### US-003: Resolve Canonical Refs and Rewrite Output `$ref`
**Description:** As a builder, I want source refs to resolve to canonical identities and then rewrite to valid output OpenAPI refs so that fragment authoring and emitted documents are decoupled.

**Acceptance Criteria:**
- [ ] Support source refs such as `oa://schema/public/book/Note`.
- [ ] Support file refs where feasible and normalize them to canonical ids.
- [ ] Rewrite schema refs to `#/components/schemas/{OutputName}`.
- [ ] Preserve unsupported/missing ref diagnostics.
- [ ] Tests cover canonical ref, relative file ref, missing ref, and nested ref rewrite.

### US-004: Implement Output Naming Policy
**Description:** As a spec author, I want deterministic output names so that name collisions like `book.Note` and `notebook.Note` are resolved without changing source definitions.

**Acceptance Criteria:**
- [ ] Implement `preserve-if-unique` naming policy.
- [ ] Implement `domain-prefix` naming policy.
- [ ] Implement server-aware namespace resolution where output name allocation considers target server, domain, and local definition name.
- [ ] Emit alias metadata mapping canonical id to output name.
- [ ] If two definitions have the same local name and both are included, output names are deterministic, e.g. `BookNote`, `NotebookNote`.
- [ ] Tests cover `book.Note` versus `notebook.Note`.

### US-005: Simulate Server and Domain Name Collision Behavior
**Description:** As a schema platform maintainer, I want collision and duplicate handling simulated across server targets and domains so that naming policy is proven before migration.

**Acceptance Criteria:**
- [ ] Add fixture target `public-api` that includes `book.Note` and `notebook.Note`.
- [ ] Add fixture target `admin-api` that includes at least one additional `admin.Note` or `internal.Note`.
- [ ] Simulate same local name across different domains in the same target and verify deterministic output names.
- [ ] Simulate same local name across different server targets and verify target-local output names do not leak between bundles.
- [ ] Simulate identical structural schema under different semantic identities and verify it remains separate with warning/info only.
- [ ] Simulate duplicate canonical id and verify it is an error.
- [ ] Emit a machine-readable collision report with canonical id, target name, domain, local name, output name, reason, and severity.
- [ ] Tests cover no-collision, rename collision, structural duplicate warning, and canonical duplicate error.

### US-006: Simulate Path Flattening Equivalence Risks
**Description:** As a schema platform maintainer, I want path-aware canonical identities tested against flattened output names so that `schema:public/a/Name` and `schema:public/aname/Name` are not accidentally treated as the same definition.

**Acceptance Criteria:**
- [ ] Add fixtures for `schema:public/a/Name`, `schema:public/aname/Name`, `schema:public/a-name/Name`, and `schema:admin/a/Name`.
- [ ] Verify all fixtures have distinct canonical identities.
- [ ] Run naming policy simulation and detect any flattened output symbol collision.
- [ ] If a policy maps multiple canonical ids to the same output name, emit `output-name-collision` diagnostics.
- [ ] The collision diagnostic includes all colliding canonical ids and the attempted output name.
- [ ] The builder either deterministically renames the later definitions or fails according to target policy.
- [ ] Tests prove no semantic dedupe occurs only because flattened names match.

### US-007: Define Duplicate and Dedupe Policy
**Description:** As a maintainer, I want explicit duplicate and dedupe rules so that structural similarity does not accidentally collapse semantically different definitions.

**Acceptance Criteria:**
- [ ] Duplicate canonical id is an error.
- [ ] Duplicate output name is handled by naming policy or explicit alias.
- [ ] Identical schema hash across different canonical ids produces warning/info only by default.
- [ ] No automatic structural dedupe unless an explicit semantic alias/ref is declared.
- [ ] Tests cover identical shape but different meaning remaining separate.

### US-008: Add Target Bundle Configuration
**Description:** As an API owner, I want target configs for public/admin/internal servers so that only selected domains and paths are emitted into each OpenAPI document.

**Acceptance Criteria:**
- [ ] Define target config format with name, servers, include domains, include paths, and naming policy.
- [ ] Target selection includes directly matched paths.
- [ ] Target selection recursively includes referenced schemas/parameters/responses.
- [ ] Tests cover public versus admin target selection.

### US-009: Build OpenAPI Document From Registry
**Description:** As a CLI user, I want the builder to emit a valid OpenAPI 3.2 document from selected fragments so that current merge output can eventually be replaced.

**Acceptance Criteria:**
- [ ] Emit root `openapi`, `info`, `servers`, `paths`, and `components`.
- [ ] Emit rewritten `$ref` values only.
- [ ] Preserve OAS 3.2 fields such as `dataValue`, `serializedValue`, and `itemSchema`.
- [ ] Output passes `validateDocument()`.
- [ ] Add fixture target that emits book and notebook APIs with colliding `Note` source names.

### US-010: Add CLI Entry for Definition Builder
**Description:** As a CLI user, I want a command or script to build target OpenAPI documents from fragment configs so that the builder can run in CI and local workflows.

**Acceptance Criteria:**
- [ ] Add a CLI command or script such as `oa-gen build-spec --target ...`.
- [ ] Support output path.
- [ ] Support diagnostics output.
- [ ] Exit non-zero on duplicate canonical id or unresolved required refs.
- [ ] Tests cover success and failure CLI cases.

### US-011: Integrate Builder With WorkspaceIndex
**Description:** As a user of large specs, I want fragment-level changes to dirty only affected target bundles so that multi-server schema builds are incremental.

**Acceptance Criteria:**
- [ ] Store fragment file/hash/id/ref metadata in WorkspaceIndex or an adjacent builder index.
- [ ] Changing a schema fragment dirties target bundles that include it directly or transitively.
- [ ] Changing target config dirties only that target.
- [ ] Driver fallback and full rebuild principles match ADR-006.
- [ ] Tests cover changed schema fragment invalidating dependent target.

### US-012: Document Migration From Current Domain Merge
**Description:** As a maintainer, I want a migration plan from current domain-level `merge.ts` to the definition builder so that current schemas remain stable during transition.

**Acceptance Criteria:**
- [ ] Document current merge path and new builder path side by side.
- [ ] Define which current files become fragments.
- [ ] Define compatibility requirements for `.merged.yaml` and `.merged.3.1.yaml`.
- [ ] Include rollback plan: current merge remains available until builder output matches expected validation.
- [ ] Update `docs/internal/todo.md` with implementation order.

## Functional Requirements

- FR-1: A definition's canonical identity must be independent from its output component name.
- FR-2: Output naming must be deterministic and documented.
- FR-3: Source definitions must not be renamed only to avoid output collisions.
- FR-4: Target builds must support different servers and path/domain subsets.
- FR-5: `$ref` rewrite must produce standard OpenAPI refs in emitted documents.
- FR-6: Structural equality must not imply semantic dedupe.
- FR-7: Builder diagnostics must preserve source path/pointer where possible.
- FR-8: Emitted documents must pass existing parser validation.
- FR-9: Existing domain merge must remain available during migration.
- FR-10: Name allocation must be scoped by target server first, then domain, then local definition name.
- FR-11: Collision reports must explain whether a rename, warning, or error occurred.
- FR-12: Canonical identity and output symbol equivalence must never be inferred by string flattening.
- FR-13: If two canonical identities flatten to the same output symbol, the builder must report `output-name-collision`.
- FR-14: Canonical IDs must use the fixed `kind:scope/domain/name` hierarchy; deeper hierarchy belongs in metadata, not the identity path.

## Non-Goals

- Do not remove `packages/schemas/scripts/merge.ts` immediately.
- Do not force all existing schema files into the new fragment format in one step.
- Do not automatically dedupe schemas based only on identical structure.
- Do not change runtime mock-server/router/client behavior as part of the initial builder.
- Do not introduce a new database-backed registry for authoring in the first iteration.

## Technical Considerations

- Reuse existing `resolveRefGraph()`, source location, and external alias concepts where possible.
- Canonical refs should use `oa://{kind}/{scope}/{domain}/{name}` and normalize to `kind:scope/domain/name`.
- Naming policy should reuse lessons from typegen external alias rename.
- Naming policy should be target-local: the same domain/local name can have different output inclusion sets per target without cross-target leakage.
- WorkspaceIndex can be extended later, but first implementation can be memory/full rebuild.
- Fragment authoring should support both `oa://...` canonical refs and relative file refs where practical.
- The builder should keep diagnostics machine-readable.

## Success Metrics

- `schema:public/book/Note` and `schema:public/notebook/Note` can coexist and emit as separate output schemas.
- A target can include only selected server/path/domain subsets.
- Output OpenAPI 3.2 validates with current parser pipeline.
- Naming collisions are deterministic and inspectable through alias metadata.
- Collision simulations produce stable machine-readable reports for rename/warning/error cases.
- Current schema validation pipeline remains unaffected until migration is explicitly enabled.

## Open Questions

- Should canonical ids be declared in frontmatter or inferred from file path?
- Should target configs live under `packages/schemas/src/targets`?
- Should `oa://schema/public/book/Note` be public syntax or internal only?
- Should semantic aliasing be represented as a separate fragment type?
- Should builder output replace `.merged.yaml` or generate parallel artifacts first?
