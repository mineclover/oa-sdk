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
