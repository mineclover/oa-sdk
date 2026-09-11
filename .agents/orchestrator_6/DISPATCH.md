## 2026-09-11T05:20:46Z

You are the Project Orchestrator for the performance bottleneck optimization and benchmark verification project in `/Users/junwoobang/workflow/oa-sdk`.

Your working directory is:
`/Users/junwoobang/workflow/oa-sdk/.agents/orchestrator_6`

The authoritative user request is recorded verbatim in:
`/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md` (see section `## 2026-09-11T05:20:05Z`).

## Mission Objectives
Directly implement code-level optimizations for the 3 core bottlenecks identified in the performance profiling report, and verify quantitative improvements and zero regressions via full benchmark and test runs:

1. **R1: Zod 4 DFS Circular Reference Traversal Optimization (`extractRefs` Memoization)**
   - Target: `packages/codegen/src/zodgen/generate-zod.ts` in `findCircularSchemas` pipeline.
   - Cache/memoize `$ref` extraction results for each schema object to eliminate duplicate recursive traversals (resolving the 69.1% V8 self-time bottleneck).
   - Guarantee 100% semantic correctness of circular reference detection.

2. **R2: Mock Server HTTP Response Serialization & Static Header Preallocation**
   - Target: `packages/mock-server/src/adapters/node-http.ts`.
   - Minimize per-response string formatting and socket buffer allocations (`writeLatin1String`, `writev`) by preallocating common headers (`Content-Type`, `Date`, etc.) and/or optimizing serialization paths.
   - Maximize QPS and reduce latency under heavy concurrent loads.

3. **R3: AST Semantic Diff Traversal & State Inspection Optimization**
   - Target: `packages/codegen/src/cli/lib/typespec-ast-diff.ts`.
   - Optimize reference check overhead during model and property comparison traversal to accelerate diffing across large specs.

4. **R4: Performance Remeasurement & Full Regression Verification**
   - Run `pnpm bench:all` and compare quantitative metrics (Throughput, p50/p95 latency, Heap Delta) before and after optimizations, recording results in the benchmark summary / reports.
   - Ensure 0.00% error rate and 0 FD leaks on Mock Server.
   - Ensure 100% pass across monorepo unit/integration tests and 150 TypeSpec ecosystem E2E tests.
   - Ensure `pnpm check:docs` and `pnpm check:cli-spec` pass with 0 errors.

## Operating Rules
- Initialize your working directory with `BRIEFING.md`, `plan.md`, and `progress.md`.
- Keep `progress.md` updated as you advance through milestones.
- Decompose work and dispatch to specialist subagents (e.g. explorer, implementers, reviewers/bench testers) in their own subdirectories under `.agents/`.
- Ensure all acceptance criteria are met.
- Write a comprehensive `handoff.md` in `/Users/junwoobang/workflow/oa-sdk/.agents/orchestrator_6/handoff.md` and notify the sentinel when complete.
