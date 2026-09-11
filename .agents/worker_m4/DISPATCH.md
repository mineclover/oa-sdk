# Dispatch: Milestone 4 - Monorepo Governance, CLI Documentation & Monorepo Gates

## Mission
Implement Requirement R4:
1. In `packages/codegen/src/cli/commands.ts`:
   - Register all new commands:
     - `tspDiff` (from `./commands/tsp-diff.js`)
     - `mock` (from `./commands/mock.js`)
     - Ensure `generateZod` is properly exported and listed.
2. In `docs/guides/cli-command-reference.md`:
   - Document all newly registered commands:
     - `oa-gen mock`: Options `--tsp`, `--spec`, `--port`, `--host`, `--watch`.
     - `oa-gen tsp diff`: Options `--base`, `--head`, `--fail-on-breaking`, `--format`.
     - `oa-gen generate:zod`: Options `--spec`, `--output`, `--runtime-adapter`.
   - Ensure the markdown table in `docs/guides/cli-command-reference.md` has rows matching `` `oa-gen <command>` `` and lists all option flags accurately.
3. In `scripts/check-cli-spec.ts`:
   - Ensure `undocumentedOaGenCommands` or governance specs account for new CLI command names (`mock`, `tsp-diff`, `generate-zod`, `generate:zod`) so that `pnpm check:cli-spec` passes cleanly.
4. Execute and verify all monorepo gates:
   - `pnpm check:docs` (Must pass all 5 document gates with 0 errors).
   - `pnpm schema:typespec-check` (Must pass with 0 drift).
   - `pnpm personas:check` (Must pass with 0 errors).
   - `pnpm test:e2e` (Must pass 150/150 tests).
   - `turbo run test` (All package test suites pass).

## Exclusive File Ownership
- `packages/codegen/src/cli/commands.ts`
- `docs/guides/cli-command-reference.md`
- `scripts/check-cli-spec.ts`

## Mandatory Rules & Warnings
- MANDATORY INTEGRITY WARNING:
  DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
- Read `/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md`.
- Read `/Users/junwoobang/workflow/oa-sdk/PROJECT.md`.

## Output
Write report to `/Users/junwoobang/workflow/oa-sdk/.agents/worker_m4/handoff.md`.
Send a message to parent when complete.

## 2026-09-11T00:12:44Z
You are the Monorepo Governance & CLI Verification Worker for Milestone 4.
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m4
Read your instructions in /Users/junwoobang/workflow/oa-sdk/.agents/worker_m4/DISPATCH.md.
Also read /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md and /Users/junwoobang/workflow/oa-sdk/PROJECT.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Implement R4:
1. Register mock, tspDiff, and generateZod in packages/codegen/src/cli/commands.ts.
2. Document all commands and option flags in docs/guides/cli-command-reference.md.
3. Update scripts/check-cli-spec.ts to ensure CLI governance passes.
4. Run all verification gates:
   - pnpm check:docs (all 5 gates pass with 0 errors)
   - pnpm schema:typespec-check (0 drift)
   - pnpm personas:check (0 errors)
   - pnpm test:e2e (150/150 pass)
   - turbo run test (monorepo tests pass)
Write your handoff report to /Users/junwoobang/workflow/oa-sdk/.agents/worker_m4/handoff.md.
Send a message to parent when complete.

## 2026-09-11T00:20:15Z
**Context**: Milestone 4 Implementation
**Content**: Status check: please proceed with registering commands in commands.ts, updating cli-command-reference.md, and running pnpm check:docs, pnpm schema:typespec-check, pnpm test:e2e, and turbo run test.
**Action**: Complete the steps and write your handoff report.
