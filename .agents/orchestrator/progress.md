# Progress — oa-sdk 4 Upstream Architectural Proposals

## Current Status
Last visited: 2026-09-02T15:22:00Z

## Iteration Status
Current iteration: 2 / 32

## Checklist
- [x] Phase 0: Survey & Project Blueprint (PROJECT.md)
  - [x] Explorer 1: Spec Miner on `oa-sdk-integration-proposals.md` -> `spec_inventory.md`
  - [x] Explorer 2: Monorepo Architecture & Package Survey -> `analysis.md`
  - [x] Explorer 3: Existing Codegen, Parser, Schemas, Spec-Lens Survey -> `analysis.md`
  - [x] Synthesize Survey -> Created `PROJECT.md` and `TEST_INFRA.md`
- [x] Phase 1: Launch E2E Testing Track + Implementation Track Milestones
  - [x] E2E Testing Track: Requirements-based test suite (Tiers 1-4, 192 tests) -> `TEST_READY.md`
  - [x] Milestone 1: Native Discriminated Union Projection (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/codegen`)
  - [x] Milestone 2: Non-AST Character Range Patching Metadata Extensions (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/parser`)
  - [x] Milestone 3: Standalone Lightweight Type Guard Generator Plugin (`@oa-sdk/codegen`)
  - [x] Milestone 4: TypeScript AST Bidirectional Synchronization (`@oa-sdk/codegen`, `@oa-sdk/spec-lens`, `@oa-sdk/schemas`)
- [x] Phase 2: Final Milestone
  - [x] Phase 1: 100% E2E test suite pass
  - [x] Phase 2: Tier 5 adversarial coverage hardening & remediation (100% pass)
- [x] Phase 3: Final Verification & Completion Report
