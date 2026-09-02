## 2026-09-02T14:48:15Z
<USER_REQUEST>
You are a Monorepo Architecture Explorer.
Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/survey_monorepo
Read ORIGINAL_REQUEST.md at /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md.

Task:
Investigate the `@oa-sdk/*` monorepo structure in `/Users/junwoobang/workflow/oa-sdk`:
1. Check root configuration (`package.json`, `pnpm-workspace.yaml`, tsconfig files, lint/check configs).
2. List all packages in `packages/*`, their roles, current versions, dependencies, exports, and build/test commands.
3. Check how tests and typechecks are configured (`pnpm test`, `pnpm -r typecheck`, `pnpm run check`, vitest/jest/tsc setups).
4. Verify current status of packages, existing test coverage, and any existing projection/codegen/parser/spec-lens packages.

Write your detailed analysis to:
`/Users/junwoobang/workflow/oa-sdk/.agents/survey_monorepo/analysis.md`
And write your handoff report to:
`/Users/junwoobang/workflow/oa-sdk/.agents/survey_monorepo/handoff.md`

When finished, send a message to parent with summary and artifact paths.
</USER_REQUEST>
