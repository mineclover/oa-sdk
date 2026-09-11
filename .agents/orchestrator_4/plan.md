# Project Plan: oa-sdk Monorepo Performance Benchmark & V8 Profiling

## Architecture & System Overview
This project establishes a comprehensive, zero-dependency performance benchmarking and V8 CPU/memory profiling harness across the 4 core components of the oa-sdk monorepo, identifies hotspots and root causes, and delivers an authoritative markdown profiling report.

### Core Pipelines under Benchmark
1. **TypeSpec In-Memory Compilation & Hot-Reload (`packages/codegen/src/cli/lib/typespec-mock-compiler.ts`)**:
   - Cold compilation latency vs Incremental (`oldProgram`) recompilation latency.
   - Large-scale spec throughput (100+ endpoints and models).
   - Hot-reload file watcher lifecycle and event debounce.
2. **TypeSpec AST Semantic Diff (`packages/codegen/src/cli/lib/typespec-ast-diff.ts`, `typespec-ref-resolver.ts`)**:
   - AST semantic extraction speed.
   - Breaking vs non-breaking change classification throughput across 7 categories.
   - Git ref resolution overhead (`git archive` scoping optimization).
3. **Zod 4 / Codegen Engine (`packages/codegen/src/zodgen/`)**:
   - OpenAPI 3.2 schema conversion to Zod 4 TypeScript AST.
   - DFS circular reference cycle detection (`findCircularSchemas`) scaling ($O(V \cdot (V + E))$).
   - Large schema translation throughput and formatting overhead (`formatGeneratedTs`).
4. **Mock Server HTTP Throughput & Routing Latency (`packages/mock-server/src/adapters/node-http.ts`)**:
   - Concurrent request throughput (QPS) and latency percentiles (p50, p90, p95, p99) under concurrency 10, 50, 100.
   - Error rate verification (guaranteed < 0.1%).
   - Atomic in-memory route swap (`server.updateSpec`) stability under active HTTP traffic.
   - Route specificity matching (`compareRouteSpecificity` and linear regex scan in `matchRoute`).

### Profiling & Resource Verification Architecture
- **V8 CPU Profiling**: Programmatic profiling via `node:inspector/promises` Session emitting `.cpuprofile` artifacts with microsecond resolution and line-level tick hotspots.
- **Heap Allocation & Retained Memory**: Multi-pass `global.gc()` before and after workload loops via `v8.setFlagsFromString('--expose_gc')` to measure true retained memory delta.
- **File Descriptor (FD) Leaks**: Platform inspection via `fs.readdirSync('/dev/fd')` and `process._getActiveHandles()` across repeated hot-reload / watch loops and server start/stop cycles.
- **Event Loop Delay**: Native `monitorEventLoopDelay` from `node:perf_hooks` for continuous event loop lag tracking.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Shared Profiling & Metrics Library | V8 CPU profiler, heap tracker, FD leak checker, latency percentile calculator in `scripts/bench/lib/` | M1 | Survey 3 |
| 2 | Synthetic Spec & Schema Generators | Generators for large-scale TypeSpec models (100+ ops/models) and OAS 3.2 circular schemas | M1 | Survey 1, 2 |
| 3 | TypeSpec Compilation Benchmark | Benchmark cold vs incremental compilation, measure speedup ratio and throughput | M2 | Survey 1 |
| 4 | TypeSpec AST Semantic Diff Benchmark | Benchmark semantic extraction and diffing on repo spec and synthetic 100+ model specs | M2 | Survey 1 |
| 5 | TypeSpec Profiling & Hotspots | V8 CPU profile for compile & diff, identifying checker/semantic walker hotspots | M2 | Survey 1 |
| 6 | Zod 4 Codegen Benchmark | Benchmark `generateZodFromSpec` on approved spec and circular/wide synthetic schemas | M3 | Survey 2 |
| 7 | Mock Server Concurrent Load Benchmark | High-throughput loopback load harness measuring QPS, p50/p95/p99, error rate (<0.1%) | M3 | Survey 2 |
| 8 | Mock Server Hot-Reload & Route Match Benchmark | Benchmark atomic `updateSpec` under load and route specificity matching latency | M3 | Survey 2 |
| 9 | Zod 4 & Mock Server Profiling & Hotspots | V8 CPU profiling for cycle detection DFS, formatting, and `matchRoute` regex scan | M3 | Survey 2 |
| 10 | Master Benchmark Runner (`run-all.ts`) | Unified CLI runner executing all 4 pipelines, generating `.bench/summary.json` | M4 | Survey 3 |
| 11 | Resource & Leak Verification Audit | Long-running test measuring heap retention delta and FD stability over 20-50 iterations | M4 | Survey 3 |
| 12 | Comprehensive Markdown Profiling Report | Detailed report in `docs/benchmarks/performance-profiling-report.md` with metrics, hotspots, tuning | M5 | Survey 1, 2, 3 |
| 13 | Monorepo Governance & Doc Verification | Verification with `pnpm check:docs` ensuring 0 errors across all governance gates | M5 | Survey 3 |

---

## Milestones & Execution Order

| # | Milestone Name | Scope & Files Owned | Dependencies | Status |
|---|----------------|---------------------|--------------|--------|
| **M1** | Shared Benchmark & Profiling Library | `scripts/bench/lib/profiler.ts`, `memory.ts`, `fd.ts`, `stats.ts`, `generators.ts`, `scripts/bench/lib/index.ts` | None | DONE |
| **M2** | TypeSpec Compile & AST Diff Benchmark | `scripts/bench/bench-typespec.ts` | M1 | IN_PROGRESS |
| **M3** | Zod 4 Codegen & Mock Server Benchmark | `scripts/bench/bench-zod-mock.ts` | M1 | IN_PROGRESS |
| **M4** | Master Runner & Resource Leak Audit | `scripts/bench/run-all.ts`, `package.json` script `bench:all` | M2, M3 | PLANNED |
| **M5** | Comprehensive Markdown Report & Governance | `docs/benchmarks/performance-profiling-report.md`, `pnpm check:docs` | M4 | PLANNED |
| **Final** | Full Verification, Review & Forensic Audit | Verification of all acceptance criteria, review pass, challenger pass, clean audit | M1, M2, M3, M4, M5 | PLANNED |

---

## Code Layout & Write Ownership
To avoid write collisions, each milestone has strictly partitioned write ownership:
- **M1 Worker**: Owns `scripts/bench/lib/**`
- **M2 Worker**: Owns `scripts/bench/bench-typespec.ts`
- **M3 Worker**: Owns `scripts/bench/bench-zod-mock.ts`
- **M4 Worker**: Owns `scripts/bench/run-all.ts` and root `package.json` (benchmark script addition only)
- **M5 Worker**: Owns `docs/benchmarks/performance-profiling-report.md`

## Interface Contracts

### `scripts/bench/lib/profiler.ts`
```typescript
export interface CpuProfileResult {
  profilePath: string;
  topHotspots: Array<{ functionName: string; url: string; lineNumber: number; hitCount: number; percentage: number }>;
}
export async function withCpuProfile<T>(name: string, fn: () => Promise<T>): Promise<{ result: T; profile: CpuProfileResult }>;
```

### `scripts/bench/lib/memory.ts`
```typescript
export interface MemoryDelta {
  initialHeapMb: number;
  finalHeapMb: number;
  heapDeltaMb: number;
  gcRuns: number;
}
export function measureMemoryDelta(fn: () => void | Promise<void>): Promise<MemoryDelta>;
```

### `scripts/bench/lib/fd.ts`
```typescript
export function getOpenFdCount(): number;
export function assertZeroFdLeak(action: () => void | Promise<void>, iterations?: number): Promise<{ initialFds: number; finalFds: number; leaked: number }>;
```

### `scripts/bench/lib/stats.ts`
```typescript
export interface LatencyStats {
  samples: number;
  minMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  meanMs: number;
}
export function calculateLatencyStats(latenciesMs: number[]): LatencyStats;
```
