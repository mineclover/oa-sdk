# TEST_READY: OpenAPI 3.2 to Zod 4 Generator & CLI

## Overview
A comprehensive 4-Tier E2E test suite for the OpenAPI 3.2 to Zod 4 generator and CLI has been designed, authored, typechecked, and verified ready for test-driven milestone implementation.

- **Target Test File**: `packages/codegen/test/e2e/zod4-generator.e2e.test.ts`
- **Fixtures Directory**: `packages/codegen/test/fixtures/zodgen/`
- **Runner Command**: `pnpm --filter @oa-sdk/codegen exec vitest run test/e2e/zod4-generator.e2e.test.ts`
- **Typecheck Command**: `pnpm --filter @oa-sdk/codegen run typecheck`
- **Total Test Cases**: 98
- **Baseline Execution Results**:
  - Total Tests Executed: 98
  - Baseline Passed: 1 (OAS 3.2 spec parsing and baseline validation)
  - Baseline Failed: 97 (Unimplemented features awaiting M1, M2, M3, M4)
  - TypeScript Compilation: 0 errors (`tsc --noEmit` clean)
  - Test Harness Stability: 100% (No unhandled exceptions, zero syntax errors, isolated assertions)

---

## Test Count per Tier

| Tier | Category | Scope | Test Count | Baseline Passed | Baseline Failed | Status |
|---|---|---|:---:|:---:|:---:|:---:|
| **Tier 1** | Feature Coverage (Happy Path) | 9 Features (5 tests per feature) | 45 | 0 | 45 | Ready for M1-M4 |
| **Tier 2** | Boundary & Corner Cases | 5 Boundary Areas (5 tests per area) | 25 | 0 | 25 | Ready for M2 |
| **Tier 3** | Cross-Feature Combinations | Multi-keyword, cycles, approved spec | 15 | 1 | 14 | Ready for M2-M3 |
| **Tier 4** | Real-World Application Scenarios | 5 End-to-End Scenarios | 13 | 0 | 13 | Ready for M1-M4 |
| **Total** | **Full E2E Suite** | **All Tiers (1–4)** | **98** | **1** | **97** | **READY** |

---

## Feature Checklist & Coverage Matrix

| # | Feature | Milestone | Tier 1 Tests | Tier 2 Boundaries | Tier 3 Combinations | Tier 4 Scenarios | Status |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **F1** | Catamorphic Zod 4 Algebra (`createZod4Algebra`) | M1 | T1-F2-1 to T1-F2-5 | - | T3-C-01, T3-C-04 | T4-S1-1 | Ready (Awaiting M1) |
| **F2** | Document Generator Engine (`generateZodFromSpec`) | M1 | T1-F2-1 to T1-F2-5 | - | T3-C-02, T3-C-06, T3-C-11 | T4-S1-1, T4-S2-1, T4-S3-1 | Ready (Awaiting M1) |
| **F3** | Numeric Exclusive Bounds (`.gt()`, `.lt()`) | M2 | T1-F3-1 to T1-F3-5 | T2-B1-1 to T2-B1-5 | T3-C-01, T3-C-07, T3-C-08 | T4-S1-2, T4-S1-3, T4-S2-3 | Ready (Awaiting M2) |
| **F4** | Tuples & Rest (`z.tuple().rest()`) | M2 | T1-F4-1 to T1-F4-5 | T2-B2-1 to T2-B2-5 | T3-C-01, T3-C-04, T3-C-05 | T4-S1-2, T4-S1-3 | Ready (Awaiting M2) |
| **F5** | Object Sealing (`.strict()`) | M2 | T1-F5-1 to T1-F5-5 | T2-B3-1 to T2-B3-5 | T3-C-01, T3-C-03, T3-C-07 | T4-S1-2, T4-S1-3, T4-S3-2 | Ready (Awaiting M2) |
| **F6** | Circular References (`z.lazy()`) | M2 | T1-F6-1 to T1-F6-5 | T2-B4-1 to T2-B4-5 | T3-C-02, T3-C-03, T3-C-15 | T4-S2-2 | Ready (Awaiting M2) |
| **F7** | Discriminator & `defaultMapping` | M2 | T1-F7-1 to T1-F7-5 | T2-B5-1 to T2-B5-5 | T3-C-02, T3-C-04, T3-C-08 | T4-S2-2, T4-S3-2, T4-S3-3 | Ready (Awaiting M2) |
| **F8** | JSDoc & Metadata (`.describe()`, `.default()`) | M2 | T1-F8-1 to T1-F8-5 | - | T3-C-02, T3-C-06, T3-C-09 | T4-S1-2 | Ready (Awaiting M2) |
| **F9** | Dynamic Runtime Validator (`z.fromJSONSchema`) | M3 | T1-F9-1 to T1-F9-5 | - | T3-C-13 | T4-S5-1, T4-S5-2 | Ready (Awaiting M3) |
| **F10** | CLI Command `generate:zod` | M4 | T1-F10-1 to T1-F10-5 | - | - | T4-S4-1, T4-S4-2 | Ready (Awaiting M4) |

---

## Tier 4 Real-World Application Scenarios

1. **Scenario 1: E-commerce Order Lifecycle Schema (`ecommerce-lifecycle.yaml`)**:
   - `T4-S1-1`: Full module code generation.
   - `T4-S1-2`: Validates multi-item order with float money amounts, sealed postal addresses, geographic tuple coordinates, and status enums.
   - `T4-S1-3`: Rejects invalid orders failing exclusive float minimum (`amount: 0`), extra address properties on sealed schema, and invalid coordinate types.
2. **Scenario 2: Recursive File System Tree (`filesystem-tree.yaml`)**:
   - `T4-S2-1`: Full module code generation.
   - `T4-S2-2`: Deeply nested directory hierarchy containing files, nested subdirectories, and symlinks validated at runtime.
   - `T4-S2-3`: Rejects oversized files (> 1GB) and unmapped node types.
3. **Scenario 3: RFC 9457 Problem Details with Extensions (`problem-details.yaml`)**:
   - `T4-S3-1`: Full module code generation.
   - `T4-S3-2`: Validates polymorphic error extensions (`ValidationProblem`, `PaymentProblem`, `ForbiddenProblem`) via URI discriminator.
   - `T4-S3-3`: Fallback routing for unknown error types using OAS 3.2 `defaultMapping`.
4. **Scenario 4: CLI Full Spec Build & Emission**:
   - `T4-S4-1`: Invokes `oa-gen generate:zod` via `runCommand`, writing output to temporary TypeScript files.
   - `T4-S4-2`: Verifies emitted code passes in-process syntax evaluation with Zod 4.
5. **Scenario 5: Dynamic Runtime vs Static Validator Parity**:
   - `T4-S5-1`: Verifies that static emitted schema and in-memory runtime validator produce identical acceptance on valid instances.
   - `T4-S5-2`: Verifies identical rejection and error behaviors on invalid instances.

---

## Progressive Turn-Green Signals for Implementing Agents

Implementing developers can track progress through these test flip milestones:

1. **Milestone 1 Completion (`createZod4Algebra` & `generateZodFromSpec`)**:
   - `T1-F2-1` through `T1-F2-5` turn GREEN (5 tests).
   - Base algebra leaf/composite generation turns GREEN.
2. **Milestone 2 Completion (OAS 3.2 Vocabulary & Circular References)**:
   - `T1-F3-1` to `T1-F3-5` (Exclusive Bounds) turn GREEN (5 tests).
   - `T1-F4-1` to `T1-F4-5` (Tuples & Rest) turn GREEN (5 tests).
   - `T1-F5-1` to `T1-F5-5` (Object Sealing) turn GREEN (5 tests).
   - `T1-F6-1` to `T1-F6-5` (Circular References) turn GREEN (5 tests).
   - `T1-F7-1` to `T1-F7-5` (Discriminator & defaultMapping) turn GREEN (5 tests).
   - `T1-F8-1` to `T1-F8-5` (JSDoc & Metadata) turn GREEN (5 tests).
   - All 25 Tier 2 tests (`T2-B1` through `T2-B5`) turn GREEN (25 tests).
   - Tier 3 combinations turn GREEN (13 tests).
   - Scenarios 1, 2, 3 turn GREEN (9 tests).
   - *Total at M2: ~77 / 98 Passed (78%)*.
3. **Milestone 3 Completion (Dynamic Runtime Validator)**:
   - `T1-F9-1` to `T1-F9-5` turn GREEN (5 tests).
   - `T3-C-13` and `T4-S5-1`, `T4-S5-2` turn GREEN (3 tests).
   - *Total at M3: ~85 / 98 Passed (87%)*.
4. **Milestone 4 Completion (CLI Command `generate:zod`)**:
   - `T1-F10-1` to `T1-F10-5` turn GREEN (5 tests).
   - `T4-S4-1` and `T4-S4-2` turn GREEN (2 tests).
   - Remaining cross-feature interactions complete.
   - *Final Result at M4: **98 / 98 Passed (100%)***.
