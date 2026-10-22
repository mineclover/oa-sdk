# oa-sdk Engineering Handoff

Last updated: 2026-10-22
Repository: `/Users/junwoobang/workflow/oa-sdk`
Main: `main` (PR #13 merged; in sync with `origin/main`; use `git log -1 --oneline`)
Worktrees: main only · Open PRs: none

## 1. Current state

- `main` includes PR #13 (`5d9e59e2`), PR #14 (`153dfa22`) and PR #15 (`9326c7ff`), and is in sync with `origin/main`. No other local branches or worktrees; 0 pending changesets; `2026-10-22-core-v0.10.0` is published.
- Last full local test run: **654 files / 9,209 tests pass** (turbo suites 635/9,006, integration 73, TypeSpec plugin e2e 130). The follow-up branch adds codegen 211/4,012, client 16/277, ast-sync 8/77, router 19/206, TypeSpec decorators 11/108 and spec-lens-contract 2/40 passing suites.
- The 43-lane local CI mirror (build, typecheck, 4 test groups, integration, e2e, schema, governance, Node 26/TS7, public runtime, NestJS/FastAPI governance) passed on the combined tree through PR #9. Later changes re-ran the full codegen suite (211 files / 4,007 tests) and every docs/governance gate.
- **GitHub Actions cannot start jobs**: PR checks show 0 steps because the account's billing limit is reached. All evidence above is from local runs.

## 2. Landed in this session (2026-10-21 → 10-22)

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
| Branch/worktree cleanup | 24 merged branches + 6 verifier worktrees + 4 superseded branches removed; SHAs in `.../opencode/branch-sha-archive-2026-10-22.txt` (outside the repo) |

## 3. Verification evidence

- Full suite: `pnpm test:core:ci`, `test:downstream:ci`, `test:maintenance:ci`, `test:internal:ci`, `test:integration`, `test:e2e:typespec-plugin`.
- Feature end-to-end:
  - TypeSpec → `schema-typespec-check --provenance` → `typegen --graph-semantic-index`: 207/207 hosts matched generated lines and `.tsp` evidence; all three hashes matched; a mismatched provenance failed without writing output.
  - Incremental: first run regenerates both, second reuses both, provenance-only change regenerates both and reports `the graph semantic index needs the generated source`.
  - WebMCP relay 3-tier smoke: 7/7 steps plus room rotation.
  - CLI journey: `init` → `validate` → `lint` → `diff` → `generate` (spec and config) → `mock` (`GET /users` 200).
  - chunk-stream 0.2.0: imports, CRDT LWW/commutativity, vector-clock merge, LTTB 100→10.
- Governance: `check:docs`, `check:api-index`, `check:cli-spec`, `check:spec-governance`, `check:feature-tests`, `check:codegen-boundaries`, `type-registry:check`, `test:docs-gates`, `check:workspace-scope` all pass.
- Follow-up branch (2026-10-22): `typecheck:core`, `typecheck:downstream`, the full codegen suite (211/4,012), client (16/277), ast-sync (8/77), router (19/206), spec-lens-contract (2/40), typespec-decorators (11/108), and every governance gate above pass. Real-framework streaming tests cover Fastify 5.12.7 and Hono 4.12. The Model B packed-tarball consumer typechecks both combined and split TanStack output.
- Release candidate `2026-10-22-core-v0.10.0` (`6affdab5`): full `pnpm release:preflight` passed on the clean versioned worktree; `release:export --dry-run --skip-registry-preflight` built all 22 public tarballs and its sanitized consumer smoke imported 51 public surfaces with TypeScript 5.9.3 (output is non-promotable and kept outside the repo).
- Published release `2026-10-22-core-v0.10.0`: official export produced 21 tarballs from `bc7c6f8d`; external validation and the approval-gated publish workflow succeeded. A fresh npm consumer installed the published `@oa-sdk/codegen@0.10.0`, `client@0.3.0`, `router@0.2.3`, `mock-server@0.1.5`, generated a client and TanStack options, passed `tsc --noEmit`, and `oa-gen mock` answered `GET /users` with 200. Every published version resolves from the registry. Vue/Svelte adapter support was also checked against the published `@tanstack/vue-query` 5.104.5 and `@tanstack/svelte-query` 5.90.2 declaration files: both `export * from "@tanstack/query-core"`, so the generated `QueryObserverOptions` / `MutationObserverOptions` / `InfiniteQueryObserverOptions` imports resolve.

Run locally with **pnpm 11.28.6** (the repo requires `>=11.28.6 <12`; `mise exec` or corepack works). Source of truth for lanes: `.github/workflows/ci.yml`.

## 4. Remaining work

### P0 — release and CI

1. **Restore GitHub Actions billing.** Still blocked on 2026-10-22: PR/main runs fail in 0–4s with "The job was not started because recent account payments have failed or your spending limit needs to be increased." All evidence in this file remains from local runs. Only the external `oa-sdk-releases` publish workflow (which runs successfully) is usable.
2. **Released: `2026-10-22-core-v0.10.0`.** 39 changesets consumed (12 minor, 11 patch), 0 pending. Source tag `archive/2026-10-22-core-v0.10.0` → `bc7c6f8d`. Export used 21 packages (`openapi-projection-contract@0.2.0` was unchanged and already published) and is in [`oa-sdk-releases` release `2026-10-22-core-v0.10.0`](https://github.com/mineclover/oa-sdk-releases/releases/tag/2026-10-22-core-v0.10.0); publish run [39708720909](https://github.com/mineclover/oa-sdk-releases/actions/runs/39708720909) succeeded.
3. **Post-release checks passed.** All 21 registry versions resolve (`@oa-sdk/tools@0.2.0` needed CDN propagation time; `--prefer-online` and the registry document confirm it). A fresh consumer installed the published codegen/client/router/mock-server, generated a client and TanStack options, passed `tsc --noEmit`, and served `GET /users` 200 via `oa-gen mock`. Version tables are already synced in source.

### P1 — main use-case gaps (highest UX impact)

These are current, documented limitations rather than stale docs:

4. ~~**TanStack `--framework vue|svelte` output does not compile.**~~ **Fixed (2026-10-22).** Tier 2 now imports the framework-neutral `QueryObserverOptions` / `MutationObserverOptions` / `InfiniteQueryObserverOptions` types that every adapter re-exports from `@tanstack/query-core`. `--framework vue|svelte` emits keys+options and `--tier hooks` fails with a clear error (Tier 3 stays React-only). Docs and `--help` updated.
5. ~~**`generate:tanstack --tier options|hooks` imports files it does not write.**~~ **Fixed (2026-10-22).** Split mode is cumulative: `options` emits keys+queries, `hooks` emits keys+queries+hooks. Combined mode remains self-contained.
6. ~~**`outputRouting` + `--split` breaks relative imports (TS2307).**~~ **Not reproduced (2026-10-22).** `pattern`, `byKind` in separate directories, explicit `--output`, and alias/relative modes all produced resolvable imports; added a regression test that resolves every relative import in pattern-routed output. Reopen with a concrete config if it recurs.
7. ~~**`@oa-sdk/client` TanStack `TError` omits transport errors.**~~ **Fixed (2026-10-22).** Generated option/hook error types are `<Op>Error | Error`; todo and guide updated.
8. ~~**Streaming operations still generate `QueryOptions`/hooks.**~~ **Fixed (2026-10-22).** SSE/NDJSON/JSONL operations keep keys but emit no options or hooks; infinite queries use `[...listKey, 'infinite']`, so list/infinite caches no longer collide while prefix invalidation still works.
9. ~~**Server streaming limits.**~~ **Verified and closed (2026-10-22).** Real Fastify 5.12.7 sends `AsyncIterable`, Web `ReadableStream` and Node streams with the declared content type and cancels the source on client disconnect. Real Hono 4.12 creates one iterator per response and calls `iterator.return()` on cancel; a Node `Readable` follows the same path. Added `streaming-real-frameworks.test.ts` and updated the router/guide docs. Elysia remains the only documented streaming limitation.
10. ~~**`generate:guards` fails on dotted component names.**~~ **Fixed (2026-10-22).** Guard exports are normalized (`isOaSdkTypeSpec_StandardError`) while the declaration keeps `data is OaSdkTypeSpec.StandardError`; split files and `--schemas` matching use the normalized/original names respectively.
11. ~~**`check-artifact` / `drift:check` only read top-level `specs`.**~~ **Fixed (2026-10-22).** Both now resolve targets through `resolveConfigWithDefaults`, so `product.specs`-only configs pass.

### P2 — design decisions / todo backlog

12. ~~`@traceId` shared `trackingId` across OpenAPI variants.~~ **Decided (2026-10-22): shared.** `@traceId` emits `x-oa-sdk-trace.declarationId` (a hash of the declaration source location). `buildSpecTraceabilityGraph` accepts an explicit id shared by nodes with the same `declarationId`; independent declarations or missing evidence still fail.
13. ~~`@traceId` propagation through shared types and derived scalars.~~ **Resolved (2026-10-22):** the copied extension carries the original declaration's `declarationId`, so shared parameters/anonymous types and `scalar B extends A` are treated as lineage; distinct declarations still collide.
14. ~~`ScenarioMachineContext.customData` TypeSpec definition.~~ **Done (2026-10-22):** added to `scenario.tsp` with a two-way field-set drift test.
15. ~~Remaining ast-sync type boundaries.~~ **Done (2026-10-22):** JSON Schema/typia parsing goes through validators, internal `symbol.id`/temp-dir/declaration-name access is modelled, and Ajv/standalone imports are typed. `type-registry:check`: explicit `any` 134→120, unvalidated deserialize 118→117.

Remaining `[ ]` items in [docs/internal/todo.md](./docs/internal/todo.md) are outside the P1–P3 list above.

### P3 — verification/hardening

16. ~~**Model B packaged-client path.**~~ **Verified (2026-10-22).** Built `@my-org/api-client` with `generate:client --pack`, packed it (and local `@oa-sdk/{core,parser,openapi-projection-contract,client}` tarballs) into a fresh consumer, generated TanStack in combined and `--split` modes with `--client-import @my-org/api-client --types-import @my-org/api-client`, and ran `tsc --noEmit` with `skipLibCheck: false`. Both layouts passed without an alias module.
17. ~~Re-check the `outputRouting` + `--split` defect with a real `oa.config.ts` before changing code.~~ Done 2026-10-22: not reproducible; regression coverage added (P1.6).
18. The TypeSpec graph index tests are already covered by the `typegen` feature row glob (`packages/codegen/src/__tests__/typegen/*.test.ts`); no matrix change is pending.

## 5. Environment notes / gotchas

- **pnpm:** 11.28.6 required. The system `pnpm` (10.30.3) fails the `engines.pnpm` check; use `mise exec`, corepack, or `~/.local/share/mise/installs/pnpm/11.28.6/pnpm`.
- **Node:** published packages require `>=22`; this repo's development engines require `>=24`; local Node is 24.20.0. `oa-gen init` intentionally writes **`@types/node ^22.0.0`** so generated projects do not typecheck Node 24-only APIs. If changing this, derive the major from the target project's `engines.node`/`.nvmrc`/`.node-version` instead of hard-coding 24.
- **CI billing:** see P0.1. Do not treat red GitHub checks as code failures until billing is restored.
- **Release artifacts:** the `archive/chunk-stream-0.2.0-publish` tag (`23afe831`) is the original published release commit; keep it.
- **Generated files:** do not edit `.merged*.yaml`, `dist/`, or the graph sidecar by hand. Regenerate with the documented command; the sidecar is hash-bound to the generated TypeScript.

## 6. Suggested order

1. Restore GitHub Actions billing.
2. Merge the versioned `release/next` candidate after review, then run the official export/promotion from `oa-sdk-releases` with the chosen release ID.
3. Remaining `[ ]` entries in `docs/internal/todo.md` are new/backlog work, not the P1–P3 handoff list.
