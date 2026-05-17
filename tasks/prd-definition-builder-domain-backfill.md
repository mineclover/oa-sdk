# PRD: Definition Builder Domain Backfill

Status: implemented in OA SDK. The original common/health/users backfill was completed and the target has since expanded to the current `common`, `auth`, `health`, `me`, and `users` domains. `pnpm --filter @oa-sdk/schemas run build:merged` and `pnpm schema:validate` are the current verification gates.

## Overview

The OpenAPI Definition Builder engine is implemented: canonical IDs, registry graph, target selection, output naming, OpenAPI emit, CLI build entry, and WorkspaceIndex metadata integration are available. This PRD backfilled the former domain-level schema sources into definition fragments and proved that builder output can own the existing `.merged.yaml` contract.

This PRD migrated the original domain specs into builder-compatible fragments and target configs. Builder output now owns `.merged.yaml`; the former `packages/schemas/scripts/merge.ts` flow has been removed.

## Goals

- Backfill current domain schemas into canonical definition fragments.
- Preserve existing `.merged.yaml` and `.merged.3.1.yaml` behavior through the builder replacement.
- Build the canonical OpenAPI artifact with `oa-gen build-spec`.
- Retire the temporary parity diff path after replacement.
- Keep rollback explicit through git history; the active source of truth is now target config + fragments.
- Add tests and docs that prove the fragment backfill is complete enough to replace the legacy merge path.

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

### US-001: Inventory Legacy Merge Sources
**Description:** As a schema maintainer, I want an inventory of the legacy merge inputs so that the fragment backfill has a complete source checklist.

**Acceptance Criteria:**
- [x] List legacy profile files under `packages/schemas/src/profiles`.
- [x] List legacy domain specs under `packages/schemas/src/domains`.
- [x] List current shared components in `common/spec.yaml`.
- [x] List current paths and operations in `health/spec.yaml`.
- [x] List current paths and operations in `users/spec.yaml`.
- [x] Record current `.merged.yaml` path, `.merged.3.1.yaml` path, and validation commands.
- [x] Document which source sections map to definition fragment kinds.

### US-002: Create Target Configs
**Description:** As a builder user, I want target configs equivalent to the environment profiles so that builder output can generate the canonical OpenAPI artifact.

**Acceptance Criteria:**
- [x] Add target config for local parity based on legacy `packages/schemas/src/profiles/local.yaml`.
- [x] Add target configs for staging and production if current profile files exist.
- [x] Target configs include stable `name`, `scopes`, `domains`, `servers`, and `includePaths`.
- [x] Local parity target includes all paths currently emitted by `.merged.yaml`.
- [x] Target config tests verify target selection includes expected direct paths and shared refs.
- [x] Legacy domain merge remained unchanged during parity, then was removed after replacement.

### US-003: Backfill Shared Common Fragments
**Description:** As a schema author, I want common schemas, responses, parameters, and security schemes split into canonical fragments so that downstream domains can reference shared definitions by stable identity.

**Acceptance Criteria:**
- [x] Convert common schemas into `schema:shared/common/*` fragments.
- [x] Convert common responses into `response:shared/common/*` fragments.
- [x] Convert common parameters into `parameter:shared/common/*` fragments.
- [x] Convert common security schemes into `securityScheme:shared/common/*` fragments.
- [x] Replace local shared refs inside fragments with `oa://...` canonical refs.
- [x] Tests verify common fragments register without duplicate canonical IDs.
- [x] Tests verify emitted shared component names match or intentionally alias merged output names.

### US-004: Backfill Health Domain Fragments
**Description:** As a schema author, I want health domain paths and schemas represented as fragments so that health endpoints can be emitted by the builder.

**Acceptance Criteria:**
- [x] Convert `/health` into a path fragment with canonical identity.
- [x] Convert `/health/stream` into a path fragment with canonical identity.
- [x] Convert `HealthStatus` into a schema fragment.
- [x] Preserve SSE `itemSchema` behavior for `/health/stream`.
- [x] Replace refs to common responses/schemas with canonical refs.
- [x] Tests verify health fragments emit paths and components equivalent to builder output.

### US-005: Backfill Users Domain Fragments
**Description:** As a schema author, I want users domain paths and schemas represented as fragments so that user APIs can be emitted by the builder.

**Acceptance Criteria:**
- [x] Convert `/users` into a path fragment with canonical identity.
- [x] Convert `/users/{id}` into a path fragment with canonical identity.
- [x] Convert `User`, `CreateUserRequest`, and `UpdateUserRequest` into schema fragments.
- [x] Preserve current request/response refs and operation IDs.
- [x] Preserve current pagination, filter, error response, and security refs.
- [x] Tests verify users fragments emit paths and components equivalent to builder output.

### US-006: Add Builder Artifact Workflow
**Description:** As a release maintainer, I want a repeatable workflow that builds the builder artifact and records diagnostics so that replacement can be reviewed and maintained.

**Acceptance Criteria:**
- [x] Add command or documented script to run `oa-gen build-spec` for the local parity target.
- [x] Initially write builder output to a parallel artifact path before replacing `.merged.yaml`.
- [x] Emit diagnostics JSON and collision report JSON for the parity build.
- [x] Add normalized diff command or script comparing current `.merged.yaml` to builder output.
- [x] Diff ignores expected ordering differences.
- [x] Diff reports unexpected path/component/security/server differences.
- [x] Tests cover successful builder artifact generation and at least one intentional diff case.

### US-007: Validate Compatibility Gates
**Description:** As a maintainer, I want the builder artifact to pass the same validation and downstream codegen gates as the merged artifact so that migration risk is visible.

**Acceptance Criteria:**
- [x] Builder artifact passes `oa-gen validate`.
- [x] Builder artifact passes the current schema validation flow.
- [x] Builder artifact can be downgraded to OpenAPI 3.1 with sidecar output.
- [x] Generated typegen output from builder artifact is compared with current generated output or documented accepted differences.
- [x] Router/client/mock-server compatibility checks run against builder artifact.
- [x] Any accepted drift is documented with rationale and owner.

### US-008: Document Rollback and Replacement Criteria
**Description:** As a maintainer, I want rollback and replacement criteria documented so that builder ownership of `.merged.yaml` stays safe.

**Acceptance Criteria:**
- [x] Document that `merge.ts` remained the active production path during parity work.
- [x] Document rollback path through git history after `merge.ts` removal.
- [x] Document the exact criteria required before builder output may replace `.merged.yaml`.
- [x] Document how `.merged.3.1.yaml` compatibility is preserved.
- [x] Update `docs/internal/todo.md` with the migration status.
- [x] Update `docs/internal/spec.md` with builder parity status.

### US-009: Final Migration Verification
**Description:** As a release maintainer, I want final verification for the domain backfill migration so that builder output can own `.merged.yaml`.

**Acceptance Criteria:**
- [x] `pnpm typecheck` passes.
- [x] `pnpm test` passes.
- [x] `pnpm build` passes.
- [x] `pnpm schema:validate` passes.
- [x] `pnpm build:scripts && pnpm check:api-index` passes.
- [x] `pnpm check:feature-tests` passes.
- [x] Builder artifact has zero error diagnostics.
- [x] Normalized diff is accepted and documented.
- [x] No temporary test artifacts remain unless intentionally documented.
- [x] Remaining dirty files are documented if unrelated work exists.

## Functional Requirements

- FR-1: The migration must create canonical fragments for all current common, health, and users schema content needed by `.merged.yaml`.
- FR-2: The migration must create target configs that can reproduce current profile server settings.
- FR-3: Builder output must generate the current merged artifact in place after replacement.
- FR-4: Builder output must preserve OpenAPI 3.2-specific fields used by the specs.
- FR-5: Builder parity diagnostics and collision reports must be machine-readable.
- FR-6: Normalized diff must separate acceptable ordering noise from semantic API drift.
- FR-7: Replacement of `.merged.yaml` is allowed only after parity gates are accepted.

## Non-Goals

- Legacy `packages/schemas/scripts/merge.ts` has been deleted after replacement.
- Do not keep a parallel replacement path after this PRD is complete.
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
- Keep generated diagnostics sidecars reviewable and avoid committing temporary parity artifacts.
- Use current `spec-diff` utilities where possible; extend only if normalized comparison needs schema-aware behavior.

## Success Metrics

- All current domain paths are represented by fragments.
- Local target emits the same public API surface as `.merged.yaml`.
- Builder artifact validates and can be downgraded.
- Downstream typegen/router/client/mock checks either match current output or have documented accepted differences.
- Rollback now means reverting the builder replacement change in git.

## Open Questions

- Should diagnostics artifacts be written under `packages/schemas/src/.builder/`, `packages/schemas/dist/`, or a temporary CI-only path?
- Should normalized diff be implemented by extending `scripts/spec-diff.ts` or by adding a builder-specific comparator?
- Should staging/production target configs be required before local parity is accepted?
