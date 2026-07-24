# TypeSpec Production Operations

Status: active operations guide for the TypeSpec-first production schema path. Last reviewed 2026-06-22.

This document records the operating decisions after the TypeSpec-first production migration and G13-G15 drift burn-down. It is intentionally narrower than the design and migration goal documents: it says what maintainers should do now.

## Current Operating Decisions

### Release And Versioning

- The repository root and workspace packages are private. `changeset publish` is not the current release mechanism for this TypeSpec migration.
- `@oa-sdk/codegen` `0.3.0` is the internal milestone that owns the TypeSpec roundtrip, bundle-check, sidecar, and production source-path work.
- Do not bump beyond `0.3.0` just to mark the G13-G15 drift burn-down. The milestone is already documented as complete, and the drift burn-down closes the same production switch scope.
- A future public npm release requires a separate packaging decision: remove or revise `private: true`, add changesets, confirm package exports, and run the full build/test/publish dry run.

### Publish Flow

Before pushing the production migration branch, the local branch must be fast-forwardable against `origin/master` and the worktree must be clean.

Required evidence:

```bash
git fetch origin --prune
git rev-list --left-right --count origin/master...HEAD
git status --short --branch --untracked-files=all
```

If the rev-list output is `0 <ahead-count>`, direct push to `origin/master` is allowed for this repository's current workflow after the validation gates below pass. If the branch is behind or diverged, rebase/merge review must happen before publish.

### Validation Gates

Run these gates before publish or before declaring the production schema path operationally green:

```bash
pnpm schema:validate
pnpm schema:rollback-check
pnpm --filter @oa-sdk/schemas run downstream:check
pnpm --filter @oa-sdk/codegen exec vitest run src/__tests__/typespec-authored-bundle.test.ts src/__tests__/typespec-sidecar.test.ts src/__tests__/typespec-sidecar-to-extensions.test.ts
pnpm build:scripts
pnpm check:api-index
pnpm check:cli-spec
pnpm check:feature-tests
pnpm --filter @oa-sdk/codegen run typecheck
git diff --check
```

`pnpm schema:validate` proves the default TypeSpec source path. `pnpm schema:rollback-check` proves the OpenAPI/Definition Builder rollback path. `pnpm --filter @oa-sdk/schemas run downstream:check` proves parser, codegen, router, client, mock-server, and generated TypeScript consumer compatibility against the TypeSpec-restored production OpenAPI.

`schema:rollback-check` intentionally ends by running the OpenAPI/Definition Builder validation path. Before committing generated schema artifacts, rerun `pnpm schema:validate` or `pnpm --filter @oa-sdk/schemas run build` so the checked-in generated OpenAPI artifacts are TypeSpec-derived again.

### Rollback Path

Keep the OpenAPI/Definition Builder rollback path.

Do not remove these commands without a separate deprecation/removal ADR:

- Root: `schema:validate:openapi`, `schema:bundle:openapi`, `schema:preview:openapi`, `schema:rollback-check`.
- Schema package: `build:openapi`, `validate:openapi`, `bundle:openapi`, `preview:openapi`, `rollback:check`.
- Builder targets: `build:merged`, `build:merged:staging`, `build:merged:production`.

Removal can be considered only after all of these are true:

- The TypeSpec production source path has been used for at least one downstream integration cycle without requiring rollback.
- `accepted-restored-drift.json` remains empty or contains only reviewed hash-pinned drift with an explicit owner.
- A final `pnpm schema:rollback-check` run proves the rollback path still works before removal.
- A new ADR records the removal rationale, affected commands, and replacement procedure.

### Source Ownership

- Production schema authoring source: `packages/schemas/typespec/`.
- Bundle entrypoint: `main.tsp` owns root service/component metadata and imports `common.tsp`,
  `auth.tsp`, `health.tsp`, `me.tsp`, and `users.tsp`.
- Domain ownership: `common` owns shared auth/error models; each remaining module owns its domain
  models, response wrappers, and operations.
- Generated production OpenAPI artifacts: `packages/schemas/src/.merged.yaml`, `packages/schemas/src/.merged.3.1.yaml`, and `packages/schemas/src/.merged.3.1.meta.json`.
- Historical/evidence fixtures: `docs/internal/typespec-roundtrip/fixtures/`.
- Rollback/reference OpenAPI fragments: `packages/schemas/src/domains`, `packages/schemas/src/fragments`, `packages/schemas/src/profiles`, and `packages/schemas/src/targets`.

Do not treat the generated OpenAPI artifacts as hand-authored source. Update `.tsp` first, then regenerate through the TypeSpec gate.

## Post-Publish Checks

After push:

```bash
git status --short --branch --untracked-files=all
git rev-list --left-right --count origin/master...HEAD
```

The expected state after a direct `master` publish is a clean worktree with `0 0` relative to `origin/master`.
