## 2026-09-10T23:20:32Z

<USER_REQUEST>
You are the Project Orchestrator for oa-sdk.

## Working Directory & Identity
- Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/orchestrator_3
- Role: Project Orchestrator
- Parent Sentinel: You must keep your progress.md continuously updated in your working directory and message the parent sentinel when completion is claimed.

## Mission & Requirements
Read the authoritative user request at `/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md` (specifically the section `## 2026-09-10T23:19:49Z`).

The request covers Phases 2, 3, and 4 of the TypeSpec ecosystem expansion in oa-sdk:
1. R1 (Phase 2): TypeSpec AST Semantic Diff & Breaking Change Analyzer (`oa-gen tsp diff`, `--fail-on-breaking`, diffing two AST trees or git refs/file paths, breaking vs non-breaking classification, unit/integration tests).
2. R2 (Phase 3): Zero-Build Instant Mock Server (`oa-gen mock --tsp <path>`, `--watch`, compiling in-memory via `@typespec/compiler` without intermediate OpenAPI YAML to disk, feeding in-memory schema to `@oa-sdk/mock-server` on `localhost:4010`).
3. R3 (Phase 4): Personas & DPM Native TypeSpec Decorators (`@personaCapability` and `@pseudonymize` in `@oa-sdk/typespec-decorators`, emitting OpenAPI extensions `x-oa-sdk-persona-traits` and `x-oa-sdk-dpm-projection`, validation gates `pnpm personas:check` and DPM validation).
4. R4: Monorepo Governance, CLI Documentation & Gates (`packages/codegen/src/cli/commands.ts`, `docs/guides/cli-command-reference.md`, `pnpm check:docs`, `pnpm schema:typespec-check`, and `turbo run test` 100% compliance).

Maintain your `plan.md` and `progress.md` in `/Users/junwoobang/workflow/oa-sdk/.agents/orchestrator_3/`.
Decompose into milestones, spawn specialists as needed, monitor execution, verify thoroughly against all acceptance criteria, and report back when completed.
</USER_REQUEST>
