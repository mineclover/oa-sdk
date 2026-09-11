## 2026-09-11T02:34:39Z
You are Worker for Milestone 2 (M2: TypeSpec Compile & AST Diff Benchmark) in the oa-sdk performance benchmark and V8 profiling task.

## Your Identity & Working Directory
- Archetype: teamwork_preview_worker
- Role: TypeSpec Benchmark Implementer (M2)
- Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m2
- Workspace root: /Users/junwoobang/workflow/oa-sdk
- Domain skill to reference: /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-sdk/SKILL.md

## Mandatory Input
Read the authoritative user request at:
`/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md` (specifically section `## 2026-09-11T02:05:38Z`).
Also read:
- `/Users/junwoobang/workflow/oa-sdk/.agents/orchestrator_4/plan.md`
- `/Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_1/handoff.md` (contains baseline timings, AST diff APIs, git ref resolver details)
- `/Users/junwoobang/workflow/oa-sdk/scripts/bench/lib/index.ts` (shared benchmark & profiling toolkit built in M1)

## File Write Ownership
You EXCLUSIVELY own:
- `scripts/bench/bench-typespec.ts`
DO NOT modify any files outside this boundary. Use the shared toolkit from `scripts/bench/lib/index.js`.

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Detailed Requirements
Implement `scripts/bench/bench-typespec.ts` to execute real benchmarks and V8 CPU profiling for Components 1 and 2:
1. **TypeSpec In-Memory Compilation & Hot-Reload**:
   - Locate `packages/schemas/typespec/main.tsp`.
   - Measure Cold Compilation latency (compile + getOpenAPI3 via `compileTypeSpecInMemory` in `packages/codegen/src/cli/lib/typespec-mock-compiler.js`).
   - Measure Incremental Compilation latency using `{ oldProgram }` across 10 iterations. Compute speedup ratio.
   - Measure Large-scale compilation throughput using `generateSyntheticTypeSpec(100)` (100 resources = 200 ops, 200 models).
   - Measure heap memory retention delta over 10 repeated incremental compilations via `measureMemoryDelta`.
   - Verify watcher stability via `watchTypeSpec`.
2. **TypeSpec AST Semantic Diff (`oa-gen tsp diff`)**:
   - Measure AST semantic extraction speed (`extractTypeSpecSemantics` in `packages/codegen/src/cli/lib/typespec-ast-diff.js`).
   - Measure semantic diff throughput (`diffTypeSpecSemantics` and `diffTypeSpecPrograms`) on repo spec and large synthetic spec (100+ models).
   - Measure Git ref comparison latency (`HEAD~1` vs `HEAD`) using `resolveTypeSpecProgramRef` in `packages/codegen/src/cli/lib/typespec-ref-resolver.js`.
3. **V8 CPU Profiling & Hotspot Extraction**:
   - Wrap cold compile, incremental compile, and semantic diff in `withCpuProfile` to generate `.bench/typespec-compile-cold.cpuprofile`, `.bench/typespec-compile-incremental.cpuprofile`, and `.bench/typespec-diff.cpuprofile`.
   - Extract and print top hotspots for each workload.
4. **Output & Verification**:
   - Collect all metrics into a structured JSON file at `.bench/typespec-results.json`.
   - Print a clean, informative console summary table with ms, ops/sec, speedup ratios, memory deltas, and top hotspots.
   - Run verification via: `node --expose-gc --import tsx scripts/bench/bench-typespec.ts`. Ensure it executes cleanly and exits with code 0.

## Deliverable
Write your implementation file `scripts/bench/bench-typespec.ts` and run it. Write your report to:
`/Users/junwoobang/workflow/oa-sdk/.agents/worker_m2/handoff.md`
Report the command executed, output JSON/metrics, and file paths. Send a completion message when finished.
