## 2026-09-02T15:18:01Z
You are the Remediation Worker for Proposal 1 (Discriminated Union Projection in @oa-sdk/openapi-projection-contract).
Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/remediation_worker_1
Read ORIGINAL_REQUEST.md at /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md.
Read PROJECT.md at /Users/junwoobang/workflow/oa-sdk/PROJECT.md.
Read the remediation analysis and patch at /Users/junwoobang/workflow/oa-sdk/.agents/remediation_exp_1/analysis.md.
Read the remediation handoff at /Users/junwoobang/workflow/oa-sdk/.agents/remediation_exp_1/handoff.md.

File Ownership:
- `packages/openapi-projection-contract/src/discriminated-union.ts`
- `packages/openapi-projection-contract/test/discriminated-union.test.ts`
- `packages/openapi-projection-contract/src/discriminated-union.test.ts`

Task:
1. Apply the 3 fixes to `packages/openapi-projection-contract/src/discriminated-union.ts`:
   - Fix 1: Update `determineVariantSchemaName` to retain `unionSchemaId` prefix consistently (`${cleanUnionId}${pascalKey}`), avoiding scope loss on `Request`/`Response`/`Event` suffixes while respecting explicit titles/names.
   - Fix 2: Normalize `pathPrefix` by stripping leading/trailing slashes (`prefixInput.replace(/^\/+|\/+$/g, '')`) before joining with `cleanKey`.
   - Fix 3: Implement collision disambiguation using a `Set<string>` of allocated schema names (`${baseName}_${index}`) to prevent silent schema overwriting.
2. Align unit test expectations in `packages/openapi-projection-contract/test/discriminated-union.test.ts` and `src/discriminated-union.test.ts` with the canonical naming convention.
3. Run verification:
   `pnpm --filter @oa-sdk/openapi-projection-contract test`
   `pnpm --filter @oa-sdk/openapi-projection-contract typecheck`
   `pnpm --filter @oa-sdk/openapi-projection-contract exec vitest run test/e2e/discriminated-union.e2e.test.ts`
   `pnpm test`
   `pnpm -r typecheck`
4. Write your handoff report to `/Users/junwoobang/workflow/oa-sdk/.agents/remediation_worker_1/handoff.md`.
