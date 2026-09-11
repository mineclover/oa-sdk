# Orchestration Plan: TypeSpec Ecosystem Expansion (Phases 2, 3, 4)

## Objective
Implement Phases 2, 3, and 4 of the TypeSpec ecosystem expansion in `oa-sdk`:
1. R1: TypeSpec AST Semantic Diff & Breaking Change Analyzer (`oa-gen tsp diff`)
2. R2: Zero-Build Instant Mock Server (`oa-gen mock --tsp <path>`, `--watch`)
3. R3: Personas & DPM Native TypeSpec Decorators (`@personaCapability`, `@pseudonymize`)
4. R4: Monorepo Governance, CLI Documentation & Verification Gates (`pnpm check:docs`, `pnpm schema:typespec-check`, `turbo run test`)

## Phases

### Phase 0: Survey & Scoping
- Spawn 3 parallel specialists:
  - Specialist 1 (Explorer): Survey `packages/codegen` CLI commands, existing TypeSpec usage/parsing in monorepo, AST structures, and semantic diff requirements.
  - Specialist 2 (Explorer): Survey `@oa-sdk/mock-server`, `@typespec/compiler` in-memory compilation, schema feeding, and watcher integration.
  - Specialist 3 (Spec Miner): Survey `@oa-sdk/typespec-decorators`, `@oa-sdk/personas`, and `@oa-sdk/dpm` for decorator implementations, OpenAPI extension schemas (`x-oa-sdk-persona-traits`, `x-oa-sdk-dpm-projection`), and validation gates.
- Aggregate reports into `PROJECT.md § Feature Inventory` and define milestone architecture and interface contracts.

### Phase 1: Dual Track Launch
- Track A: E2E Testing Orchestrator (Opaque-box test suite for all features across Tiers 1-4).
- Track B: Implementation Track (Milestone Sub-orchestrators).

### Phase 2: Implementation Milestones
- Milestone 1: TypeSpec AST Semantic Diff (`oa-gen tsp diff`, `--fail-on-breaking`, breaking change classification, AST comparison).
- Milestone 2: Zero-Build Instant Mock Server (`oa-gen mock --tsp`, in-memory compiler, `@oa-sdk/mock-server` feeding, hot-reloading file watcher).
- Milestone 3: Native TypeSpec Decorators (`@personaCapability`, `@pseudonymize`, compiler emission to extensions, integration with `personas:check` and DPM).
- Milestone 4: CLI Registration, Docs, & Monorepo Gates (`packages/codegen/src/cli/commands.ts`, `docs/guides/cli-command-reference.md`, `pnpm check:docs`, `pnpm schema:typespec-check`).

### Phase 3: Acceptance & Hardening
- Pass 100% E2E test suite (Tiers 1-4).
- Tier 5 Adversarial Coverage Hardening.
- Final forensic audit and verification.
