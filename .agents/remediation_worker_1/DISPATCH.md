## 2026-09-11T00:02:42Z

You are the Remediation Worker (`remediation_worker_1`) for the OpenAPI 3.2 to Zod 4 generator in oa-sdk.

Your working directory is:
/Users/junwoobang/workflow/oa-sdk/.agents/remediation_worker_1

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Authoritative Context to Read First:
- Original User Request: /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md
- Project Specification: /Users/junwoobang/workflow/oa-sdk/.agents/PROJECT.md
- E2E Test Suite Specification: /Users/junwoobang/workflow/oa-sdk/.agents/TEST_READY.md
- Remediation Blueprint & Exact Diffs: /Users/junwoobang/workflow/oa-sdk/.agents/remediation_explorer_2/handoff.md

Write Ownership (You exclusively own and may edit these files):
- `packages/codegen/src/zodgen/generate-zod.ts`
- `packages/codegen/src/zodgen/schema-to-zod.ts`
- `packages/codegen/test/zodgen/adversarial-challenger-1.test.ts`
- `packages/codegen/src/zodgen/schema-to-zod.test.ts`
- `packages/codegen/test/e2e/zod4-generator.e2e.test.ts`

Your Mission:
Apply the exact remediation blueprint documented in `/Users/junwoobang/workflow/oa-sdk/.agents/remediation_explorer_2/handoff.md`:

1. In `packages/codegen/src/zodgen/generate-zod.ts`:
   - Implement and export `findCircularSchemas(schemas: Record<string, OasSchema>): Set<string>` which detects directed reference cycles via DFS.
   - Annotate only schemas in `circularSchemas` with `: z.ZodTypeAny` (`export const ${schemaConstName}${typeAnnotation} = ${zodExpr}`). Acyclic schemas remain unannotated so `z.infer` preserves full structural type inference.
   - Collect discriminator properties across all schemas (`collectDiscriminatorProperties`) and pass `discriminatorProperties` to `createZod4Algebra`.

2. In `packages/codegen/src/zodgen/schema-to-zod.ts`:
   - Add `discriminatorProperties?: Set<string>` to `Zod4AlgebraOptions`.
   - In `algebra.object`, mark property as required if key is in `discriminatorProperties` and the property schema has `'const'` or `'enum'` in it.
   - In `algebra.oneOf`, if `s.discriminator.mapping` exists and has keys, synthesize branches using `buildMappingBranches(...)` with `.extend({ [propertyName]: z.literal(key) })`.
   - In `prepareSchemaForZod`, when `s.discriminator?.propertyName` exists on `oneOf` or `anyOf`, ensure each branch that has the discriminator property in `properties` has it added to `branch.required`.
   - In `schemaToZod`, collect discriminator properties via `collectDiscriminatorProperties` and pass to algebra.
   - Export `buildMappingBranches` and `collectDiscriminatorProperties`.
   - In `foldSiblingProperties`, strip `description`, `default`, `example`, `title`, and `$comment` from `siblingSchema` before folding into the synthetic object to eliminate duplicate `.describe(...)`.

3. Synchronize Test Suites:
   - In `packages/codegen/test/zodgen/adversarial-challenger-1.test.ts`:
     - Update assertion for `ASchema` on lines 102-108 to match `export const ASchema: z.ZodTypeAny = z.object({` (or regex).
     - In `new Function` sanitization helpers (lines 112-120 and 179-187), add `.replace(/:\s*z\.ZodTypeAny/g, '')` so valid TypeScript annotations don't throw syntax errors in raw JS evaluation.
     - On line 211, verify TypeScript compile diagnostics count is 0 (`TS7022` resolved).
     - On lines 654-676, update discriminator omitted-required test: with the fix applied, it should successfully parse valid payloads (`safeParse({ kind: 'v1' }).success === true`) and return `false` without throwing for empty payloads.
   - In `packages/codegen/src/zodgen/schema-to-zod.test.ts`:
     - Line 482: Update `CategorySchema` regex or check if needed.
   - In `packages/codegen/test/e2e/zod4-generator.e2e.test.ts`:
     - Line 120: In `evalGeneratedModule`, strip `: z.ZodTypeAny`.
     - Line 123: Update `nameRegex` to handle optional `: z.ZodTypeAny`.

4. Run Complete Verification:
   - Run: `pnpm --filter @oa-sdk/codegen exec vitest run test/zodgen/adversarial-challenger-1.test.ts` (all 23 tests must pass).
   - Run: `pnpm --filter @oa-sdk/codegen test` (all unit and 98 E2E tests must pass).
   - Run: `pnpm --filter @oa-sdk/codegen run typecheck` (0 errors).
   - Run the in-memory TypeScript strict check from blueprint section 5.2.

5. Report Results:
   - Document all changes and verification outputs in `/Users/junwoobang/workflow/oa-sdk/.agents/remediation_worker_1/handoff.md`.
   - Send a completion message back to parent.
