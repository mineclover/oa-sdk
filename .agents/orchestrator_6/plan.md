# Project Execution Plan: Performance Optimization & Benchmark Verification

## Architecture & Problem Taxonomy
- **Category**: SWE (Software Engineering) / Performance Engineering
- **Codebase**: `oa-sdk` monorepo (TypeScript, Node.js, pnpm)
- **Scope**:
  1. `packages/codegen/src/zodgen/generate-zod.ts` (Zod 4 circular schema traversal)
  2. `packages/mock-server/src/adapters/node-http.ts` (HTTP serialization & headers)
  3. `packages/codegen/src/cli/lib/typespec-ast-diff.ts` (AST semantic diffing)
  4. Monorepo benchmark suite (`pnpm bench:all`) and regression gates

## Feature Inventory & Milestones
| # | Milestone | Scope | Dependencies | Status |
|---|-----------|-------|--------------|--------|
| M1 | Zod 4 Circular Ref Memoization | `packages/codegen/src/zodgen/generate-zod.ts` | None | DONE |
| M2 | Mock Server HTTP Serialization & Header Preallocation | `packages/mock-server/src/adapters/node-http.ts` | None | DONE |
| M3 | AST Semantic Diff Traversal Optimization | `packages/codegen/src/cli/lib/typespec-ast-diff.ts` | None | DONE |
| M4 | Performance Benchmark & Full Monorepo Regression Gate | `pnpm bench:all`, `pnpm test`, 150 E2E tests, docs gates | M1, M2, M3 | DONE |

## Detailed Milestone Scope & Acceptance Criteria

### M1: Zod 4 DFS Circular Reference Traversal Optimization
- **Target**: `packages/codegen/src/zodgen/generate-zod.ts`
- **Objective**: Memoize `$ref` extraction in `findCircularSchemas` to eliminate redundant recursive traversals.
- **Verification**: Zod generation unit tests pass; cycle detection produces identical circular schema sets.

### M2: Mock Server HTTP Response Serialization & Static Header Preallocation
- **Target**: `packages/mock-server/src/adapters/node-http.ts`
- **Objective**: Preallocate common static headers (`Content-Type`, `Date`, etc.) and optimize buffer serialization paths.
- **Verification**: Mock server tests pass, zero socket/FD leaks, 0.00% error rate under load.

### M3: AST Semantic Diff Traversal & State Inspection Optimization
- **Target**: `packages/codegen/src/cli/lib/typespec-ast-diff.ts`
- **Objective**: Optimize model and property comparison traversal and reference checking overhead.
- **Verification**: Diffing tests pass, identical diff outputs for equivalent and divergent ASTs.

### M4: Full Benchmark Remeasurement & Regression Gate
- **Target**: Full monorepo
- **Objective**:
  - Run `pnpm bench:all` and capture before/after metrics (Throughput, p50/p95 latency, Heap Delta).
  - Run full unit/integration test suites.
  - Run 150 TypeSpec ecosystem E2E tests.
  - Verify `pnpm check:docs` and `pnpm check:cli-spec`.
- **Integrity**: Zero tolerance for cheating or hardcoded outputs; Forensic Auditor must report CLEAN.
