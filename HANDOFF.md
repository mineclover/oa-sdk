# oa-sdk Engineering Handoff

Last updated: 2026-10-23
Repository: `/Users/junwoobang/workflow/oa-sdk`
Main: `main` (PR #21 merged; in sync with `origin/main`; use `git log -1 --oneline`)
Worktrees: main only · Open PRs: none

## 1. Current state

- `main` includes PR #13 (`5d9e59e2`), PR #14 (`153dfa22`), PR #15 (`9326c7ff`), PR #16 (`f27ca51f`), PR #17 (`975a008c`), PR #18 (`7de51c04`), PR #19 (`bfa136f3`), PR #20 (`2e55d182`) and PR #21 (`32615cb2`), and is in sync with `origin/main`. No other local branches or worktrees; 0 pending changesets; the latest release is `2026-10-23-tools-v0.2.2` (`@oa-sdk/tools@0.2.2` + `@oa-sdk/mcp-mesh@0.1.3`), the first publish through GitHub OIDC trusted publishing. Registry `latest` confirms both. `2026-10-22-core-v0.10.0`, `@oa-sdk/webmcp-peer@0.2.1`, `@oa-sdk/router@0.2.4`/`0.2.5`, and `2026-10-23-tools-v0.2.1` are also published.
- **CI policy while Actions billing is broken:** run `pnpm ci:local` (superset of `.github/workflows/ci.yml`) and treat an all-green local run as the merge/release gate. The versioned-candidate run on 2026-10-23 00:35–00:53 local passed all 46 lanes.
- Last full local test run: **661 files / 9,297 tests pass** (turbo suites 637/9,029 — codegen 211/4,012, dpm 121, mock-server 46, router 19/209, client 16/277 — plus integration 73, TypeSpec plugin e2e 130, schema 62 and rollback 3).
- The 46-lane local CI mirror covers build/typecheck, 4 test groups, integration, e2e, schema validation/rollback, governance, Node 22/24/26 public runtime, TS7 on Node 26, parser bench, and NestJS/FastAPI governance. The current run supersedes the earlier combined-tree run through PR #9.
- **GitHub Actions cannot start jobs**: PR checks show 0 steps because the account's billing limit is reached. All evidence above is from local runs.

## 2. Landed in this session (2026-10-21 → 10-23)

| Item | State |
|---|---|
| PR #5 spec-diff bundle fix | merged earlier (`b4af9074`) |
| PR #7 WebMCP relay O-62..O-77 | merged (`8bd8e95c`); spec §10.2 has no open problems |
| chunk-stream 0.2.0 release merge-back | content on main as `213a9a85`; PR #6 closed (rebased). Published commit `23afe831` preserved by tag `archive/chunk-stream-0.2.0-publish` |
| PR #8 recursive map typegen | merged (`298dfe98`); `type Node = { [key: string]: Node }`, `tsc --strict` passes |
| PR #9 TypeSpec graph semantic index | merged (`6bf4c3c1`); sidecar + public exports + API index |
| PR #10 typegen incremental reporting + guide | merged (`73d2397e`) |
| PR #11 onboarding UX + docs consistency | merged (`e960e74f`) |
| PR #12 engineering handoff | merged (`e40301ea`) |
| PR #13 TanStack P1 fixes + dotted guard names | merged (`5d9e59e2`) |
| PR #14 real streaming + P2 design decisions + P3.16 | merged (`153dfa22`) |
| PR #15 `2026-10-22-core-v0.10.0` release candidate | merged (`9326c7ff`) |
| `2026-10-22-core-v0.10.0` npm release | published from `oa-sdk-releases` (source tag `archive/2026-10-22-core-v0.10.0` → `bc7c6f8d`) |
| PR #16 webmcp-peer version fix | merged (`f27ca51f`) |
| PR #17 `pnpm ci:local` mirror | merged (`975a008c`) |
| PR #18 Elysia streaming + release-tooling hardening | merged (`7de51c04`) |
| PR #19 essential GitHub CI + full local gate | merged (`bfa136f3`) |
| PR #20 current-version + CI-topology docs | merged (`2e55d182`) |
| PR #21 Hono 4.13 / Express 5.3 target verification | merged (`32615cb2`) |
| `@oa-sdk/router@0.2.5` | published (source tag `archive/2026-10-22-router-v0.2.5` → `32615cb2`) |
| `@oa-sdk/router@0.2.4` | published after the npm token was refreshed (source tag `archive/2026-10-22-router-v0.2.4` → `7de51c04`) |
| `2026-10-22-webmcp-peer-v0.2.1` npm patch | published (source tag `archive/2026-10-22-webmcp-peer-v0.2.1` → `f27ca51f`) |
| `2026-10-22-router-v0.2.4` npm patch | published (source tag `archive/2026-10-22-router-v0.2.4` → `7de51c04`) |
| Branch/worktree cleanup | 24 merged branches + 6 verifier worktrees + 4 superseded branches removed; SHAs in `.../opencode/branch-sha-archive-2026-10-22.txt` (outside the repo) |
| Stabilization pass (2026-10-22, `960a7205`) | full `pnpm ci:local` 46/46 lanes pass (661 files / 9,297 tests); registry versions and release tags re-confirmed; no code changes required |
| Dependency security refresh (2026-10-22) | `pnpm audit --prod` 107 → **0**; full audit 94 → 4 dev-only. Hono 4.13.13, MCP SDK 1.32.1, NestJS 11.2.7/Swagger 11.4.7, Redocly 2.67/Spectral 6.17, Vite 6.4.5/8.3.5; patched transitive overrides |
| Versioned dependency-refresh candidate | `pnpm version-packages` consumed the changeset and produced `@oa-sdk/tools@0.2.1` + dependent `@oa-sdk/mcp-mesh@0.1.2`; CHANGELOGs, version tables and the type-registry baseline updated; full `pnpm ci:local` 46/46 passes |
| Release candidate export (2026-10-23) | `pnpm release:preflight` passed; official export created `oa-sdk-releases` release `2026-10-23-tools-v0.2.1` from source `3d6d5d5e` (2 tarballs, consumer smoke + `validate-release.mjs` passed); PR #11 merged (`4fdc558`) |
| Published `2026-10-23-tools-v0.2.1` | `@oa-sdk/tools@0.2.1` + `@oa-sdk/mcp-mesh@0.1.2`; [GitHub release](https://github.com/mineclover/oa-sdk-releases/releases/tag/2026-10-23-tools-v0.2.1) / tag `2026-10-23-tools-v0.2.1`; [publish run 39818377072](https://github.com/mineclover/oa-sdk-releases/actions/runs/39818377072); registry `latest` confirms both |
| Optimization pass (2026-10-23) | Deduplicated `@hono/node-server` on `2.1.5` (tools was on 1.x; spec-lens on 2.x) and pinned patched `ip-address` `10.7.4`; full `pnpm ci:local` 46/46 and clean-worktree `release:preflight` passed |
| Published `2026-10-23-tools-v0.2.2` | `@oa-sdk/tools@0.2.2` + `@oa-sdk/mcp-mesh@0.1.3`; [GitHub release](https://github.com/mineclover/oa-sdk-releases/releases/tag/2026-10-23-tools-v0.2.2); **first GitHub OIDC publish** [39892391866](https://github.com/mineclover/oa-sdk-releases/actions/runs/39892391866); registry `latest` confirms both |
| Publish verification hardening (2026-10-23) | Root cause: registry propagation took 3m 24s (`tools`) and 6m 13s (`mcp-mesh`) while the script allowed 5m. [PR #12](https://github.com/mineclover/oa-sdk-releases/pull/12) merged (`b8c1108`): 15m default window (`PUBLISH_VERIFY_TIMEOUT_MS`), publish-all-then-verify, verify-only reruns without a token, and non-404 error details |
| Trusted publishing configured (2026-10-23) | `npm trust list` confirms both packages already had the desired GitHub Actions publisher: `publish.yml`, `mineclover/oa-sdk-releases`, `npm-publish`, permissions `publish, stage publish` (`@oa-sdk/tools` id `b0eb415e-7c65-4654-bda9-bd2aa0efae32`, `@oa-sdk/mcp-mesh` id `44afb0d3-e11d-4211-aad2-83654202080c`). The earlier E409 was the existing-config conflict; the CI token's E403 applies only to automated management. The publish workflow is now OIDC-only and passes no token to the publish step ([PR #21](https://github.com/mineclover/oa-sdk-releases/pull/21), `749d33d`) |
| OIDC guide (2026-10-23) | Added [docs/guides/oidc-trusted-publishing.md](./docs/guides/oidc-trusted-publishing.md): first-time setup, E403/E409/ENEEDAUTH troubleshooting, trust rotation, OIDC publish verification, registry propagation, and token retirement. Linked from the guide index and release-preparation |
| Backlog review (2026-10-23) | Added [docs/internal/backlog-handoff-2026-10-23.md](./docs/internal/backlog-handoff-2026-10-23.md). The bun-graph-db pin moved from the local-only `cecef25` to `origin/main` `c065557`; local-only work is preserved in `backup/local-2026-10-23`; `pnpm check:cross-repo-projection` runs typecheck + focused projection tests. MCP PRD US-001–US-009 and shared PRD US-001–US-013 are complete after the full-gate run; DPM production data-plane remains out of scope and needs a Phase 10 runtime owner decision |

## 3. Verification evidence

- **Stabilization gate (2026-10-22 22:31–22:45 local, `960a7205`):** `pnpm ci:local` passed 46/46 lanes with 0 failures (661 files / 9,297 tests). Log: `../oa-sdk-local-ci-run/local-ci.log` (outside the repo). `git status` remained clean afterwards.
- **Dependency-refresh gate (2026-10-22 23:17–23:32 local):** `pnpm ci:local` passed 46/46 lanes again (661 files / 9,297 tests). `pnpm audit --prod` reports **0 vulnerabilities**; `pnpm audit` leaves 4 dev-only advisories (`braces` and `sprintf-js` have no patched release; `uuid` needs an incompatible Azure MSAL major; `esbuild` is a Windows dev-server low). `pnpm peers check` is clean, and `pnpm install --frozen-lockfile` passes. Log: `../oa-sdk-local-ci-final/local-ci.log` (outside the repo).
- **Dependency-refresh interface checks:** tools 9/74, spec-lens 16/180 (4 skipped), codegen 211/4,012 including the hardened `fs.watch` startup test, NestJS 11 typecheck/build + `openapi-governance.sh ci`, Redocly/Spectral schema validation, and Node 22/24/26 public runtime all pass.
- **Versioned candidate (2026-10-23 00:35–00:53 local):** `pnpm version-packages` consumed the dependency-refresh changeset and produced `@oa-sdk/tools@0.2.1` + `@oa-sdk/mcp-mesh@0.1.2`; CHANGELOGs, the version table and the type-registry baseline are updated. The full `pnpm ci:local` passed 46/46 lanes (661 files / 9,297 tests), including `check:package-versions`, `type-registry:check` and the Node 22/24/26 public runtime. Log: `../oa-sdk-local-ci-versioned-final2/local-ci.log`.
- **Cross-repo projection gate (2026-10-23 21:17–21:32 local):** `pnpm ci:local` → `LOCAL CI: ALL PASS`; `pnpm schema:validate` passed; `oa-gen build-spec` + `oa-gen validate --require-32` passed for all seven definition builder targets with 0 diagnostics; `pnpm check:cross-repo-projection` passed (15 tests, 301 assertions) at submodule `c065557`; bun-graph-db `typecheck`/`build`/`lint` passed and 11 focused projection/runtime/smoke files passed (77 tests, 989 assertions).
- **Flake hardening:** the `webmcp-peer` real-relay backpressure test now retries twice because it depends on OS socket backpressure; 10/10 isolated runs and the downstream suite pass after the change.
- **Official export (2026-10-23, source `3d6d5d5e`):** clean-worktree `pnpm release:preflight` passed; `pnpm release:export -- --output ../oa-sdk-releases --release-id 2026-10-23-tools-v0.2.1 --version @oa-sdk/tools=0.2.1 --version @oa-sdk/mcp-mesh=0.1.2` produced 2 tarballs. The exporter's sanitized consumer smoke imported 3 public surfaces with TypeScript 5.9.3, and `oa-sdk-releases/scripts/validate-release.mjs --release 2026-10-23-tools-v0.2.1` passed. [PR #11](https://github.com/mineclover/oa-sdk-releases/pull/11) merged as `4fdc558`.
- **npm publish (2026-10-23):** run [39816697850](https://github.com/mineclover/oa-sdk-releases/actions/runs/39816697850) published both packages with provenance, then failed its post-publish check because `@oa-sdk/mcp-mesh@0.1.2` had not propagated to the registry within 5 minutes. The rerun [39818377072](https://github.com/mineclover/oa-sdk-releases/actions/runs/39818377072) skipped the already-published versions and verified both successfully. `npm view --prefer-online` now reports `latest` `0.2.1` / `0.1.2`, and the GitHub release/tag `2026-10-23-tools-v0.2.1` exists.
- **Publish verification hardening (2026-10-23):** measured propagation was 3m 24s for `tools@0.2.1` and 6m 13s for `mcp-mesh@0.1.2`. [PR #12](https://github.com/mineclover/oa-sdk-releases/pull/12) merged as `b8c1108`: default verification window 15 minutes (`PUBLISH_VERIFY_TIMEOUT_MS`), publish all missing packages before verifying, verify-only reruns without a token, and non-404 registry errors surfaced in the failure. Tested against the published release: both packages skipped re-publish and verified in 0s.
- **Trusted publishing (2026-10-23):** automated bootstrap/read attempts with the CI token failed with `E403` (2FA-bypass tokens cannot manage trust relationships), and the unusable workflows were removed. An interactive `npm trust list` then confirmed both packages have the desired GitHub Actions publisher: `publish.yml`, `mineclover/oa-sdk-releases`, `npm-publish`, permissions `publish, stage publish`. The 0.2.2 release exercised it successfully with run [39892391866](https://github.com/mineclover/oa-sdk-releases/actions/runs/39892391866) (`Publishing with npm trusted publishing (GitHub OIDC)`), validating the trust relationships. The publish workflow is now OIDC-only: the `trusted_publishing` input and token env were removed, and the script always runs with `--trusted` ([PR #21](https://github.com/mineclover/oa-sdk-releases/pull/21), `749d33d`). A verification-only rerun on the published 0.2.2 release ([39897639007](https://github.com/mineclover/oa-sdk-releases/actions/runs/39897639007)) skipped both publishes and verified both versions.
- **Optimization pass (2026-10-23):** `@oa-sdk/tools` moved from `@hono/node-server` 1.x to `2.1.5`, matching `@oa-sdk/spec-lens` and leaving one installed major; `ip-address` is pinned to patched `10.7.4`. `pnpm ci:local` passed 46/46 lanes (661 files / 9,297 tests), `pnpm release:preflight` passed on a clean worktree, and the official export created `2026-10-23-tools-v0.2.2` from source `d9bdb374`. The trusted-publishing publish verified `tools@0.2.2` after 1m 9s and `mcp-mesh@0.1.3` immediately.
- Full suite: `pnpm test:core:ci`, `test:downstream:ci`, `test:maintenance:ci`, `test:internal:ci`, `test:integration`, `test:e2e:typespec-plugin`.
- Feature end-to-end:
  - TypeSpec → `schema-typespec-check --provenance` → `typegen --graph-semantic-index`: 207/207 hosts matched generated lines and `.tsp` evidence; all three hashes matched; a mismatched provenance failed without writing output.
  - Incremental: first run regenerates both, second reuses both, provenance-only change regenerates both and reports `the graph semantic index needs the generated source`.
  - WebMCP relay 3-tier smoke: 7/7 steps plus room rotation.
  - CLI journey: `init` → `validate` → `lint` → `diff` → `generate` (spec and config) → `mock` (`GET /users` 200).
  - chunk-stream 0.2.0: imports, CRDT LWW/commutativity, vector-clock merge, LTTB 100→10.
- Governance: `check:docs`, `check:api-index`, `check:cli-spec`, `check:spec-governance`, `check:feature-tests`, `check:codegen-boundaries`, `type-registry:check`, `test:docs-gates`, `check:workspace-scope` all pass.
- Follow-up branch (2026-10-22): `typecheck:core`, `typecheck:downstream`, the full codegen suite (211/4,012), client (16/277), ast-sync (8/77), router (19/206), spec-lens-contract (2/40), typespec-decorators (11/108), and every governance gate above pass. Real-framework streaming tests cover Fastify 5.12.7 and Hono 4.12. The Model B packed-tarball consumer typechecks both combined and split TanStack output.
- **CI topology (2026-10-22):** GitHub keeps the essential lanes only (`ci.yml`, one job, 17 steps); `pnpm ci:local` is the full gate and still runs every historical lane.
- **Local CI mirror (`pnpm ci:local`), 2026-10-22: ALL PASS.** Every `ci.yml` lane is green on `f27ca51f`, including core 422s, downstream 139s, maintenance 45s, internal 15s, integration, TypeSpec e2e, schema spectral/redocly/32/freshness/rollback, API index, CLI spec, codegen boundaries, type registry, browser runtime, docs gates, feature matrix, DPM surface, codegen pack smoke, workspace/release policy, parser bench (scale 2), public runtime prepare + Node 22/24/26 verify, TS7 on Node 26, and NestJS/FastAPI governance. Script: `scripts/local-ci.sh` (`pnpm ci:local`).
- Release candidate `2026-10-22-core-v0.10.0` (`6affdab5`): full `pnpm release:preflight` passed on the clean versioned worktree; `release:export --dry-run --skip-registry-preflight` built all 22 public tarballs and its sanitized consumer smoke imported 51 public surfaces with TypeScript 5.9.3 (output is non-promotable and kept outside the repo).
- Published patch `2026-10-22-router-v0.2.5`: Hono 4.13 and Express 5.3 target verification; router suite 19/209 (real Fastify/Hono/Elysia/Express streaming). Publish run [39769873333](https://github.com/mineclover/oa-sdk-releases/actions/runs/39769873333); registry reads confirm `latest = 0.2.5`.
- Published patch `2026-10-22-router-v0.2.4`: after the npm token refresh, the workflow validated the tarball and published `@oa-sdk/router@0.2.4`; registry reads confirm `0.2.4`. A fresh consumer installed the published tarball with `elysia@1.4`, generated an Elysia router, and streamed SSE through `app.handle()` (200, `text/event-stream`, exact body).
- Published release `2026-10-22-core-v0.10.0`: official export produced 21 tarballs from `bc7c6f8d`; external validation and the approval-gated publish workflow succeeded. A fresh npm consumer installed the published `@oa-sdk/codegen@0.10.0`, `client@0.3.0`, `router@0.2.3`, `mock-server@0.1.5`, generated a client and TanStack options, passed `tsc --noEmit`, and `oa-gen mock` answered `GET /users` with 200. Every published version resolves from the registry. Vue/Svelte adapter support was also checked against the published `@tanstack/vue-query` 5.104.5 and `@tanstack/svelte-query` 5.90.2 declaration files: both `export * from "@tanstack/query-core"`, so the generated `QueryObserverOptions` / `MutationObserverOptions` / `InfiniteQueryObserverOptions` imports resolve.

Run locally with **pnpm 11.28.6** (the repo requires `>=11.28.6 <12`; `mise exec` or corepack works). Source of truth for lanes: `.github/workflows/ci.yml`.

## 4. Remaining work

### Open — P0/P1

1. **GitHub Actions billing is still blocked, and GitHub CI is now the essential subset.** PR/main runs fail in 0–4s with "The job was not started because recent account payments have failed or your spending limit needs to be increased." `.github/workflows/ci.yml` keeps one job: core/downstream build, typecheck and tests, integration, TypeSpec plugin e2e, parser bench, docs/API/CLI/boundary/type-registry/package-version/workspace gates and the browser smoke. `pnpm ci:local` is the full superset (maintenance/internal workspaces, schema validation/rollback, public runtime Node 22/24/26, TS7, NestJS/FastAPI governance). Treat a green local run as CI success.
2. **`NPM_TOKEN` is left to expire (2026-10-23 decision).** The publish workflow is OIDC-only and never receives the token, so its expiry does not affect releases. Do not add it back to the workflow. Revoking it early and tightening npm Publishing access remain optional hardening steps.

### Dev-only dependency advisories

`pnpm audit --prod` is **0**. The full audit leaves 4 dev-only advisories: `braces` and `sprintf-js` have no patched release, `uuid` needs an incompatible Azure MSAL major, and `esbuild` is a Windows dev-server low.

### Released (record)

2. **Released: `2026-10-22-core-v0.10.0`.** 39 changesets consumed (12 minor, 11 patch), 0 pending. Source tag `archive/2026-10-22-core-v0.10.0` → `bc7c6f8d`. Export used 21 packages (`openapi-projection-contract@0.2.0` was unchanged and already published) and is in [`oa-sdk-releases` release `2026-10-22-core-v0.10.0`](https://github.com/mineclover/oa-sdk-releases/releases/tag/2026-10-22-core-v0.10.0); publish run [39708720909](https://github.com/mineclover/oa-sdk-releases/actions/runs/39708720909) succeeded.
3. **Post-release patch released: `@oa-sdk/webmcp-peer@0.2.1`.** Local CI caught `PACKAGE_VERSION` still reporting `0.1.0`; PR #16 fixed it and refreshed the browser-runtime smoke allowlist. Patch release `2026-10-22-webmcp-peer-v0.2.1` is in `oa-sdk-releases` (publish run [39716844893](https://github.com/mineclover/oa-sdk-releases/actions/runs/39716844893)), source tag `archive/2026-10-22-webmcp-peer-v0.2.1` → `f27ca51f`.
4. **Post-release checks passed.** All registry versions resolve (`@oa-sdk/tools@0.2.0` at that release and `@oa-sdk/webmcp-peer@0.2.1` needed CDN propagation time; `--prefer-online` and the registry document confirm them). A fresh consumer installed the published codegen/client/router/mock-server, generated a client and TanStack options, passed `tsc --noEmit`, and served `GET /users` 200 via `oa-gen mock`. Version tables are already synced in source.
5. **`@oa-sdk/router@0.2.4` is published.** After the expired token was replaced at 09:47 UTC, **Publish npm release** [39758279894](https://github.com/mineclover/oa-sdk-releases/actions/runs/39758279894) succeeded in 1m14s. The release is in [`oa-sdk-releases`](https://github.com/mineclover/oa-sdk-releases/releases/tag/2026-10-22-router-v0.2.4), `npm view @oa-sdk/router version` is `0.2.4`, and the source tag is `archive/2026-10-22-router-v0.2.4` → `7de51c04`.

### Resolved P1 — main use-case gaps

These are current, documented limitations rather than stale docs:

4. ~~**TanStack `--framework vue|svelte` output does not compile.**~~ **Fixed (2026-10-22).** Tier 2 now imports the framework-neutral `QueryObserverOptions` / `MutationObserverOptions` / `InfiniteQueryObserverOptions` types that every adapter re-exports from `@tanstack/query-core`. `--framework vue|svelte` emits keys+options and `--tier hooks` fails with a clear error (Tier 3 stays React-only). Docs and `--help` updated.
5. ~~**`generate:tanstack --tier options|hooks` imports files it does not write.**~~ **Fixed (2026-10-22).** Split mode is cumulative: `options` emits keys+queries, `hooks` emits keys+queries+hooks. Combined mode remains self-contained.
6. ~~**`outputRouting` + `--split` breaks relative imports (TS2307).**~~ **Not reproduced (2026-10-22).** `pattern`, `byKind` in separate directories, explicit `--output`, and alias/relative modes all produced resolvable imports; added a regression test that resolves every relative import in pattern-routed output. Reopen with a concrete config if it recurs.
7. ~~**`@oa-sdk/client` TanStack `TError` omits transport errors.**~~ **Fixed (2026-10-22).** Generated option/hook error types are `<Op>Error | Error`; todo and guide updated.
8. ~~**Streaming operations still generate `QueryOptions`/hooks.**~~ **Fixed (2026-10-22).** SSE/NDJSON/JSONL operations keep keys but emit no options or hooks; infinite queries use `[...listKey, 'infinite']`, so list/infinite caches no longer collide while prefix invalidation still works.
9. ~~**Server streaming limits.**~~ **Verified and closed (2026-10-22).** Real Fastify 5.12.7 sends `AsyncIterable`, Web `ReadableStream` and Node streams with the declared content type and cancels the source on client disconnect. Real Hono 4.13 creates one iterator per response and calls `iterator.return()` on cancel; Express 5.3 streams `AsyncIterable`/Node `Readable`; a Node `Readable` follows the same path. Added `streaming-real-frameworks.test.ts` and updated the router/guide docs. Elysia's default adapter is now covered too: the router converts `AsyncIterable`/Node streams to a Web `ReadableStream`, so `app.handle()` streams SSE/NDJSON without double framing; `@elysiajs/node` remains untested.
10. ~~**`generate:guards` fails on dotted component names.**~~ **Fixed (2026-10-22).** Guard exports are normalized (`isOaSdkTypeSpec_StandardError`) while the declaration keeps `data is OaSdkTypeSpec.StandardError`; split files and `--schemas` matching use the normalized/original names respectively.
11. ~~**`check-artifact` / `drift:check` only read top-level `specs`.**~~ **Fixed (2026-10-22).** Both now resolve targets through `resolveConfigWithDefaults`, so `product.specs`-only configs pass.

### Resolved P2 — design decisions / todo backlog

12. ~~`@traceId` shared `trackingId` across OpenAPI variants.~~ **Decided (2026-10-22): shared.** `@traceId` emits `x-oa-sdk-trace.declarationId` (a hash of the declaration source location). `buildSpecTraceabilityGraph` accepts an explicit id shared by nodes with the same `declarationId`; independent declarations or missing evidence still fail.
13. ~~`@traceId` propagation through shared types and derived scalars.~~ **Resolved (2026-10-22):** the copied extension carries the original declaration's `declarationId`, so shared parameters/anonymous types and `scalar B extends A` are treated as lineage; distinct declarations still collide.
14. ~~`ScenarioMachineContext.customData` TypeSpec definition.~~ **Done (2026-10-22):** added to `scenario.tsp` with a two-way field-set drift test.
15. ~~Remaining ast-sync type boundaries.~~ **Done (2026-10-22):** JSON Schema/typia parsing goes through validators, internal `symbol.id`/temp-dir/declaration-name access is modelled, and Ajv/standalone imports are typed. `type-registry:check`: explicit `any` 134→120, unvalidated deserialize 118→117.

[docs/internal/todo.md](./docs/internal/todo.md) currently has no open `[ ]` items; only the open P0/P1 hardening above remains.

### Resolved P3 — verification/hardening

16. ~~**Model B packaged-client path.**~~ **Verified (2026-10-22).** Built `@my-org/api-client` with `generate:client --pack`, packed it (and local `@oa-sdk/{core,parser,openapi-projection-contract,client}` tarballs) into a fresh consumer, generated TanStack in combined and `--split` modes with `--client-import @my-org/api-client --types-import @my-org/api-client`, and ran `tsc --noEmit` with `skipLibCheck: false`. Both layouts passed without an alias module.
17. ~~Re-check the `outputRouting` + `--split` defect with a real `oa.config.ts` before changing code.~~ Done 2026-10-22: not reproducible; regression coverage added (P1.6).
18. The TypeSpec graph index tests are already covered by the `typegen` feature row glob (`packages/codegen/src/__tests__/typegen/*.test.ts`); no matrix change is pending.

## 5. Environment notes / gotchas

- **pnpm:** 11.28.6 required. The system `pnpm` (10.30.3) fails the `engines.pnpm` check; use `mise exec`, corepack, or `~/.local/share/mise/installs/pnpm/11.28.6/pnpm`.
- **Node:** published packages require `>=22`; this repo's development engines require `>=24`; local Node is 24.20.0. `oa-gen init` intentionally writes **`@types/node ^22.0.0`** so generated projects do not typecheck Node 24-only APIs. If changing this, derive the major from the target project's `engines.node`/`.nvmrc`/`.node-version` instead of hard-coding 24.
- **CI billing:** see P0.1. Run `pnpm ci:local` (log path printed at the end; `LOCAL_CI_KEEP=1` keeps it). Do not treat red GitHub checks as code failures until billing is restored.
- **npm credentials (2026-10-23):** trusted publishing is configured and validated by the 0.2.2 OIDC publish; the publish workflow is OIDC-only and passes no token. The old granular `NPM_TOKEN` (2FA bypass) is unused by the workflow and cannot manage trust relationships (`npm trust` reads/writes return `E403`). Per the 2026-10-23 decision it is left to expire naturally rather than revoked now; expiry does not affect OIDC releases. See the manual setup and `E409`/`E403` notes in `oa-sdk-releases/README.md`.
- **Release artifacts:** the `archive/chunk-stream-0.2.0-publish` tag (`23afe831`) is the original published release commit; keep it.
- **Release repository (local):** `/Users/junwoobang/workflow/oa-sdk-releases` has `main` at `41616f7` (PR #20 release merge, PR #21 OIDC-only workflow, PR #22/#23 token-expiry docs; earlier PR #11/#12/#14/#15/#17/#18/#19), in sync with `origin/main`. Local release records include `2026-10-22-core-v0.10.0`, `2026-10-22-webmcp-peer-v0.2.1`, `2026-10-22-router-v0.2.4`/`v0.2.5`, `2026-10-23-tools-v0.2.1`, and the published `2026-10-23-tools-v0.2.2` (release/tag exists; npm `latest` confirmed).
- **Generated files:** do not edit `.merged*.yaml`, `dist/`, or the graph sidecar by hand. Regenerate with the documented command; the sidecar is hash-bound to the generated TypeScript.

## 6. Suggested order

1. Restore GitHub Actions billing.
2. No release work is pending: `2026-10-23-tools-v0.2.1` is published, tagged, and confirmed on the registry. The next release starts from a fresh changeset and follows [the release runbook](./docs/guides/release-preparation.md), including the trusted-publishing default.
3. `docs/internal/todo.md` has no open `[ ]` entries; new work starts from a fresh PRD/backlog item.
