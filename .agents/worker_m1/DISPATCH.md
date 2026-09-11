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
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An integrity violation WILL be detected and your work WILL be rejected.

Implement R1 (Phase 2): TypeSpec AST Semantic Diff & Breaking Change Analyzer in packages/codegen.
Implement the 7-category breaking change classification, git ref resolver, CLI command `oa-gen tsp diff`, multi-token router, and unit/integration tests.
Run tests via pnpm and verify they pass.
Write your handoff report to /Users/junwoobang/workflow/oa-sdk/.agents/worker_m1/handoff.md.
Send a message to parent when complete.

## 2026-09-11T02:13:17Z
You are Worker for Milestone 1 (M1: Shared Benchmark & Profiling Library) in the oa-sdk performance benchmark and V8 profiling task.

## Your Identity & Working Directory
- Archetype: teamwork_preview_worker
- Role: Benchmark Library Implementer (M1)
- Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m1
- Workspace root: /Users/junwoobang/workflow/oa-sdk
- Domain skill to reference: /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-sdk/SKILL.md

## Mandatory Input
Read the authoritative user request at:
`/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md` (specifically section `## 2026-09-11T02:05:38Z`).
Also read the Survey Reports and Plan:
- `/Users/junwoobang/workflow/oa-sdk/.agents/orchestrator_4/plan.md`
- `/Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_3/handoff.md` (contains concrete implementation recipes for V8 profiler, memory delta, and FD leak tracking)
- `/Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_1/handoff.md`
- `/Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2/handoff.md`

## File Write Ownership
You EXCLUSIVELY own:
- `scripts/bench/lib/profiler.ts`
- `scripts/bench/lib/memory.ts`
- `scripts/bench/lib/fd.ts`
- `scripts/bench/lib/stats.ts`
- `scripts/bench/lib/generators.ts`
- `scripts/bench/lib/index.ts`
- `scripts/bench/lib/test-smoke.ts` (for self-verification)
DO NOT modify any files outside this boundary.

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Detailed Requirements
Implement a high-performance, zero-external-dependency benchmarking and profiling toolkit in `scripts/bench/lib/`:
1. `profiler.ts`:
   - Use `node:inspector/promises` Session to profile CPU execution.
   - Support `withCpuProfile<T>(name: string, fn: () => Promise<T>, options?: { samplingIntervalUs?: number; outputDir?: string }): Promise<{ result: T; profile: CpuProfileResult }>`.
   - Ensure directory exists (e.g. `.bench/`), export `.cpuprofile` JSON.
   - Traverse the call tree nodes to calculate total hit counts and extract top hotspots (sorted by hitCount descending with functionName, url, lineNumber, percentage).
2. `memory.ts`:
   - Enable GC programmatically via `v8.setFlagsFromString('--expose_gc')`.
   - `runGc()`: Run multiple passes of `global.gc?.()` to clear queued weak references and deferred finalizers.
   - `measureMemoryDelta<T>(fn: () => Promise<T>): Promise<{ result: T; delta: MemoryDelta }>` measuring initial and final heapUsed in MB, heap delta, and GC stats.
3. `fd.ts`:
   - `getOpenFdCount()`: On Darwin/macOS and Linux, inspect `/dev/fd` via `fs.readdirSync('/dev/fd')`. Fall back to `process._getActiveHandles().length`.
   - `assertZeroFdLeak(action: () => Promise<void> | void, iterations?: number)`: Run action repeatedly, wait a tick with `setImmediate` or micro-sleep so closing handles flush, and return initial, final, and leaked FD counts.
4. `stats.ts`:
   - `calculateLatencyStats(latenciesMs: number[]): LatencyStats` calculating min, p50, p90, p95, p99, max, mean, stddev, and throughput (QPS).
   - High-precision time helpers using `performance.now()`.
5. `generators.ts`:
   - `generateSyntheticTypeSpec(resourceCount: number, options?: { cyclic?: boolean }): string`: Generates valid TypeSpec source with N models and operations.
   - `generateSyntheticOpenApiSchema(modelCount: number, options?: { cyclic?: boolean; depth?: number }): Record<string, unknown>`: Generates valid OAS 3.2 document with circular $refs or deep nesting.
6. `index.ts`:
   - Cleanly export all utilities.
7. Verification:
   - Create `scripts/bench/lib/test-smoke.ts` and run it via `node --expose-gc --import tsx scripts/bench/lib/test-smoke.ts`. Ensure all smoke tests pass with 0 errors.

## Deliverable
Write your implementation files and run verification. Then write your report to:
`/Users/junwoobang/workflow/oa-sdk/.agents/worker_m1/handoff.md`
Report the command executed, the test results, and file paths. Send a completion message when finished.
