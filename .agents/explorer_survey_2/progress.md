# Progress: Survey Explorer 2 (Zod 4 Codegen & Mock Server Throughput)

- Last visited: 2026-09-11T11:11:15+09:00
- Status: Investigation complete, empirical benchmarks validated
- Current step: Writing handoff report to .agents/explorer_survey_2/handoff.md
- Findings summary:
  - Codegen: `findCircularSchemas` in `packages/codegen/src/zodgen/generate-zod.ts` does $O(V \cdot (V+E))$ DFS; consumes 37-51% of codegen time on large models; `formatGeneratedTs` consumes significant CPU during string formatting.
  - Mock Server: `createNodeMockServer` handles 3,000+ QPS with 0.00% errors under $C = 10, 50, 100$. `updateSpec` is atomic and drops 0 connections under concurrent load, but causes a brief tail latency spike (p95 jumps from ~39ms to ~142ms). `matchRoute` does a linear $O(N)$ scan across all routes.
