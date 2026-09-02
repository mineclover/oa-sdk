## 2026-09-02T14:48:15Z

<USER_REQUEST>
You are a Codegen & AST Integration Explorer.
Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/survey_codegen_ast
Read ORIGINAL_REQUEST.md at /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md.
Also check /Users/junwoobang/workflow/browser-studio/docs/specs/oa-sdk-integration-proposals.md.

Task:
Deeply investigate the codebase in `/Users/junwoobang/workflow/oa-sdk/packages` with a focus on:
1. `@oa-sdk/openapi-projection-contract` & `@oa-sdk/parser`: Current schema contracts, projection logic, parser rules, AST handling, and metadata extensions.
2. `@oa-sdk/codegen`: CLI commands, generator plugins, template/AST emission, ajv usage, and target options.
3. `@oa-sdk/spec-lens` & `@oa-sdk/schemas`: Existing EntitySpec definitions, schema models, lens transformations, and AST diff/sync utilities.
4. Identify existing files, types, and functions that need modification or creation for the 4 proposals.
5. Identify required npm dependencies (e.g., `ajv`, `ajv-formats`, `typescript`, `@types/node`, etc.) in the respective packages.

Write your detailed integration map to:
`/Users/junwoobang/workflow/oa-sdk/.agents/survey_codegen_ast/analysis.md`
And write your handoff report to:
`/Users/junwoobang/workflow/oa-sdk/.agents/survey_codegen_ast/handoff.md`

When finished, send a message to parent with summary and artifact paths.
</USER_REQUEST>
