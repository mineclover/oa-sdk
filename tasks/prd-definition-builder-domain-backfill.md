# PRD: Definition Builder Domain Backfill

## Overview

The OpenAPI Definition Builder engine is implemented: canonical IDs, registry graph, target selection, output naming, OpenAPI emit, CLI build entry, and WorkspaceIndex metadata integration are available. The remaining migration work is to backfill the current domain-level schema sources into definition fragments and prove that builder output can match the existing `.merged.yaml` contract without removing the current merge path.

This PRD migrates the current `packages/schemas/src/domains/{common,health,users}/spec.yaml` sources into builder-compatible fragments and target configs. The migration must run in parallel with the existing `packages/schemas/scripts/merge.ts` flow until parity is proven by normalized diff, validation, downgrade compatibility, and downstream codegen/mock tests.

## Goals

- Backfill current domain schemas into canonical definition fragments.
- Preserve existing `.merged.yaml` and `.merged.3.1.yaml` behavior during migration.
- Build a parallel OpenAPI artifact with `oa-gen build-spec`.
- Compare builder output against the current merged artifact with normalized diffs.
- Keep rollback simple: `merge.ts` remains the active source of truth until parity is accepted.
- Add tests and docs that prove the fragment backfill is complete enough to replace the current merge path later.

## Quality Gates

These commands must pass for every user story where applicable:

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm schema:validate`
- `pnpm build:scripts && pnpm check:api-index`
- `pnpm check:feature-tests`

When a story changes schema fixtures, docs, public exports, or feature/test mapping:

- update `docs/internal/spec.md`
- update `docs/internal/todo.md`
- update `docs/internal/feature-test-matrix.json` if feature coverage paths change
- update `docs/internal/api-index.md` if public exports change

## User Stories

### US-001: Inventory Current Merge Sources
**Description:** As a schema maintainer, I want an inventory of the current merge inputs so that the fragment backfill has a complete source checklist.

**Acceptance Criteria:**
- [ ] List current profile files under `packages/schemas/src/profiles`.
- [ ] List current domain specs under `packages/schemas/src/domains`.
- [ ] List current shared components in `common/spec.yaml`.
- [ ] List current paths and operations in `health/spec.yaml`.
- [ ] List current paths and operations in `users/spec.yaml`.
- [ ] Record current `.merged.yaml` path, `.merged.3.1.yaml` path, and validation commands.
- [ ] Document which source sections map to definition fragment kinds.

### US-002: Create Parity Target Configs
**Description:** As a builder user, I want target configs equivalent to the current environment profiles so that builder output can be generated beside the existing merge output.

**Acceptance Criteria:**
- [ ] Add target config for local parity based on `packages/schemas/src/profiles/local.yaml`.
- [ ] Add target configs for staging and production if current profile files exist.
- [ ] Target configs include stable `name`, `scopes`, `domains`, `servers`, and `includePaths`.
- [ ] Local parity target includes all paths currently emitted by `.merged.yaml`.
- [ ] Target config tests verify target selection includes expected direct paths and shared refs.
- [ ] Current domain merge remains unchanged.

### US-003: Backfill Shared Common Fragments
**Description:** As a schema author, I want common schemas, responses, parameters, and security schemes split into canonical fragments so that downstream domains can reference shared definitions by stable identity.

**Acceptance Criteria:**
- [ ] Convert common schemas into `schema:shared/common/*` fragments.
- [ ] Convert common responses into `response:shared/common/*` fragments.
- [ ] Convert common parameters into `parameter:shared/common/*` fragments.
- [ ] Convert common security schemes into `securityScheme:shared/common/*` fragments.
- [ ] Replace local shared refs inside fragments with `oa://...` canonical refs.
- [ ] Tests verify common fragments register without duplicate canonical IDs.
- [ ] Tests verify emitted shared component names match or intentionally alias current merged output names.

### US-004: Backfill Health Domain Fragments
**Description:** As a schema author, I want health domain paths and schemas represented as fragments so that health endpoints can be emitted by the builder.

**Acceptance Criteria:**
- [ ] Convert `/health` into a path fragment with canonical identity.
- [ ] Convert `/health/stream` into a path fragment with canonical identity.
- [ ] Convert `HealthStatus` into a schema fragment.
- [ ] Preserve SSE `itemSchema` behavior for `/health/stream`.
- [ ] Replace refs to common responses/schemas with canonical refs.
- [ ] Tests verify health fragments emit paths and components equivalent to current merge output.

### US-005: Backfill Users Domain Fragments
**Description:** As a schema author, I want users domain paths and schemas represented as fragments so that user APIs can be emitted by the builder.

**Acceptance Criteria:**
- [ ] Convert `/users` into a path fragment with canonical identity.
- [ ] Convert `/users/{id}` into a path fragment with canonical identity.
- [ ] Convert `User`, `CreateUserRequest`, and `UpdateUserRequest` into schema fragments.
- [ ] Preserve current request/response refs and operation IDs.
- [ ] Preserve current pagination, filter, error response, and security refs.
- [ ] Tests verify users fragments emit paths and components equivalent to current merge output.

### US-006: Add Builder Parity Artifact Workflow
**Description:** As a release maintainer, I want a repeatable workflow that builds a builder artifact and compares it with current `.merged.yaml` so that parity can be reviewed before replacing merge output.

**Acceptance Criteria:**
- [ ] Add command or documented script to run `oa-gen build-spec` for the local parity target.
- [ ] Write builder output to a parallel artifact path that does not replace `.merged.yaml`.
- [ ] Emit diagnostics JSON and collision report JSON for the parity build.
- [ ] Add normalized diff command or script comparing current `.merged.yaml` to builder output.
- [ ] Diff ignores expected ordering differences.
- [ ] Diff reports unexpected path/component/security/server differences.
- [ ] Tests cover successful parity artifact generation and at least one intentional diff case.

### US-007: Validate Compatibility Gates
**Description:** As a maintainer, I want the builder parity artifact to pass the same validation and downstream codegen gates as the current merged artifact so that migration risk is visible.

**Acceptance Criteria:**
- [ ] Builder artifact passes `oa-gen validate`.
- [ ] Builder artifact passes current schema validation flow or an explicitly documented equivalent.
- [ ] Builder artifact can be downgraded to OpenAPI 3.1 with sidecar output.
- [ ] Generated typegen output from builder artifact is compared with current generated output or documented accepted differences.
- [ ] Router/client/mock-server compatibility checks run against builder artifact.
- [ ] Any accepted drift is documented with rationale and owner.

### US-008: Document Rollback and Replacement Criteria
**Description:** As a maintainer, I want rollback and replacement criteria documented so that the builder can replace `.merged.yaml` only when parity is safe.

**Acceptance Criteria:**
- [ ] Document that `merge.ts` remains the active production path during parity work.
- [ ] Document rollback path to current `merge.ts` and current domain specs.
- [ ] Document the exact criteria required before builder output may replace `.merged.yaml`.
- [ ] Document how `.merged.3.1.yaml` compatibility is preserved.
- [ ] Update `docs/internal/todo.md` with the migration status.
- [ ] Update `docs/internal/spec.md` with builder parity status.

### US-009: Final Migration Verification
**Description:** As a release maintainer, I want final verification for the domain backfill migration so that the next phase can decide whether to switch merge output.

**Acceptance Criteria:**
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm build` passes.
- [ ] `pnpm schema:validate` passes.
- [ ] `pnpm build:scripts && pnpm check:api-index` passes.
- [ ] `pnpm check:feature-tests` passes.
- [ ] Builder parity artifact has zero error diagnostics.
- [ ] Normalized diff is accepted and documented.
- [ ] No temporary test artifacts remain unless intentionally documented.
- [ ] Remaining dirty files are documented if unrelated work exists.

## Functional Requirements

- FR-1: The migration must create canonical fragments for all current common, health, and users schema content needed by `.merged.yaml`.
- FR-2: The migration must create target configs that can reproduce current profile server settings.
- FR-3: Builder parity output must be generated beside the current merged artifact, not in place of it.
- FR-4: Builder parity output must preserve OpenAPI 3.2-specific fields used by the current specs.
- FR-5: Builder parity diagnostics and collision reports must be machine-readable.
- FR-6: Normalized diff must separate acceptable ordering noise from semantic API drift.
- FR-7: Replacement of `.merged.yaml` must remain out of scope until parity gates are accepted.

## Non-Goals

- Do not delete `packages/schemas/scripts/merge.ts`.
- Do not replace `.merged.yaml` as part of this PRD.
- Do not rewrite runtime mock-server/router/client behavior.
- Do not introduce a new storage-backed authoring registry.
- Do not change public API exports unless a story explicitly requires it.
- Do not migrate unrelated example or reference specs outside current `common`, `health`, and `users` domains.

## Technical Considerations

- Reuse existing Definition Builder APIs in `@oa-sdk/parser`.
- Reuse `oa-gen build-spec` from `@oa-sdk/codegen`.
- Prefer canonical refs such as `oa://schema/shared/common/Error`.
- Preserve current component names through target-local output naming or explicit aliases.
- Keep target configs stable and reviewable.
- Keep generated parity artifacts out of source control unless deliberately approved.
- Use current `spec-diff` utilities where possible; extend only if normalized comparison needs schema-aware behavior.

## Success Metrics

- All current domain paths are represented by fragments.
- Local parity target emits the same public API surface as current `.merged.yaml`.
- Builder parity artifact validates and can be downgraded.
- Downstream typegen/router/client/mock checks either match current output or have documented accepted differences.
- `merge.ts` rollback remains available until a later replacement PRD.

## Open Questions

- Should parity artifacts be written under `packages/schemas/src/.builder/`, `packages/schemas/dist/`, or a temporary CI-only path?
- Should normalized diff be implemented by extending `scripts/spec-diff.ts` or by adding a builder-specific comparator?
- Should staging/production target configs be required before local parity is accepted?
