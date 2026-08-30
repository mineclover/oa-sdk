# TypeSpec Production Operations

Status: active operations guide for the TypeSpec-first production schema path. Last reviewed 2026-08-11.

This document records the operating decisions after the TypeSpec-first production migration and G13-G15 drift burn-down. It is intentionally narrower than the design and migration goal documents: it says what maintainers should do now.

## Current Operating Decisions

### Release And Versioning

- The repository root and most workspace packages are private. `@oa-sdk/codegen`과 그 runtime dependency closure는 public npm distribution candidate지만, private source repository의 [`release-policy.json`](../release-policy.json)은 `artifact-only` mode만 허용한다. Registry publish는 별도 artifact repository의 승인된 workflow가 담당한다.
- `@oa-sdk/codegen` `0.3.0` was the internal milestone that established the TypeSpec roundtrip, bundle-check, sidecar, and production source-path work. The current distribution candidate is `0.6.0`; its version is governed by the public release artifact and Changeset flow rather than the completed migration milestone.
- Do not bump a package merely to restate the completed G13-G15 drift burn-down. A new version must correspond to the reviewed package artifact being promoted.
- A registry release requires package-specific approval, a Changeset, confirmed exports, and the full build/test/pack smoke. The current TypeSpec migration milestone itself does not require a version bump.
- The public API contract version is `OaSdkApi.ContractVersion` in `packages/schemas/typespec/version.tsp`, emitted as OpenAPI `info.version`. It is SemVer-governed independently of package versions; before `1.0.0`, incompatible consumer changes advance `0.MINOR`.
- Bundle (`oa-sdk.typespec-bundle.v1`), current sidecar-less extension (`oa-sdk.typespec-extensions.v5`), candidate, and accepted-drift `schemaVersion` values version their own machine-readable formats. They must not be used as API-release numbers.

### Publish Flow

Release 후보를 만들기 전에 source change는 `main` 대상 review를 통과해야 한다. 공식 artifact export는 clean, committed worktree에서만 실행한다.

Required evidence:

```bash
git fetch origin --prune
git rev-list --left-right --count origin/main...HEAD
git status --short --branch --untracked-files=all
```

If the branch is behind or diverged, rebase/merge review must happen before artifact promotion. Do not
direct-publish from the private source repository. After the validation gates below pass, use the
artifact exporter described in [`release-management.md`](../release-management.md):

```bash
pnpm check:release-policy
pnpm release:export -- \
  --output ../oa-sdk-releases \
  --release-id <immutable-release-id> \
  --version @oa-sdk/codegen=<next-version>
```

### Validation Gates

Run these gates before artifact export or before declaring the production schema path operationally green:

```bash
pnpm schema:validate
pnpm schema:bundle
node packages/codegen/dist/cli/index.js check-artifact --head packages/schemas/src/.merged.3.1.yaml --artifact packages/schemas/dist/openapi.yaml
pnpm schema:rollback-check
pnpm --filter @oa-sdk/schemas run downstream:check
pnpm --filter @oa-sdk/codegen exec vitest run src/__tests__/typespec-authored-bundle.test.ts src/__tests__/typespec-sidecar.test.ts src/__tests__/typespec-sidecar-to-extensions.test.ts src/__tests__/typespec-extension-schema-version.test.ts
pnpm build:scripts
pnpm check:api-index
pnpm check:cli-spec
pnpm check:feature-tests
pnpm --filter @oa-sdk/codegen run typecheck
git diff --check
```

`pnpm schema:validate` proves the default TypeSpec source path. `pnpm schema:bundle` regenerates the package-consumed OpenAPI 3.1 bundle, and `check-artifact` proves that `dist/openapi.yaml` matches it. `pnpm schema:rollback-check` proves the OpenAPI/Definition Builder rollback path. `pnpm --filter @oa-sdk/schemas run downstream:check` proves parser, codegen, router, client, mock-server, and generated TypeScript consumer compatibility against the TypeSpec-restored production OpenAPI.

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
- Bundle entrypoint: `main.tsp` is the composition root; `metadata/service.tsp`, `metadata/security.tsp`, and `metadata/common-components.tsp` own root metadata and `main.tsp` imports `common.tsp`,
  `auth.tsp`, `health.tsp`, `me.tsp`, and `users.tsp`.
- Domain ownership: `common` owns shared auth/error models; each remaining module owns its domain
  models, response wrappers, and operations.
- Generated production OpenAPI artifacts: `packages/schemas/src/.merged.yaml`, `packages/schemas/src/.merged.3.1.yaml`, and `packages/schemas/src/.merged.3.1.meta.json`.
- Approved contract snapshot: `packages/schemas/typespec/approved.openapi.yaml`. It is generated from the TypeSpec-restored artifact and updated only through `pnpm schema:approve-typespec-reference -- --write` after reviewing its normalized diff.
- Historical/evidence fixtures: `docs/internal/typespec-roundtrip/fixtures/`.
- Rollback/reference OpenAPI fragments: `packages/schemas/src/domains`, `packages/schemas/src/fragments`, `packages/schemas/src/profiles`, and `packages/schemas/src/targets`.

Do not treat generated OpenAPI artifacts or the approved snapshot as hand-authored source. Update `.tsp` first, inspect `pnpm schema:approve-typespec-reference`, then accept the reviewed snapshot with `--write` and regenerate through the TypeSpec gate.

### Snapshot Promotion

The approval command is deliberately two-stage:

```bash
pnpm schema:approve-typespec-reference
pnpm schema:approve-typespec-reference -- --write
```

The first command retains a candidate under the ignored path
`.oa-sdk/typespec-candidates/<manifest-hash>/`. Its metadata records the manifest, the
bundle-root source hash (all nested `.tsp` files, TypeSpec config, bundle manifest,
compatibility sidecar, and—when imported—the trusted decorator package source), the current
approved snapshot hash, and the generated candidate hash. Review the normalized diff before the
second command.

`--write` can update only the `expectedOpenapi` path declared in the supplied manifest;
it does not fall back to the production snapshot. The command rechecks the source and
approved snapshot hashes immediately before promotion, so a changed review baseline or
source requires a new candidate.

If `accepted-restored-drift.json` has entries, promotion stops. Review whether the drift
is genuinely resolved, then promote and reset both artifacts explicitly:

```bash
pnpm schema:approve-typespec-reference -- --write --clear-accepted-restored-drift
```

Commit the approved snapshot and the cleared drift manifest together. A nonempty drift
manifest with a newly promoted snapshot would fail the normal TypeSpec drift gate.

For this paired write, the approval command persists an ignored recovery journal under
`.oa-sdk/typespec-snapshot-promotions/` before modifying either file. If execution is
interrupted, the next approval or `schema:typespec-check` finishes the recorded pair
only after both recorded payloads and on-disk hashes are recognized; otherwise it stops
before replacing either file.

## Post-Promotion Checks

After push:

```bash
git status --short --branch --untracked-files=all
git rev-list --left-right --count origin/main...HEAD
```

The expected source state after the reviewed merge is a clean worktree with `0 0` relative to
`origin/main`. Verify that the artifact repository manifest records this source commit as
`sourceRevision`; registry verification runs from the artifact repository, not this private checkout.
