# oa-sdk Engineering Handoff

Last updated: 2026-10-22
Repository: `/Users/junwoobang/workflow/oa-sdk`
Main: `e960e74f` (in sync with `origin/main`)
Worktrees: main only · Open PRs: none

## 1. Current state

- Working tree clean. No open PRs. Only `main` remains as a local branch; the merged feature branches and verifier worktrees were removed.
- Last full local test run: **654 files / 9,209 tests pass** (turbo suites 635/9,006, integration 73, TypeSpec plugin e2e 130).
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

Run locally with **pnpm 11.28.6** (the repo requires `>=11.28.6 <12`; `mise exec` or corepack works). Source of truth for lanes: `.github/workflows/ci.yml`.

## 4. Remaining work

### P0 — release and CI

1. **Restore GitHub Actions billing.** All PR jobs currently fail at 0 steps, so GitHub is not a usable gate. Until it is fixed, run the local lanes above before merging.
2. **Cut the next release.** `changeset status` currently bumps `@oa-sdk/codegen`, `parser`, `surface-ir`, `typespec-decorators`, `tools`, `telemetry`, `rpc`, `webmcp-peer`, `peer-server`, `peer-transport`, `chunk-stream` at **minor** and 10 other packages at **patch** (37 changeset files total; 12 touch codegen). Review the changesets, run the release process in [release management](./docs/internal/release-management.md), publish, then merge the release commit back to `main` like the chunk-stream 0.2.0 merge-back.
3. **Post-release checks:** public runtime smoke, packed-package installs, and the version table in [release management](./docs/internal/release-management.md) / [guide index](./docs/guides/README.md) updated to the published versions.

### P1 — main use-case gaps (highest UX impact)

These are current, documented limitations rather than stale docs:

4. **TanStack `--framework vue|svelte` output does not compile.** The generator imports React type names (`UndefinedInitialDataOptions`, `UseMutationOptions`, `mutationOptions`, ...). Decide between framework-specific generators and failing fast with a clear message; update `--help` and the CLI reference either way. See [client & query consumption](./docs/guides/client-and-query-consumption.md) and [TypeSpec generation topologies](./docs/guides/typespec/06-generation-topologies-and-rules.md).
5. **`generate:tanstack --tier options|hooks` imports files it does not write** (`./keys.js`, `./queries.js`), so the single-file output does not compile. Either emit the needed keys/queries inline or require a multi-file layout.
6. **`outputRouting` + `--split` breaks relative imports (TS2307).** Reproduce first, then fix the path routing or reject the combination.
7. **`@oa-sdk/client` TanStack `TError` omits transport errors.** Open todo: widen to `<Op>Error | Error` (or document the narrowing pattern as final). [todo](./docs/internal/todo.md).
8. **Streaming operations still generate `QueryOptions`/hooks** whose `queryFn` returns an `AsyncGenerator`, and list vs infinite queries share one `queryKey`. Either stop generating query artifacts for streaming operations and give infinite queries distinct keys, or document a hard limitation.
9. **Server streaming limits:** Fastify cannot send `AsyncIterable` bodies; Hono re-invokes `Symbol.asyncIterator` per chunk and leaks listeners on Node streams. See [backend handler contracts](./docs/guides/backend-handler-contracts.md).
10. **`generate:guards` fails on decorator error contracts whose component names contain dots** (`OaSdkTypeSpec.StandardError`) unless `--schemas` is passed.
11. **`check-artifact` / `drift:check` only read top-level `specs`**, so a project that declares only `product.specs` fails with `specs 목록이 비어 있습니다`.

### P2 — design decisions / todo backlog

12. `@traceId` shared `trackingId` across OpenAPI variants (visibility and merge-patch clones).
13. `@traceId` propagation through shared types and derived scalars.
14. `ScenarioMachineContext.customData` TypeSpec definition (TS/`.tsp` drift).
15. Remaining ast-sync type boundaries (`JSON.parse` results, `any` in checker/guards).

Items 12–15 are the open `[ ]` entries in [docs/internal/todo.md](./docs/internal/todo.md).

### P3 — verification/hardening

16. **Model B packaged-client path:** the docs now say `--types-import @my-org/api-client` and `--client-import @my-org/api-client` compile without an alias module. Verify this with a real packed tarball, not only the workspace layout.
17. Re-check the `outputRouting` + `--split` defect with a real `oa.config.ts` before changing code.
18. The TypeSpec graph index tests are already covered by the `typegen` feature row glob (`packages/codegen/src/__tests__/typegen/*.test.ts`); no matrix change is pending.

## 5. Environment notes / gotchas

- **pnpm:** 11.28.6 required. The system `pnpm` (10.30.3) fails the `engines.pnpm` check; use `mise exec`, corepack, or `~/.local/share/mise/installs/pnpm/11.28.6/pnpm`.
- **Node:** published packages require `>=22`; this repo's development engines require `>=24`; local Node is 24.20.0. `oa-gen init` intentionally writes **`@types/node ^22.0.0`** so generated projects do not typecheck Node 24-only APIs. If changing this, derive the major from the target project's `engines.node`/`.nvmrc`/`.node-version` instead of hard-coding 24.
- **CI billing:** see P0.1. Do not treat red GitHub checks as code failures until billing is restored.
- **Release artifacts:** the `archive/chunk-stream-0.2.0-publish` tag (`23afe831`) is the original published release commit; keep it.
- **Generated files:** do not edit `.merged*.yaml`, `dist/`, or the graph sidecar by hand. Regenerate with the documented command; the sidecar is hash-bound to the generated TypeScript.

## 6. Suggested order

1. Restore GitHub Actions billing.
2. Review and cut the pending release, then merge the release commit back.
3. Fix the TanStack framework/tier/streaming gaps (P1.4, P1.5, P1.8) — these are the most visible failures in the library's main client-generation use case.
4. Work through P1.6–P1.11 and the P2 design items as capacity allows.
5. Close P3 verification before advertising the packaged-client path.
