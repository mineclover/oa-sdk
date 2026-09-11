# BRIEFING — 2026-09-11T11:11:30+09:00

## Mission
Investigate Components 3 & 4 for the performance benchmark & V8 profiling project:
- Component 3: Zod 4 / Codegen Engine (translation speed, circular DFS cycle detection with z.lazy, large schema scalability).
- Component 4: Mock Server HTTP Throughput & Routing Latency (NodeMockServer, atomic updateSpec, compareRouteSpecificity, concurrent QPS and p50/p95/p99 latency).
Produce detailed 5-component handoff report with exact signatures, benchmark designs, V8 profiling targets, and pitfalls.

## 🔒 My Identity
- Archetype: explorer / teamwork_preview_explorer
- Roles: investigation, synthesis
- Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2
- Original parent: c8e6c449-4228-4443-bc32-e90615c118a5
- Milestone: survey
- Sub-Identity (2026-09-10T23:21:16Z): Instant Mock Server Explorer
- Current parent: dcde8985-1d52-452b-9743-7bf870f71d2e
- Milestone: Benchmark & V8 Profiling Survey (Components 3 & 4)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Produce 5-component handoff report (Observation, Logic Chain, Caveats, Conclusion, Verification Method)
- Closed-by-default agent skill governance
- Zero-build instant mock: compile TypeSpec directly in-memory without writing intermediate OpenAPI YAML artifacts to disk
- Hot reload without dropping port binding or restarting process
- Focus on Components 3 & 4 (Zod 4 Codegen and Mock Server Throughput)
- Never place source code or tests in .agents/

## Current Parent
- Conversation ID: dcde8985-1d52-452b-9743-7bf870f71d2e
- Updated: 2026-09-11T11:07:30+09:00

## Investigation State
- **Explored paths**:
  - `packages/codegen/src/zodgen/`: `generate-zod.ts`, `schema-to-zod.ts`, `runtime-adapter.ts`, `index.ts`.
  - `packages/parser/src/`: `fold.ts` (`foldSchema`), `folder.ts` (`SchemaFolder`), `route-match.ts` (`matchRoute`, `compareRouteSpecificity`).
  - `packages/schemas/`: `typespec/approved.openapi.yaml` (2,599 lines, OAS 3.2), `src/openapi.yaml`, `test/fixtures/zodgen/` (`circular-components.yaml`, `filesystem-tree.yaml`, `ecommerce-lifecycle.yaml`).
  - `packages/mock-server/`: `src/adapters/node-http.ts` (`createNodeMockServer`), `src/core/handler.ts`, `src/core/generate.ts`, `src/core/response-picker.ts`, `src/core/request-validation/schema-compiler.ts`.
  - Benchmark precedents: `packages/codegen/scripts/bench-validation-engines.ts`.
- **Key findings**:
  - **Component 3 (Codegen Engine)**:
    - DFS Cycle Detection in `findCircularSchemas`: runs full DFS per node ($O(V \cdot (V + E))$), causing 37% to 51% of total codegen time for 200-500 models.
    - String Formatting: `formatGeneratedTs` uses line-by-line delimiter counting and multiple regex replacements, accounting for significant V8 ticks.
    - Reference wrapping: All component schemas are systematically lazily wrapped (`z.lazy(() => Schema)`), but only circular schemas receive `: z.ZodTypeAny` annotations to bypass TS7022 while maintaining static inference for non-cycles.
  - **Component 4 (Mock Server Throughput & Routing)**:
    - Server Engine: Native Node.js `node:http.createServer` with asynchronous event-loop concurrency.
    - Throughput: Measured 3,108 QPS at C=10 (p50=2.54ms, p99=19.74ms) and 3,207 QPS at C=100 (p50=21.74ms, p99=316.48ms) with 0.00% error rate.
    - Atomic `updateSpec`: Hot swaps `state = nextState` in synchronous event-loop execution. Under 50 concurrency with 3,000 requests, updateSpec completed with 0 errors and 0 dropped connections, but increased tail latency (p95 rose to ~142ms) due to synchronous schema recompilation.
    - Route matching bottleneck: `matchRoute` performs linear $O(N)$ scanning over all routes in `RouteIndex`. At 250 routes, matchRoute consumes ~40.15 µs/op, appearing as top V8 CPU hotspot alongside socket writes.
- **Unexplored areas**: None. Full empirical tests and V8 profiling completed.

## Key Decisions Made
- Confirmed synthetic generation recipes for Codegen (Deep, Circular, Wide Swarm).
- Confirmed load generation approach: zero-dependency native `http.Agent` with worker pool for reproducible high-throughput testing.
- Confirmed V8 profiling strategy: programmatic `node:inspector` CPU Profiler producing Chrome/VSCode `.cpuprofile` alongside standard `performance.now()`.

## Artifact Index
- /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2/handoff.md — Comprehensive Survey Report for Components 3 & 4
