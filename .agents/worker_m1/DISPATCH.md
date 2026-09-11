# Dispatch: Milestone 1 - TypeSpec AST Semantic Diff & Breaking Change Analyzer

## Mission
Implement Requirement R1 (Phase 2) in `@oa-sdk/codegen`:
1. Core AST diff engine: `packages/codegen/src/cli/lib/typespec-ast-diff.ts`:
   - Programmatic in-memory compilation using `@typespec/compiler` (`noEmit: true`), `@typespec/http` (`getAllHttpServices`), and `@typespec/openapi` (`getOperationId`).
   - Semantic extraction of operations (route, verb, statusCodes, parameters, operationId) and domain models (name, properties, types, optionality).
   - 7-category breaking change classification:
     - Removed operations (`operation-removed`)
     - Altered HTTP methods/routes (`route-changed`, `http-method-changed`)
     - Removed/renamed models (`model-removed`)
     - Removed properties (`property-removed`)
     - Newly required properties (`property-required`, `required-property-added`)
     - Changed status codes (`status-code-removed`)
     - Changed `@operationId` (`operation-id-changed`)
   - Non-breaking change classification (`operation-added`, `model-added`, `property-added`, `property-optional`, `status-code-added`).
2. Git ref & file path resolver: `packages/codegen/src/cli/lib/typespec-ref-resolver.ts`:
   - Handles local file paths / directories and git refs (`HEAD~1`, `main`, etc.) via `git archive` to temp tree with symlinked `node_modules`.
3. Multi-token CLI routing: `packages/codegen/src/cli/index.ts`:
   - Compound subcommand lookahead for `oa-gen tsp diff`.
4. CLI command: `packages/codegen/src/cli/commands/tsp-diff.ts`:
   - Arguments `--base <ref>`, `--head <ref>`, `--fail-on-breaking`, `--format <markdown|json>`.
   - Exits with non-zero code (`throw new CliExitError(1)`) when `--fail-on-breaking` is set and breaking changes are detected.
5. Unit and integration tests: `packages/codegen/src/__tests__/tsp-diff.test.ts` (or `test/tsp-diff.test.ts`).
   - Comprehensive test suite covering all 7 breaking categories and non-breaking additions.

## Exclusive File Ownership
- `packages/codegen/src/cli/commands/tsp-diff.ts`
- `packages/codegen/src/cli/lib/typespec-ast-diff.ts`
- `packages/codegen/src/cli/lib/typespec-ref-resolver.ts`
- `packages/codegen/src/cli/index.ts`
- `packages/codegen/src/__tests__/tsp-diff.test.ts`

## Mandatory Rules & Warnings
- MANDATORY INTEGRITY WARNING:
  DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
- Read `/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md` before starting work.
- Consult the survey findings at `/Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_1/handoff.md`.
- Run builds and tests for affected targets (`pnpm --filter @oa-sdk/codegen test`) and report results in handoff.

## Output
Write report to `/Users/junwoobang/workflow/oa-sdk/.agents/worker_m1/handoff.md`.

## 2026-09-10T23:28:44Z
You are the TypeSpec Diff Worker for Milestone 1.
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m1
Read your instructions in /Users/junwoobang/workflow/oa-sdk/.agents/worker_m1/DISPATCH.md.
Also read /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md, /Users/junwoobang/workflow/oa-sdk/PROJECT.md, and /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_1/handoff.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Implement R1 (Phase 2): TypeSpec AST Semantic Diff & Breaking Change Analyzer in packages/codegen.
Implement the 7-category breaking change classification, git ref resolver, CLI command `oa-gen tsp diff`, multi-token router, and unit/integration tests.
Run tests via pnpm and verify they pass.
Write your handoff report to /Users/junwoobang/workflow/oa-sdk/.agents/worker_m1/handoff.md.
Send a message to parent when complete.
