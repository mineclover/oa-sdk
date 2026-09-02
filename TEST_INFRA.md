# E2E Test Infra: 4 Upstream Architectural Proposals in `@oa-sdk/*`

## Test Philosophy
- Opaque-box, requirement-driven. Derives test cases strictly from `ORIGINAL_REQUEST.md` and `oa-sdk-integration-proposals.md`.
- Zero coupling to internal module implementation details.
- Systematic 4-tier methodology:
  - **Tier 1: Feature Coverage (>=5 tests per feature)**: Equivalence class happy-path tests in isolation.
  - **Tier 2: Boundary & Corner Cases (>=5 tests per feature)**: Bounds, malformed coordinates, drift conflicts, recursive schemas, syntax edge cases.
  - **Tier 3: Cross-Feature Combinations (Pairwise coverage)**: Multi-feature workflows (e.g. projecting discriminated unions with `x-surface-*` metadata, then compiling to standalone guards, then synchronizing AST).
  - **Tier 4: Real-World Application Scenarios (>=5 realistic scenarios)**: End-to-end browser extension message passing, MCP stdio server RPC pipelines, live visual design surface patching.

## Feature Inventory & Test Coverage Goals

| # | Feature | Requirement Source | Tier 1 Goal | Tier 2 Goal | Tier 3 Interaction |
|---|---------|-------------------|:-----------:|:-----------:|:------------------:|
| 1 | `projectDiscriminatedUnion` Core API | Proposal 1 Spec §1.3 | 5 | 5 | ✓ |
| 2 | Single-Stream Multiplexed RPC Projection | Proposal 1 Spec §1.2 | 5 | 5 | ✓ |
| 3 | MCP Stdio Protocol Projection | Proposal 1 Spec §1.2 | 5 | 5 | ✓ |
| 4 | Projection Profile Integration | `@oa-sdk/openapi-projection-contract` | 5 | 5 | ✓ |
| 5 | `zod-to-schema` Discriminated Union Emission | Proposal 1 Spec §1.3 | 5 | 5 | ✓ |
| 6 | `x-surface-anchor` Extension | Proposal 2 Spec §2.2 | 5 | 5 | ✓ |
| 7 | `x-surface-param-range` Extension | Proposal 2 Spec §2.2 | 5 | 5 | ✓ |
| 8 | `x-surface-fingerprint` Extension | Proposal 2 Spec §2.2 | 5 | 5 | ✓ |
| 9 | `x-surface-quote-style` Extension | Proposal 2 Spec §2.2 | 5 | 5 | ✓ |
| 10 | `x-surface-patch-policy` Extension | Proposal 2 Spec §2.2 | 5 | 5 | ✓ |
| 11 | Parser Linting Rules for `x-surface-*` | Proposal 2 Spec §2.4 | 5 | 5 | ✓ |
| 12 | `generateStandaloneGuards` Core API | Proposal 3 Spec §3.2 | 5 | 5 | ✓ |
| 13 | CLI `oa-codegen --target standalone-guards` | Proposal 3 Spec §3.3 | 5 | 5 | ✓ |
| 14 | Pure ESM Zero-Dependency Output Invariant | Proposal 3 Spec §3.1 | 5 | 5 | ✓ |
| 15 | TypeScript Guard Signature Generation | Proposal 3 Spec §3.2 | 5 | 5 | ✓ |
| 16 | `EntitySpec` Canonical IR | Proposal 4 Spec §4.2 | 5 | 5 | ✓ |
| 17 | Pluggable `TypeAdapter` Interface | Proposal 4 Spec §4.3 | 5 | 5 | ✓ |
| 18 | `ZodTypeAdapter` | Proposal 4 Spec §4.2 | 5 | 5 | ✓ |
| 19 | `TsAstTypeAdapter` | Proposal 4 Spec §4.2 | 5 | 5 | ✓ |
| 20 | `TypiaTypeAdapter` | Proposal 4 Spec §4.2 | 5 | 5 | ✓ |
| 21 | `computeEntitySpecDiff` Engine | Proposal 4 Spec §4.2 | 5 | 5 | ✓ |
| 22 | Reverse-Offset Bottom-Up `TextEdit` Patching | Proposal 4 Spec §4.2 | 5 | 5 | ✓ |
| 23 | `syncEntitySpecWithCode` Core Synchronizer | Proposal 4 Spec §4.2 | 5 | 5 | ✓ |

## Test Architecture
- Harness Location: `packages/codegen/test/e2e/`, `packages/openapi-projection-contract/test/e2e/`, `packages/parser/test/e2e/`
- Test Runner: Node test runner (`node --test`) / Vitest (`pnpm test`)
- Pass/Fail Semantics: Exit code 0, all assertions pass, strict schema & type validation.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Chrome Native Messaging 4-byte RPC Stream Projection | F1, F2, F4, F12, F14, F15 | High |
| 2 | MCP Stdio Protocol Server Projection & Standalone Type Guard Validation | F1, F3, F4, F12, F13, F14, F15 | High |
| 3 | Visual Design Tool 60fps Parameter Slider Byte Patching with Drift Resolution | F6, F7, F8, F9, F10, F21, F22 | High |
| 4 | Bi-Directional Schema Evolution: Zod Schema <-> TypeScript Interface AST Sync | F16, F17, F18, F20, F21, F22, F23 | High |
| 5 | JSDoc/Typia Validated Interface AST Synchronization with Preserved Comments & Trivia | F16, F19, F20, F21, F22, F23 | High |
| 6 | End-to-End Proposal Pipeline: Multi-Variant Schema -> Projection -> Standalone Guards -> AST Code Sync | F1, F4, F6, F11, F13, F14, F23 | Very High |
