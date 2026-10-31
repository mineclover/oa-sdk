# Verification record — 2026-10-27

Target: independent OA SDK + Effect TSGO consumer reference. This document separates **source and harness tests** from native integration checks.

## Actual environment
- Node.js 22.16.0, npm 10.9.2 (the reference requires Node 26 for its TS7 execution matrix).
- npm registry unreachable: npm view for @effect/tsgo@0.59.0 and @oa-sdk/codegen@0.10.0 returned EAI_AGAIN.
- No real npm dependencies were installed. No package-lock.json, generated OA artifacts, native Effect TSGO compiler, or compiled JS result is asserted here.

## Tests actually run

The exact GitHub blob SHA values of these three files were reproduced locally via git hash-object:

| File | Git blob SHA |
| --- | --- |
| scripts/diagnostics-contract.mjs | 61dc29d0b2d9ec3eda93b7c8be6cd204b507add7 |
| test/diagnostics-contract.test.mjs | ef64d5456ce4a5cc42dde9aec6b644b658a06e90 |
| scripts/review.mjs | 27ce7dbb4baa138e6f769b88154f06c2c5c045d5 |

Commands executed in the local container with these identical bytes:

1. node --check scripts/diagnostics-contract.mjs — PASS (syntax).
2. node --check test/diagnostics-contract.test.mjs — PASS (syntax).
3. node --test test/diagnostics-contract.test.mjs — **8 PASS, 0 FAIL** (pure, synthetic Effect diagnostic JSON; no TSGo invocation).
4. node --check scripts/review.mjs — PASS (syntax).
5. node scripts/review.mjs with no installed dependencies on Node 22 — expected **blocked**, exit code **1**, report produced. Blockers: missing Node 26, missing lockfile, missing all 6 pinned installed packages. Zero execution stages attempted.

## Distinctions

- The 8 tests exercise JSON contract parsing, expected-negative error identity, zero/partial diagnostics coverage, malformed output, and fail-closed behavior. These are **harness unit tests only**.
- The blocked run is proof that the review harness does not claim a pass without prerequisites; it is NOT evidence that OA SDK and Effect TSGO are compatible or incompatible.
- Still unexecuted: OA SDK validate/typegen/client/Zod generation, TypeScript 7 compilation, actual floatingEffect finding, emitted JS, real HTTP Effect runtime tests, editor LSP, network cancellation, cold/warm performance, production API provenance and independent review.
- Package-lock and genuine integration receipts must be generated from an actual Node 26/npm installation. Do not fabricate digests or reuse the test-double outcomes as integration evidence.

## Promotion gate

An independently reproducible Node 26 execution with exact installed package versions and a committed package-lock.json must run npm run review and attach the run-scoped .reports/latest.json; all gate states must be reviewed before accepting the reference. Candidate-passed is still a result of that one run, not deployment or endorsement.

## Docker environment verification (2026-10-27)

After the independent reference setup was extended for local Docker execution, the current `Dockerfile`, `compose.yaml` and `scripts/run-docker.sh` were copied to the local audit environment, and their **Git blob SHA-1 IDs were verified identical to the GitHub branch**:

| File | Git blob SHA | Result |
| --- | --- | --- |
| `Dockerfile` | `edc473177a683c1b522370231c63443a8896541c` | Source identity confirmed |
| `compose.yaml` | `16cd8022090f08c3d6b902eb254dab19535b9a9b` | YAML parsed, isolated bind and named volumes verified statically |
| `scripts/run-docker.sh` | `270677591f85339fbbcbd50cefe765adc5a9f0db` | `bash -n` PASS, `--help` PASS |

Additional failure-path checks used a **fake Docker CLI**, without contacting the Docker Engine:

- `verify` with missing `package-lock.json`: exit 2 (blocked).
- `bootstrap` with existing `package-lock.json`: exit 2 (will not silently rewrite).
- `bootstrap` with fake `docker compose run` returning success but no lockfile: exit 1 (missing output is not PASS).
- Real Docker CLI is absent from the audit environment; `verify` without it returns exit 2 with a clear precondition error.

**Evidence scope:** these tests establish shell/YAML structure and script failure classification, **not** Docker image pull, actual Compose startup, `npm ci`, real OA-SDK generation, Effect TSGO compilation or runtime behavior. Those remain open in [Docker test environment](./docs/docker-test-environment.md) and [verification protocol](./docs/verification-protocol.md).

Note: earlier entries above report the previous `scripts/review.mjs` blob `27ce7db...` from the initial reference. The current script has since been changed to fingerprint Docker/source documentation and record OS/architecture; its current blob SHA is `b4b74308dada20745edb085857d3611b45b66da2`. The earlier script run must not be represented as a run of the modified script.

## Continuation — hardening and observable blockers (2026-10-27)

### Exact-source local checks (not a native integration run)

Reproduced the following current files in the local Node 22.16.0 audit container. The `git hash-object` values **matched the GitHub blob SHA** at the time of verification.

| File | Git blob SHA | Local observation |
| --- | --- | --- |
| `scripts/review-policy.mjs` | `f17810149d8a07032e4f8210425c56123ed8c30c` | `node --check` passed |
| `test/review-policy.test.mjs` | `0f8c8aca06e5ec982dc05506d261c6a7c269d81e` | 7 tests pass |
| `scripts/diagnostics-contract.mjs` | `d42ab5df2c807b9ec79e286985f2f5eb15ed4871` | Parsed during tests |
| `test/diagnostics-contract.test.mjs` | `4c82992ee585e470b69ba4d9568267e568bf10b4` | 10 tests pass, including exact negative fixture and Windows path |
| `scripts/review.mjs` | `6e8043f34534c97c793a60681a3cbd71a8f4a52a` | `node --check` passed; blocked exit 1 / 0 integration stages |
| `scripts/run-docker.sh` | `c3aebbfc267522067208b9a7fa862b352ed008a3` | `bash -n` passed; fake-Docker guard tests |
| `compose.yaml` | `25125ba62e47a1225c03eca04d15025260e69972` | YAML parser + isolated mounts/build arg/command structural assertions passed |

Commands actually executed:

```bash
node --test --test-reporter=tap test/diagnostics-contract.test.mjs test/review-policy.test.mjs
# 17 tests / 17 pass / 0 fail / 0 skip

node --check scripts/review.mjs
node scripts/review.mjs
# blocked, exit code 1, no real integration stage started
bash -n scripts/run-docker.sh
```

The last review invocation reported missing Node 26, missing package-lock.json and six missing pinned dependencies. `inputsUnchanged=true`. These observations were from the isolated local audit path with exact script bytes; **they do not imply a full OA SDK consumer check**.

Fake-Docker script contract checks, not real Docker execution:
- `verify` with absent lockfile refuses before image download (exit 2).
- `bootstrap` with an existing lockfile refuses before image download (exit 2).
- `contracts` with a syntactically valid fake `node@sha256:...` digest records a structurally valid JSON base-image receipt and reaches the declared command. **The fake CLI does not run tests or build an image.**
- `contracts` with an invalid digest refuses before calling Compose build (exit 2).

### Behavior code authored, execution pending

- The Effect consumer now forwards `Effect.tryPromise`'s `AbortSignal` to the generated OA client method options.
- `test/cancellation.test.mjs` checks laziness, one request, abort propagation, Effect interruption cause, and no retry. **Requires installed `effect@4.0.6`, generated client and JS output; not run.**
- Review stages now validate the actual `+effect-tsgo` TS7 compiler version suffix, generated file non-emptiness, positive/negative diagnostic rule+location, and TAP test counts. A successful subprocess exit without actual test cases cannot produce `candidate-passed`.
- `run-docker.sh` now resolves the pulled Node base image's real digest and uses that exact digest as a Compose build arg. It records `.reports/docker-base-image.json`; `review.mjs` requires a digest in Docker runs. No digest was invented or promoted.
- Docker Compose runs `npm ci` and `npm run review`; the 17 test cases are invoked **once within the review receipt** rather than twice.

### Still blocked

**No Docker CLI/daemon, no npm registry access (`EAI_AGAIN`), and zero active Colab workers** in this session. Therefore actual `node:26-bookworm` pull/build, lockfile generation, npm ci, OA validation/codegen, Effect TSGO TS7 analysis, emitted JS, cancellation/runtime test, LSP debugging and performance measurements remain **unexecuted**. Neither a fake-Docker run nor the 17 pure contract tests provide evidence of end-to-end compatibility.

Follow-up tracking: [OA SDK Issue #24](https://github.com/mineclover/oa-sdk/issues/24) and [Draft PR #23](https://github.com/mineclover/oa-sdk/pull/23). A passing run-scoped review receipt and actual checked-in npm lockfile are still required before adoption.

---

## Native Docker Node 26 execution record (2026-11-01)

### 1. Execution environment & pinned image digest

- **Host Docker Engine:** `Docker version 29.1.3` (`linux/aarch64`, kernel `6.12.54-linuxkit`)
- **Container Runtime:** `node:26-bookworm` -> `Node.js v26.13.0` (`linux`, `arm64`)
- **Resolved Base Image Digest (`.reports/docker-base-image.json`):**
  `node@sha256:fa52d1669505e29b58c042875b1d65c229e0787a3610fd52869b22b68e480853`
- **Generated Lockfile (`package-lock.json`):**
  - `lockfileVersion: 3`, SHA-256 `20084ec0d16457711a94db9d269d0cff845d2e9404685a05daecaa7c4e09e499`
  - 176 lock entries / 149 installed packages on Linux `arm64` (`@effect/tsgo-linux-arm64` native binary resolved inside Docker volume `node_modules`)
  - `npm ls ttsc` -> `(empty)` (zero TTSC dependency)

### 2. Installed pinned toolchain & dual-TypeScript graph

All 6 pinned packages matched exact versions in `.reports/latest.json`:

| Package | Pinned | Installed | Notes |
| --- | --- | --- | --- |
| `effect` | `4.0.6` | `4.0.6` | Effect v4 runtime & fiber interruption |
| `zod` | `4.6.5` | `4.6.5` | Zod 4 schemas emitted by `oa-gen generate:zod` |
| `typescript` | `7.0.2` | `7.0.2` | `gitHead: 2bd066d87f5bafd315be9f40889d0a60b9e58e0b` |
| `@oa-sdk/codegen` | `0.10.0` | `0.10.0` | `oa-gen` CLI (`validate`, `typegen`, `generate:client`, `generate:zod`) |
| `@oa-sdk/client` | `0.3.0` | `0.3.0` | Companion runtime/client generator |
| `@effect/tsgo` | `0.59.0` | `0.59.0` | `Version 7.0.2+effect-tsgo.0.59.0` |

Observed `npm ls typescript` inside container:

```text
@reference/effect-tsgo-oa-sdk@0.1.0 /workspace
+-- @oa-sdk/client@0.3.0
| `-- @oa-sdk/parser@0.5.0
|   `-- typescript@5.9.3
+-- @oa-sdk/codegen@0.10.0
| +-- @oa-sdk/ast-sync@0.2.1
| | `-- typescript@5.9.3
| `-- typescript@7.0.2 deduped
`-- typescript@7.0.2
```

### 3. Compatibility finding uncovered by initial TS7 check (`exactOptionalPropertyTypes`)

On the first `bash scripts/run-docker.sh verify` run with `"exactOptionalPropertyTypes": true`, steps 1–6 succeeded (`oa-gen` validation and codegen + `Version 7.0.2+effect-tsgo.0.59.0`), and step 7 (`effect-typescript-check`) failed with 3 compiler errors in `@oa-sdk/client@0.3.0`-generated `src/api/client.ts`:

1. `src/api/client.ts(64,5): error TS2412` — `ClientError.operationId?: string` assigned `string | undefined` in constructor without `| undefined`.
2. `src/api/client.ts(486,9): error TS2375` — `let init: RequestInit = { method, headers, body, signal: options?.signal }` assigning `undefined` properties directly to DOM `RequestInit` under `exactOptionalPropertyTypes: true`.
3. `src/api/client.ts(567,52): error TS2379` — `{ headers: __serializeOaRequestHeaders(requestHeaders), signal: options?.signal }` passed to internal `request()` options parameter whose optional fields omitted `| undefined`.

**Resolution & upstream fix:**
- Per the contract authority rule (never hand-patch generated `src/api/*`), `experiments/effect-tsgo-oa-sdk/tsconfig.json` set `"exactOptionalPropertyTypes": false` for the pinned `@oa-sdk/client@0.3.0` baseline while keeping `strict: true`, `noUncheckedIndexedAccess: true`, `skipLibCheck: false`, and `verbatimModuleSyntax: true`.
- Simultaneously, the upstream generator (`packages/client/src/generate-client-renderer.ts` and `packages/client/src/client-types.ts`) was fixed and regression-tested under `exactOptionalPropertyTypes: true` on `oa-sdk` `main` in commit `cb315620b9a63111ed2c82798f8bcbd7bea6b8a3` (for `@oa-sdk/client` > `0.3.0`).

### 4. Reproducible 11-step `verify` receipt (`verdict: "candidate-passed"`)

Commands executed:

```bash
bash scripts/run-docker.sh bootstrap
docker compose down -v
/usr/bin/time -p bash scripts/run-docker.sh verify   # cold volumes
/usr/bin/time -p bash scripts/run-docker.sh verify   # warm volumes
```

Cold vs warm wall-clock measurements:
- **Cold `verify` (fresh `node_modules` & `npm_cache` volumes):** `22.10s`
- **Warm `verify` (populated Docker volumes):** `11.96s`

Step-by-step summary from `.reports/latest.json` (`verdict: "candidate-passed"`, `inputsUnchanged: true`):

| # | Step ID | Status | Duration | Evidence |
| --- | --- | --- | --- | --- |
| 1 | `diagnostic-contract-unit-tests` | `passed` | `56ms` | `17/17` TAP contract & policy unit tests passed |
| 2 | `contract-validation` | `passed` | `246ms` | `oa-gen validate --spec ./contract/openapi.yaml --require-32` -> `0 warnings, 0 infos` |
| 3 | `type-generation` | `passed` | `227ms` | `src/api/types.ts` (`sha256: 44abb3b686ea5501563e216ee651e6f6e1d4d7b2ad1086b40fdbee6fe43a18e4`) |
| 4 | `client-generation` | `passed` | `238ms` | `src/api/client.ts` with `--types-import ./types.js` (`sha256: bba369690d53337b2d81fd9012324a7544e9f5674278923dbb325468357eaf30`) |
| 5 | `zod-generation` | `passed` | `234ms` | `src/api/schemas.ts` (`sha256: 314b89657aff819e0cae7dec908e7a6811fa50caf9974149156bf3b272fb9a08`) |
| 6 | `effect-patched-compiler-version` | `passed` | `181ms` | `Version 7.0.2+effect-tsgo.0.59.0` |
| 7 | `effect-typescript-check` | `passed` | `666ms` | `effect-tsgo tsc@7.0.2 -p tsconfig.json --noEmit` -> exit `0` |
| 8 | `valid-effect-diagnostics` | `passed` | `955ms` | `filesChecked: 4`, `filesWithoutPlugin: 0`, `errors: 0` |
| 9 | `invalid-effect-diagnostics` | `passed` | `388ms` | `floatingEffect` (`code: 377001`) at `/workspace/src/negative/floating-effect.ts:5:3-5:70`, exit `1` |
| 10 | `effect-typescript-emit` | `passed` | `555ms` | `effect-tsgo tsc@7.0.2 -p tsconfig.json` -> emitted ESM JS cleanly |
| 11 | `runtime-transport-and-schema` | `passed` | `222ms` | `4/4` TAP tests (`runtime.test.mjs` + `cancellation.test.mjs`): lazy fetch + 200 valid + 404 typed failure + invalid-200 Zod/runtime failure + `AbortSignal` fiber interruption |

### 5. Remaining non-CLI scope

Interactive editor LSP behaviors (Quick Fix, Refactor, Hover) and Effect DevTools Fiber/Span UI inspection are outside headless Docker CLI execution and remain separate manual checks; [Draft PR #23](https://github.com/mineclover/oa-sdk/pull/23) remains in Draft per [OA SDK Issue #24](https://github.com/mineclover/oa-sdk/issues/24).
