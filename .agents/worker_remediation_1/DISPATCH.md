# Dispatch — Worker Remediation 1 (Gate Remediation)

## Mandatory Context
Read the authoritative user request at:
`/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md` (specifically ## 2026-09-05T06:38:42Z).

Read the Project Plan at:
`/Users/junwoobang/workflow/oa-sdk/.agents/teamwork_preview_orchestrator_docs_1/PROJECT.md`

Read the Reviewer 1 Handoff (Finding 1 & 2):
`/Users/junwoobang/workflow/oa-sdk/.agents/reviewer_1/handoff.md`

Read the Challenger 1 Handoff (Critical Defect):
`/Users/junwoobang/workflow/oa-sdk/.agents/challenger_1/handoff.md`

## Your Working Directory
`/Users/junwoobang/workflow/oa-sdk/.agents/worker_remediation_1`

## Mandatory Integrity Warning
> DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Write Ownership Boundaries
You EXCLUSIVELY own and may edit:
- `/Users/junwoobang/workflow/oa-sdk/docs/guides/schema-architecture-and-conventions.md`
- `/Users/junwoobang/workflow/oa-sdk/packages/codegen/src/cli/commands/validate.ts`

## Remediation Tasks

### Task 1: Fix `.annotate(...)` Defect in `docs/guides/schema-architecture-and-conventions.md`
- In lines 1210–1236, the code example attempts to call `.annotate({...})` on a `z.object({...})` schema. Neither Zod v3 nor Zod v4 supports `.annotate(...)`.
- Inspect how `x-surface-*` extensions are attached in production or in OpenAPI projection (e.g. via OpenAPI schema object decoration, metadata helpers, or `.describe(...)` / OpenAPI projection contract).
- Update the code snippet so it is 100% valid TypeScript and executes cleanly without calling non-existent methods on Zod schemas.

### Task 2: Fix Single-Spec Recursive `$ref` Validation in `packages/codegen/src/cli/commands/validate.ts`
- Inspect `packages/codegen/src/cli/commands/validate.ts`:
  - In batch mode (lines 144–152), circular `$ref` errors/warnings from recursive schemas (`refs/cycle`) are suppressed when validating profiles or documents known to contain recursive schemas.
  - In single `--spec` mode (`runSpecValidation`, lines 246–329), this circular `$ref` suppression was omitted.
  - As a result, running `oa-gen validate --spec <spec> --profile component-bundle` on recursive specs like `visual-ir` emits 148 `refs/cycle` errors and exits with code 1.
  - Align `runSpecValidation` to apply the same circular `$ref` handling as batch mode.
- Verify that `pnpm --filter @oa-sdk/codegen test src/__tests__/e2e` test `T1-F14-4: validates visual-ir profile artifact` passes cleanly!

## Verification Requirements
- Run `pnpm --filter @oa-sdk/codegen test src/__tests__/e2e` and confirm all 202 E2E tests pass (100% pass).
- Run `pnpm -r typecheck` and confirm 0 errors across 21 packages.
- Run `pnpm check:docs` and confirm 0 errors.
- Run `pnpm exec tsx scripts/check-cli-spec.ts` and confirm 0 errors.
- Verify the snippet in `schema-architecture-and-conventions.md` compiles and runs without errors.

## Output Requirements
Write your detailed changes to:
`/Users/junwoobang/workflow/oa-sdk/.agents/worker_remediation_1/changes.md`
and write your structured handoff report to:
`/Users/junwoobang/workflow/oa-sdk/.agents/worker_remediation_1/handoff.md`.
Send a completion message back to parent when done.

## 2026-09-05T07:07:47Z
Invoked by parent a329d2dd-a30a-4c8e-872a-6ab18e0a1c87 to execute gate remediation tasks (Task 1: .annotate in schema-architecture-and-conventions.md, Task 2: runSpecValidation circular ref in validate.ts, Task 3: verification).
