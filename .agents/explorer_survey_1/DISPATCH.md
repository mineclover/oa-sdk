# Dispatch: Survey 1 - TypeSpec AST Semantic Diff & Breaking Change Analyzer

## Mission
Investigate the codebase for implementing R1 (Phase 2):
- CLI command `oa-gen tsp diff` in `packages/codegen`
- Support `--base <ref>` and `--head <ref>` (file paths or git refs) and `--fail-on-breaking`
- TypeSpec AST parsing mechanisms using `@typespec/compiler` (how TypeSpec programs and AST are compiled, navigated, and compared)
- Classification of breaking vs non-breaking changes:
  - Removed operations
  - Altered HTTP methods/routes
  - Removed/renamed models
  - Removed properties
  - Newly required properties
  - Changed status codes
  - Changed `@operationId`
- Identify existing compiler/AST utilities in `packages/codegen`, `packages/parser`, or elsewhere in monorepo
- Document exact file locations, dependencies, interfaces, and testing strategies.

## Inputs
- /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md
- /Users/junwoobang/workflow/oa-sdk/packages/codegen
- /Users/junwoobang/workflow/oa-sdk/packages/schemas

## Output
Write report to `/Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_1/handoff.md`.
