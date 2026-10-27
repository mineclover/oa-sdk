# Effect TSGO × OA SDK — independent reference

Status: DRAFT. Authored source and review harness only; actual OA SDK/Effect TSGO integration execution has **not** passed in the authoring environment.

## Goal

Evaluate a public OA SDK consumer checked and run through Effect TSGO **without TTSC**. This experiment lives outside the OA SDK pnpm workspaces (only packages/* and apps/* are members); its npm package and dependencies can be moved independently.

## Ownership

- contract/openapi.yaml — consumer-authored OpenAPI 3.2 contract (does not modify OA SDK's production TypeSpec SSOT).
- @oa-sdk/codegen@0.10.0 — validates the contract and generates TS types and Zod runtime schemas.
- @oa-sdk/client@0.3.0 — companion generator for the fetch client; the generated client has no runtime dependency on this generator.
- src/api/*.ts — **generated-only** artifacts; never edit to make diagnostics pass.
- src/service.ts — authored Effect 4 code, composing the generated typed client and generated Zod validator into lazy execution and typed failure channels.
- @effect/tsgo@0.59.0 + typescript@7.0.2 — compiler, language-service diagnostics, optional editor LSP; no separate standard tsgo process.
- test/runtime.test.mjs — local HTTP server + actual Effect v4 run/Exit checks.

The generated Zod schema is the only runtime payload-schema definition for this fixture. Do not re-declare the same Profile schema in Effect Schema; Effect owns orchestration, not the contract.

## Reproduce in Node 26

Node 26 is the baseline of this reference because the OA SDK repository's TS7 consumer verification already targets Node 26. It is NOT the minimum for all public OA packages.

    cd experiments/effect-tsgo-oa-sdk
    npm install
    npm run test:contracts
    npm run review

The first npm install creates package-lock.json, which must be retained with a completed compatibility result. The authoring environment could not access npm, so no lockfile has been fabricated or committed yet. After the first successful lockfile generation, use npm ci for subsequent reproducibility.

npm run review runs:
1. Check installed exact package versions, Node 26 and lockfile presence; fail closed when missing.
2. oa-gen validate --spec ./contract/openapi.yaml --require-32.
3. oa-gen typegen and generate:client --types-import ./types.js, plus generate:zod.
4. effect-tsgo tsc@7.0.2 -p tsconfig.json --noEmit.
5. effect-tsgo diagnostics --project tsconfig.json --format json on valid authored + generated code.
6. The same diagnostics on tsconfig.negative.json, requiring an error-level floatingEffect report (expected CLI exit code 1). A deliberate failing program does NOT become a green application check.
7. effect-tsgo tsc@7.0.2 -p tsconfig.json followed by Node tests of the actual emitted JS.
8. Persist source and generated-file SHA-256, package version, compiler outputs and findings to .reports/latest.json.

The report's candidate-passed verdict is run-scoped, **not** a claim of independent review, user adoption, official package release, or Effect Runtime DevTools verification.

## Cases

| ID | Scenario | Expected evidence |
| --- | --- | --- |
| OA-01 | OA spec -> generated type/client/Zod | Typechecked and one source authority |
| EF-01 | Effect lazy HTTP request | 0 requests before runPromise, exactly 1 after |
| EF-02 | OA generated HTTP error guard (404) | Effect typed ProfileNotFoundError with NOT_FOUND code |
| EF-03 | Invalid 200 payload | OA generated Zod rejection -> Effect ProfilePayloadError |
| EF-04 | Discarded Effect.sync | Error-level floatingEffect reported on a separate negative tsconfig |
| ENV-01 | Exact TS7/Effect TSGO toolchain | Pinned package versions and no unavailable/partially checked project |
| REG-01 | Generated non-Effect TS code | No unexpected Effect errors or checker regressions |

## Boundaries and known pending checks

- This is an independent OpenAPI-first **consumer** example. The OA SDK monorepo's accepted production authoring source remains TypeSpec (ADR-009). TypeSpec/provenance integration would be a separate follow-up scenario.
- OA client retries are explicitly zero. The Effect service does not add its own retry; do not duplicate retry policies.
- LSP Quick Fix/refactors, live Effect Runtime DevTools Fibers/Spans, cancellation propagation and cold/warm performance still require actual verification. CLI diagnostics alone do not prove them.
- There are no TTSC package imports, and this reference does not modify the existing TTSC fork or compiler fixture.
- No production OA SDK schema, root package/lock, main-branch gates, public interfaces or release policy changed by this experiment.

Sources: OA SDK docs/guides/quick-start.md, docs/guides/client-and-query-consumption.md, docs/internal/architecture/009-typespec-first-authoring.md, and https://effect.website/docs/v4/onboarding , https://github.com/Effect-TS/tsgo .

See REVIEW.md for specific compatibility risks and promotion criteria.
