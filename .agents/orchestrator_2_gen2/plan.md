# Execution Plan: Milestone 5 Gate 1 Remediation (OpenAPI 3.2 to Zod 4 Generator)

## Context & Objectives
Predecessor `orchestrator_2` executed Milestones 1–4, passing 98/98 E2E tests and 63 unit tests.
Gate 1 resulted in:
- Reviewer 1: APPROVE
- Reviewer 2: APPROVE
- Challenger 2: APPROVE
- Forensic Auditor: CLEAN
- Challenger 1: REQUEST_CHANGES (TS7022 circular reference explicit type annotations, discriminator variant non-optional property enforcement).

`remediation_explorer_2` delivered an actionable blueprint in `/Users/junwoobang/workflow/oa-sdk/.agents/remediation_explorer_2/handoff.md` with exact diffs for:
1. Selective cycle detection via DFS (`findCircularSchemas`) annotating cyclic schemas with `: z.ZodTypeAny` while preserving 100% type inference for acyclic schemas.
2. Discriminator variant property required enforcement in `prepareSchemaForZod`, `discriminatorProperties` algebra option, and mapping alias synthesis.
3. Redundant `.describe(...)` cleanup in `foldSiblingProperties`.
4. Test suite synchronization in `adversarial-challenger-1.test.ts`, `schema-to-zod.test.ts`, and `zod4-generator.e2e.test.ts`.

## Steps
1. **Remediation Worker Dispatch**:
   - Spawn `teamwork_preview_worker` (`remediation_worker_1`).
   - Inputs: `remediation_explorer_2/handoff.md`, `ORIGINAL_REQUEST.md`, `PROJECT.md`.
   - Action: Apply changes to `packages/codegen/src/zodgen/generate-zod.ts`, `packages/codegen/src/zodgen/schema-to-zod.ts`, and test files.
   - Verification by Worker:
     - Run `pnpm --filter @oa-sdk/codegen exec vitest run test/zodgen/adversarial-challenger-1.test.ts`
     - Run `pnpm --filter @oa-sdk/codegen test` (all unit and E2E tests)
     - Run `pnpm --filter @oa-sdk/codegen run typecheck`
     - Run in-memory TS compilation strict check from blueprint.

2. **Re-verification Dispatch**:
   - Spawn `teamwork_preview_challenger` (`re_challenger_1`) to re-execute adversarial validation against the patched code and verify resolution of TS7022 and discriminator errors.
   - Spawn `teamwork_preview_reviewer` (`re_reviewer_1`) to review code quality, regression safety, and interface conformance.

3. **Gate Evaluation & Final Reporting**:
   - Record verdicts in `GATE_STATUS.md`.
   - Update `progress.md` and `PROJECT.md`.
   - Write `handoff.md`.
   - Send completion message to parent (`66fc19ba-51f5-4a60-8a60-a106e8fb21b4`).
