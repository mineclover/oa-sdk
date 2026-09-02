## 2026-09-02T14:53:23Z
You are the Worker for Milestone 1: Native Discriminated Union Projection.
Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/m1_worker
Read ORIGINAL_REQUEST.md at /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md.
Read PROJECT.md at /Users/junwoobang/workflow/oa-sdk/PROJECT.md.
Read the specification at /Users/junwoobang/workflow/browser-studio/docs/specs/oa-sdk-integration-proposals.md.

File Ownership:
- `packages/openapi-projection-contract/src/discriminated-union.ts`
- `packages/openapi-projection-contract/src/index.ts` (exporting discriminated union helpers)
- `packages/openapi-projection-contract/test/discriminated-union.test.ts`
- `packages/codegen/src/zod-to-schema.ts` (supporting discriminator mapping generation)

Task:
1. Implement `projectDiscriminatedUnion(options: DiscriminatedUnionProjectionOptions): DiscriminatedUnionProjectionResult` in `packages/openapi-projection-contract/src/discriminated-union.ts`:
   - Support `discriminatorProperty`, `unionSchemaId`, `variants`, `profile` ('operation-contract' | 'component-bundle'), `pathPrefix`, `description`.
   - Project multiplexed single-stream RPC operations (e.g. `/rpc/{method}`) and MCP stdio operations (`/mcp/{op}`) into canonical OpenAPI 3.1 `discriminator` + `oneOf` models.
   - Validate discriminator property presence on variant schemas; emit diagnostics or throw meaningful error on missing/empty variants.
2. In `packages/codegen/src/zod-to-schema.ts`:
   - Enhance `z.ZodDiscriminatedUnion` conversion to generate canonical `discriminator` object and `oneOf` schema array.
3. Write thorough unit tests in `packages/openapi-projection-contract/test/discriminated-union.test.ts` and `packages/codegen/test/zod-to-schema.test.ts` (or update existing).
4. Run builds and tests:
   `pnpm --filter @oa-sdk/openapi-projection-contract test`
   `pnpm --filter @oa-sdk/openapi-projection-contract typecheck`
   `pnpm --filter @oa-sdk/codegen test`
5. Write your handoff report to `/Users/junwoobang/workflow/oa-sdk/.agents/m1_worker/handoff.md`.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Send a message to parent upon completion.
