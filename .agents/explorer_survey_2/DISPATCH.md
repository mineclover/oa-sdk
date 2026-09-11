# Dispatch: Survey 2 - Zero-Build Instant Mock Server

## Mission
Investigate the codebase for implementing R2 (Phase 3):
- CLI command `oa-gen mock --tsp <path>` (and watch mode `--watch`)
- How to compile TypeSpec specifications directly in-memory via `@typespec/compiler` (and `@typespec/openapi3` if emitter in-memory is used, or in-memory OpenAPI generation) without writing intermediate OpenAPI YAML artifacts to disk
- How `@oa-sdk/mock-server` operates (`createNodeMockServer`, port 4010, schema input structure)
- How to implement file watching (`--watch`) that detects `.tsp` modifications and updates in-memory routes/schemas without restarting the process or dropping port binding
- Identify existing mock server code in `packages/mock-server`, CLI entry points in `packages/codegen/src/cli`, and any existing mock CLI commands.
- Document exact interfaces, dependencies, error handling, and testing strategies.

## Inputs
- /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md
- /Users/junwoobang/workflow/oa-sdk/packages/mock-server
- /Users/junwoobang/workflow/oa-sdk/packages/codegen
- /Users/junwoobang/workflow/oa-sdk/packages/schemas

## Output
Write report to `/Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2/handoff.md`.

## 2026-09-10T23:21:16Z
Investigate the codebase for R2 (Phase 3): Zero-Build Instant Mock Server.
Investigate packages/mock-server, packages/codegen/src/cli, in-memory compilation with @typespec/compiler, hot reload/file watching without restart.
Write your findings and recommendation to /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2/handoff.md.
Send a message to parent when complete with a summary.
