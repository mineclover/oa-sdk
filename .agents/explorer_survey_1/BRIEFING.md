# BRIEFING — 2026-09-11T08:25:00Z

## Mission
Investigate requirement R1 (Phase 2): TypeSpec AST Semantic Diff & Breaking Change Analyzer in @oa-sdk/codegen and produce a comprehensive survey and blueprint report.

## 🔒 My Identity
- Archetype: Explorer
- Roles: Investigation, Synthesis
- Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_1
- Original parent: c8e6c449-4228-4443-bc32-e90615c118a5
- Milestone: Survey R1 Standalone Guards Splitting & Filtering
- Role: TypeSpec AST Diff Explorer
- Current parent: c665389a-7f3c-4d31-a717-f16983c4bb03
- Milestone: Survey R1 (Phase 2) TypeSpec AST Semantic Diff & Breaking Change Analyzer

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Produce 5-component handoff report (Observation, Logic Chain, Caveats, Conclusion, Verification Method)
- .agents/ holds only agent metadata
- Strictly read-only on codebase during survey phase

## Current Parent
- Conversation ID: c665389a-7f3c-4d31-a717-f16983c4bb03
- Updated: 2026-09-11T08:25:00Z

## Investigation State
- **Explored paths**:
  - `packages/codegen/package.json`
  - `packages/codegen/src/cli/index.ts`
  - `packages/codegen/src/cli/commands.ts`
  - `packages/codegen/src/cli/commands/diff.ts`
  - `packages/codegen/src/cli/commands/tsp-*.ts`
  - `packages/codegen/src/cli/lib/openapi-breaking-diff.ts`
  - `packages/codegen/src/cli/lib/typespec-ref-provenance.ts`
  - `packages/codegen/src/cli/lib/typespec-bundle-check.ts`
  - `packages/codegen/src/schema-governance.ts`
  - `packages/typespec-erd/src/extract.ts`
  - `packages/typespec-decorators/src/decorators.ts`
  - `scripts/check-cli-spec.ts`
  - `scripts/check-docs.ts`
  - `scripts/schema-typespec-check.ts`
  - `docs/guides/cli-command-reference.md`
- **Key findings**:
  - `@typespec/compiler` (^1.13.0), `@typespec/http`, and `@typespec/openapi` are already direct dependencies in `@oa-sdk/codegen`.
  - `@typespec/compiler` provides programmatic `compile(NodeHost, path, { noEmit: true })` and `navigateProgram(program, visitor)` that compile and traverse the full semantic AST without disk artifacts.
  - `@typespec/http` provides `getAllHttpServices(program)` directly yielding all HTTP operations, route paths, HTTP verbs, parameters, and response status codes.
  - `@typespec/openapi` provides `getOperationId(program, operation)` for checking `@operationId` drift.
  - Model inspection via `navigateProgram` exposes named models and `model.properties` with `.optional`, `.type`, etc., enabling exact detection of removed models, removed properties, newly required properties, and type changes.
  - Git ref vs file path resolution can support both local `.tsp` files/directories and git refs (via temporary tree extraction or `git archive` / `git show`).
  - Command routing in `oa-gen` needs multi-token dispatch in `src/cli/index.ts` to support `oa-gen tsp diff` alongside aliases `tsp:diff` and `tsp-diff`.
  - CLI governance requires registering `tsp-diff` (kebab-case) in `oaGenGovernanceManifest`, adding coverage to `docs/guides/cli-command-reference.md`, and documenting options to satisfy `check:docs` and `check:cli-spec`.
- **Unexplored areas**: None.

## Key Decisions Made
- Confirmed programmatic `@typespec/compiler` + `@typespec/http` + `@typespec/openapi` AST semantic diff architecture.
- Designed complete 7-category breaking change classification engine with parity to existing `openapi-breaking-diff.ts`.
- Formulated exact file layout and test strategy for implementation in `packages/codegen`.

## Artifact Index
- /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_1/BRIEFING.md — Situational awareness
- /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_1/DISPATCH.md — Incoming task log
- /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_1/progress.md — Liveness & heartbeat
- /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_1/handoff.md — Final survey report

