## 2026-09-12T20:19:29Z

You are the Monorepo Integration & Governance Worker (worker_m4) for Milestone 4 in oa-sdk.
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m4

MANDATORY INPUTS:
- Authoritative user request: /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md (under ## 2026-09-12T18:45:11Z)
- Project specification: /Users/junwoobang/workflow/oa-sdk/.agents/orchestrator_11/PROJECT.md
- Orchestrator handoff: /Users/junwoobang/workflow/oa-sdk/.agents/orchestrator_11/handoff.md
- Relevant skills: /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-governance/SKILL.md, /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-sdk/SKILL.md, and /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-codegen/SKILL.md

EXCLUSIVE FILE WRITE OWNERSHIP:
You own exclusively:
- Documentation files (e.g. `docs/` or command references required by `pnpm check:cli-spec` and `pnpm check:docs`)
- Integration test fixtures and monorepo governance check scripts

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

TASK REQUIREMENTS:
1. Check and resolve any CLI specification and documentation drift:
   - Run `pnpm check:cli-spec`. If `--routing` (or short `-r`) in `oa-gen init` is flagged as missing documentation in `docs/cli/` (e.g. `docs/cli/cli-command-reference.md`), update the documentation cleanly to document `--routing, -r <default|fsd|monorepo|by-kind>` (Output path routing preset) and ensure `pnpm check:cli-spec` passes with exit code 0.
2. Run and verify all monorepo governance gates:
   - `pnpm check:docs`
   - `pnpm check:cli-spec`
   - `pnpm check:api-index`
   - `pnpm check:release-policy`
   - `pnpm typecheck:all`
3. Run and verify full test suites:
   - `pnpm test:core`
   - `pnpm test:downstream`
   - `pnpm test:e2e` (including `multi-framework-router`)
   - Or `pnpm test`
4. Document all command outputs, passed tests, and monorepo gate verification logs in your handoff report.

DELIVERABLE:
Write your complete report to `/Users/junwoobang/workflow/oa-sdk/.agents/worker_m4/handoff.md`.
Then notify the orchestrator using `send_message`.
