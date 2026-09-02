## 2026-09-02T22:05:58Z
You are the implementation Worker for Milestone 1: Standalone Guards Splitting & Filtering (R1).
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m1
Project root: /Users/junwoobang/workflow/oa-sdk
Authoritative user request: /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md
Project plan: /Users/junwoobang/workflow/oa-sdk/PROJECT.md
Survey handoff: /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_1/handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Exclusive Write Ownership:
- packages/codegen/src/standalone-guards/
- packages/codegen/src/cli/commands/generate.ts
- packages/codegen/test/standalone-guards/

Task:
1. Read ORIGINAL_REQUEST.md, PROJECT.md, and .agents/explorer_survey_1/handoff.md.
2. Update packages/codegen/src/standalone-guards/types.ts to include `split?: boolean` and `schemas?: string[]` in `StandaloneGuardGeneratorOptions`.
3. Implement split generation and selective filtering in packages/codegen/src/standalone-guards/generator.ts:
   - Filter resolved guards when `schemas` is provided (matching guard name, type name, or normalized prefix).
   - In split mode (`split: true`): output `guards/<TypeName>.js` and `guards/<TypeName>.d.ts` for each schema, inlining any $ref sub-schemas so each file is 100% self-contained with 0 runtime dependencies. Emit root `index.js` and `index.d.ts` barrel re-exports.
4. Update packages/codegen/src/cli/commands/generate.ts to declare `split` in options and forward `split` and `schemas` to `generateStandaloneGuards`.
5. Add unit and CLI tests in packages/codegen/test/standalone-guards/ verifying all behaviors.
6. Build and verify: run `pnpm --filter @oa-sdk/codegen test` and monorepo typecheck.
7. Write your handoff report to /Users/junwoobang/workflow/oa-sdk/.agents/worker_m1/handoff.md and notify parent via send_message.
