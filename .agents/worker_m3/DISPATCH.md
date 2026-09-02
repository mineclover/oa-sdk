## 2026-09-03T07:05:58+09:00

You are the implementation Worker for Milestone 3: Manifest V3 CSP Audit Command (R3).
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m3
Project root: /Users/junwoobang/workflow/oa-sdk
Authoritative user request: /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md
Project plan: /Users/junwoobang/workflow/oa-sdk/PROJECT.md
Survey handoff: /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2/handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Exclusive Write Ownership:
- packages/codegen/src/cli/commands/audit-csp.ts
- packages/codegen/src/cli/commands.ts
- packages/codegen/test/audit-csp/ (or packages/codegen/test/cli-audit-csp.test.ts)

Task:
1. Read ORIGINAL_REQUEST.md, PROJECT.md, and .agents/explorer_survey_2/handoff.md.
2. Implement `packages/codegen/src/cli/commands/audit-csp.ts` and register `audit:csp` in `packages/codegen/src/cli/commands.ts`.
3. Implement AST scanner using TypeScript compiler API (`ts.createSourceFile`):
   - Traverse all JS/MJS/CJS files in `--bundle <dir>`.
   - Detect `eval(...)` calls (`csp/no-eval`).
   - Detect `new Function(...)` / `Function(...)` (`csp/no-new-function`).
   - Detect `setTimeout(string, ...)` and `setInterval(string, ...)` with string literal/template arguments (`csp/no-string-settimeout`, `csp/no-string-setinterval`).
   - Detect disallowed runtime heavy schema engines / SDK runtime imports: `ajv`, `zod`, `@oa-sdk` in ES imports or CommonJS `require(...)` (`csp/no-disallowed-import`).
4. Output structured CLI diagnostics with line/column and summary. Exit with code 1 via `CliExitError(1)` upon violations; exit code 0 when clean.
5. Add unit and CLI tests in packages/codegen/test/ covering clean bundles and violating fixtures.
6. Build and verify: run `pnpm --filter @oa-sdk/codegen test` and typecheck.
7. Write your handoff report to /Users/junwoobang/workflow/oa-sdk/.agents/worker_m3/handoff.md and notify parent via send_message.
