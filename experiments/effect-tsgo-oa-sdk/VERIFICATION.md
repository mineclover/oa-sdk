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
