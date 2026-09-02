# Implementation Plan: 4 Upstream Architectural Proposals in `@oa-sdk/*`

## Overview
Implement the 4 upstream architectural proposals:
1. Native Discriminated Union Projection (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/codegen`)
2. Non-AST Character Range Patching Metadata Extensions (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/parser`)
3. Standalone Lightweight Type Guard Generator Plugin (`@oa-sdk/codegen`)
4. TypeScript AST Bidirectional Synchronization (`@oa-sdk/codegen`, `@oa-sdk/spec-lens`, `@oa-sdk/schemas`)

## Execution Phases

### Phase 0: Survey & Project Blueprint
- Dispatch 3 Explorers (including Spec-Miner) to analyze:
  - Specification document (`/Users/junwoobang/workflow/browser-studio/docs/specs/oa-sdk-integration-proposals.md`)
  - Target packages, existing contracts, test frameworks, scripts, dependencies
- Synthesize into `PROJECT.md` (Feature Inventory, Architecture, Milestones, Interface Contracts, Code Layout) and `TEST_INFRA.md`.

### Phase 1: Dual Track Execution
- **Track A: E2E Testing Track**
  - Build opaque-box requirement-driven tests covering Tiers 1-4 across all 4 proposals.
  - Publish `TEST_READY.md`.
- **Track B: Implementation Track Milestones**
  - Milestone 1: Native Discriminated Union Projection
  - Milestone 2: Non-AST Character Range Patching Metadata Extensions
  - Milestone 3: Standalone Lightweight Type Guard Generator Plugin
  - Milestone 4: TypeScript AST Bidirectional Synchronization

### Phase 2: Final Milestone
- Tier 1-4 full suite pass
- Tier 5 adversarial coverage hardening

### Phase 3: Monorepo Verification & Final Report
- Monorepo full typecheck (`pnpm -r typecheck` / `pnpm run check`)
- Monorepo full test suite (`pnpm test`)
- Final handoff and completion report to user
