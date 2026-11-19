# oa-sdk Engineering Handoff

Last updated: 2026-11-20
Repository: `/Users/junwoobang/workflow/oa-sdk`
Main: `main` at `9bf2d649`, in sync with `origin/main` (use `git log -1 --oneline`)
Open PRs: #23 (draft, `experiment/effect-tsgo-oa-reference-20261027`)

The 2026-10-21 → 10-23 session record (landed PR table, verification evidence, released and resolved items) is no longer in this file. Read it with `git show c080be1e:HANDOFF.md`.

## 1. Current state

- **GitHub Actions works again.** The billing block recorded on 2026-10-23 is resolved: the three most recent `workflow_dispatch` runs of `CI` on `main` succeeded (2026-11-15 UTC). `.github/workflows/ci.yml` runs on `pull_request` and `workflow_dispatch` only, on `ubuntu-24.04` with Node 26. It is still the essential subset; `pnpm ci:local` remains the full gate (maintenance/internal workspaces, schema validation and rollback, public runtime, TS7, NestJS/FastAPI governance).
- **49 commits landed on `main` since the previous handoff (`c080be1e`, 2026-10-23).** See section 2.
- **Source versions:** `@oa-sdk/codegen` 0.11.0, `ast-sync` 0.3.0, `tools` 0.2.3, `typespec-decorators` 0.5.0, `ftp-contract` 0.3.0, `mcp-mesh` 0.1.4, `parser` 0.5.0, `client` 0.3.0, `router` 0.2.5, `popup-bridge` 0.2.0 (private).
- **Pending changesets: 1.** `.changeset/ftp-contract-turbo-output.md` (`@oa-sdk/ftp-contract` patch).
- **Release state:** the local `oa-sdk-releases` log has release commits for `2026-10-31-ftp-contract-v0.3.0` and `2026-11-14 typespec decorators v0.5.0`. The npm registry was not queried for this handoff, so published versions are unconfirmed here.
- **Worktrees: 3.** `main`; `.claude/worktrees/vibrant-nightingale-658fc0` (`fix/pydantic-encoding-degraded`); an opencode worktree `pipeline-stability-validation` (detached at `020ec128`).
- **Local branches besides `main`:** `wip/pydantic-p2c-fastapi-router`, `release/typespec-tool-pipeline`, `fix/ftp-contract-dist-fixtures`, `fix/pydantic-encoding-degraded`, `experiment/effect-tsgo-oa-reference-20261027`, `claude/exciting-boyd-2ac5b7`, `claude/vibrant-nightingale-658fc0`.
- **Defects:** the verification ledger reports `open 0, fixed 10` (FR-01–09 and TEST-01). The source of truth is [docs/internal/verification/registry.json](./docs/internal/verification/registry.json); the readable view is [status.md](./docs/internal/verification/status.md).

## 2. Landed since 2026-10-23

Details are in [docs/changelog.md](./docs/changelog.md) and `git log c080be1e..HEAD`.

| Date | Item |
|---|---|
| 2026-10-25 | Purpose-specific pipeline isolation (`api` / `data` / `interface`) and unified guard generation ([checkpoint](./docs/internal/pipeline-isolation-checkpoint-2026-10-25.md)) |
| 2026-10-28 | `@oa-sdk/popup-bridge` (private) |
| 2026-10-30 | Incremental `oa-gen generate` target reuse; FR-05–09 fixed with regressions registered ([feature review](./docs/reports/feature-review-2026-10-26.md)) |
| 2026-10-31 | `@oa-sdk/ftp-contract` 0.3.0 |
| 2026-11-07 → 11-09 | OAS 3.2 → Pydantic v2 generator, Phase 1 and Phase 2 types-only scope (PR #25–#37). FastAPI router stub, `ContractRegistry` adapter and manifest/provenance are out of scope by decision ([Phase 2 doc](./docs/internal/architecture/pydantic-codegen-phase2.md)) |
| 2026-11-09 | CI governance gates restored (PR #38, #39) |
| 2026-11-14 | `@oa-sdk/typespec-decorators` 0.5.0 release preparation |
| 2026-11-15 → 11-16 | CI lanes made parallel and cacheable, Ubuntu 24.04 pinned, essential lane moved to Node 26 |
| 2026-11-16 | Docs cleanup: `docs/internal/todo.md` reduced to open work and backlog, completed history moved to `docs/internal/todo-archive.md` |
| 2026-11-20 | `@oa-sdk/ast-sync@0.3.0` & `@oa-sdk/codegen@0.11.0`: pure data-model TypeSpec → Draft 2020-12 JSON Schema (`compileTypeSpecToJsonSchemas`), named `alias` preservation, `createTypeSpecFallbackHost`, Zod-free `@oa-sdk/codegen/typespec` & `./guards` subpaths (`zod` removed from `peerDependencies`), and standalone guard `.errors`/`validate*`/`assert*`/`writePackageJson: 'auto'` |

## 3. Remaining work

[docs/internal/todo.md](./docs/internal/todo.md) is the single list. As of 2026-11-16 it holds:

- **One open task:** external document interoperability and autocomplete metadata ([plan](./docs/internal/external-document-interop-autocomplete.plan.md)).
- **Report feedback backlog (awaiting a decision, not approved work):** items collected from `docs/reports/`.
- **Owner-gated backlog:** cross-repo projection is not checked by CI (`pnpm check:cross-repo-projection` is a manual gate), the contract release boundary, and DPM Phase 10, which stays a no-op until the external owner decides.

Completed items and the closed 2026-10-23 backlog review are in [docs/internal/todo-archive.md](./docs/internal/todo-archive.md).

### Carried over from 2026-10-23, not re-checked

- **`NPM_TOKEN` is left to expire (2026-10-23 decision).** The publish workflow is OIDC-only and never receives the token, so expiry does not affect releases. Do not add it back to the workflow.
- **Dev-only dependency advisories (as of 2026-10-23).** `pnpm audit --prod` was 0. The full audit left 4 dev-only advisories: `braces` and `sprintf-js` had no patched release, `uuid` needed an incompatible Azure MSAL major, and `esbuild` was a Windows dev-server low. Re-run `pnpm audit` before relying on these numbers.

## 4. Environment notes / gotchas

- **pnpm:** 11.28.6 required (`engines.pnpm` is `>=11.28.6 <12`). A system `pnpm` outside that range fails the engines check; run `corepack pnpm ...` or `mise exec`.
- **Node:** development `engines.node` is `>=24.0.0 || >=26.0.0`; local Node is 24.22.1; GitHub CI uses Node 26. Published packages require `>=22`. `oa-gen init` intentionally writes **`@types/node ^22.0.0`** so generated projects do not typecheck Node 24-only APIs. If changing this, derive the major from the target project's `engines.node`/`.nvmrc`/`.node-version` instead of hard-coding it.
- **CI:** GitHub runs the essential lanes; run `pnpm ci:local` for the full set (log path printed at the end; `LOCAL_CI_KEEP=1` keeps it).
- **npm credentials (as of 2026-10-23):** trusted publishing is configured, and the publish workflow is OIDC-only and passes no token. See [the OIDC guide](./docs/guides/oidc-trusted-publishing.md).
- **Release artifacts:** the `archive/chunk-stream-0.2.0-publish` tag (`23afe831`) is the original published release commit; keep it.
- **Release repository (local):** `/Users/junwoobang/workflow/oa-sdk-releases`, `main` at `c186f20`, in sync with `origin/main`.
- **Generated files:** do not edit `.merged*.yaml`, `dist/`, the graph sidecar, or `docs/internal/verification/status.md` by hand. Regenerate with the documented command (`pnpm verification:report` for the status file).
- **Root status files:** `PROJECT.md`, `TEST_INFRA.md` and `TEST_READY.md` are pinned by `tests/e2e/output-routing-tanstack/tier1-feature-coverage.test.ts`; do not rewrite them as part of a docs cleanup.

## 5. Suggested order

1. Decide which report-feedback backlog items in `docs/internal/todo.md` to adopt; only adopted items become tasks.
2. Release the pending `@oa-sdk/ftp-contract` patch changeset when ready, following [the release runbook](./docs/guides/release-preparation.md).
