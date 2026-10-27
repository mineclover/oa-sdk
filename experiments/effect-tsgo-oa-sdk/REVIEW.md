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
