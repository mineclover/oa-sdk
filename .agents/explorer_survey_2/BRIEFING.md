# BRIEFING — 2026-09-02T15:52:00Z

## Mission
Investigate requirements R2 (CLI Category-Aware Linting & Profile-Aware Validation) and R3 (Automated Manifest V3 CSP Audit Command) in @oa-sdk and produce a comprehensive survey report.

## 🔒 My Identity
- Archetype: explorer
- Roles: investigation, synthesis
- Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2
- Original parent: c8e6c449-4228-4443-bc32-e90615c118a5
- Milestone: survey

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Produce 5-component handoff report (Observation, Logic Chain, Caveats, Conclusion, Verification Method)

## Current Parent
- Conversation ID: c8e6c449-4228-4443-bc32-e90615c118a5
- Updated: 2026-09-02T15:52:00Z

## Investigation State
- **Explored paths**:
  - `packages/codegen/src/cli/commands/lint.ts`
  - `packages/codegen/src/cli/commands/validate.ts`
  - `packages/codegen/src/cli/commands/generate.ts`
  - `packages/codegen/src/cli/commands.ts`
  - `packages/codegen/src/cli/lib/{args.ts, types.ts, run.ts, diagnostics.ts, errors.ts, load-spec.ts}`
  - `packages/parser/src/lint.ts`
  - `packages/parser/src/validate.ts`
  - `packages/openapi-projection-contract/src/{index.ts, surface-extensions.ts, validation.test.ts}`
  - `packages/codegen/test/standalone-guards/cli.test.ts`
  - `packages/codegen/test/e2e/standalone-guards.e2e.test.ts`
  - `packages/codegen/src/__tests__/{cli.test.ts, cli-scenarios.test.ts, builder-projection-validation.test.ts}`
- **Key findings**:
  - `oa-codegen lint` currently lacks `--categories`. `@oa-sdk/parser` already implements `categories` filter supporting: `'structure' | 'operations' | 'parameters' | 'refs' | 'security' | 'style' | 'components' | 'surface'`. Wiring it up in `lint.ts` requires declaring `categories` option in `lint.options`, splitting comma-separated string, and forwarding to `lintDocument`.
  - `oa-codegen validate` currently lacks `--profile`. `@oa-sdk/openapi-projection-contract` provides `validateOpenApiProjection` and profile semantics for `'component-bundle'`, `'operation-contract'`, and `'full-api-document'`. Wiring it up requires declaring `profile` option, checking against `OPENAPI_PROJECTION_PROFILES`, validating document via `validateOpenApiProjection`, and emitting errors / exit code 1 if profile invariants fail (such as `operation-contract` with no operations under `paths`).
  - `oa-codegen audit:csp --bundle <dir>` is a new command to be created at `packages/codegen/src/cli/commands/audit-csp.ts` and registered in `commands.ts`. It will scan bundled JS files using AST/regex for `eval(`, `new Function(`, `setTimeout(string)`, `setInterval(string)`, and disallowed runtime schema engines (`ajv`, `zod`, `@oa-sdk` imports/requires). Emits structured diagnostics and exits with code 1 upon violation.
- **Unexplored areas**: None for R2/R3 scope.

## Key Decisions Made
- Confirmed full design and implementation strategy for R2 (`--categories`, `--profile`) and R3 (`audit:csp`).
- Formulated exact test cases, entrypoints, and acceptance criteria verification.

## Artifact Index
- /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2/handoff.md — Final investigation handoff report
