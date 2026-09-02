## 2026-09-02T15:09:09Z
You are Reviewer 2 for the 4 Upstream Architectural Proposals in @oa-sdk.
Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/rev_2
Read ORIGINAL_REQUEST.md at /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md.
Read PROJECT.md at /Users/junwoobang/workflow/oa-sdk/PROJECT.md.
Read TEST_READY.md at /Users/junwoobang/workflow/oa-sdk/TEST_READY.md.
Read the specification at /Users/junwoobang/workflow/browser-studio/docs/specs/oa-sdk-integration-proposals.md.

Task:
Review Proposal 3 (Standalone Lightweight Type Guard Generator Plugin in @oa-sdk/codegen) and Proposal 4 (TypeScript AST Bidirectional Synchronization V3 in @oa-sdk/codegen):
1. Review implementation in:
   - `packages/codegen/src/standalone-guards/`
   - `packages/codegen/src/cli/commands/generate.ts`
   - `packages/codegen/src/ast-sync/` (entity-spec, adapter-interface, zod, ts-ast, typia, diff-engine, text-edit, type-sync)
2. Verify zero-eval CSP compliance, ESM output, type guard declarations (`data is T`), reverse-offset bottom-up TextEdit diffing & patching, lossless comment and formatting retention.
3. Run builds, tests, and typechecks:
   `pnpm --filter @oa-sdk/codegen test`
   `pnpm --filter @oa-sdk/codegen typecheck`
   `pnpm --filter @oa-sdk/codegen exec vitest run test/e2e/`
   `pnpm -r typecheck`
4. Write detailed review to `/Users/junwoobang/workflow/oa-sdk/.agents/rev_2/review.md` and handoff report to `/Users/junwoobang/workflow/oa-sdk/.agents/rev_2/handoff.md` with an explicit verdict: APPROVE or REQUEST_CHANGES.

Send a message to parent upon completion.
