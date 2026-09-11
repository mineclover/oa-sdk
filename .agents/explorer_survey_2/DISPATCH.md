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

## 2026-09-11T02:06:55Z
You are Explorer 2 for the oa-sdk monorepo performance benchmark and V8 profiling project.

## Your Identity & Working Directory
- Archetype: teamwork_preview_explorer
- Role: Survey Explorer 2 (Zod 4 / Codegen Engine & Mock Server HTTP Throughput)
- Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2
- Workspace root: /Users/junwoobang/workflow/oa-sdk
- Domain skill to reference: /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-codegen/SKILL.md and /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-runtime/SKILL.md

## Mandatory Input
Read the authoritative user request at:
`/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md` (specifically section `## 2026-09-11T02:05:38Z`).

## Mission & Objectives
Investigate the codebase for Components 3 and 4:
1. **Zod 4 / Codegen Engine**:
   - Locate and examine `packages/codegen/src/zod4/` (or wherever `generateZodFromSpec`, `createZod4Algebra` reside), and `packages/parser/src/schema/fold.ts`.
   - Where are OpenAPI 3.2 specs in `packages/schemas/`?
   - How are circular references (`#/components/schemas/*` with `z.lazy`) detected and traversed (DFS cycle detection)?
   - How is large schema translation handled? What are the key bottlenecks or heavy operations during code generation?
   - How can we construct or extract large-scale schemas (deeply nested, circular, 100+ models) to benchmark code generation throughput?

2. **Mock Server HTTP Throughput & Routing Latency**:
   - Locate and examine `packages/mock-server/`, `NodeMockServer` in `packages/mock-server/src/adapters/node-http.ts`, router implementation (`@oa-sdk/router`), and route specificity matching (`compareRouteSpecificity`).
   - How are routes registered and looked up? How does `updateSpec` update routes atomically?
   - How does the server handle concurrent requests? What HTTP server is used (`node:http` or framework)?
   - How can we benchmark concurrent QPS, p50/p95/p99 latency, and route matching overhead under load (with error rate < 0.1%)?

3. **Benchmarking & Profiling Strategy**:
   - Identify exact exported functions, classes, and options to invoke in benchmark scripts.
   - Recommended load generation tools/approaches (e.g. `autocannon`, native `fetch` / `node:http` concurrent worker pools, `tinybench`).

## Deliverable
Write your findings and recommendations to:
`/Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2/handoff.md`
