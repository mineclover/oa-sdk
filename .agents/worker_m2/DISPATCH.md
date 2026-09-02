## 2026-09-02T22:06:00Z
You are the implementation Worker for Milestone 2: CLI Category-Aware Linting & Profile-Aware Validation (R2).
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m2
Project root: /Users/junwoobang/workflow/oa-sdk
Authoritative user request: /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md
Project plan: /Users/junwoobang/workflow/oa-sdk/PROJECT.md
Survey handoff: /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2/handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Exclusive Write Ownership:
- packages/codegen/src/cli/commands/lint.ts
- packages/codegen/src/cli/commands/validate.ts
- packages/codegen/test/cli/ (or packages/codegen/test/cli-lint-validate.test.ts)

Task:
1. Read ORIGINAL_REQUEST.md, PROJECT.md, and .agents/explorer_survey_2/handoff.md.
2. In packages/codegen/src/cli/commands/lint.ts:
   - Declare `categories` in `options` (`--categories <comma-separated list>`).
   - Parse and validate category names against allowed `LintCategory` set ('structure' | 'operations' | 'parameters' | 'refs' | 'security' | 'style' | 'components' | 'surface').
   - Forward `categories` to `lintDocument(doc, { basePath, lookupSourceLocation, categories: parsedCategories })`.
3. In packages/codegen/src/cli/commands/validate.ts:
   - Declare `profile` in `options` (`--profile <component-bundle | operation-contract | full-api-document>`).
   - If provided, validate profile name using `isOpenApiProjectionProfile` and run `validateOpenApiProjection` from `@oa-sdk/openapi-projection-contract`.
   - Format profile diagnostics and ensure validation fails (exit code 1 via CliExitError) if profile invariants are violated (specifically if `operation-contract` has no operations under paths).
4. Add comprehensive unit and integration tests in packages/codegen/test/ verifying category filtering and profile validation.
5. Build and verify: run `pnpm --filter @oa-sdk/codegen test` and typecheck.
6. Write your handoff report to /Users/junwoobang/workflow/oa-sdk/.agents/worker_m2/handoff.md and notify parent via send_message.
