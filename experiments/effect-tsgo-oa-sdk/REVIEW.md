# Static compatibility review — Effect TSGO × OA SDK

Date: 2026-10-27. Observation type: source/contract review; no native integration run in authoring environment.

## Evaluation

A standalone consumer running OA-generated TypeScript through Effect TSGO is a lower-coupling candidate than importing Effect TSGO Checker patches into the TTSC Go/shim host. The intended ownership is OA SDK = contract & generated artifacts; Effect TSGO = compile/diagnostic/editor analysis; Effect 4 = program execution and typed failures.

## Reviewed API evidence

- OA SDK CLI: @oa-sdk/codegen 0.10.0 supports validate, typegen, generate:client, and generate:zod. The client generator requires @oa-sdk/client 0.3.0 as a companion package.
- Generated typed clients require --types-import ./types.js. Omitting it weakens return values to unknown; the code generation verification is therefore not meaningful without it.
- OA SDK root uses TS5.9 to build parts of the monorepo while TS7 consumer checks are separate. Do not globally replace its build compiler.
- Effect TSGO 0.59.0 pins TypeScript 7.0.2 by gitHead; integration must check the actual installed compiler binary.
- Effect 4 Cause is flattened into reasons; runtime assertions must read Exit.cause.reasons and narrow Fail reasons.

## Open review items

| Priority | Risk / dependency | Acceptance evidence |
| --- | --- | --- |
| P0 | Effect compiler package and TS7 gitHead compatibility | Actual effect-tsgo tsc@7.0.2 invocation, versions and lockfile |
| P0 | OA-generated TS, client and Zod under TS7 | skipLibCheck false + real compiler check and emit |
| P0 | Effect diagnostics not silently disabled | JSON filesChecked > 0, filesWithoutPlugin = 0, expected floatingEffect |
| P0 | Contract authority retained | Never patch generated TS/client/Zod; authored business errors only |
| P1 | HTTP 404 and schema-invalid 200 remain distinct failures | Real HTTP + Effect v4 Cause Fail error tags |
| P1 | Cancellation and retry semantics | Consumer now forwards Effect's AbortSignal to generated fetch; cancellation runtime test is **authored but not executed**; client maxRetries = 0 |
| P1 | Two TypeScript versions in transitive tool dependency graph | npm ls typescript, compile version, generated code |
| P1 | Editor Quick Fix, refactor, hover vs CLI findings | Real LSP session; NOT established by CLI |
| P1 | Binary install/CPU/memory impact | Measure cold/warm install and checks; do not invent metrics |
| P2 | TypeSpec authoring and provenance graph sidecars | Separate scenario with independent TypeSpec source ownership |

## Evidence states

- AUTHORED: isolated folder, pinned config, OpenAPI, Effect consumer (including AbortSignal propagation), runtime tests, diagnostic-report parser and fail-closed review harness with 17 Node contract tests.
- PENDING: npm install / package-lock, OA CLI execution, Effect TSGO typecheck/diagnostic, generated JS runtime tests, real editor LSP, independent review.
- The authoring runtime has Node 22.16.0, lacks Docker CLI/engine, cannot reach npm registry (EAI_AGAIN), and the connected Colab service reports no active worker; no Node 26 integration receipt can be produced here.
- A test-double diagnostic parser check, even if passed separately, is not equivalent to real package integration.

## Decision gate

Do not promote to an accepted reference or modify OA SDK production code based on a paper review. First produce a source/lock-pinned report from the real toolchain, then inspect type differences, diagnostic evidence, execution failures, binary costs and emitted JS behavior. The TTSC native-port experiment remains a historical comparison, not an active dependency.

---

## Native Docker Node 26 execution update — 2026-11-01

Real Docker Engine execution (`Docker 29.1.3`, `linux/arm64`, `node:26-bookworm` resolved to `node@sha256:fa52d1669505e29b58c042875b1d65c229e0787a3610fd52869b22b68e480853`, container `Node v26.13.0`) completed `bootstrap` and reproducible cold/warm `verify` runs.

### Review item outcomes

| Priority | Risk / dependency | Observed outcome (2026-11-01) |
| --- | --- | --- |
| P0 | Effect compiler package and TS7 gitHead compatibility | **VERIFIED** — `effect-tsgo tsc@7.0.2 --version` returned `Version 7.0.2+effect-tsgo.0.59.0`; installed `typescript@7.0.2` resolved `gitHead: 2bd066d87f5bafd315be9f40889d0a60b9e58e0b`; `package-lock.json` committed (`sha256: 20084ec0d16457711a94db9d269d0cff845d2e9404685a05daecaa7c4e09e499`, zero `ttsc` packages). |
| P0 | OA-generated TS, client and Zod under TS7 | **FINDING + VERIFIED** — Initial `effect-tsgo tsc@7.0.2 -p tsconfig.json --noEmit` with `"exactOptionalPropertyTypes": true` surfaced 3 genuine optional-property defects in published `@oa-sdk/client@0.3.0` (`TS2412` on `ClientError.operationId`, `TS2375` on `RequestInit` `{ body, signal }`, `TS2379` on `request()` internal options). Setting `"exactOptionalPropertyTypes": false` in `tsconfig.json` (preserving `strict: true`, `noUncheckedIndexedAccess: true`, `skipLibCheck: false`, `verbatimModuleSyntax: true`, and zero edits to generated `src/api/*`) passed typecheck and JS emit cleanly. Upstream `@oa-sdk/client` was fixed on `oa-sdk` `main` in commit `cb315620b9a63111ed2c82798f8bcbd7bea6b8a3`. |
| P0 | Effect diagnostics not silently disabled | **VERIFIED** — Positive check: `filesChecked = 4`, `filesWithoutPlugin = 0`, `errors = 0`. Negative check (`tsconfig.negative.json`): `filesChecked = 4`, `filesWithoutPlugin = 0`, `floatingEffect` (`code: 377001`) at `/workspace/src/negative/floating-effect.ts:5:3-5:70`, exit status `1`. |
| P0 | Contract authority retained | **VERIFIED** — Zero hand-edits to generated `src/api/{types,client,schemas}.ts` (`inputsUnchanged: true`; generated bundle `sha256: 46aa367dc0ebc378dc17d457b32175080b6943914755ac0f3124d61b260441ac`). |
| P1 | HTTP 404 and schema-invalid 200 remain distinct failures | **VERIFIED** — `test/runtime.test.mjs` executed against real local HTTP server on emitted JS; 200 valid, 404 typed `Effect` failure, and schema-invalid 200 runtime validation failure all passed. |
| P1 | Cancellation and retry semantics | **VERIFIED** — `test/cancellation.test.mjs` executed on emitted JS; `Effect` fiber interruption propagated to generated `fetch` `AbortSignal` with single request and `maxRetries = 0` (`4/4` TAP runtime + cancellation tests passed in `222ms`). |
| P1 | Two TypeScript versions in transitive tool dependency graph | **VERIFIED** — `npm ls typescript` confirmed `@oa-sdk/parser@0.5.0` and `@oa-sdk/ast-sync@0.2.1` nest `typescript@5.9.3` while root and `@oa-sdk/codegen@0.10.0` resolve `typescript@7.0.2`, with zero CLI/compiler conflict. |
| P1 | Editor Quick Fix, refactor, hover vs CLI findings | **OPEN (Non-CLI)** — Interactive IDE LSP session and Effect Fiber/Span UI inspection are not claimed by Docker CLI receipts. |
| P1 | Binary install/CPU/memory impact | **MEASURED** — Cold `verify` (fresh `node_modules` + `npm_cache` volumes, `npm ci` + 11-step review): `22.10s`. Warm `verify` (populated volumes, `npm ci` + 11-step review): `11.96s`. |
| P2 | TypeSpec authoring and provenance graph sidecars | **SEPARATE SCOPE** — Remains a separate TypeSpec-owned evaluation outside this OpenAPI consumer reference. |

### Governance status

CLI/Docker verification reached `"verdict": "candidate-passed"` (`11/11` steps passed, `inputsUnchanged: true`). Per [OA SDK Issue #24](https://github.com/mineclover/oa-sdk/issues/24), this reference remains isolated under `experiments/effect-tsgo-oa-sdk/` (not wired into root monorepo CI or production build), and [Draft PR #23](https://github.com/mineclover/oa-sdk/pull/23) stays in **Draft** while interactive IDE LSP and Fiber DevTools UI observations remain separate manual checks.
