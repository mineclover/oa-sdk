# Dispatch: Milestone 3 - Personas & DPM Native TypeSpec Decorators

## Mission
Implement Requirement R3 (Phase 4) in `@oa-sdk/typespec-decorators`, `@oa-sdk/personas`, and `@oa-sdk/dpm`:
1. In `@oa-sdk/typespec-decorators`:
   - `lib/decorators.tsp`: Extern declarations for `@personaCapability` (target: Operation, ...traits: valueof string[]) and `@pseudonymize` (target: ModelProperty, transform: valueof string, role?: valueof string, pii?: valueof boolean, relationship?: valueof string).
   - `src/decorators.ts`:
     - `@personaCapability`: validates traits against the 24 capability traits defined in `packages/personas/src/traits/skill.yaml`. Rejects unknown traits by reporting diagnostic `invalid-persona-trait`. Merges, sorts, and emits `x-oa-sdk-persona-traits: string[]` under the OpenAPI Operation Object.
     - `@pseudonymize`: validates transform against DPM transforms (`keep`, `redact`, `mask`, `null`, `hash`, `generalize`, `relationship_token`, `polymorphic_relationship_token`). Enforces DPM safety invariants (`SAF001`: direct_identifier cannot use keep; `SAF002`: pii foreign_identifier requires relationship; `SAF010`: pii field cannot use keep). Emits `x-oa-sdk-dpm-projection` under the OpenAPI Schema property.
   - `src/lib.ts`: Register diagnostics `invalid-persona-trait`, `invalid-pseudonymize-rule`, etc.
2. In `@oa-sdk/personas`:
   - `src/load.ts`: Update `loadOperationsFromMergedSpec` to extract `x-oa-sdk-persona-traits` into `OperationInfo.traits`.
   - `src/validate.ts`: Ensure persona validator checks endpoint trait obligations against persona required skills.
3. In `@oa-sdk/dpm`:
   - Ensure DPM validation gates (`data-binding-validator.ts`, `safety-validator.ts`) recognize and validate `x-oa-sdk-dpm-projection`.
4. Verification:
   - Run `pnpm --filter @oa-sdk/typespec-decorators test`
   - Run `pnpm personas:check`
   - Run `pnpm --filter @oa-sdk/dpm test`

## Exclusive File Ownership
- `packages/typespec-decorators/lib/decorators.tsp`
- `packages/typespec-decorators/src/decorators.ts`
- `packages/typespec-decorators/src/lib.ts`
- `packages/typespec-decorators/src/decorators.test.ts`
- `packages/personas/src/load.ts`
- `packages/personas/src/validate.ts`
- `packages/personas/src/__tests__/persona-traits.test.ts`
- `packages/dpm/src/validator/data-binding-validator.ts`

## Mandatory Rules & Warnings
- MANDATORY INTEGRITY WARNING:
  DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
- Read `/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md` before starting work.
- Consult the survey findings at `/Users/junwoobang/workflow/oa-sdk/.agents/spec_miner_survey_3/handoff.md`.
- Run builds and tests for affected targets and report results in handoff.

## Output
Write report to `/Users/junwoobang/workflow/oa-sdk/.agents/worker_m3/handoff.md`.

## 2026-09-10T23:28:44Z
You are the Personas & DPM Decorators Worker for Milestone 3.
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m3
Read your instructions in /Users/junwoobang/workflow/oa-sdk/.agents/worker_m3/DISPATCH.md.
Also read /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md, /Users/junwoobang/workflow/oa-sdk/PROJECT.md, and /Users/junwoobang/workflow/oa-sdk/.agents/spec_miner_survey_3/handoff.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Implement R3 (Phase 4): Native TypeSpec Decorators @personaCapability and @pseudonymize in packages/typespec-decorators, emit extensions x-oa-sdk-persona-traits and x-oa-sdk-dpm-projection, and integrate with packages/personas and packages/dpm.
Run tests and validation gates (pnpm personas:check) to verify compliance.
Write your handoff report to /Users/junwoobang/workflow/oa-sdk/.agents/worker_m3/handoff.md.
Send a message to parent when complete.

## 2026-09-11T02:34:39Z
You are Worker for Milestone 3 (M3: Zod 4 Codegen & Mock Server Benchmark) in the oa-sdk performance benchmark and V8 profiling task.

## Your Identity & Working Directory
- Archetype: teamwork_preview_worker
- Role: Zod 4 & Mock Server Implementer (M3)
- Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m3
- Workspace root: /Users/junwoobang/workflow/oa-sdk
- Domain skill to reference: /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-sdk/SKILL.md, /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-codegen/SKILL.md, /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-runtime/SKILL.md

## Mandatory Input
Read the authoritative user request at:
`/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md` (specifically section `## 2026-09-11T02:05:38Z`).
Also read:
- `/Users/junwoobang/workflow/oa-sdk/.agents/orchestrator_4/plan.md`
- `/Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2/handoff.md` (contains baseline QPS figures, Zod 4 cycle detection details, mock server architecture)
- `/Users/junwoobang/workflow/oa-sdk/scripts/bench/lib/index.ts` (shared benchmark & profiling toolkit built in M1)

## File Write Ownership
You EXCLUSIVELY own:
- `scripts/bench/bench-zod-mock.ts`
DO NOT modify any files outside this boundary. Use the shared toolkit from `scripts/bench/lib/index.js`.

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Detailed Requirements
Implement `scripts/bench/bench-zod-mock.ts` to execute real benchmarks and V8 CPU profiling for Components 3 and 4:
1. **Zod 4 / Codegen Engine**:
   - Locate `packages/schemas/typespec/approved.openapi.yaml`.
   - Measure full Zod 4 code generation speed (`generateZodFromSpec` in `packages/codegen/src/zodgen/generate-zod.js`).
   - Benchmark DFS circular reference cycle detection (`findCircularSchemas`) scaling across synthetic schemas with 10, 50, 100, 200, 500 models generated via `generateSyntheticOpenApiSchema`.
   - Measure formatting latency (`formatGeneratedTs` or formatting stage).
2. **Mock Server HTTP Throughput & Routing Latency**:
   - Start `createNodeMockServer` on an ephemeral port (e.g. port: 0) with a loaded specification.
   - Implement concurrent HTTP load test using native `node:http.request` with persistent keepAlive agent (`http.Agent({ keepAlive: true, maxSockets: 100 })`).
   - Benchmark throughput (QPS) and latency percentiles (min, p50, p90, p95, p99, max, mean) under concurrency levels:
     - Concurrency 10
     - Concurrency 50
     - Concurrency 100
   - Assert error rate is strictly < 0.1% (0 errors expected).
   - Benchmark atomic `updateSpec` route swap under active concurrent requests, verifying 0 dropped connections.
   - Benchmark route matching latency and `compareRouteSpecificity` overhead across small (10 routes), medium (50 routes), and large (200+ routes) routing tables.
3. **V8 CPU Profiling & Hotspot Extraction**:
   - Profile `generateZodFromSpec`, `findCircularSchemas` at scale (500 models), and Mock Server concurrent load using `withCpuProfile`.
   - Export `.cpuprofile` files to `.bench/`.
   - Extract and print top hotspots for both codegen DFS/formatting and mock server route matching.
4. **Memory & FD Stability**:
   - Measure heap retention delta across 2,000 HTTP requests using `measureMemoryDelta`.
   - Verify zero FD leaks across 20 mock server start/stop and updateSpec cycles using `assertZeroFdLeak`.
5. **Output & Verification**:
   - Export all metrics to `.bench/zod-mock-results.json`.
   - Print clean console summary tables with QPS, p50/p95/p99 ms, error rates, scaling curves, and top hotspots.
   - Run verification via: `node --expose-gc --import tsx scripts/bench/bench-zod-mock.ts`. Ensure it executes cleanly and exits with code 0.

## Deliverable
Write your implementation file `scripts/bench/bench-zod-mock.ts` and run it. Write your report to:
`/Users/junwoobang/workflow/oa-sdk/.agents/worker_m3/handoff.md`
Report the command executed, output JSON/metrics, and file paths. Send a completion message when finished.
