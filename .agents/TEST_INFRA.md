# E2E Test Infra: Typia AST Tags, Validation Benchmark Suite & Architectural Docs

## Test Philosophy
- Opaque-box, requirement-driven testing. Derived strictly from `ORIGINAL_REQUEST.md` and user-facing requirements.
- 4-Tier Test Architecture: Category-Partition (Tier 1), Boundary Value Analysis (Tier 2), Pairwise Combinatorial Interactions (Tier 3), Real-World Application Workloads (Tier 4).
- Standalone test execution: `packages/codegen/test/e2e/typia-benchmark-docs.e2e.test.ts`.
- Zero coupling to implementation private internals.

## Feature Inventory Coverage Matrix
| # | Feature | Requirement Source | Tier 1 (Happy Path) | Tier 2 (Boundaries) | Tier 3 (Cross-Feature) |
|---|---------|-------------------|:-------------------:|:-------------------:|:----------------------:|
| F1 | Typia AST Tag Decomposition | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| F2 | Numeric Bounds & Negative Values | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| F3 | String Format & Pattern Tags | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| F4 | Bidirectional Type Emission | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| F5 | Surgical Patch Bitwise Invariance | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| F6 | Auto-Detection in `type-sync.ts` | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| F7 | Typia AST Unit Test Suite | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| F8 | Realistic Benchmark Schemas | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| F9 | Synchronous 3-Paradigm Compilers | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| F10 | Benchmark Metrics Engine | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| F11 | Benchmark Runner Script & Exports | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| F12 | Npm Script & Acceptance Gates | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| F13 | Normative Benchmark Report Doc | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| F14 | Master Documentation Indexing | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| F15 | Concept Guide (Validation Continuum) | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| F16 | Schema Conventions Guide (§ 3.4) | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| F17 | Platform Scope Quarantine Doc | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| F18 | Monorepo Integrity & E2E Clean | ORIGINAL_REQUEST AC | 5 | 5 | ✓ |

## Test Architecture
- Test Suite Location: `packages/codegen/test/e2e/typia-benchmark-docs.e2e.test.ts`
- Runner: `pnpm --filter @oa-sdk/codegen exec vitest run test/e2e/typia-benchmark-docs.e2e.test.ts`
- Verification Semantics: All tests pass with exit code 0.

## Real-World Application Scenarios (Tier 4)
1. **Scenario 1: Full E2E Schema Lifecycle Roundtrip**: Zod Schema -> Project to EntitySpec -> Emit Typia Interface with Type Tags -> Patch interface -> Read back to EntitySpec -> Validate bitwise invariance.
2. **Scenario 2: Validation Engine Benchmark Execution**: Execute `pnpm --filter @oa-sdk/codegen bench:validation` end-to-end, verify JSON output format, check standalone type guards latency < 0.5ms (500 µs), and verify 0 CSP violations.
3. **Scenario 3: Documentation Verification Gate**: Run `pnpm check:docs` verifying all links to `docs/benchmarks/validation-engines.md` and cross-references across `runtime-and-generation.md`, `schema-architecture-and-conventions.md`, `platform-scope.md`, and `docs/README.md`.
4. **Scenario 4: Monorepo Full Typecheck Gate**: Execute `pnpm -r typecheck` verifying clean type checking across all packages.
5. **Scenario 5: Monorepo Full Test Suite Gate**: Execute `pnpm test` verifying all unit and integration tests pass without regression.

## Coverage Thresholds
- N = 18 features
- Tier 1: ≥ 90 test cases (5 per feature)
- Tier 2: ≥ 90 test cases (5 per feature)
- Tier 3: ≥ 18 pairwise interaction test cases
- Tier 4: ≥ 5 application-level end-to-end scenarios
- Total Target: ≥ 203 test cases
