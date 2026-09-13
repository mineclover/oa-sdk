# DISPATCH — M3 Worker (Automated Empirical Verification Test Suite)

## Mission
Implement the automated empirical verification test suite in `tests/e2e/docs-execution.test.ts` that extracts and executes all documented CLI commands, `--help` usage, and `oa.config.ts` configuration blocks, asserting exit code 0 and `tsc --noEmit` type safety.

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Context & Inputs
- Authoritative Request: `/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md` (see `## 2026-09-13T02:03:17Z`, Requirement R3)
- Global Project Architecture: `/Users/junwoobang/workflow/oa-sdk/.agents/orchestrator_12/PROJECT.md`
- Specification Report 1 (Suites 1 & 2): `/Users/junwoobang/workflow/oa-sdk/.agents/m3_spec_miner_cli/report.md`
- Specification Report 2 (Suites 3 & 4): `/Users/junwoobang/workflow/oa-sdk/.agents/m3_spec_miner_onboarding/report.md`
- Specification Report 3 (Suites 5 & 6): `/Users/junwoobang/workflow/oa-sdk/.agents/m3_spec_miner_recipes/report.md`

## Exclusively Owned Files
- `tests/e2e/docs-execution.test.ts`

## Tasks
1. Assemble and write `tests/e2e/docs-execution.test.ts` incorporating all 6 test suites designed by the 3 spec miners:
   - Helper infrastructure:
     - `runCli(args: string[], cwd?: string)` using Node + compiled CLI (`packages/codegen/dist/cli/index.js`) or tsx.
     - `runTsc(cwd: string)` using local `typescript/bin/tsc --noEmit` via `execFileSync`.
     - Temp directory lifecycle management using `fs.mkdtemp` and `beforeAll`/`afterAll` cleanups.
   - Suite 1: Help Flag Matrix Coverage (all 11 documented CLI targets).
   - Suite 2: Quick Start CLI Pipeline Execution (`oa-gen init --yes`, `validate`, `typegen`, `generate:zod`, `audit:shape`, `tsc --noEmit`).
   - Suite 3: Onboarding Framework Targets & Runtime Isolation (Fastify JIT, Bun Elysia zero-copy, Express method guards, NestJS generic fallback, dry-run, force).
   - Suite 4: Lifecycle Archetype Presets & Safety Gates (MVP, Microservice, Enterprise, and validation gates).
   - Suite 5: Configuration Recipe Schema & Type Validation (FSD outputRouting, Monorepo outputRouting, Microservice dual-layer, and path dispatch assertions).
   - Suite 6: TanStack Query & Handler Contract End-to-End Type Safety (TanStack 3-tier generation, handler contract generation, typed full-stack parity consumer with `runTsc(tmpDir)` yielding 0 diagnostics).
2. Execute `pnpm vitest run tests/e2e/docs-execution.test.ts` and verify 100% test pass rate.
3. Verify monorepo governance gates:
   - `pnpm check:docs`
   - `pnpm check:cli-spec`
   - `pnpm check:release-policy`
   - `pnpm check:api-index`
   - `pnpm typecheck:all`
4. Document all verification commands and exact results in `/Users/junwoobang/workflow/oa-sdk/.agents/m3_worker/handoff.md`.
5. Report completion via `send_message`.

## 2026-09-13T03:18:31Z
You are the Implementation Worker for Milestone M3 (Automated Empirical Verification Test Suite).
Your assigned working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/m3_worker
Read /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md (specifically Requirement R3), /Users/junwoobang/workflow/oa-sdk/.agents/orchestrator_12/PROJECT.md, and DISPATCH.md in your working directory.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Inputs & Specification Reports:
1. /Users/junwoobang/workflow/oa-sdk/.agents/m3_spec_miner_cli/report.md (Suites 1 & 2)
2. /Users/junwoobang/workflow/oa-sdk/.agents/m3_spec_miner_onboarding/report.md (Suites 3 & 4)
3. /Users/junwoobang/workflow/oa-sdk/.agents/m3_spec_miner_recipes/report.md (Suites 5 & 6)

Exclusively Owned File:
- `tests/e2e/docs-execution.test.ts`
