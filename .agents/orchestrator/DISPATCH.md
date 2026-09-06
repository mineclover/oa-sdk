## 2026-09-02T14:47:38Z

You are the Project Orchestrator for implementing the 4 Upstream Architectural Proposals in the `@oa-sdk/*` monorepo.

Your working directory is: `/Users/junwoobang/workflow/oa-sdk/.agents/orchestrator`
The original user request is documented at: `/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md`
The standardized specification file is at: `/Users/junwoobang/workflow/browser-studio/docs/specs/oa-sdk-integration-proposals.md`

Requirements:
1. Native Discriminated Union Projection (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/codegen`):
   - Add first-class support for projecting multiplexed single-stream RPC/stdio operations and polymorphic Zod/JSON schemas into canonical OpenAPI 3.1 `discriminator` + `oneOf` models.
   - Implement `projectDiscriminatedUnion` helper API and wire into projection contract profiles.
2. Non-AST Character Range Patching Metadata Extensions (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/parser`):
   - Standardize `x-surface-*` vendor extensions (`x-surface-anchor`, `x-surface-param-range`, `x-surface-fingerprint`, `x-surface-quote-style`, `x-surface-patch-policy`) across schema envelopes and parser linting rules.
3. Standalone Lightweight Type Guard Generator Plugin (`@oa-sdk/codegen`):
   - Implement zero-eval, zero-runtime dependency pre-compiled static ESM type guard generator (`oa-codegen generate --target standalone-guards`) using `ajv/dist/2020` and `ajv/dist/standalone`. Pure ESM `.js` + `.d.ts` type guards (`data is T`).
4. TypeScript AST Bidirectional Synchronization (`@oa-sdk/codegen`, `@oa-sdk/spec-lens`, `@oa-sdk/schemas`):
   - Establish V3 Unified Architecture bidirectional synchronization engine between `EntitySpec` intermediate representations and source code.
   - Pluggable Type Adapters (`ZodAdapter`, `TsAstAdapter`, `TypiaAdapter`), reverse-offset bottom-up TextEdit diffing, lossless comment/formatting retention.

Acceptance Criteria:
- All package unit tests pass (`pnpm test`).
- Full monorepo typecheck passes (`pnpm -r typecheck` / `pnpm run check`).
- Maintain `plan.md` and `progress.md` in your working directory.

## 2026-09-05T19:00:40Z

You are the Project Orchestrator for @oa-sdk.
Your working directory is `/Users/junwoobang/workflow/oa-sdk/.agents/orchestrator`.
The project root is `/Users/junwoobang/workflow/oa-sdk`.
The authoritative user request is recorded in `/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md`.

Please read `/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md` and manage the full decomposition, implementation, testing, benchmarking, documentation, and verification of the tasks:
1. R1: Typia Type-Level Tag AST Parsing & Bidirectional Sync (`@oa-sdk/codegen`) in `packages/codegen/src/ast-sync/adapters/typia.ts` and test suite `packages/codegen/test/ast-sync/typia-adapter.test.ts`.
2. R2: Validation Engine Performance Benchmark Suite (`@oa-sdk/codegen`) in `packages/codegen/scripts/bench-validation-engines.ts` with npm script `bench:validation` in `packages/codegen/package.json`.
3. R3: Architectural Positioning & Comparative Benchmark Report Documentation across `docs/benchmarks/validation-engines.md` (indexed in `docs/README.md`), `docs/concepts/runtime-and-generation.md`, `docs/guides/schema-architecture-and-conventions.md`, and `docs/internal/platform-scope.md`.
4. Monorepo integrity: `pnpm test` and `pnpm -r typecheck` must pass cleanly.

Maintain your `plan.md`, `progress.md`, and `BRIEFING.md` in your working directory (`/Users/junwoobang/workflow/oa-sdk/.agents/orchestrator`).
Update `progress.md` regularly as milestones progress.
When all acceptance criteria are met and independently verified within your team, send a completion report back with your victory claim.
